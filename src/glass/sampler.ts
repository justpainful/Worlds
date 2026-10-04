/**
 * Backdrop sampling.
 *
 * Estimates what is behind a glass surface from a 4x4 grid of probes. Each
 * probe walks the element stack under that point (skipping the surface
 * itself) and reads real colour: image/video pixels via a small CORS-clean
 * canvas, computed background colours, text colour weighted by coverage,
 * and the already-composited appearance of lower glass surfaces.
 *
 * The result drives adaptive tint, colour spill, blur, saturation,
 * brightness and edge-light intensity. It runs throttled and never during
 * fast scrolling.
 */

export interface Ambient {
  r: number;
  g: number;
  b: number;
  /** Mean relative luminance, 0..1. */
  luminance: number;
  /** Luminance spread across probes, 0..1 (busy backdrops need more blur). */
  variance: number;
  /** Colourfulness, 0..1 (already-saturated scenes get less saturation). */
  chroma: number;
}

export const NEUTRAL_AMBIENT: Ambient = { r: 28, g: 28, b: 30, luminance: 0.012, variance: 0, chroma: 0 };

type RGB = [number, number, number];

const FRACTIONS = [0.12, 0.37, 0.63, 0.88];

interface PixelCache {
  src: string;
  w: number;
  h: number;
  data: Uint8ClampedArray | null;
  at: number;
}
const mediaCache = new WeakMap<HTMLImageElement | HTMLVideoElement, PixelCache>();
const scratch = document.createElement("canvas");
scratch.width = scratch.height = 24;
const sctx = scratch.getContext("2d", { willReadFrequently: true })!;

function mediaPixels(el: HTMLImageElement | HTMLVideoElement): PixelCache | null {
  const isVideo = el instanceof HTMLVideoElement;
  const src = isVideo ? el.currentSrc || el.poster : el.currentSrc || el.src;
  const ready = isVideo ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
  if (!ready || !src) return null;
  const hit = mediaCache.get(el);
  const fresh = hit && hit.src === src && (!isVideo || performance.now() - hit.at < 1200);
  if (fresh) return hit!;
  const entry: PixelCache = { src, w: 24, h: 24, data: null, at: performance.now() };
  try {
    sctx.clearRect(0, 0, 24, 24);
    sctx.drawImage(el, 0, 0, 24, 24);
    entry.data = sctx.getImageData(0, 0, 24, 24).data;
  } catch {
    entry.data = null; // tainted (no CORS) – fall back to element colour
  }
  mediaCache.set(el, entry);
  return entry;
}

function parseColor(c: string): [number, number, number, number] | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/** Average colour of every rgb()/rgba() stop in a background-image (gradients). */
function gradientColor(img: string): [number, number, number, number] | null {
  const stops = img.match(/rgba?\([^)]+\)/g);
  if (!stops?.length) return null;
  let r = 0, g = 0, b = 0, a = 0;
  for (const st of stops) {
    const c = parseColor(st);
    if (!c) continue;
    r += c[0] * c[3];
    g += c[1] * c[3];
    b += c[2] * c[3];
    a += c[3];
  }
  if (a <= 0) return null;
  return [r / a, g / a, b / a, a / stops.length];
}

const SIDE_ANGLE: Record<string, number> = {
  "to top": 0, "to right": 90, "to bottom": 180, "to left": 270,
  "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135,
  "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315,
};

/**
 * Colour of a (non-repeating) linear gradient at a point, so glass over a
 * banner or a tinted panel takes the colour actually behind it. Anything it
 * cannot resolve falls back to the average of the stops.
 */
function gradientAt(img: string, rect: DOMRect, x: number, y: number): [number, number, number, number] | null {
  const m = img.match(/^linear-gradient\((.*)\)$/);
  if (!m || img.indexOf("gradient(", 16) !== -1) return gradientColor(img);
  const parts = m[1].split(/,(?![^(]*\))/).map((p) => p.trim());
  let angle = 180;
  const head = parts[0];
  if (/^-?[\d.]+deg$/.test(head)) {
    angle = parseFloat(head);
    parts.shift();
  } else if (head in SIDE_ANGLE) {
    angle = SIDE_ANGLE[head];
    parts.shift();
  }
  const stops: { c: [number, number, number, number]; at: number | null }[] = [];
  for (const p of parts) {
    const cm = p.match(/rgba?\([^)]+\)/);
    const c = cm ? parseColor(cm[0]) : null;
    if (!c) return gradientColor(img);
    const pm = p.slice(cm![0].length).match(/(-?[\d.]+)%/);
    stops.push({ c, at: pm ? parseFloat(pm[1]) / 100 : null });
  }
  if (stops.length < 2) return gradientColor(img);
  stops[0].at ??= 0;
  stops[stops.length - 1].at ??= 1;
  for (let i = 1; i < stops.length - 1; i++) {
    if (stops[i].at !== null) continue;
    let j = i;
    while (stops[j].at === null) j++;
    const a0 = stops[i - 1].at!, a1 = stops[j].at!;
    for (let k = i; k < j; k++) stops[k].at = a0 + ((a1 - a0) * (k - i + 1)) / (j - i + 1);
  }
  // Project the point on the gradient line (CSS: length |w sin| + |h cos|).
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const len = Math.abs(rect.width * dx) + Math.abs(rect.height * dy) || 1;
  const px = x - (rect.left + rect.width / 2), py = y - (rect.top + rect.height / 2);
  const t = Math.min(1, Math.max(0, (px * dx + py * dy) / len + 0.5));
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1].at!) i++;
  const s0 = stops[i], s1 = stops[i + 1];
  const k = s1.at! > s0.at! ? Math.min(1, Math.max(0, (t - s0.at!) / (s1.at! - s0.at!))) : 1;
  return [0, 1, 2, 3].map((n) => s0.c[n] + (s1.c[n] - s0.c[n]) * k) as [number, number, number, number];
}

function srgbToLin(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function luminanceOf([r, g, b]: RGB) {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

export interface SampleContext {
  /** Is this element part of the surface being sampled (to skip)? */
  isSelf: (el: Element) => boolean;
  /** If `el` is a lower glass surface, its composited appearance colour. */
  glassColor: (el: Element) => RGB | null;
  canvas: RGB;
}

function probe(x: number, y: number, ctx: SampleContext, styleCache: Map<Element, CSSStyleDeclaration>): RGB {
  const stack = document.elementsFromPoint(x, y);
  const style = (el: Element) => {
    let s = styleCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };
  let textTint: RGB | null = null;
  for (const el of stack) {
    if (ctx.isSelf(el)) continue;
    const glass = ctx.glassColor(el);
    if (glass) return mixText(glass, textTint);
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      const px = mediaPixels(el);
      if (px?.data) {
        const r = el.getBoundingClientRect();
        const u = Math.min(23, Math.max(0, Math.floor(((x - r.left) / r.width) * 24)));
        const v = Math.min(23, Math.max(0, Math.floor(((y - r.top) / r.height) * 24)));
        const i = (v * 24 + u) * 4;
        if (px.data[i + 3] > 20) return mixText([px.data[i], px.data[i + 1], px.data[i + 2]], textTint);
      }
    }
    const s = style(el);
    // Text directly under the probe contributes its colour, weighted by
    // typical glyph coverage.
    if (!textTint && hasOwnText(el)) {
      const c = parseColor(s.color);
      if (c && c[3] > 0.2) textTint = [c[0], c[1], c[2]];
    }
    // CSS gradients count too (banners, tinted panels, test backdrops): average their stops.
    const grad = s.backgroundImage && s.backgroundImage.includes("gradient(") ? gradientAt(s.backgroundImage, el.getBoundingClientRect(), x, y) : null;
    if (grad && grad[3] > 0.5) return mixText([grad[0], grad[1], grad[2]], textTint);
    const bg = parseColor(s.backgroundColor);
    if (bg && bg[3] > 0.05) {
      if (bg[3] >= 0.95) return mixText([bg[0], bg[1], bg[2]], textTint);
      // translucent background: blend over whatever is below (approximate with canvas)
      const a = bg[3];
      return mixText(
        [bg[0] * a + ctx.canvas[0] * (1 - a), bg[1] * a + ctx.canvas[1] * (1 - a), bg[2] * a + ctx.canvas[2] * (1 - a)],
        textTint,
      );
    }
  }
  return mixText(ctx.canvas, textTint);
}

function hasOwnText(el: Element) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) return true;
  }
  return false;
}

function mixText(base: RGB, text: RGB | null): RGB {
  if (!text) return base;
  const k = 0.14;
  return [base[0] * (1 - k) + text[0] * k, base[1] * (1 - k) + text[1] * k, base[2] * (1 - k) + text[2] * k];
}

export function sample(rect: DOMRect, ctx: SampleContext): Ambient {
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const colors: RGB[] = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (const fy of FRACTIONS) {
    for (const fx of FRACTIONS) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      colors.push(probe(x, y, ctx, styleCache));
    }
  }
  if (colors.length === 0) return NEUTRAL_AMBIENT;
  let r = 0, g = 0, b = 0;
  const lums: number[] = [];
  let chroma = 0;
  for (const c of colors) {
    r += c[0];
    g += c[1];
    b += c[2];
    lums.push(luminanceOf(c));
    const mx = Math.max(c[0], c[1], c[2]);
    const mn = Math.min(c[0], c[1], c[2]);
    chroma += mx > 0 ? (mx - mn) / 255 : 0;
  }
  const n = colors.length;
  const mean = lums.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(lums.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n);
  return {
    r: r / n,
    g: g / n,
    b: b / n,
    luminance: mean,
    variance: Math.min(1, sd * 3.2),
    chroma: Math.min(1, chroma / n),
  };
}
