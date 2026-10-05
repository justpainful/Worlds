/**
 * Phase 2 instruments for V2 in the real app (read by the validation scripts
 * through window.__glassV2). Nothing here changes how the glass looks unless
 * probe(true) is called.
 */
import { mapStats } from "./maps";

/** Ancestor properties that cut a backdrop-filter off from the scene in Chromium (or are suspected to). */
const CHECKS: [string, (cs: CSSStyleDeclaration) => string | null][] = [
  ["transform", (cs) => (cs.transform !== "none" ? `transform: ${cs.transform}` : null)],
  ["translate", (cs) => (cs.translate !== "none" ? `translate: ${cs.translate}` : null)],
  ["scale", (cs) => (cs.scale !== "none" ? `scale: ${cs.scale}` : null)],
  ["rotate", (cs) => (cs.rotate !== "none" ? `rotate: ${cs.rotate}` : null)],
  ["filter", (cs) => (cs.filter !== "none" ? `filter: ${cs.filter}` : null)],
  ["backdrop-filter", (cs) => (cs.backdropFilter && cs.backdropFilter !== "none" ? `backdrop-filter: ${cs.backdropFilter.slice(0, 40)}` : null)],
  ["opacity", (cs) => (parseFloat(cs.opacity) < 1 ? `opacity: ${cs.opacity}` : null)],
  ["mask", (cs) => (cs.maskImage && cs.maskImage !== "none" ? "mask-image" : null)],
  ["clip-path", (cs) => (cs.clipPath !== "none" ? `clip-path: ${cs.clipPath.slice(0, 40)}` : null)],
  ["mix-blend-mode", (cs) => (cs.mixBlendMode !== "normal" ? `mix-blend-mode: ${cs.mixBlendMode}` : null)],
  ["will-change", (cs) => (/transform|opacity|filter|mask|clip/.test(cs.willChange) ? `will-change: ${cs.willChange}` : null)],
  ["view-transition-name", (cs) => (cs.getPropertyValue("view-transition-name") && cs.getPropertyValue("view-transition-name") !== "none" ? "view-transition-name" : null)],
];

const label = (el: Element) => {
  const cls = [...el.classList].filter((c) => !/^(glass|lg2|g-|lg2-)/.test(c) || c === "glass-group").slice(0, 2);
  return `${el.tagName.toLowerCase()}${cls.length ? "." + cls.join(".") : ""}`;
};

export interface AuditRow {
  component: string;
  path: string;
  rect: [number, number, number, number];
  filter: string;
  filterInDom: boolean;
  blocking: string[];
}

/** Every V2 surface, its DOM path and every ancestor (itself included) that would cut its optics off. */
export function auditBackdrops(): AuditRow[] {
  return [...document.querySelectorAll<HTMLElement>(".lg2")].map((el) => {
    const optics = el.querySelector<HTMLElement>(":scope > .lg2-optics");
    const chain: string[] = [];
    const blocking: string[] = [];
    // The optics layer itself carries the mask by design (it cuts the result, not the backdrop).
    for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) {
      chain.unshift(label(a));
      const cs = getComputedStyle(a);
      for (const [, test] of CHECKS) {
        const hit = test(cs);
        if (hit) blocking.push(`${label(a)} { ${hit} }`);
      }
    }
    const f = optics?.style.backdropFilter ?? "";
    const id = /#([\w-]+)/.exec(f)?.[1];
    const r = el.getBoundingClientRect();
    return {
      component: label(el),
      path: chain.join(" > "),
      rect: [r.left, r.top, r.width, r.height],
      filter: f,
      filterInDom: !!(id && document.getElementById(id)),
      blocking,
    };
  });
}

let probeFilter: SVGSVGElement | null = null;
const saved = new Map<HTMLElement, string>();

/**
 * Backdrop probe: every V2 optics layer shows the alpha of what its filter
 * receives as magenta (full magenta = an opaque backdrop, black = empty: a
 * broken backdrop root, or a transparent window where only the desktop is).
 * Screenshots then show exactly what the filter receives.
 */
export function probe(on: boolean) {
  if (!probeFilter) {
    probeFilter = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    probeFilter.setAttribute("width", "0");
    probeFilter.setAttribute("height", "0");
    probeFilter.style.position = "absolute";
    probeFilter.innerHTML =
      '<filter id="lg2-probe" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 1 0  0 0 0 0 0  0 0 0 1 0  0 0 0 0 1"/></filter>';
    document.body.appendChild(probeFilter);
  }
  if (on) document.documentElement.dataset.lg2Probe = "on";
  else delete document.documentElement.dataset.lg2Probe;
  for (const o of document.querySelectorAll<HTMLElement>(".lg2 > .lg2-optics")) {
    if (on) {
      if (!saved.has(o)) saved.set(o, o.style.backdropFilter);
      o.style.backdropFilter = "url(#lg2-probe)";
    } else if (saved.has(o)) {
      o.style.backdropFilter = saved.get(o)!;
      saved.delete(o);
    }
  }
}

declare global {
  interface Window {
    __glassV2?: { audit: typeof auditBackdrops; probe: typeof probe; maps: typeof mapStats };
  }
}

window.__glassV2 = { audit: auditBackdrops, probe, maps: mapStats };
