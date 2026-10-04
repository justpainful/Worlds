/**
 * Optical maps derived from surface geometry.
 *
 * For a rounded-rect surface we compute a signed distance field, then a
 * convex height profile across the bezel (thin, flat center; thick, curved
 * rim). From its slope we derive:
 *
 *   displacement map: per-pixel refraction vector (R = x, G = y), pointing
 *                     inward so the lens samples from inside the surface.
 *                     Strongest at the rim and corners, near zero in the center.
 *   thickness mask:   alpha = perceived thickness. Drives the blend between
 *                     the clear center blur and the thicker edge blur, so blur
 *                     is never uniform from center to edge.
 *
 * Maps are cached by geometry and rendered at reduced resolution. They are
 * smooth fields, upscaled bilinearly by the filter pipeline.
 */

export interface OpticalMaps {
  key: string;
  displacement: string; // data URL
  thickness: string; // data URL
  width: number;
  height: number;
}

const cache = new Map<string, OpticalMaps>();
const MAX_CACHE = 96;
const MAX_MAP_SIDE = 420;

/** Convex bezel profile: h(0) = 0 at the rim, h(1) = 1 inside. */
function height(t: number) {
  const u = 1 - Math.min(1, Math.max(0, t));
  return Math.pow(1 - u * u * u * u, 0.25);
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function opticalMaps(width: number, height_: number, radius: number, bezel: number): OpticalMaps {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height_));
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const b = Math.max(2, Math.min(bezel, Math.min(w, h) / 2 - 0.5));
  const key = `${w}x${h}r${Math.round(r)}b${Math.round(b)}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const scale = Math.min(1, MAX_MAP_SIDE / Math.max(w, h));
  const mw = Math.max(2, Math.round(w * scale));
  const mh = Math.max(2, Math.round(h * scale));

  const dc = document.createElement("canvas");
  dc.width = mw;
  dc.height = mh;
  const tc = document.createElement("canvas");
  tc.width = mw;
  tc.height = mh;
  const dctx = dc.getContext("2d")!;
  const tctx = tc.getContext("2d")!;
  const dimg = dctx.createImageData(mw, mh);
  const timg = tctx.createImageData(mw, mh);
  const dd = dimg.data;
  const td = timg.data;

  const cx = w / 2;
  const cy = h / 2;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const eps = 0.02;
  // Snell-like deviation for n ~ 1.5: deviation grows with atan(slope).
  const HALF_PI = Math.PI / 2;

  for (let my = 0; my < mh; my++) {
    const y = (my + 0.5) / scale;
    for (let mx = 0; mx < mw; mx++) {
      const x = (mx + 0.5) / scale;
      const px = x - cx;
      const py = y - cy;
      const qx = Math.abs(px) - hx;
      const qy = Math.abs(py) - hy;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const inside = Math.min(Math.max(qx, qy), 0);
      const sd = outside + inside - r; // negative inside
      const dist = -sd;

      // outward normal of the nearest edge
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const l = outside || 1;
        nx = (ox / l) * Math.sign(px);
        ny = (oy / l) * Math.sign(py);
      } else if (qx > qy) {
        nx = Math.sign(px) || 1;
      } else {
        ny = Math.sign(py) || 1;
      }

      const t = dist / b;
      let mag = 0;
      if (t < 1 && dist > -1) {
        const slope = (height(t + eps) - height(t)) / eps;
        const tilt = Math.atan(slope * 1.6) / HALF_PI; // 0..1
        // Corners curve in two directions, so they lens a little more.
        const cornerBoost = qx > 0 && qy > 0 ? 1.15 : 1;
        mag = Math.min(1, tilt * 0.82 * cornerBoost);
        // Feather the outermost pixel so the rim does not alias.
        mag *= smoothstep(-0.5, 1.2, dist);
      }
      const i = (my * mw + mx) * 4;
      dd[i] = Math.round(128 - nx * mag * 127);
      dd[i + 1] = Math.round(128 - ny * mag * 127);
      dd[i + 2] = 128;
      dd[i + 3] = 255;

      // Thickness: 1 at the rim, falling to 0 across 1.8 bezel widths.
      const thick = 1 - smoothstep(0, b * 1.8, Math.max(0, dist));
      td[i] = 255;
      td[i + 1] = 255;
      td[i + 2] = 255;
      td[i + 3] = Math.round(thick * 255);
    }
  }
  dctx.putImageData(dimg, 0, 0);
  tctx.putImageData(timg, 0, 0);

  const maps: OpticalMaps = {
    key,
    displacement: dc.toDataURL("image/png"),
    thickness: tc.toDataURL("image/png"),
    width: w,
    height: h,
  };
  cache.set(key, maps);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  return maps;
}

// ---------------------------------------------------------------------------
// Merged glass: several rounded shapes melted into one continuous body.
// ---------------------------------------------------------------------------

/** A rounded rectangle in the surface's local CSS pixels (a circle is w = h = 2r). */
export interface GlassShape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface UnionMaps extends OpticalMaps {
  mask: string; // alpha = inside the merged body (anti-aliased)
  rim: string; // directional edge light following the merged outline
}

const unionCache = new Map<string, UnionMaps>();

function sdRoundRect(px: number, py: number, s: GlassShape) {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const qx = Math.abs(px - cx) - (s.w / 2 - r);
  const qy = Math.abs(py - cy) - (s.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Polynomial smooth minimum: k is the width of the liquid bridge in px. */
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Maps for a merged body. The signed distance field is the smooth union of
 * the shapes, so refraction, thickness, rim light and the clip mask all
 * follow one continuous outline, including the liquid neck between shapes.
 */
export function unionMaps(
  width: number,
  height: number,
  shapes: GlassShape[],
  bezel: number,
  k: number,
  rim: { top: number; side: number; bottom: number; inner: number },
): UnionMaps {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const key = `${w}x${h}b${Math.round(bezel)}k${Math.round(k)}|${shapes.map((s) => `${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.w)},${Math.round(s.h)},${Math.round(s.r)}`).join(";")}|${rim.top}`;
  const hit = unionCache.get(key);
  if (hit) return hit;

  // The rim needs crisp pixels, so render at device resolution (capped).
  const scale = Math.min(window.devicePixelRatio || 1, 2, 900 / Math.max(w, h));
  const mw = Math.max(2, Math.round(w * scale));
  const mh = Math.max(2, Math.round(h * scale));
  const mk = (n: number, m: number) => {
    const c = document.createElement("canvas");
    c.width = n;
    c.height = m;
    return c;
  };
  const cD = mk(mw, mh), cT = mk(mw, mh), cM = mk(mw, mh), cR = mk(mw, mh);
  const xD = cD.getContext("2d")!, xT = cT.getContext("2d")!, xM = cM.getContext("2d")!, xR = cR.getContext("2d")!;
  const iD = xD.createImageData(mw, mh), iT = xT.createImageData(mw, mh), iM = xM.createImageData(mw, mh), iR = xR.createImageData(mw, mh);

  const sdf = (px: number, py: number) => {
    let d = sdRoundRect(px, py, shapes[0]);
    for (let i = 1; i < shapes.length; i++) d = smin(d, sdRoundRect(px, py, shapes[i]), k);
    return d;
  };
  const e = 0.75;
  const HALF_PI = Math.PI / 2;
  for (let my = 0; my < mh; my++) {
    const y = (my + 0.5) / scale;
    for (let mx = 0; mx < mw; mx++) {
      const x = (mx + 0.5) / scale;
      const d = sdf(x, y);
      // outward normal from the field gradient
      let nx = sdf(x + e, y) - sdf(x - e, y);
      let ny = sdf(x, y + e) - sdf(x, y - e);
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const i = (my * mw + mx) * 4;
      const dist = -d;

      // refraction (inward), strongest near the rim
      let mag = 0;
      if (dist > -1 && dist < bezel) {
        const t = Math.max(0, dist) / bezel;
        const u = 1 - t;
        const slope = (u * u * u) * 4 * Math.pow(Math.max(1e-4, 1 - u * u * u * u), -0.75) * 0.25;
        mag = Math.min(1, (Math.atan(slope * 1.6) / HALF_PI) * 0.82) * smoothstep(-0.5, 1.2, dist);
      }
      iD.data[i] = Math.round(128 - nx * mag * 127);
      iD.data[i + 1] = Math.round(128 - ny * mag * 127);
      iD.data[i + 2] = 128;
      iD.data[i + 3] = 255;

      // thickness for the blur blend
      iT.data[i] = iT.data[i + 1] = iT.data[i + 2] = 255;
      iT.data[i + 3] = Math.round((1 - smoothstep(0, bezel * 1.8, Math.max(0, dist))) * 255);

      // anti-aliased body mask
      iM.data[i] = iM.data[i + 1] = iM.data[i + 2] = 0;
      iM.data[i + 3] = Math.round(Math.min(1, Math.max(0, 0.5 + dist * scale)) * 255);

      // rim: a thin lit band on the outline, brighter where the edge faces up
      const band = Math.max(0, 1 - Math.abs(dist - 0.6) / 0.9);
      const light = rim.side + (rim.top - rim.side) * Math.max(0, -ny) + (rim.bottom - rim.side) * Math.max(0, ny);
      const inner = dist > 0.8 && dist < 3 ? rim.inner * Math.max(0, -ny) * (1 - (dist - 0.8) / 2.2) : 0;
      iR.data[i] = iR.data[i + 1] = iR.data[i + 2] = 255;
      iR.data[i + 3] = Math.round(Math.min(1, band * light + inner) * 255);
    }
  }
  xD.putImageData(iD, 0, 0);
  xT.putImageData(iT, 0, 0);
  xM.putImageData(iM, 0, 0);
  xR.putImageData(iR, 0, 0);
  const maps: UnionMaps = {
    key,
    displacement: cD.toDataURL("image/png"),
    thickness: cT.toDataURL("image/png"),
    mask: cM.toDataURL("image/png"),
    rim: cR.toDataURL("image/png"),
    width: w,
    height: h,
  };
  unionCache.set(key, maps);
  if (unionCache.size > 48) {
    const first = unionCache.keys().next().value;
    if (first) unionCache.delete(first);
  }
  return maps;
}

let noiseUrl: string | null = null;
/** A small tile of fine luminance noise, generated once. */
export function noiseTile(): string {
  if (noiseUrl) return noiseUrl;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(96, 96);
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(rnd() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseUrl = c.toDataURL("image/png");
  return noiseUrl;
}
