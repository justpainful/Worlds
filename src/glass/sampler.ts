/**
 * What is behind a piece of glass, measured where the glass is.
 *
 * A grid of probes looks through the surface (skipping the glass itself and
 * anything above it) and composites, bottom to top, what each layer paints
 * at that point: image and video pixels, background colours and gradients,
 * other glass as it appears, and text weighted by how much of the probe it
 * covers. The result is the scene's colour, its lightness (relative
 * luminance), how busy it is, and how colourful. Each surface is measured on
 * its own, never the page as a whole.
 */

export interface Ambient {
  r: number;
  g: number;
  b: number;
  /** Relative luminance 0..1 (0.2126 R + 0.7152 G + 0.0722 B, linear light). */
  luminance: number;
  /** Spread of luminance across the probes, 0..1: text and detail read busy. */
  busy: number;
  chroma: number;
}

type RGB = [number, number, number];

export const DARK_AMBIENT: Ambient = { r: 28, g: 28, b: 30, luminance: 0.012, busy: 0, chroma: 0 };

const GRID = [0.15, 0.5, 0.85];

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
export const luminance = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

function parseColor(s: string): [number, number, number, number] | null {
  const m = s.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith("%")) a /= 100;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
}

/** A gradient is approximated by the mean of its colour stops. */
function gradientColor(img: string): [number, number, number, number] | null {
  const stops = img.match(/rgba?\([^)]+\)/g);
  if (!stops) return null;
  const cs = stops.map(parseColor).filter(Boolean) as [number, number, number, number][];
  if (!cs.length) return null;
  const sum = cs.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2], a[3] + c[3]], [0, 0, 0, 0]);
  return [sum[0] / cs.length, sum[1] / cs.length, sum[2] / cs.length, sum[3] / cs.length];
}

const pixelCache = new WeakMap<Element, { src: string; at: number; data: Uint8ClampedArray | null }>();
const scratch = document.createElement("canvas");
scratch.width = scratch.height = 16;
const sctx = scratch.getContext("2d", { willReadFrequently: true })!;

/** Pixels of an image or video, 16x16, when the browser lets us read them. */
function mediaColor(el: HTMLImageElement | HTMLVideoElement, x: number, y: number): RGB | null {
  const video = el instanceof HTMLVideoElement;
  const src = video ? el.currentSrc || el.poster : el.currentSrc || el.src;
  const ready = video ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
  if (!src || !ready) return null;
  let hit = pixelCache.get(el);
  if (!hit || hit.src !== src || (video && performance.now() - hit.at > 1000)) {
    hit = { src, at: performance.now(), data: null };
    try {
      sctx.clearRect(0, 0, 16, 16);
      sctx.drawImage(el, 0, 0, 16, 16);
      hit.data = sctx.getImageData(0, 0, 16, 16).data;
    } catch {
      hit.data = null; // not ours to read
    }
    pixelCache.set(el, hit);
  }
  if (!hit.data) return null;
  const r = el.getBoundingClientRect();
  const u = Math.min(15, Math.max(0, Math.floor(((x - r.left) / r.width) * 16)));
  const v = Math.min(15, Math.max(0, Math.floor(((y - r.top) / r.height) * 16)));
  const i = (v * 16 + u) * 4;
  return [hit.data[i], hit.data[i + 1], hit.data[i + 2]];
}

function over(base: RGB, c: RGB, a: number): RGB {
  return [base[0] + (c[0] - base[0]) * a, base[1] + (c[1] - base[1]) * a, base[2] + (c[2] - base[2]) * a];
}

/** The colour seen through the point, composited bottom-up from the stack below `skip`. */
function probe(x: number, y: number, skip: Element, canvasColor: RGB): RGB {
  const stack = document.elementsFromPoint(x, y);
  // Everything above and including the glass is not behind it.
  const at = stack.findIndex((e) => e === skip || skip.contains(e));
  const below = at >= 0 ? stack.slice(at + 1) : stack;
  const layers: { c: RGB; a: number }[] = [];
  for (const el of below) {
    if (skip.contains(el) || el.closest("[data-glass-id]") === skip) continue;
    // Lower glass is seen as it appears (the engine publishes that colour).
    const seen = (el as HTMLElement).dataset?.glassSeen;
    if (seen) {
      const [r, g, b] = seen.split(",").map(Number);
      layers.push({ c: [r, g, b], a: 1 });
      break;
    }
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      const c = mediaColor(el, x, y);
      if (c) {
        layers.push({ c, a: 1 });
        break;
      }
    }
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    // Text: its colour, weighted by how much of a probe it covers.
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) {
      const tc = parseColor(cs.color);
      if (tc) layers.push({ c: [tc[0], tc[1], tc[2]], a: 0.18 * tc[3] });
    }
    const img = cs.backgroundImage;
    if (img && img !== "none" && img.includes("gradient(")) {
      const g = gradientColor(img);
      if (g) layers.push({ c: [g[0], g[1], g[2]], a: g[3] });
    }
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg[3] > 0) {
      layers.push({ c: [bg[0], bg[1], bg[2]], a: bg[3] });
      if (bg[3] >= 0.98) break;
    }
  }
  let c: RGB = canvasColor;
  for (let i = layers.length - 1; i >= 0; i--) c = over(c, layers[i].c, layers[i].a);
  return c;
}

/** Measure the scene behind `el` (rect in viewport pixels). */
export function sample(el: Element, rect: DOMRect, canvasColor: RGB): Ambient {
  const cs: RGB[] = [];
  for (const fy of GRID) {
    for (const fx of GRID) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      cs.push(probe(x, y, el, canvasColor));
    }
  }
  if (!cs.length) return { ...DARK_AMBIENT, r: canvasColor[0], g: canvasColor[1], b: canvasColor[2], luminance: luminance(canvasColor) };
  const n = cs.length;
  const mean: RGB = [cs.reduce((a, c) => a + c[0], 0) / n, cs.reduce((a, c) => a + c[1], 0) / n, cs.reduce((a, c) => a + c[2], 0) / n];
  const ls = cs.map(luminance);
  const lm = ls.reduce((a, b) => a + b, 0) / n;
  const busy = Math.min(1, Math.sqrt(ls.reduce((a, l) => a + (l - lm) * (l - lm), 0) / n) * 4);
  const mx = Math.max(...mean);
  const mn = Math.min(...mean);
  return { r: mean[0], g: mean[1], b: mean[2], luminance: luminance(mean), busy, chroma: mx > 0 ? (mx - mn) / mx : 0 };
}
