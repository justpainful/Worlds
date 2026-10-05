/**
 * Liquid Glass V2: the SVG filter used as a backdrop filter (the only way a
 * DOM app can read the real pixels behind an element).
 *
 *   bent  = displace(backdrop, lens)
 *   A     = refracted branch: blur(bent, edgeFrostSigma), with a little scatter
 *   B     = frost branch: blur(bent, bodyFrostSigma)
 *   glass = A * (1 - w) + B * w          (w = frost weight: 0 at the optical edge)
 *   out   = body tonal shaping: chroma and contrast compressed toward the local scene tone
 */
import type { ProfileV2 } from "./profile";

const NS = "http://www.w3.org/2000/svg";
let defs: SVGDefsElement | null = null;

function root(): SVGDefsElement {
  if (defs) return defs;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  defs = document.createElementNS(NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

export interface FilterV2 {
  id: string;
  el: SVGFilterElement;
  lens: SVGFEImageElement;
  frost: SVGFEImageElement;
  disp: SVGFEDisplacementMapElement;
  a0: SVGFEGaussianBlurElement;
  scat: SVGFEGaussianBlurElement;
  aMix: SVGFECompositeElement;
  b: SVGFEGaussianBlurElement;
  sat: SVGFEColorMatrixElement;
  funcs: SVGFEFuncRElement[];
}

let seq = 0;

export function createFilter(): FilterV2 {
  const id = `lgv2-${++seq}`;
  const f = document.createElementNS(NS, "filter");
  f.id = id;
  f.setAttribute("filterUnits", "userSpaceOnUse");
  f.setAttribute("primitiveUnits", "userSpaceOnUse");
  f.setAttribute("color-interpolation-filters", "sRGB");
  f.setAttribute("x", "0");
  f.setAttribute("y", "0");
  const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent: Element = f) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e as SVGElementTagNameMap[K];
  };
  const lens = mk("feImage", { result: "lens", x: "0", y: "0", preserveAspectRatio: "none" });
  const disp = mk("feDisplacementMap", { in: "SourceGraphic", in2: "lens", xChannelSelector: "R", yChannelSelector: "G", result: "bent" });
  const a0 = mk("feGaussianBlur", { in: "bent", edgeMode: "duplicate", result: "a0" });
  const scat = mk("feGaussianBlur", { in: "a0", edgeMode: "duplicate", result: "ascat" });
  const aMix = mk("feComposite", { in: "a0", in2: "ascat", operator: "arithmetic", k1: "0", k4: "0", result: "A" });
  const b = mk("feGaussianBlur", { in: "bent", edgeMode: "duplicate", result: "B" });
  const frost = mk("feImage", { result: "w", x: "0", y: "0", preserveAspectRatio: "none" });
  mk("feComposite", { in: "B", in2: "w", operator: "in", result: "Bw" });
  mk("feComposite", { in: "A", in2: "w", operator: "out", result: "Aw" });
  mk("feComposite", { in: "Aw", in2: "Bw", operator: "arithmetic", k1: "0", k2: "1", k3: "1", k4: "0", result: "glass" });
  // Debug view of the weight map itself.
  mk("feFlood", { "flood-color": "#fff", result: "white" });
  mk("feComposite", { in: "white", in2: "w", operator: "in", result: "wview" });
  const sat = mk("feColorMatrix", { in: "glass", type: "saturate", result: "sat" });
  const ct = mk("feComponentTransfer", { in: "sat" });
  const funcs = [mk("feFuncR", { type: "linear" }, ct), mk("feFuncG", { type: "linear" }, ct), mk("feFuncB", { type: "linear" }, ct)] as SVGFEFuncRElement[];
  root().appendChild(f);
  return { id, el: f, lens, frost, disp, a0, scat, aMix, b, sat, funcs };
}

export type DebugView = "glass" | "A" | "B" | "w";

export interface FilterState {
  width: number; // padded box, CSS px
  height: number;
  lens: string;
  frost: string;
  scale: number;
  displacement: boolean;
  view: DebugView;
  tint: { amount: number; rgb: [number, number, number] };
}

function set(el: Element, k: string, v: string) {
  if (el.getAttribute(k) !== v) el.setAttribute(k, v);
}

export function updateFilter(f: FilterV2, p: ProfileV2, st: FilterState) {
  set(f.el, "width", String(st.width));
  set(f.el, "height", String(st.height));
  for (const img of [f.lens, f.frost]) {
    set(img, "width", String(st.width));
    set(img, "height", String(st.height));
  }
  set(f.lens, "href", st.lens);
  set(f.frost, "href", st.frost);
  set(f.disp, "scale", st.displacement ? st.scale.toFixed(3) : "0");
  set(f.a0, "stdDeviation", String(p.edgeFrostSigma));
  set(f.scat, "stdDeviation", String(p.scatterSigma));
  set(f.aMix, "k2", (1 - p.scatterMix).toFixed(4));
  set(f.aMix, "k3", p.scatterMix.toFixed(4));
  set(f.b, "stdDeviation", String(p.bodyFrostSigma));
  set(f.sat, "in", st.view === "glass" ? "glass" : st.view === "A" ? "A" : st.view === "B" ? "B" : "wview");
  set(f.sat, "values", String(st.view === "w" ? 1 : p.bodySaturation));
  // y = x (1 - t) c + t T + (1 - t) 0.5 (1 - c)
  const t = st.view === "w" ? 0 : st.tint.amount;
  const c = st.view === "w" ? 1 : p.bodyContrast;
  f.funcs.forEach((fn, i) => {
    set(fn, "slope", ((1 - t) * c).toFixed(4));
    set(fn, "intercept", ((t * st.tint.rgb[i]) / 255 + (1 - t) * 0.5 * (1 - c)).toFixed(4));
  });
}
