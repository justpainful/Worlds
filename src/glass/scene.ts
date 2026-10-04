/**
 * Glass composition context.
 *
 * Owns every glass surface on screen: geometry, material, stacking tier,
 * interaction state, its optical filter pipeline and its adaptive state.
 *
 * Pipeline per surface (one SVG filter, used as `backdrop-filter: url()`;
 * the backdrop it receives is the already-composited scene, including any
 * lower glass, so overlapping glass genuinely refracts glass):
 *
 *   backdrop ─ refraction (displacement from geometry, inward, strongest at rim)
 *            ─ center blur σc ┐
 *            ─ edge blur  σe  ┴ blended by the thickness mask (non-uniform blur)
 *            ─ over ambient flood (edge pixels resolve to sampled colour)
 *            ─ saturation ─ brightness compensation
 *   + CSS layers: adaptive tint + colour spill, fresnel rim glow, directional
 *     edge light, pointer specular, micro-noise, intersection response.
 *
 * Quality tiers: full (above), reduced (CSS blur/saturate only), solid.
 */

import { MATERIALS, type MaterialName, type QualityTier, clamp, lerp } from "./materials";
import { opticalMaps, unionMaps, noiseTile, type GlassShape, type UnionMaps } from "./maps";
import { sample, NEUTRAL_AMBIENT, type Ambient } from "./sampler";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface SurfaceOptions {
  material: MaterialName;
  layer: number;
  selected?: boolean;
  /** Static scenes (e.g. sidebar over black) can opt out of sampling. */
  sample?: boolean;
  /** Merged glass: the body is the smooth union of these shapes (local px). */
  shapes?: GlassShape[];
  /** Width of the liquid bridge between merged shapes, px. */
  merge?: number;
}

interface Prims {
  dmap: SVGFEImageElement;
  disp: SVGFEDisplacementMapElement;
  bc: SVGFEGaussianBlurElement;
  be: SVGFEGaussianBlurElement;
  emask: SVGFEImageElement;
  flood: SVGFEFloodElement;
  sat: SVGFEColorMatrixElement;
  fr: SVGFEFuncRElement;
  fg: SVGFEFuncGElement;
  fb: SVGFEFuncBElement;
}

interface Optics {
  refraction: number;
  sigmaC: number;
  sigmaE: number;
  saturation: number;
  brightness: number;
}

export interface Surface {
  id: string;
  el: HTMLElement;
  optics: HTMLElement;
  intersect: HTMLElement;
  opts: SurfaceOptions;
  filter: SVGFilterElement | null;
  prims: Prims | null;
  mapsKey: string;
  rect: DOMRect | null;
  radius: number;
  ambient: Ambient;
  lastSample: number;
  overlap: number;
  hover: boolean;
  press: boolean;
  current: Optics;
  target: Optics;
  tintRgb: [number, number, number];
  opacity: number;
  /** Sits inside another glass surface (a lens in a capsule, a button on a panel). */
  nested: boolean;
  /**
   * Uses the plain CSS backdrop path instead of the SVG lens. Chromium gives
   * an SVG backdrop filter an empty backdrop when an ancestor is transformed,
   * so nested glass (its container moves on hover) and glass inside a
   * transformed subtree take the path that still sees the scene.
   */
  flat: boolean;
}

let seq = 0;

class GlassScene {
  private surfaces = new Map<string, Surface>();
  private defs: SVGDefsElement | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private dirtyLayout = true;
  private animating = false;
  private scrollTimer = 0;
  private sampleTimer = 0;
  quality: QualityTier = "full";
  inactive = false;
  scrolling = false;
  canvas: [number, number, number] = [0, 0, 0];

  init() {
    if (this.defs) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.style.pointerEvents = "none";
    this.defs = document.createElementNS(SVG_NS, "defs");
    svg.appendChild(this.defs);
    document.body.appendChild(svg);
    document.documentElement.style.setProperty("--g-noise-tile", `url(${noiseTile()})`);

    this.ro = new ResizeObserver(() => this.invalidate());
    window.addEventListener("resize", () => this.invalidate());
    window.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
    const rt = window.matchMedia("(prefers-reduced-transparency: reduce)");
    rt.addEventListener("change", () => this.applyQuality());
    // Periodic gentle resample keeps adaptation current as content changes.
    this.sampleTimer = window.setInterval(() => this.sampleAll(false), 1400);
  }

  // ---------------------------------------------------------------------
  // registration
  // ---------------------------------------------------------------------

  register(el: HTMLElement, optics: HTMLElement, intersect: HTMLElement, opts: SurfaceOptions): Surface {
    this.init();
    const id = `g${++seq}`;
    const spec = MATERIALS[opts.material];
    const base: Optics = {
      refraction: spec.refraction,
      sigmaC: spec.blur.base * spec.centerBlurK,
      sigmaE: spec.blur.base * spec.edgeBlurK,
      saturation: spec.saturation.base,
      brightness: spec.brightness.base,
    };
    const s: Surface = {
      id,
      el,
      optics,
      intersect,
      opts,
      filter: null,
      prims: null,
      mapsKey: "",
      rect: null,
      radius: 0,
      ambient: NEUTRAL_AMBIENT,
      lastSample: 0,
      overlap: 0,
      nested: !!el.parentElement?.closest(".glass"),
      flat: false,
      hover: false,
      press: false,
      current: { ...base },
      target: { ...base },
      tintRgb: [24, 24, 26],
      opacity: spec.opacity.base,
    };
    el.dataset.glassId = id;
    this.surfaces.set(id, s);
    this.ro?.observe(el);
    this.buildFilter(s);
    this.applyStatic(s);
    this.invalidate();
    return s;
  }

  update(s: Surface, opts: SurfaceOptions) {
    const materialChanged = s.opts.material !== opts.material;
    s.opts = opts;
    if (materialChanged) {
      this.applyStatic(s);
      s.mapsKey = "";
    }
    this.retarget(s);
    this.invalidate();
  }

  /**
   * Pointer light: nudges the refraction field by a pixel or two toward the
   * pointer (x, y in 0..1, or null to rest), so the bent background drifts
   * with the light instead of anything drawn moving.
   */
  lightAt(s: Surface, x: number | null, y: number | null) {
    const p = s.prims;
    if (!p) return;
    const dx = x === null ? 0 : (x - 0.5) * 3;
    const dy = y === null ? 0 : (y - 0.5) * 2;
    p.dmap.setAttribute("x", dx.toFixed(2));
    p.dmap.setAttribute("y", dy.toFixed(2));
  }

  unregister(s: Surface) {
    this.surfaces.delete(s.id);
    this.ro?.unobserve(s.el);
    s.filter?.remove();
    this.invalidate();
  }

  setInteraction(s: Surface, hover: boolean, press: boolean) {
    if (s.hover === hover && s.press === press) return;
    s.hover = hover;
    s.press = press;
    this.retarget(s);
    this.kick();
  }

  setActive(active: boolean) {
    this.inactive = !active;
    document.documentElement.classList.toggle("is-inactive", !active);
    for (const s of this.surfaces.values()) this.retarget(s);
    this.kick();
  }

  setQuality(q: QualityTier) {
    this.quality = q;
    this.applyQuality();
  }

  private effectiveQuality(): QualityTier {
    if (window.matchMedia("(prefers-reduced-transparency: reduce)").matches) return "solid";
    return this.quality;
  }

  private applyQuality() {
    const q = this.effectiveQuality();
    document.documentElement.dataset.glass = q;
    for (const s of this.surfaces.values()) {
      this.applyOptics(s);
      this.applyAdaptive(s);
    }
  }

  invalidate() {
    this.dirtyLayout = true;
    this.kick();
  }

  // ---------------------------------------------------------------------
  // filter pipeline
  // ---------------------------------------------------------------------

  private buildFilter(s: Surface) {
    if (!this.defs) return;
    const f = document.createElementNS(SVG_NS, "filter");
    f.setAttribute("id", `wg-${s.id}`);
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("primitiveUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    f.setAttribute("x", "0");
    f.setAttribute("y", "0");
    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
      const e = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      f.appendChild(e);
      return e as SVGElementTagNameMap[K];
    };
    const dmap = mk("feImage", { result: "dmap", x: "0", y: "0", preserveAspectRatio: "none" });
    const disp = mk("feDisplacementMap", { in: "SourceGraphic", in2: "dmap", xChannelSelector: "R", yChannelSelector: "G", result: "refr" });
    const bc = mk("feGaussianBlur", { in: "refr", result: "bc", edgeMode: "duplicate" });
    const be = mk("feGaussianBlur", { in: "refr", result: "be", edgeMode: "duplicate" });
    const emask = mk("feImage", { result: "emask", x: "0", y: "0", preserveAspectRatio: "none" });
    mk("feComposite", { in: "be", in2: "emask", operator: "in", result: "beM" });
    mk("feComposite", { in: "bc", in2: "emask", operator: "out", result: "bcM" });
    mk("feComposite", { in: "beM", in2: "bcM", operator: "arithmetic", k1: "0", k2: "1", k3: "1", k4: "0", result: "mix" });
    const flood = mk("feFlood", { result: "ambient", "flood-opacity": "1" });
    mk("feComposite", { in: "mix", in2: "ambient", operator: "over", result: "solidMix" });
    const sat = mk("feColorMatrix", { in: "solidMix", type: "saturate", result: "sat" });
    const ct = mk("feComponentTransfer", { in: "sat", result: "lit" });
    const fr = document.createElementNS(SVG_NS, "feFuncR");
    const fg = document.createElementNS(SVG_NS, "feFuncG");
    const fb = document.createElementNS(SVG_NS, "feFuncB");
    for (const fn of [fr, fg, fb]) {
      fn.setAttribute("type", "linear");
      ct.appendChild(fn);
    }
    this.defs.appendChild(f);
    s.filter = f;
    s.prims = { dmap, disp, bc, be, emask, flood, sat, fr, fg, fb };
  }

  /** Geometry-dependent maps (on resize / radius change). */
  private applyGeometry(s: Surface) {
    if (!s.prims || !s.filter || !s.rect) return;
    // Use layout size (unaffected by hover/press transforms).
    const w = s.el.offsetWidth;
    const h = s.el.offsetHeight;
    if (w < 2 || h < 2) return;
    const cs = getComputedStyle(s.el);
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    s.radius = radius;
    const spec = MATERIALS[s.opts.material];
    const shapes = s.opts.shapes;
    const maps = shapes?.length ? unionMaps(w, h, shapes, spec.bezel, s.opts.merge ?? 18, spec.rim) : opticalMaps(w, h, radius, spec.bezel);
    if (maps.key === s.mapsKey) return;
    s.mapsKey = maps.key;
    const merged = maps as Partial<UnionMaps>;
    if (merged.mask && merged.rim) {
      // One continuous body: every layer is clipped to the merged outline and
      // the rim light follows it (CSS borders cannot draw this shape).
      s.el.dataset.union = "1";
      s.el.style.setProperty("--g-mask", `url(${merged.mask})`);
      s.el.style.setProperty("--g-rim-img", `url(${merged.rim})`);
    } else if (s.el.dataset.union) {
      delete s.el.dataset.union;
      s.el.style.removeProperty("--g-mask");
      s.el.style.removeProperty("--g-rim-img");
    }
    for (const [img, url] of [
      [s.prims.dmap, maps.displacement],
      [s.prims.emask, maps.thickness],
    ] as const) {
      img.setAttribute("href", url);
      img.setAttribute("width", String(w));
      img.setAttribute("height", String(h));
    }
    s.filter.setAttribute("width", String(w));
    s.filter.setAttribute("height", String(h));
    this.applyOptics(s);
  }

  private applyOptics(s: Surface) {
    const q = this.effectiveQuality();
    const o = s.current;
    if (q === "full" && s.mapsKey && !s.flat) {
      s.optics.style.backdropFilter = `url(#wg-${s.id})`;
    } else if (q === "reduced" || (q === "full" && s.flat)) {
      s.optics.style.backdropFilter = `blur(${((o.sigmaC + o.sigmaE) / 2).toFixed(1)}px) saturate(${o.saturation.toFixed(3)}) brightness(${o.brightness.toFixed(3)})`;
    } else if (q === "solid") {
      s.optics.style.backdropFilter = "none";
    }
    if (!s.prims || q !== "full") return;
    const p = s.prims;
    setAttr(p.disp, "scale", (o.refraction * 2).toFixed(2));
    setAttr(p.bc, "stdDeviation", o.sigmaC.toFixed(2));
    setAttr(p.be, "stdDeviation", o.sigmaE.toFixed(2));
    setAttr(p.sat, "values", o.saturation.toFixed(3));
    const b = o.brightness.toFixed(3);
    setAttr(p.fr, "slope", b);
    setAttr(p.fg, "slope", b);
    setAttr(p.fb, "slope", b);
    const a = s.ambient;
    setAttr(p.flood, "flood-color", `rgb(${a.r | 0},${a.g | 0},${a.b | 0})`);
  }

  // ---------------------------------------------------------------------
  // adaptation
  // ---------------------------------------------------------------------

  /** Material constants that do not depend on the backdrop. */
  private applyStatic(s: Surface) {
    const spec = MATERIALS[s.opts.material];
    const st = s.el.style;
    st.setProperty("--g-rim-w", `${spec.rim.width}px`);
    st.setProperty("--g-noise", String(spec.noise));
    st.setProperty("--g-fresnel", String(spec.fresnel));
    st.setProperty("--g-shadow-y", `${spec.shadow.y}px`);
    st.setProperty("--g-shadow-blur", `${spec.shadow.blur}px`);
    st.setProperty("--g-shadow-a", String(spec.shadow.opacity));
    s.el.dataset.material = s.opts.material;
  }

  /** Recompute optical targets from material, ambient and state. */
  private retarget(s: Surface) {
    const spec = MATERIALS[s.opts.material];
    const a = s.ambient;
    const lp = Math.pow(a.luminance, 1 / 2.2); // perceptual lightness
    const busy = a.variance;

    // Busy backdrops get only a little extra blur: enough for legibility, not so
    // much that the lens bending at the edges is averaged away.
    let blur = clamp(spec.blur.base + (busy - 0.25) * 4, spec.blur.min, spec.blur.max);
    let saturation = clamp(spec.saturation.base + (0.22 - a.chroma) * 0.35, spec.saturation.min, spec.saturation.max);
    let brightness = clamp(spec.brightness.base + (0.18 - lp) * 0.12, spec.brightness.min, spec.brightness.max);
    let refraction = spec.refraction;

    // Glass inside glass reads as one piece: the inner surface only gets a
    // light distinction (half the lensing, no overlap boost), so its bezel
    // never draws a second ring inside the container's.
    if (s.nested) {
      refraction *= 0.5;
    } else {
      // Overlapping floating glass: slightly denser, never a second outline.
      refraction *= 1 + 0.12 * s.overlap;
      blur += 2.5 * s.overlap;
    }

    if (s.hover) brightness *= 1.04;
    if (s.press) {
      refraction *= 0.72; // lens compresses under the press
      blur += 1.5;
    }
    if (this.scrolling) {
      refraction *= 0.45; // stabilise optics during fast motion
    }
    if (this.inactive) {
      saturation = 1 + (saturation - 1) * 0.35;
      brightness = 1 + (brightness - 1) * 0.5;
    }

    s.target = {
      refraction,
      sigmaC: blur * spec.centerBlurK,
      sigmaE: this.scrolling ? blur * spec.centerBlurK * 1.2 : blur * spec.edgeBlurK,
      saturation,
      brightness,
    };
    this.applyAdaptive(s);
  }

  /** CSS-side adaptive values: tint, spill, opacity, tone, edge light. */
  private applyAdaptive(s: Surface) {
    const spec = MATERIALS[s.opts.material];
    const a = s.ambient;
    const lp = Math.pow(a.luminance, 1 / 2.2);
    const busy = a.variance;
    const light = lp > 0.62;
    const solid = this.effectiveQuality() === "solid";

    const spill = clamp(spec.spill.base + a.chroma * 0.08, spec.spill.min, spec.spill.max);
    // Dark appearance uses a milky grey body, so glass reads as a bright lens over dark content.
    const body: [number, number, number] = light ? [250, 250, 252] : [120, 120, 128];
    const tintK = s.opts.selected ? spec.tintSelected : spec.tint;
    const k = spill + tintK * 0.5;
    s.tintRgb = [lerp(body[0], a.r, k), lerp(body[1], a.g, k), lerp(body[2], a.b, k)];

    let opacity = clamp(
      spec.opacity.base + busy * 0.05 + (light ? 0.05 : 0) + (lp < 0.04 ? -0.015 : 0),
      spec.opacity.min,
      spec.opacity.max + (light ? 0.08 : 0),
    );
    // Mid-brightness backdrops are where neither ink reads well: the glass
    // commits to its tone with a denser body there instead of staying grey.
    const mid = clamp(1 - Math.abs(lp - 0.56) / 0.26, 0, 1);
    opacity += mid * 0.2;
    if (!s.nested) opacity += 0.03 * s.overlap;
    if (s.press) opacity += 0.04;
    if (s.opts.selected) opacity += 0.04;
    if (this.inactive) opacity += 0.03;
    if (solid) opacity = 0.94;
    s.opacity = opacity;

    // Edge light strength adapts to the scene: crisper over dark, softer over bright.
    let rimK = light ? 0.7 : clamp(1 + (0.14 - lp) * 0.7, 0.75, 1.2);
    if (s.hover) rimK *= 1.2;
    if (s.press) rimK *= 0.85;
    if (this.inactive) rimK *= 0.55;

    const dim = spec.dimCompensation > 0 && !light ? spec.dimCompensation * clamp(busy * 1.4 + lp * 0.8, 0, 1) : 0;

    const st = s.el.style;
    st.setProperty("--g-tint-rgb", s.tintRgb.map((v) => v | 0).join(","));
    st.setProperty("--g-opacity", opacity.toFixed(3));
    st.setProperty("--g-dim", dim.toFixed(3));
    st.setProperty("--rim-top", (spec.rim.top * rimK).toFixed(3));
    st.setProperty("--rim-side", (spec.rim.side * rimK).toFixed(3));
    st.setProperty("--rim-bottom", (spec.rim.bottom * rimK).toFixed(3));
    st.setProperty("--rim-inner", ((s.press ? spec.rim.inner * 1.6 : spec.rim.inner) * rimK).toFixed(3));
    s.el.dataset.tone = light ? "light" : "dark";
  }

  // ---------------------------------------------------------------------
  // frame loop (only runs while something is dirty or settling)
  // ---------------------------------------------------------------------

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.raf = 0;
    if (this.dirtyLayout) {
      this.dirtyLayout = false;
      this.layout();
    }
    // Ease optical values toward their targets (smooth restore after scroll, press, etc).
    let moving = false;
    for (const s of this.surfaces.values()) {
      const c = s.current;
      const t = s.target;
      let changed = false;
      for (const key of ["refraction", "sigmaC", "sigmaE", "saturation", "brightness"] as const) {
        const d = t[key] - c[key];
        if (Math.abs(d) > 0.002) {
          c[key] += d * (s.press ? 0.42 : 0.24);
          changed = true;
        } else if (d !== 0) {
          c[key] = t[key];
          changed = true;
        }
      }
      if (changed) {
        this.applyOptics(s);
        moving = true;
      }
    }
    this.animating = moving;
    if (moving) this.kick();
  };

  private layout() {
    const list = [...this.surfaces.values()];
    for (const s of list) {
      s.rect = s.el.getBoundingClientRect();
      this.checkPath(s);
      this.applyGeometry(s);
    }
    // Intersections: an upper surface responds to the lower glass it covers.
    for (const s of list) {
      let best: { area: number; t: Surface; r: DOMRect } | null = null;
      if (!s.rect || s.rect.width === 0) continue;
      for (const t of list) {
        if (t === s || !t.rect || t.opts.layer >= s.opts.layer) continue;
        if (s.el.contains(t.el) || t.el.contains(s.el)) continue;
        const x1 = Math.max(s.rect.left, t.rect.left);
        const y1 = Math.max(s.rect.top, t.rect.top);
        const x2 = Math.min(s.rect.right, t.rect.right);
        const y2 = Math.min(s.rect.bottom, t.rect.bottom);
        const area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        if (area > 0 && (!best || area > best.area)) best = { area, t, r: t.rect };
      }
      const overlap = best ? Math.min(1, best.area / (s.rect.width * s.rect.height)) : 0;
      if (Math.abs(overlap - s.overlap) > 0.01) {
        s.overlap = overlap;
        this.retarget(s);
      }
      const ix = s.intersect;
      if (best && overlap > 0.002) {
        ix.style.display = "block";
        ix.style.left = `${best.r.left - s.rect.left}px`;
        ix.style.top = `${best.r.top - s.rect.top}px`;
        ix.style.width = `${best.r.width}px`;
        ix.style.height = `${best.r.height}px`;
        ix.style.borderRadius = `${best.t.radius}px`;
      } else if (ix.style.display !== "none") {
        ix.style.display = "none";
      }
    }
    this.sampleAll(true);
  }

  /** Pick the optical path this surface can actually render (see Surface.flat). */
  private checkPath(s: Surface) {
    const flat = s.nested || transformedAncestor(s.el);
    if (flat !== s.flat) {
      s.flat = flat;
      this.applyOptics(s);
    }
  }

  private sampleAll(force: boolean) {
    if (this.scrolling || document.hidden) return;
    const now = performance.now();
    if (!force) for (const s of this.surfaces.values()) this.checkPath(s);
    for (const s of this.surfaces.values()) {
      if (s.opts.sample === false) continue;
      if (!force && now - s.lastSample < 1200) continue;
      const rect = s.el.getBoundingClientRect();
      if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      s.lastSample = now;
      const amb = sample(rect, {
        canvas: this.canvas,
        isSelf: (el) => {
          const host = (el as HTMLElement).closest?.("[data-glass-id]") as HTMLElement | null;
          if (!host) return false;
          const o = this.surfaces.get(host.dataset.glassId!);
          return !o || o === s || o.opts.layer >= s.opts.layer;
        },
        glassColor: (el) => {
          const host = (el as HTMLElement).closest?.("[data-glass-id]") as HTMLElement | null;
          if (!host) return null;
          const o = this.surfaces.get(host.dataset.glassId!);
          if (!o || o === s || o.opts.layer >= s.opts.layer) return null;
          const k = o.opacity;
          return [
            lerp(o.ambient.r, o.tintRgb[0], k),
            lerp(o.ambient.g, o.tintRgb[1], k),
            lerp(o.ambient.b, o.tintRgb[2], k),
          ];
        },
      });
      const changed =
        Math.abs(amb.luminance - s.ambient.luminance) > 0.004 ||
        Math.abs(amb.r - s.ambient.r) + Math.abs(amb.g - s.ambient.g) + Math.abs(amb.b - s.ambient.b) > 6 ||
        Math.abs(amb.variance - s.ambient.variance) > 0.05;
      if (changed) {
        s.ambient = amb;
        this.retarget(s);
        this.applyOptics(s);
      }
    }
    this.kick();
  }

  private onScroll = () => {
    if (!this.scrolling) {
      this.scrolling = true;
      for (const s of this.surfaces.values()) this.retarget(s);
      this.kick();
    }
    clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => {
      this.scrolling = false;
      for (const s of this.surfaces.values()) this.retarget(s);
      this.invalidate();
    }, 160);
  };

  get isAnimating() {
    return this.animating;
  }

  destroy() {
    clearInterval(this.sampleTimer);
  }
}

/** Any transform between this element and the root (transform, translate, scale or rotate). */
function transformedAncestor(el: HTMLElement): boolean {
  for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
    const c = getComputedStyle(e);
    if (c.transform !== "none" || c.translate !== "none" || c.scale !== "none" || c.rotate !== "none") return true;
  }
  return false;
}

function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export const glassScene = new GlassScene();
