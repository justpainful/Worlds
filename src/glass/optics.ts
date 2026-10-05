/**
 * Geometry and light for one piece of glass.
 *
 * Everything starts from the shape's signed distance field (SDF): a rounded
 * rectangle, a capsule, a circle, or several of them melted into one body
 * (smooth union). From the SDF come, per pixel, the depth inside the edge
 * and the direction of the surface normal, and from those:
 *
 *   lens map    how far, and which way, the backdrop is displaced. The centre
 *               barely moves (a slight magnification), the body a little, and
 *               the edge band bends strongly outward along the normal, so the
 *               scene just past the edge is drawn in around it.
 *   edge mask   where the lens band is (sharper there, frosted in the middle).
 *   light map   white light on the surface: the rim, brightest facing the
 *               light with a counter-reflection on the far side; Fresnel
 *               light gathered inside the edge; a soft specular on the bevel
 *               that faces the light; a grain too fine to see.
 *   shade map   the faint inner shadow on the side away from the light, and
 *               the slightly deeper glass across the upper middle.
 *   shape mask  the outline itself, for melted shapes (simple shapes clip
 *               with a rounded inset instead).
 *
 * The light falloffs were measured from the macOS 26 Mail toolbar; they are
 * baked at the strength they have over a bright scene, and the engine dims
 * the whole map over darker scenes (white light reads far stronger there).
 */

export interface GlassShape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface OpticsInput {
  w: number;
  h: number;
  /** Corner radius for a single shape (ignored when `shapes` is set). */
  r: number;
  shapes?: GlassShape[];
  merge?: number;
  thickness: number;
  /** Lens band width and displacements, px at thickness 1. */
  lens: { width: number; center: number; body: number; edge: number };
  /** Margin of backdrop the optics read around the shape. */
  pad: number;
  /** Device pixel ratio for the light maps. */
  dpr: number;
  specular: number;
  innerShadow: number;
}

export interface OpticsMaps {
  key: string;
  /** Displacement map over the padded box (R = x, G = y, 0.5 = none). */
  lens: string;
  /** feDisplacementMap scale that maps the map's 0..1 back to pixels. */
  lensScale: number;
  /** Alpha: 1 in the edge band, 0 in the middle (padded box). */
  edge: string;
  light: string;
  shade: string;
  /** Alpha outline of the shape over the padded box: what clips the optics. */
  mask: string;
}

const LIGHT = normalize3(-0.34, -0.94, 0.9);

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function sdRoundRect(px: number, py: number, s: GlassShape): number {
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const qx = Math.abs(px - cx) - (s.w / 2 - r);
  const qy = Math.abs(py - cy) - (s.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Polynomial smooth minimum: shapes closer than k melt into one body. */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

function makeSdf(inp: OpticsInput): (x: number, y: number) => number {
  const shapes = inp.shapes?.length ? inp.shapes : [{ x: 0, y: 0, w: inp.w, h: inp.h, r: inp.r }];
  const k = inp.merge ?? 0;
  return (x, y) => {
    let d = sdRoundRect(x, y, shapes[0]);
    for (let i = 1; i < shapes.length; i++) d = smin(d, sdRoundRect(x, y, shapes[i]), k);
    return d;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d")!;
  return [c, ctx, ctx.createImageData(c.width, c.height)];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Small deterministic grain, so gradients never band. */
function grain(i: number): number {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x & 1023) / 1023 - 0.5;
}

const cache = new Map<string, OpticsMaps>();

export function opticsKey(inp: OpticsInput): string {
  const s = inp.shapes?.map((q) => `${q.x | 0},${q.y | 0},${q.w | 0},${q.h | 0},${q.r | 0}`).join(";") ?? "";
  return [inp.w | 0, inp.h | 0, Math.round(inp.r), s, inp.merge ?? 0, inp.thickness, inp.lens.width, inp.lens.edge, inp.pad, inp.dpr, inp.specular, inp.innerShadow].join("|");
}

export function buildOptics(inp: OpticsInput): OpticsMaps {
  const key = opticsKey(inp);
  const hit = cache.get(key);
  if (hit) return hit;
  const sdf = makeSdf(inp);
  const t = inp.thickness;
  const tk = Math.sqrt(t);
  const minHalf = Math.min(inp.w, inp.h) / 2;
  const lensW = Math.min(inp.lens.width * t, minHalf * 0.9);
  const edgeD = inp.lens.edge * t;
  const bodyD = inp.lens.body * t;
  const centerD = inp.lens.center * t;
  const maxD = edgeD + bodyD + centerD + 0.5;
  const P = inp.pad;
  const W = Math.ceil(inp.w + 2 * P);
  const H = Math.ceil(inp.h + 2 * P);
  const cx = inp.w / 2;
  const cy = inp.h / 2;

  // ---- lens, edge and outline over the padded box (CSS px; the lens is smooth) ----
  const [lc, lctx, lens] = canvas(W, H);
  const [ec, ectx, edge] = canvas(W, H);
  const [mc, mctx, mask] = canvas(W, H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = px + 0.5 - P;
      const y = py + 0.5 - P;
      const d = sdf(x, y);
      const i = (py * W + px) * 4;
      // Outward normal from the field's gradient.
      const gx = sdf(x + 0.5, y) - sdf(x - 0.5, y);
      const gy = sdf(x, y + 0.5) - sdf(x, y - 0.5);
      const gl = Math.hypot(gx, gy) || 1;
      const nx = gx / gl;
      const ny = gy / gl;
      const depth = -d;
      const b = clamp01(depth / lensW);
      // Edge lens: strongest at the rim, gone by the end of the band.
      const e = edgeD * (1 - b) * (1 - b);
      // Body: a gentle bend across the bevel.
      const m = bodyD * (1 - b) * b * 4 * 0.5;
      // Centre: a slight magnification (sample nearer the middle).
      const ox = ((x - cx) / Math.max(1, inp.w / 2)) * -centerD;
      const oy = ((y - cy) / Math.max(1, inp.h / 2)) * -centerD;
      let dx = nx * (e + m) + ox;
      let dy = ny * (e + m) + oy;
      if (depth < 0) {
        // Outside the outline nothing shows; keep the map continuous.
        dx = nx * edgeD;
        dy = ny * edgeD;
      }
      lens.data[i] = Math.round(255 * clamp01(0.5 + dx / (2 * maxD)));
      lens.data[i + 1] = Math.round(255 * clamp01(0.5 + dy / (2 * maxD)));
      lens.data[i + 2] = 128;
      lens.data[i + 3] = 255;
      edge.data[i] = edge.data[i + 1] = edge.data[i + 2] = 255;
      edge.data[i + 3] = Math.round(255 * (1 - smooth(0, lensW, depth)));
      mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = 255;
      mask.data[i + 3] = Math.round(255 * clamp01(0.5 - d));
    }
  }
  lctx.putImageData(lens, 0, 0);
  ectx.putImageData(edge, 0, 0);
  mctx.putImageData(mask, 0, 0);

  // ---- light and shade over the shape (device pixels) ----
  const s = inp.dpr;
  const LW = Math.ceil(inp.w * s);
  const LH = Math.ceil(inp.h * s);
  const [hc, hctx, light] = canvas(LW, LH);
  const [sc, sctx, shade] = canvas(LW, LH);
  const px1 = 1 / s; // one device pixel in CSS px
  const rimW = 1 * tk;
  // Specular: Blinn-Phong on the bevel normal, flat glass subtracted so only the curve shines.
  const H3 = normalize3(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
  const shin = 2 / (0.32 * 0.32) - 2;
  const flat = Math.pow(H3[2], shin);
  for (let py = 0; py < LH; py++) {
    for (let px = 0; px < LW; px++) {
      const x = (px + 0.5) / s;
      const y = (py + 0.5) / s;
      const d = sdf(x, y);
      const i = (py * LW + px) * 4;
      const cover = clamp01(0.5 - d / px1);
      // Outside, or deep in the flat middle where no light lands.
      if (cover <= 0 || -d > 16 * t) continue;
      const gx = sdf(x + 0.5, y) - sdf(x - 0.5, y);
      const gy = sdf(x, y + 0.5) - sdf(x, y - 0.5);
      const gl = Math.hypot(gx, gy) || 1;
      const nx = gx / gl;
      const ny = gy / gl;
      const depth = Math.max(0, -d);
      // Facing: up toward the light, down for the counter-reflection, across for the flanks.
      const up = Math.max(-ny, 0);
      const down = Math.max(ny, 0);
      const across = Math.abs(nx);
      const lean = 0.92 + 0.08 * Math.max(-nx, 0); // the light sits a little to the left
      const wUp = up * up * lean;
      const wDown = down * down;
      const wSide = across * across;

      // Rim: one crisp band, brightest facing the light.
      const band = clamp01((rimW - depth) / px1 + 0.5);
      const rim = band * (0.3 + 0.7 * wUp + 0.62 * wDown);

      // Fresnel light gathered inside the edge (measured falloffs, scaled with thickness).
      const dd = depth / tk;
      const top = 0.46 * wUp * clamp01(1 - (dd - 1.5) / 6.3);
      const bottom = 0.5 * wDown * clamp01(1 - (dd - 1.5) / 4.2);
      const side = 0.35 * wSide * Math.exp(-dd / 0.9);

      // Soft specular on the bevel facing the light.
      const bb = clamp01(depth / (9 * t));
      const tilt = 1.73 * (1 - bb);
      const N = normalize3(nx * tilt, ny * tilt, 1);
      const ndh = Math.max(0, N[0] * H3[0] + N[1] * H3[1] + N[2] * H3[2]);
      const spec = (inp.specular * Math.max(0, Math.pow(ndh, shin) - flat)) / (1 - flat);

      let a = 1 - (1 - rim) * (1 - top) * (1 - bottom) * (1 - side) * (1 - spec);
      a = clamp01(a + grain(i) * 0.004) * cover;
      light.data[i] = light.data[i + 1] = light.data[i + 2] = 255;
      light.data[i + 3] = Math.round(255 * a);

      // Shade: the inner shadow away from the light, and the deeper upper middle.
      const inner = inp.innerShadow * wDown * smooth(0.8, 2, depth) * (1 - smooth(2.5, 4, depth));
      const deep = 0.02 * wUp * smooth(5 * tk, 8 * tk, depth) * (1 - smooth(11 * tk, 15 * tk, depth));
      shade.data[i + 3] = Math.round(255 * clamp01(inner + deep) * cover);
    }
  }
  hctx.putImageData(light, 0, 0);
  sctx.putImageData(shade, 0, 0);

  const maps: OpticsMaps = {
    key,
    lens: lc.toDataURL(),
    lensScale: 2 * maxD,
    edge: ec.toDataURL(),
    light: hc.toDataURL(),
    shade: sc.toDataURL(),
    mask: mc.toDataURL(),
  };
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(key, maps);
  return maps;
}
