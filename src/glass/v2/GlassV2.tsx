/**
 * Liquid Glass V2 surface (phase 1: lab only). Same idea as Glass: the
 * optics read the real backdrop through the SVG filter; light and shade are
 * layers drawn from the same surface; content never passes through the optics.
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
import { createFilter, updateFilter, type DebugView, type FilterV2 } from "./filterGraph";
import { buildMaps, type MapsV2 } from "./maps";
import { regularToolbarV2, type ProfileV2 } from "./profile";
import { sample, DARK_AMBIENT, type Ambient } from "../sampler";
import type { Shape } from "./surface";
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
  filter: FilterV2;
  maps: MapsV2 | null;
  ambient: Ambient;
  profile: ProfileV2;
  shapes?: Shape[];
  merge?: number;
}

const live = new Set<Live>();

export function setDebugV2(patch: Partial<DebugV2>) {
  Object.assign(debugV2, patch);
  for (const s of live) refresh(s, true);
}

export function statsV2() {
  return [...live].map((s) => ({ w: s.el.offsetWidth, h: s.el.offsetHeight, mapsMs: s.maps ? +s.maps.ms.toFixed(1) : null, tone: s.el.dataset.tone, tint: s.el.dataset.tint }));
}

/** Adaptive neutral tint: amount by scene lightness; colour a neutral near the scene's own lightness. */
function tintFor(p: ProfileV2, a: Ambient): { amount: number; rgb: [number, number, number] } {
  const L = a.luminance;
  const amount = L > 0.2 ? p.lightTintMidScene + (p.lightTintLightScene - p.lightTintMidScene) * Math.min(1, (L - 0.2) / 0.4) : p.darkSceneTint + (p.lightTintMidScene - p.darkSceneTint) * (L / 0.2);
  const Lp = Math.pow(L, 1 / 2.2);
  const grey = 255 * Math.min(1, Math.max(0, Lp + (Lp < 0.5 ? 0.1 : -0.1)));
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
    s.maps = buildMaps({ w, h, r, shapes: s.shapes, merge: s.merge, dpr: Math.min(3, devicePixelRatio || 1), profile: p });
  }
  const m = s.maps;
  const st = s.el.style;
  st.setProperty("--lg2-pad", `${m.pad}px`);
  st.setProperty("--lg2-mask", `url(${m.mask})`);
  st.setProperty("--lg2-light", `url(${m.light})`);
  st.setProperty("--lg2-shade", `url(${m.shade})`);
  st.setProperty("--lg2-c-a", String(p.contactShadowOpacity));
  st.setProperty("--lg2-b-a", String(p.bodyShadowOpacity));
  st.setProperty("--lg2-a-a", String(p.ambientShadowOpacity));
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
  });
  s.optics.style.backdropFilter = debugV2.optics ? `url(#${s.filter.id})` : "none";
  s.light.style.display = s.shade.style.display = debugV2.lighting ? "" : "none";
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
}

export const GlassV2 = forwardRef<HTMLDivElement, GlassV2Props>(function GlassV2(
  { profile = regularToolbarV2, radius, shapes, merge, className = "", contentClassName = "", style, children, ...rest },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  const optics = useRef<HTMLSpanElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  const shade = useRef<HTMLSpanElement>(null);
  useImperativeHandle(ref, () => el.current!, []);

  useLayoutEffect(() => {
    if (!el.current || !optics.current || !light.current || !shade.current) return;
    const s: Live = { el: el.current, optics: optics.current, light: light.current, shade: shade.current, filter: createFilter(), maps: null, ambient: DARK_AMBIENT, profile, shapes, merge };
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
      <span ref={shade} className="lg2-layer lg2-shade" aria-hidden />
      <span ref={light} className="lg2-layer lg2-light" aria-hidden />
      <div className={`lg2-content ${contentClassName}`}>{children}</div>
    </div>
  );
});
