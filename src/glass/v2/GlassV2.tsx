/**
 * Liquid Glass V2 surface (lab only for now). Same idea as Glass: the optics
 * read the real backdrop through the SVG filter; the outer interface, shade
 * and light are layers drawn from the same surface; content never passes
 * through the optics.
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
import { createFilter, updateFilter, type DebugView, type FilterV2 } from "./filterGraph";
import { buildMaps, type MapsV2 } from "./maps";
import { regularToolbarV2, type ProfileV2, type SceneTriple } from "./profile";
import { sample, DARK_AMBIENT, type Ambient } from "../sampler";
import { maxExposure, type Shape } from "./surface";
import "./glassV2.css";

export interface DebugV2 {
  optics: boolean;
  displacement: boolean;
  frost: boolean;
  lighting: boolean;
  view: DebugView;
  sign: 1 | -1;
}

export const debugV2: DebugV2 = { optics: true, displacement: true, frost: true, lighting: true, view: "glass", sign: 1 };

interface Live {
  el: HTMLDivElement;
  optics: HTMLSpanElement;
  light: HTMLSpanElement;
  shade: HTMLSpanElement;
  edge: HTMLSpanElement;
  glow: HTMLSpanElement;
  filter: FilterV2;
  debug: boolean;
  maps: MapsV2 | null;
  ambient: Ambient;
  profile: ProfileV2;
  shapes?: Shape[];
  merge?: number;
}

const live = new Set<Live>();
const mapsByEl = new WeakMap<Element, MapsV2>();

export function setDebugV2(patch: Partial<DebugV2>) {
  Object.assign(debugV2, patch);
  for (const s of live) refresh(s, true);
}

/** The maps a surface is drawn with (debug views in the lab). */
export function mapsOf(el: Element | null): MapsV2 | undefined {
  return el ? mapsByEl.get(el) : undefined;
}

export function statsV2() {
  return [...live].map((s) => ({ w: s.el.offsetWidth, h: s.el.offsetHeight, mapsMs: s.maps ? +s.maps.ms.toFixed(1) : null, tone: s.el.dataset.tone, tint: s.el.dataset.tint }));
}

/** Scene lightness band: 0 dark, 1 light (perceptual lightness 0.2 .. 0.75). */
const lightness = (a: Ambient) => Math.min(1, Math.max(0, (Math.pow(a.luminance, 1 / 2.2) - 0.2) / 0.55));
const byScene = (t: SceneTriple, k: number) => (k < 0.5 ? t.dark + (t.mid - t.dark) * (k / 0.5) : t.mid + (t.light - t.mid) * ((k - 0.5) / 0.5));

/** Body tonal shaping: the neutral target sits at the scene's own tone (slightly offset), so hue
 * survives while chroma and contrast are compressed. Amount by scene lightness. */
function tintFor(p: ProfileV2, a: Ambient): { amount: number; rgb: [number, number, number] } {
  const amount = byScene(p.neutralization, lightness(a));
  const Lp = Math.pow(a.luminance, 1 / 2.2);
  const grey = 255 * Math.min(1, Math.max(0, Lp + (Lp < 0.5 ? p.neutralOffset : -p.neutralOffset)));
  const k = p.environmentColorSpill;
  return { amount, rgb: [grey + (a.r - grey) * k, grey + (a.g - grey) * k, grey + (a.b - grey) * k] };
}

function refresh(s: Live, rebuild = false) {
  const w = s.el.offsetWidth;
  const h = s.el.offsetHeight;
  if (!w || !h) return;
  const p: ProfileV2 = { ...s.profile, refractionSign: debugV2.sign };
  if (rebuild || !s.maps || !s.maps.key.startsWith(JSON.stringify([w, h]).slice(0, -1))) {
    const r = Math.min(parseFloat(getComputedStyle(s.el).borderTopLeftRadius) || 0, w / 2, h / 2);
    s.maps = buildMaps({ w, h, r, shapes: s.shapes, merge: s.merge, dpr: Math.min(3, devicePixelRatio || 1), profile: p, debug: s.debug });
    mapsByEl.set(s.el, s.maps);
  }
  const m = s.maps;
  const st = s.el.style;
  st.setProperty("--lg2-pad", `${m.pad}px`);
  st.setProperty("--lg2-mask", `url(${m.mask})`);
  st.setProperty("--lg2-light", `url(${m.light})`);
  st.setProperty("--lg2-shade", `url(${m.shade})`);
  st.setProperty("--lg2-edge", `url(${m.edge})`);
  st.setProperty("--lg2-glow", `url(${m.glow})`);
  st.setProperty("--lg2-shadow", [p.contactShadow, p.bodyShadow, p.ambientShadow].map(([y, b, a]) => `0 ${y}px ${b}px rgba(0,0,0,${a})`).join(", "));
  // Exposure: the light map is baked at the highest exposure; the scene brings it down.
  const k = lightness(s.ambient);
  st.setProperty("--lg2-exposure", (byScene(p.fresnelExposure, k) / maxExposure(p)).toFixed(3));
  // The outer interface reads on bright scenes and fades on dark ones.
  st.setProperty("--lg2-edge-k", byScene(p.outerEdgeExposure, k).toFixed(3));
  // Bevel glow is scene light carried through the glass.
  st.setProperty("--lg2-glow-k", (0.12 + 0.88 * k).toFixed(3));
  const tint = tintFor(p, s.ambient);
  s.el.dataset.tint = `${tint.amount.toFixed(3)} rgb(${tint.rgb.map((v) => v | 0).join(",")})`;
  const Lp = Math.pow(s.ambient.luminance, 1 / 2.2);
  const prev = s.el.dataset.tone;
  s.el.dataset.tone = prev === "light" ? (Lp > 0.55 ? "light" : "dark") : Lp > 0.62 ? "light" : "dark";
  updateFilter(s.filter, p, {
    width: w + 2 * m.pad,
    height: h + 2 * m.pad,
    lens: m.lens,
    frost: m.frost,
    scale: m.scale,
    displacement: debugV2.displacement,
    view: debugV2.frost ? debugV2.view : debugV2.view === "glass" ? "A" : debugV2.view,
    tint,
    // Body lift on light and mid scenes only.
    lift: (p.bodyLift / 255) * Math.min(1, k * 1.6),
  });
  // (While the phase 2 backdrop probe runs, it owns the optics filter.)
  if (!document.documentElement.dataset.lg2Probe) s.optics.style.backdropFilter = debugV2.optics ? `url(#${s.filter.id})` : "none";
  s.light.style.display = s.shade.style.display = s.edge.style.display = s.glow.style.display = debugV2.lighting ? "" : "none";
}

function resample(s: Live) {
  const rect = s.el.getBoundingClientRect();
  s.ambient = sample(s.el, rect, [28, 28, 30]);
  refresh(s);
}

export interface GlassV2Props extends HTMLAttributes<HTMLDivElement> {
  profile?: ProfileV2;
  radius?: number | string;
  shapes?: Shape[];
  merge?: number;
  contentClassName?: string;
  /** Also build the debug views (lab). */
  debugMaps?: boolean;
}

export const GlassV2 = forwardRef<HTMLDivElement, GlassV2Props>(function GlassV2(
  { profile = regularToolbarV2, radius, shapes, merge, debugMaps = false, className = "", contentClassName = "", style, children, ...rest },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  const optics = useRef<HTMLSpanElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  const shade = useRef<HTMLSpanElement>(null);
  const edge = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  useImperativeHandle(ref, () => el.current!, []);

  useLayoutEffect(() => {
    if (!el.current || !optics.current || !light.current || !shade.current || !edge.current || !glow.current) return;
    const s: Live = {
      el: el.current,
      optics: optics.current,
      light: light.current,
      shade: shade.current,
      edge: edge.current,
      glow: glow.current,
      filter: createFilter(),
      debug: debugMaps,
      maps: null,
      ambient: DARK_AMBIENT,
      profile,
      shapes,
      merge,
    };
    live.add(s);
    refresh(s);
    const ro = new ResizeObserver(() => refresh(s));
    ro.observe(el.current);
    const t = window.setTimeout(() => resample(s), 120);
    const iv = window.setInterval(() => resample(s), 2500);
    return () => {
      ro.disconnect();
      clearTimeout(t);
      clearInterval(iv);
      live.delete(s);
      s.filter.el.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const st: CSSProperties = { ...style };
  if (radius !== undefined) st.borderRadius = typeof radius === "number" ? `${radius}px` : radius;
  return (
    <div ref={el} className={`lg2 ${className}`} style={st} {...rest}>
      <span ref={optics} className="lg2-layer lg2-optics" aria-hidden />
      <span ref={edge} className="lg2-layer lg2-edge" aria-hidden />
      <span ref={shade} className="lg2-layer lg2-shade" aria-hidden />
      <span ref={glow} className="lg2-layer lg2-glow" aria-hidden />
      <span ref={light} className="lg2-layer lg2-light" aria-hidden />
      <div className={`lg2-content ${contentClassName}`}>{children}</div>
    </div>
  );
});
