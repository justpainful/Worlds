/**
 * The Liquid Glass engine.
 *
 * Every piece of glass is one Surface. Its optics run in a per-surface SVG
 * filter used as a backdrop filter, so they act on the real pixels behind it:
 *
 *   backdrop (read with a margin around the shape, so nothing at the edge
 *   is invented)
 *     → lens: displaced along the shape's normal (optics.ts)
 *     → frost in the middle, a sharper edge band so the bend stays legible
 *     → scatter: a little light diffused through the body
 *     → saturation
 *     → dynamic range (contrast, highlight compression, shadow lift),
 *       adaptive tint with the scene's colour spilled in, black response
 *   all in one pass; the result is clipped to the shape.
 *
 * On top: the light map (rim, Fresnel, specular), the shade map, a faint
 * reflection of the scene's colour along the edge, and the light that
 * spreads from a press. Below: layered shadows whose depth follows the
 * scene (deeper over text, lighter over clean bright backgrounds).
 *
 * The scene under each surface is measured on its own (sampler.ts) and
 * drives tint, tone (light or dark glass and ink), light strength and
 * shadow. Large glass (menus, sheets) keeps its tone; small glass flips.
 */
import { buildOptics, type GlassShape, type OpticsMaps } from "./optics";
import { clamp, INACTIVE, INTERACTION, lerp, PROFILES, type Material, type Profile, type QualityTier } from "./profiles";
import { DARK_AMBIENT, sample, type Ambient } from "./sampler";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface SurfaceParts {
  root: HTMLElement;
  optics: HTMLElement;
  light: HTMLElement;
  shade: HTMLElement;
  env: HTMLElement;
}

export interface SurfaceOptions {
  material: Material;
  layer: number;
  selected: boolean;
  shapes?: GlassShape[];
  merge?: number;
  /** Measure the scene (false for glass whose backdrop is known and fixed). */
  sample: boolean;
}

interface Prims {
  lens: SVGFEImageElement;
  disp: SVGFEDisplacementMapElement;
  frost: SVGFEGaussianBlurElement;
  sharp: SVGFEGaussianBlurElement;
  edge: SVGFEImageElement;
  scatter: SVGFEGaussianBlurElement;
  scatterMix: SVGFECompositeElement;
  sat: SVGFEColorMatrixElement;
  fr: SVGFEFuncRElement;
  fg: SVGFEFuncGElement;
  fb: SVGFEFuncBElement;
  fa: SVGFEFuncAElement;
}

interface Motion {
  /** Multipliers that ease toward their targets. */
  refraction: number;
  brightness: number;
}

export interface Surface {
  id: string;
  parts: SurfaceParts;
  opts: SurfaceOptions;
  w: number;
  h: number;
  r: number;
  pad: number;
  maps: OpticsMaps | null;
  filter: SVGFilterElement | null;
  prims: Prims | null;
  ambient: Ambient;
  tone: "light" | "dark";
  visible: boolean;
  /** No SVG optics here: a transformed ancestor, or a reduced quality tier. */
  flat: boolean;
  hover: boolean;
  press: boolean;
  cur: Motion;
  tgt: Motion;
  motionMs: number;
  sampledAt: number;
}

export interface GlassStats {
  surfaces: number;
  lenses: number;
  flat: number;
  hidden: number;
  sampleMs: number;
  layoutMs: number;
  quality: QualityTier;
  autoReduced: boolean;
}

let seq = 0;

function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Any transform on an ancestor hands an SVG backdrop filter an empty backdrop (Chromium). */
function transformedAncestor(el: HTMLElement): boolean {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.transform !== "none" || cs.translate !== "none" || cs.scale !== "none" || cs.rotate !== "none") return true;
  }
  return false;
}

function radiusOf(el: HTMLElement, w: number, h: number): number {
  const v = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return Math.min(v, w / 2, h / 2);
}

class GlassEngine {
  private surfaces = new Map<string, Surface>();
  private defs: SVGDefsElement | null = null;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private dirtyLayout = new Set<Surface>();
  private resampleTimer = 0;
  private scrollTimer = 0;
  private lastSampleMs = 0;
  private lastLayoutMs = 0;
  private reducedTransparency = false;
  private moreContrast = false;
  quality: QualityTier = "full";
  autoReduced = false;
  /** Settings: follow the scene, or always light or dark glass. */
  tone: "auto" | "light" | "dark" = "auto";
  /** Settings: frost multiplier (1 = the profile as designed). */
  frost = 1;
  active = true;
  scrolling = false;
  /** What sits under everything (the app canvas), for probes that reach the bottom. */
  canvas: [number, number, number] = [28, 28, 30];

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
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const s = this.surfaces.get((e.target as HTMLElement).dataset.glassId ?? "");
          if (!s || s.visible === e.isIntersecting) continue;
          s.visible = e.isIntersecting;
          this.applyOptics(s);
          if (s.visible) this.resampleSoon();
        }
      },
      { rootMargin: "160px" },
    );
    this.ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const s = this.surfaces.get((e.target as HTMLElement).dataset.glassId ?? "");
        if (s) this.dirtyLayout.add(s);
      }
      this.kick();
      this.resampleSoon();
    });
    addEventListener("resize", () => this.invalidate());
    addEventListener("scroll", this.onScroll, { capture: true, passive: true });
    const rt = matchMedia("(prefers-reduced-transparency: reduce)");
    const mc = matchMedia("(prefers-contrast: more)");
    this.reducedTransparency = rt.matches;
    this.moreContrast = mc.matches;
    rt.addEventListener("change", () => ((this.reducedTransparency = rt.matches), this.refreshAll()));
    mc.addEventListener("change", () => ((this.moreContrast = mc.matches), this.refreshAll()));
    this.readCanvas();
    window.setInterval(() => this.sampleAll(false), 2500);
  }

  // ------------------------------------------------------------------ registry

  register(parts: SurfaceParts, opts: SurfaceOptions): Surface {
    this.init();
    const id = `lg${++seq}`;
    const s: Surface = {
      id,
      parts,
      opts,
      w: 0,
      h: 0,
      r: 0,
      pad: 0,
      maps: null,
      filter: null,
      prims: null,
      ambient: DARK_AMBIENT,
      tone: "dark",
      visible: true,
      flat: false,
      hover: false,
      press: false,
      cur: { refraction: 1, brightness: 1 },
      tgt: { refraction: 1, brightness: 1 },
      motionMs: INTERACTION.releaseMs,
      sampledAt: 0,
    };
    parts.root.dataset.glassId = id;
    this.surfaces.set(id, s);
    this.buildFilter(s);
    this.applyStatic(s);
    this.ro?.observe(parts.root);
    this.io?.observe(parts.root);
    this.dirtyLayout.add(s);
    this.kick();
    this.resampleSoon(40);
    return s;
  }

  update(s: Surface, opts: SurfaceOptions) {
    const shapeChanged = JSON.stringify(opts.shapes ?? null) !== JSON.stringify(s.opts.shapes ?? null) || opts.merge !== s.opts.merge;
    const materialChanged = opts.material !== s.opts.material;
    s.opts = opts;
    if (materialChanged) this.applyStatic(s);
    if (shapeChanged || materialChanged) this.dirtyLayout.add(s);
    this.adapt(s);
    this.kick();
  }

  unregister(s: Surface) {
    this.ro?.unobserve(s.parts.root);
    this.io?.unobserve(s.parts.root);
    s.filter?.remove();
    this.surfaces.delete(s.id);
    this.dirtyLayout.delete(s);
  }

  // ------------------------------------------------------------------ public controls

  /** Layout changed somewhere (panes, window): re-measure every surface. */
  invalidate() {
    for (const s of this.surfaces.values()) this.dirtyLayout.add(s);
    this.kick();
    this.resampleSoon();
  }

  /** Content behind the glass changed (navigation, images loading). */
  resampleSoon(ms = 140) {
    clearTimeout(this.resampleTimer);
    this.resampleTimer = window.setTimeout(() => this.sampleAll(true), ms);
  }

  /** The window gained or lost focus. */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    document.documentElement.dataset.glassFocus = active ? "active" : "inactive";
    this.refreshAll();
  }

  setLook(tone: "auto" | "light" | "dark", frost: number) {
    if (tone === this.tone && frost === this.frost) return;
    this.tone = tone;
    this.frost = frost;
    this.refreshAll();
  }

  setQuality(q: QualityTier) {
    this.quality = q;
    document.documentElement.dataset.glass = this.effectiveQuality();
    this.refreshAll();
  }

  setAutoReduced(on: boolean) {
    if (on === this.autoReduced) return;
    this.autoReduced = on;
    document.documentElement.dataset.glass = this.effectiveQuality();
    this.refreshAll();
  }

  effectiveQuality(): QualityTier {
    if (this.quality === "full" && this.autoReduced) return "reduced";
    return this.quality;
  }

  stats(): GlassStats {
    let lenses = 0;
    let flat = 0;
    let hidden = 0;
    for (const s of this.surfaces.values()) {
      if (!s.visible) hidden++;
      else if (s.flat || this.effectiveQuality() !== "full") flat++;
      else lenses++;
    }
    return {
      surfaces: this.surfaces.size,
      lenses,
      flat,
      hidden,
      sampleMs: this.lastSampleMs,
      layoutMs: this.lastLayoutMs,
      quality: this.effectiveQuality(),
      autoReduced: this.autoReduced,
    };
  }

  /** Hover and press: the material responds, it does not just scale. */
  setInteraction(s: Surface, hover: boolean, press: boolean) {
    if (s.hover === hover && s.press === press) return;
    s.hover = hover;
    s.press = press;
    s.tgt.refraction = press ? 1 + INTERACTION.press.lensing : hover ? 1 + INTERACTION.hover.refraction : 1;
    s.tgt.brightness = hover && !press ? 1 + INTERACTION.hover.brightness : 1;
    s.motionMs = press ? INTERACTION.press.ms : hover ? INTERACTION.hover.ms : INTERACTION.releaseMs;
    this.adapt(s);
    this.kick();
  }

  // ------------------------------------------------------------------ internals

  private refreshAll() {
    for (const s of this.surfaces.values()) {
      this.applyStatic(s);
      this.applyOptics(s);
      this.adapt(s);
    }
  }

  private readCanvas() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--surface-deep").trim();
    const m = v.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      this.canvas = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  }

  private onScroll = () => {
    if (!this.scrolling) {
      this.scrolling = true;
      for (const s of this.surfaces.values()) this.applyOptics(s);
    }
    clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => {
      this.scrolling = false;
      for (const s of this.surfaces.values()) this.applyOptics(s);
      this.sampleAll(true);
    }, 140);
  };

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.dirtyLayout.size) {
      const t0 = performance.now();
      for (const s of this.dirtyLayout) this.layout(s);
      this.dirtyLayout.clear();
      this.lastLayoutMs = performance.now() - t0;
    }
    // Ease refraction and brightness toward their targets.
    let moving = false;
    for (const s of this.surfaces.values()) {
      const k = Math.min(1, 16 / Math.max(16, s.motionMs));
      let changed = false;
      for (const key of ["refraction", "brightness"] as const) {
        const d = s.tgt[key] - s.cur[key];
        if (Math.abs(d) > 0.001) {
          s.cur[key] += d * k * 2.2;
          if (Math.abs(s.tgt[key] - s.cur[key]) < 0.001) s.cur[key] = s.tgt[key];
          changed = true;
        }
      }
      if (changed) {
        this.applyOptics(s);
        moving = true;
      }
    }
    void now;
    if (moving) this.kick();
  };

  private profile(s: Surface): Profile {
    return PROFILES[s.opts.material];
  }

  /** Material constants that do not depend on the scene. */
  private applyStatic(s: Surface) {
    const p = this.profile(s);
    const st = s.parts.root.style;
    const t = p.thickness;
    const sh = (n: string, v: { y: number; blur: number; opacity: number }, k = 1) => {
      st.setProperty(`--g-${n}-y`, `${(v.y * t * k).toFixed(2)}px`);
      st.setProperty(`--g-${n}-b`, `${(v.blur * t * k).toFixed(2)}px`);
      st.setProperty(`--g-${n}-a`, v.opacity.toFixed(3));
    };
    sh("contact", p.shadow.contact, 1 / t);
    sh("body", p.shadow.body);
    sh("ambient", p.shadow.ambient);
    st.setProperty("--g-hair-a", (this.moreContrast ? 0.28 : p.rim.dark).toFixed(3));
    s.parts.root.dataset.material = s.opts.material;
  }

  private buildFilter(s: Surface) {
    if (!this.defs) return;
    const f = document.createElementNS(SVG_NS, "filter");
    f.id = `${s.id}-f`;
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("primitiveUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    f.setAttribute("x", "0");
    f.setAttribute("y", "0");
    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent: Element = f) => {
      const e = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.appendChild(e);
      return e as SVGElementTagNameMap[K];
    };
    const lens = mk("feImage", { result: "lens", x: "0", y: "0", preserveAspectRatio: "none" });
    const disp = mk("feDisplacementMap", { in: "SourceGraphic", in2: "lens", xChannelSelector: "R", yChannelSelector: "G", result: "bent" });
    const frost = mk("feGaussianBlur", { in: "bent", edgeMode: "duplicate", result: "frost" });
    const sharp = mk("feGaussianBlur", { in: "bent", edgeMode: "duplicate", result: "sharp" });
    const edge = mk("feImage", { result: "edge", x: "0", y: "0", preserveAspectRatio: "none" });
    mk("feComposite", { in: "sharp", in2: "edge", operator: "in", result: "sharpEdge" });
    mk("feComposite", { in: "frost", in2: "edge", operator: "out", result: "frostMid" });
    mk("feComposite", { in: "sharpEdge", in2: "frostMid", operator: "arithmetic", k1: "0", k2: "1", k3: "1", k4: "0", result: "lensed" });
    const scatter = mk("feGaussianBlur", { in: "lensed", edgeMode: "duplicate", result: "scatter" });
    const scatterMix = mk("feComposite", { in: "lensed", in2: "scatter", operator: "arithmetic", k1: "0", k4: "0", result: "body" });
    const sat = mk("feColorMatrix", { in: "body", type: "saturate", result: "sat" });
    const ct = mk("feComponentTransfer", { in: "sat", result: "glass" });
    const fr = mk("feFuncR", { type: "linear" }, ct);
    const fg = mk("feFuncG", { type: "linear" }, ct);
    const fb = mk("feFuncB", { type: "linear" }, ct);
    const fa = mk("feFuncA", { type: "linear" }, ct);
    this.defs.appendChild(f);
    s.filter = f;
    s.prims = { lens, disp, frost, sharp, edge, scatter, scatterMix, sat, fr, fg, fb, fa };
  }

  /** Size, shape and maps (on resize, shape or material change). */
  private layout(s: Surface) {
    const root = s.parts.root;
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    if (!w || !h) return;
    const p = this.profile(s);
    const t = p.thickness;
    const r = s.opts.shapes ? 0 : radiusOf(root, w, h);
    // Enough backdrop beyond the outline for the lens to bend in and the frost to spread.
    const pad = Math.ceil(p.refraction.edge * t + p.refraction.body * t + 4);
    const dpr = Math.min(2, devicePixelRatio || 1);
    s.flat = transformedAncestor(root);
    const maps = buildOptics({
      w,
      h,
      r,
      shapes: s.opts.shapes,
      merge: s.opts.merge,
      thickness: t,
      lens: { width: p.refraction.lensWidth, center: p.refraction.center, body: p.refraction.body, edge: p.refraction.edge },
      pad,
      dpr,
      specular: p.specular.strength,
      innerShadow: p.inner.shadow,
    });
    s.w = w;
    s.h = h;
    s.r = r;
    s.pad = pad;
    s.maps = maps;
    const st = root.style;
    st.setProperty("--g-pad", `${pad}px`);
    st.setProperty("--g-r", `${r}px`);
    st.setProperty("--g-light-img", `url(${maps.light})`);
    st.setProperty("--g-shade-img", `url(${maps.shade})`);
    st.setProperty("--g-mask-img", `url(${maps.mask})`);
    if (s.opts.shapes?.length) root.dataset.melted = "";
    else delete root.dataset.melted;
    if (s.prims && s.filter) {
      const W = w + 2 * pad;
      const H = h + 2 * pad;
      setAttr(s.filter, "width", String(W));
      setAttr(s.filter, "height", String(H));
      for (const img of [s.prims.lens, s.prims.edge]) {
        setAttr(img, "width", String(W));
        setAttr(img, "height", String(H));
      }
      setAttr(s.prims.lens, "href", maps.lens);
      setAttr(s.prims.edge, "href", maps.edge);
    }
    this.applyOptics(s);
  }

  /** The backdrop pass: the SVG lens, a CSS fallback, or a solid body. */
  private applyOptics(s: Surface) {
    const o = s.parts.optics;
    const q = this.effectiveQuality();
    if (!s.visible || q === "solid") {
      o.style.backdropFilter = "none";
      return;
    }
    const p = this.profile(s);
    const tint = this.tintFor(s);
    const blur = this.blurFor(s);
    const sat = p.saturation * (this.active ? 1 : INACTIVE.saturation);
    if (q === "full" && !s.flat && s.maps && s.prims) {
      const pr = s.prims;
      const refr = s.cur.refraction * (this.active ? 1 : INACTIVE.refraction) * (this.scrolling ? 0.5 : 1) * (this.reducedTransparency ? 0.5 : 1);
      setAttr(pr.disp, "scale", (s.maps.lensScale * refr).toFixed(2));
      setAttr(pr.frost, "stdDeviation", blur.toFixed(2));
      setAttr(pr.sharp, "stdDeviation", (blur * 0.38).toFixed(2));
      setAttr(pr.scatter, "stdDeviation", (p.scatter.radius * Math.sqrt(p.thickness)).toFixed(2));
      const sc = p.scatter.strength * Math.sqrt(p.thickness);
      setAttr(pr.scatterMix, "k2", (1 - sc).toFixed(3));
      setAttr(pr.scatterMix, "k3", sc.toFixed(3));
      setAttr(pr.sat, "values", sat.toFixed(3));
      // Dynamic range, tint and black response folded into one linear transfer per channel.
      const b = p.brightness * s.cur.brightness;
      const c = p.contrast;
      const comp = 1 - p.highlightCompression - p.shadowLift;
      const slope2 = c * b * comp;
      const int2 = 0.5 * (1 - c) * b * comp + p.shadowLift;
      const ch = [tint.r, tint.g, tint.b];
      [pr.fr, pr.fg, pr.fb].forEach((fn, i) => {
        setAttr(fn, "slope", (slope2 * (1 - tint.a) * (1 - tint.black)).toFixed(4));
        setAttr(fn, "intercept", ((int2 * (1 - tint.a) + (ch[i] / 255) * tint.a) * (1 - tint.black)).toFixed(4));
      });
      // Over a transparent backdrop (window transparency) the glass keeps a body.
      setAttr(pr.fa, "slope", (1 - tint.floor).toFixed(3));
      setAttr(pr.fa, "intercept", tint.floor.toFixed(3));
      o.style.backdropFilter = `url(#${s.id}-f)`;
      o.style.removeProperty("background-color");
    } else {
      // Fallback: frost and colour in CSS, the tint as a fill.
      o.style.backdropFilter = `blur(${blur.toFixed(1)}px) saturate(${sat.toFixed(2)}) contrast(${p.contrast}) brightness(${(p.brightness * s.cur.brightness).toFixed(3)})`;
      o.style.backgroundColor = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${tint.a.toFixed(3)})`;
    }
  }

  private blurFor(s: Surface): number {
    const p = this.profile(s);
    let blur = p.blur * this.frost;
    if (this.reducedTransparency) blur *= 1.6;
    return blur;
  }

  /** Neutral tint by the scene's lightness, with its colour spilled in. */
  private tintFor(s: Surface): { r: number; g: number; b: number; a: number; black: number; floor: number } {
    const p = this.profile(s);
    const a = s.ambient;
    const L = a.luminance;
    // light (L ~ 0.6+), mid (~0.2), dark (< 0.05)
    const base = L > 0.2 ? lerp(p.tint.mid, p.tint.light, clamp((L - 0.2) / 0.4, 0, 1)) : lerp(p.tint.dark, p.tint.mid, clamp(L / 0.2, 0, 1));
    let alpha = base * (this.frost > 1 ? 1 + (this.frost - 1) * 0.6 : this.frost);
    let colour: [number, number, number] = s.tone === "light" || !p.flips ? [255, 255, 255] : [255, 255, 255];
    // Large glass in a dark app keeps a dark body; its tint lifts it only slightly.
    if (!p.flips && s.tone === "dark") colour = [44, 44, 48];
    // A tone forced against the scene needs a body solid enough for its own ink.
    const against = this.tone !== "auto" && p.flips && (this.tone === "light") !== L > 0.36;
    if (against) {
      alpha = Math.max(alpha, 0.42 * Math.max(0.6, this.frost));
      colour = this.tone === "light" ? [250, 250, 252] : [30, 30, 34];
    }
    if (this.reducedTransparency) alpha = Math.max(alpha, p.flips ? 0.55 : 0.85);
    if (s.opts.selected) alpha += 0.04;
    const k = p.environment.spill * (1 + a.chroma);
    const spill: [number, number, number] = [lerp(colour[0], a.r, k), lerp(colour[1], a.g, k), lerp(colour[2], a.b, k)];
    const black = L > 0.45 && s.tone === "light" ? p.blackResponse : 0;
    const floor = clamp(alpha + 0.25, 0.3, 0.95);
    return { r: spill[0], g: spill[1], b: spill[2], a: clamp(alpha, 0, 0.96), black, floor };
  }

  /** Everything that follows the scene: tone, light strength, shadow depth, ink. */
  private adapt(s: Surface) {
    const p = this.profile(s);
    const a = s.ambient;
    const L = a.luminance;
    // Small glass flips with hysteresis; large glass keeps the app's (dark) tone.
    let tone: "light" | "dark";
    if (!p.flips) tone = "dark";
    else if (this.tone !== "auto") tone = this.tone;
    else tone = s.tone === "light" ? (L > 0.3 ? "light" : "dark") : L > 0.38 ? "light" : "dark";
    s.tone = tone;
    const root = s.parts.root;
    root.dataset.tone = tone;
    const st = root.style;
    // White light reads far stronger over a dark scene: the baked map is for bright scenes.
    const sceneGain = lerp(0.42, 1, clamp((L - 0.04) / 0.5, 0, 1));
    let light = sceneGain;
    if (s.hover) light *= 1 + INTERACTION.hover.rim;
    if (!this.active) light *= INACTIVE.specular;
    if (this.moreContrast) light = Math.min(1, light * 1.3);
    st.setProperty("--g-light", light.toFixed(3));
    // Shadow: deeper over busy content, lighter over clean bright scenes.
    let shadow = (1 + 0.35 * a.busy) * (L > 0.5 && a.busy < 0.15 ? 0.78 : 1);
    if (s.hover) shadow *= 1 + INTERACTION.hover.shadow;
    if (s.press) shadow *= 1 + INTERACTION.press.shadow;
    if (!this.active) shadow *= INACTIVE.shadow;
    st.setProperty("--g-shadow", shadow.toFixed(3));
    st.setProperty("--g-env", `${a.r | 0},${a.g | 0},${a.b | 0}`);
    st.setProperty("--g-env-a", (p.environment.reflection * (0.4 + a.chroma)).toFixed(3));
    st.setProperty("--g-glow-a", (INTERACTION.glow.opacity * (s.press ? 1 + INTERACTION.press.glow : 1)).toFixed(3));
    // Publish how this glass looks, for glass above it to sample.
    const t = this.tintFor(s);
    root.dataset.glassSeen = [0, 1, 2]
      .map((i) => Math.round(lerp([a.r, a.g, a.b][i], [t.r, t.g, t.b][i], t.a)))
      .join(",");
    this.applyOptics(s);
  }

  private sampleAll(force: boolean) {
    const t0 = performance.now();
    if (this.scrolling) return;
    // Lower tiers first, so higher glass sees them as they now appear.
    const list = [...this.surfaces.values()].filter((s) => s.visible && s.opts.sample).sort((a, b) => a.opts.layer - b.opts.layer);
    for (const s of list) {
      if (!force && performance.now() - s.sampledAt < 2000) continue;
      const rect = s.parts.root.getBoundingClientRect();
      if (rect.width < 1 || rect.bottom < 0 || rect.top > innerHeight) continue;
      s.ambient = sample(s.parts.root, rect, this.canvas);
      s.sampledAt = performance.now();
      this.adapt(s);
    }
    for (const s of this.surfaces.values()) if (!s.opts.sample && s.sampledAt === 0) ((s.sampledAt = 1), this.adapt(s));
    this.lastSampleMs = performance.now() - t0;
  }
}

export const glassEngine = new GlassEngine();
