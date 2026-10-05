/**
 * Liquid Glass V2: the images the filter and the overlay layers use, all
 * computed from surface.ts at device-pixel resolution.
 *
 *   lens    displacement (R = x, G = y, 0.5 = none), padded box
 *   frost   alpha = share of the frost branch, padded box
 *   mask    alpha = coverage of the outline, padded box (cuts the optics)
 *   light   white alpha: Fresnel x environment + specular + bevel highlight (baked at max exposure)
 *   shade   black alpha: the bevel facing away from the key light
 *   edge    black alpha: the outer interface (scaled per scene by the layer)
 *   debug   optional views: normals, Fresnel, outer interface, inner rim, lighting
 *
 * Phase 1 builds them synchronously; the function is pure apart from the
 * canvas so it can move to a Worker with OffscreenCanvas.
 */
import type { ProfileV2 } from "./profile";
import { displacement, frostWeight, lighting, makeSdf, surfaceAt, surfaceSpec, type Shape } from "./surface";

export interface MapsInput {
  w: number;
  h: number;
  r: number;
  shapes?: Shape[];
  merge?: number;
  dpr: number;
  profile: ProfileV2;
  debug?: boolean;
}

export interface DebugMaps {
  normal: string;
  fresnel: string;
  outer: string;
  rim: string;
  lighting: string;
}

export interface MapsV2 {
  key: string;
  pad: number;
  /** feDisplacementMap scale (px) that maps 0..1 back to the offset. */
  scale: number;
  lens: string;
  frost: string;
  mask: string;
  light: string;
  shade: string;
  edge: string;
  glow: string;
  debug?: DebugMaps;
  ms: number;
}

const cache = new Map<string, MapsV2>();

function image(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d")!;
  return { c, ctx, img: ctx.createImageData(c.width, c.height) };
}

export function padFor(p: ProfileV2): number {
  const t = p.opticalThickness;
  return Math.ceil((p.edgeDisplacement + p.centerDisplacement) * t + 3 * p.bodyFrostSigma);
}

export function buildMaps(inp: MapsInput): MapsV2 {
  const p = inp.profile;
  const key = JSON.stringify([inp.w, inp.h, Math.round(inp.r), inp.shapes ?? null, inp.merge ?? 0, inp.dpr, p, !!inp.debug]);
  const hit = cache.get(key);
  if (hit) return hit;
  const t0 = performance.now();
  const shapes = inp.shapes?.length ? inp.shapes : [{ x: 0, y: 0, w: inp.w, h: inp.h, r: inp.r }];
  const sdf = makeSdf(shapes, inp.merge ?? 0);
  const spec = surfaceSpec(p, inp.w, inp.h);
  const pad = padFor(p);
  const scale = 2 * (p.edgeDisplacement + p.centerDisplacement) * p.opticalThickness + 0.5;
  const s = inp.dpr;

  // Padded box: lens, frost weight and coverage.
  const PW = Math.ceil((inp.w + 2 * pad) * s);
  const PH = Math.ceil((inp.h + 2 * pad) * s);
  const lens = image(PW, PH);
  const frost = image(PW, PH);
  const mask = image(PW, PH);
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const x = (px + 0.5) / s - pad;
      const y = (py + 0.5) / s - pad;
      const i = (py * PW + px) * 4;
      const pt = surfaceAt(sdf, spec, x, y);
      const [dx, dy] = pt.d > -1 ? displacement(spec, pt, p.refractionSign) : [0, 0];
      lens.img.data[i] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + dx / scale)));
      lens.img.data[i + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + dy / scale)));
      lens.img.data[i + 2] = 128;
      lens.img.data[i + 3] = 255;
      frost.img.data[i] = frost.img.data[i + 1] = frost.img.data[i + 2] = 255;
      frost.img.data[i + 3] = Math.round(255 * frostWeight(p, pt.q));
      mask.img.data[i] = mask.img.data[i + 1] = mask.img.data[i + 2] = 255;
      mask.img.data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + pt.d * s)));
    }
  }
  lens.ctx.putImageData(lens.img, 0, 0);
  frost.ctx.putImageData(frost.img, 0, 0);
  mask.ctx.putImageData(mask.img, 0, 0);

  // Element box: light and shade.
  const LW = Math.ceil(inp.w * s);
  const LH = Math.ceil(inp.h * s);
  const light = image(LW, LH);
  const shade = image(LW, LH);
  const edge = image(LW, LH);
  const glow = image(LW, LH);
  const dbg = inp.debug ? { normal: image(LW, LH), fresnel: image(LW, LH), outer: image(LW, LH), rim: image(LW, LH), lighting: image(LW, LH) } : null;
  const grey = (im: ReturnType<typeof image>, i: number, v: number) => {
    const g = Math.round(255 * Math.min(1, Math.max(0, v)));
    im.img.data[i] = im.img.data[i + 1] = im.img.data[i + 2] = g;
    im.img.data[i + 3] = 255;
  };
  for (let py = 0; py < LH; py++) {
    for (let px = 0; px < LW; px++) {
      const x = (px + 0.5) / s;
      const y = (py + 0.5) / s;
      const i = (py * LW + px) * 4;
      const pt = surfaceAt(sdf, spec, x, y);
      const cover = Math.min(1, Math.max(0, 0.5 + pt.d * s));
      if (cover <= 0) continue;
      const l = lighting(p, pt, 1 / s);
      light.img.data[i] = light.img.data[i + 1] = light.img.data[i + 2] = 255;
      light.img.data[i + 3] = Math.round(255 * l.light * cover);
      shade.img.data[i + 3] = Math.round(255 * l.shade * cover);
      edge.img.data[i + 3] = Math.round(255 * l.edge * cover);
      glow.img.data[i] = glow.img.data[i + 1] = glow.img.data[i + 2] = 255;
      glow.img.data[i + 3] = Math.round(255 * l.glow * cover);
      if (dbg) {
        dbg.normal.img.data[i] = Math.round(255 * (0.5 + 0.5 * pt.N[0]));
        dbg.normal.img.data[i + 1] = Math.round(255 * (0.5 - 0.5 * pt.N[1]));
        dbg.normal.img.data[i + 2] = Math.round(255 * pt.N[2]);
        dbg.normal.img.data[i + 3] = 255;
        grey(dbg.fresnel, i, l.fresnel * 4);
        grey(dbg.outer, i, l.edge / Math.max(0.01, p.outerEdgeAlpha));
        grey(dbg.rim, i, l.rim);
        grey(dbg.lighting, i, Math.min(1, l.light + l.glow));
      }
    }
  }
  light.ctx.putImageData(light.img, 0, 0);
  shade.ctx.putImageData(shade.img, 0, 0);
  edge.ctx.putImageData(edge.img, 0, 0);
  glow.ctx.putImageData(glow.img, 0, 0);
  let debug: DebugMaps | undefined;
  if (dbg) {
    for (const im of Object.values(dbg)) im.ctx.putImageData(im.img, 0, 0);
    debug = { normal: dbg.normal.c.toDataURL(), fresnel: dbg.fresnel.c.toDataURL(), outer: dbg.outer.c.toDataURL(), rim: dbg.rim.c.toDataURL(), lighting: dbg.lighting.c.toDataURL() };
  }

  const maps: MapsV2 = {
    key,
    pad,
    scale,
    lens: lens.c.toDataURL(),
    frost: frost.c.toDataURL(),
    mask: mask.c.toDataURL(),
    light: light.c.toDataURL(),
    shade: shade.c.toDataURL(),
    edge: edge.c.toDataURL(),
    glow: glow.c.toDataURL(),
    debug,
    ms: performance.now() - t0,
  };
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(key, maps);
  return maps;
}
