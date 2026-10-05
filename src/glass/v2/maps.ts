/**
 * Liquid Glass V2: the images the filter and the overlay layers use, all
 * computed from surface.ts at device-pixel resolution.
 *
 *   lens    displacement (R = x, G = y, 0.5 = none), padded box
 *   frost   alpha = share of the frost branch, padded box
 *   mask    alpha = coverage of the outline, padded box (cuts the optics)
 *   light   white alpha: Fresnel x environment + specular + bevel highlight
 *   shade   black alpha: the bevel facing away from the key light
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
  const key = JSON.stringify([inp.w, inp.h, Math.round(inp.r), inp.shapes ?? null, inp.merge ?? 0, inp.dpr, p]);
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
  for (let py = 0; py < LH; py++) {
    for (let px = 0; px < LW; px++) {
      const x = (px + 0.5) / s;
      const y = (py + 0.5) / s;
      const i = (py * LW + px) * 4;
      const pt = surfaceAt(sdf, spec, x, y);
      const cover = Math.min(1, Math.max(0, 0.5 + pt.d * s));
      if (cover <= 0) continue;
      const l = lighting(p, pt);
      light.img.data[i] = light.img.data[i + 1] = light.img.data[i + 2] = 255;
      light.img.data[i + 3] = Math.round(255 * l.light * cover);
      shade.img.data[i + 3] = Math.round(255 * l.shade * cover);
    }
  }
  light.ctx.putImageData(light.img, 0, 0);
  shade.ctx.putImageData(shade.img, 0, 0);

  const maps: MapsV2 = {
    key,
    pad,
    scale,
    lens: lens.c.toDataURL(),
    frost: frost.c.toDataURL(),
    mask: mask.c.toDataURL(),
    light: light.c.toDataURL(),
    shade: shade.c.toDataURL(),
    ms: performance.now() - t0,
  };
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(key, maps);
  return maps;
}
