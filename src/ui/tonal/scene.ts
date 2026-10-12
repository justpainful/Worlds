/**
 * Tonal controls: what is behind each control decides its colour.
 *
 * A control is opaque. Its fill is the scene's own hue, quieted and moved to
 * a fixed distance in lightness (darker scenes get a lifted dark fill, light
 * scenes a near white one), so a control on a green cover is a deep or pale
 * green, on the dark canvas a soft graphite, on white a white chip with a
 * shadow. Ink is chosen against the fill itself, never against the scene, so
 * text and icons always read, whatever the sampler sees.
 *
 * Controls that sit together (a toolbar row, the Home controls) share one
 * tone: the row is measured as a whole (`data-tonal-group` on the container),
 * so one bar never mixes a white button with a coloured one.
 *
 * One scheduler measures every mounted control: on mount, after images load,
 * while and after scrolling, on resize, and every couple of seconds. Only
 * controls in the viewport are measured.
 */
import { sample, type Ambient } from "../../glass/sampler";

export interface Tone {
  dark: boolean;
  fill: string;
  hover: string;
  thumb: string;
}

const CANVAS: [number, number, number] = [28, 28, 31];

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const css = (h: number, s: number, l: number) => `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;

export type TonalLook = "auto" | "light" | "dark";
let look: TonalLook = "auto";

/**
 * The control's colours for a scene. `wasDark` keeps a control from flickering
 * at the threshold; a forced look (Settings, Glass tone) keeps the hue but
 * fixes light or dark.
 */
export function toneFor(a: Ambient, wasDark?: boolean, forced: TonalLook = look): Tone {
  const [h, s, l] = hsl(a.r, a.g, a.b);
  // Light scenes get light controls; a band around the threshold keeps the last choice.
  const lum = a.luminance;
  const dark = forced !== "auto" ? forced === "dark" : wasDark === undefined ? lum < 0.34 : wasDark ? lum < 0.4 : lum < 0.28;
  // Colour is a whisper of the scene's hue: enough to belong, never a coloured button.
  const sat = Math.min(s, 0.7) * (dark ? 0.22 : 0.16);
  if (dark) {
    const base = Math.min(0.3, Math.max(0.17, l + 0.08));
    return { dark, fill: css(h, sat, base), hover: css(h, sat, base + 0.045), thumb: css(h, sat * 1.1, base + 0.085) };
  }
  const base = Math.min(0.985, Math.max(0.93, l + 0.08));
  return { dark, fill: css(h, sat, base), hover: css(h, sat, base - 0.035), thumb: css(h, sat * 0.8, base - 0.075) };
}

interface Entry {
  el: HTMLElement;
  /** The row whose scene this control shares, if any. */
  group: HTMLElement | null;
  dark?: boolean;
  key?: string;
}

const entries = new Set<Entry>();
let timer = 0;
let scheduled = false;

const visible = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= innerHeight && r.right >= 0 && r.left <= innerWidth;

/** One measurement per row and pass; a lone control is its own row. */
function measure(e: Entry, cache: Map<HTMLElement, Tone | null>): Tone | null {
  const src = e.group ?? e.el;
  if (cache.has(src)) return cache.get(src)!;
  const r = src.getBoundingClientRect();
  const t = visible(r) ? toneFor(sample(src, r, CANVAS), e.dark) : null;
  cache.set(src, t);
  return t;
}

function apply(e: Entry, cache = new Map<HTMLElement, Tone | null>()) {
  if (!visible(e.el.getBoundingClientRect())) return;
  const t = measure(e, cache);
  if (!t) return;
  const key = `${t.dark}|${t.fill}`;
  if (key === e.key) return;
  e.key = key;
  e.dark = t.dark;
  const st = e.el.style;
  st.setProperty("--tn-fill", t.fill);
  st.setProperty("--tn-hover", t.hover);
  st.setProperty("--tn-thumb", t.thumb);
  e.el.dataset.tone = t.dark ? "dark" : "light";
}

function run() {
  scheduled = false;
  const cache = new Map<HTMLElement, Tone | null>();
  for (const e of entries) apply(e, cache);
}

/** Settings, Glass tone: Automatic, Light or Dark for every control. */
export function setTonalLook(next: TonalLook) {
  if (next === look) return;
  look = next;
  for (const e of entries) {
    e.key = undefined;
    e.dark = undefined;
  }
  retone();
}

/** Measure every control on the next frame (coalesced). */
export function retone() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(run);
}

let lastScroll = 0;
let scrollEnd = 0;
function onScroll() {
  // While scrolling, at most every 120 ms; once more when it settles.
  const now = performance.now();
  if (now - lastScroll > 120) {
    lastScroll = now;
    retone();
  }
  clearTimeout(scrollEnd);
  scrollEnd = window.setTimeout(retone, 140);
}

function start() {
  addEventListener("scroll", onScroll, { capture: true, passive: true });
  addEventListener("resize", retone);
  // Images and video (covers) change the scene when they arrive.
  addEventListener("load", retone, true);
  addEventListener("loadeddata", retone, true);
  timer = window.setInterval(retone, 1800);
}

function stop() {
  removeEventListener("scroll", onScroll, { capture: true });
  removeEventListener("resize", retone);
  removeEventListener("load", retone, true);
  removeEventListener("loadeddata", retone, true);
  clearInterval(timer);
}

export function track(el: HTMLElement): () => void {
  const e: Entry = { el, group: el.parentElement?.closest<HTMLElement>("[data-tonal-group]") ?? null };
  if (!entries.size) start();
  entries.add(e);
  apply(e);
  // Layout and images settle just after mount.
  const t1 = window.setTimeout(() => apply(e), 90);
  const t2 = window.setTimeout(() => apply(e), 450);
  return () => {
    clearTimeout(t1);
    clearTimeout(t2);
    entries.delete(e);
    if (!entries.size) stop();
  };
}
