/**
 * Liquid Glass V2: one optical surface.
 *
 * Everything the glass does comes from a single pseudo-height field built on
 * the shape's signed distance field (SDF):
 *
 *   d  = distance inside the edge            nO = outward in-plane direction (SDF gradient)
 *   q  = clamp(d / W, 0, 1)                  W  = lens width
 *   height = Hb * (1 - (1 - q)^P)  +  Hd * (1 - rx^2 - ry^2) * fade(q)
 *            bevel                     a very low dome over the flat field only
 *   N  = normalize(-grad(height), 1)
 *
 * From N: refraction (displacement along the slope), Schlick Fresnel, a
 * synthetic low-frequency environment seen in the reflection vector,
 * specular, and the shading of the bevel. No per-effect curves.
 *
 * Pure functions with no DOM, so they can be unit-tested and moved to a Worker.
 */
import type { ProfileV2 } from "./profile";

export interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export type Vec3 = [number, number, number];

export const norm3 = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function sdRoundRect(px: number, py: number, s: Shape): number {
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const qx = Math.abs(px - (s.x + s.w / 2)) - (s.w / 2 - r);
  const qy = Math.abs(py - (s.y + s.h / 2)) - (s.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Polynomial smooth minimum: shapes closer than k melt into one body. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

export function makeSdf(shapes: Shape[], merge = 0): (x: number, y: number) => number {
  return (x, y) => {
    let d = sdRoundRect(x, y, shapes[0]);
    for (let i = 1; i < shapes.length; i++) d = smin(d, sdRoundRect(x, y, shapes[i]), merge);
    return d;
  };
}

/** Constants of the surface for one shape size and profile. */
export interface SurfaceSpec {
  W: number; // lens width (px)
  P: number; // bevel curve power
  Hb: number; // bevel height (px)
  Hd: number; // dome height (px)
  K: number; // displacement per unit slope at the edge
  gamma: number; // displacement = K * slope^gamma (gamma set by midDisplacement)
  cx: number;
  cy: number;
  hx: number; // half size
  hy: number;
}

export function surfaceSpec(p: ProfileV2, w: number, h: number): SurfaceSpec {
  const t = p.opticalThickness;
  const W = Math.min(p.lensWidth * t, 0.9 * Math.min(w, h) / 2);
  const P = p.surfaceCurvePower;
  // Bevel height such that the normal tilts edgeTiltDeg at the edge: Hb * P / W = tan(tilt).
  const edgeSlope = Math.tan((p.edgeTiltDeg * Math.PI) / 180);
  const Hb = (edgeSlope * W) / P;
  // Displacement grows with the slope; its exponent makes the mid-band value come out at midDisplacement.
  // slope(q = 0.5) / slope(0) = 0.5^(P - 1)
  const midRatio = Math.pow(0.5, P - 1);
  const gamma = Math.log(p.midDisplacement / p.edgeDisplacement) / Math.log(midRatio);
  const K = (p.edgeDisplacement * t) / Math.pow(edgeSlope, gamma);
  // Dome: lives only in the flat field (faded in over q 0.6..1, so the bevel alone sets the edge and
  // mid-band values); its slope where the flat field starts gives centerDisplacement.
  const hx = w / 2;
  const hy = h / 2;
  const half = Math.min(hx, hy);
  const rFlat = Math.max(0.25, (half - W) / half);
  const domeSlopeNeeded = Math.pow((p.centerDisplacement * t) / K, 1 / gamma);
  const Hd = (domeSlopeNeeded * half) / (2 * rFlat); // |grad(Hd(1 - r^2))| = 2 Hd r / half
  return { W, P, Hb, Hd, K, gamma, cx: hx, cy: hy, hx, hy };
}

export interface SurfacePoint {
  /** distance inside the outline (negative outside) */
  d: number;
  /** grad(height) in the plane (px of height per px) */
  gx: number;
  gy: number;
  /** surface normal toward the viewer */
  N: Vec3;
  /** optical depth 0 at the edge, 1 at the end of the bevel */
  q: number;
}

/** The surface at a point (local CSS px). */
export function surfaceAt(sdf: (x: number, y: number) => number, s: SurfaceSpec, x: number, y: number): SurfacePoint {
  const d = -sdf(x, y);
  const ex = sdf(x + 0.5, y) - sdf(x - 0.5, y);
  const ey = sdf(x, y + 0.5) - sdf(x, y - 0.5);
  const el = Math.hypot(ex, ey) || 1;
  const nOx = ex / el;
  const nOy = ey / el;
  const q = Math.min(1, Math.max(0, d / s.W));
  // Bevel: height rises inward, so its gradient points along -nO.
  const dh = d >= 0 && q < 1 ? (s.Hb * s.P * Math.pow(1 - q, s.P - 1)) / s.W : 0;
  // Dome: Hd * (1 - rx^2 - ry^2), gradient -2 Hd (rx / hx, ry / hy).
  const rx = (x - s.cx) / s.hx;
  const ry = (y - s.cy) / s.hy;
  const dome = smoothstep(0.6, 1, q);
  const gx = -dh * nOx + (dome * -2 * s.Hd * rx) / s.hx;
  const gy = -dh * nOy + (dome * -2 * s.Hd * ry) / s.hy;
  return { d, gx, gy, N: norm3(-gx, -gy, 1), q };
}

/** Sampling offset of the refraction at a point (px). Along the slope; sign picks inward or outward. */
export function displacement(s: SurfaceSpec, pt: SurfacePoint, sign: 1 | -1): [number, number] {
  const slope = Math.hypot(pt.gx, pt.gy);
  if (slope < 1e-6) return [0, 0];
  const mag = s.K * Math.pow(slope, s.gamma);
  // The gradient points uphill (inward on the bevel, toward the centre on the dome).
  return [(sign * mag * pt.gx) / slope, (sign * mag * pt.gy) / slope];
}

/** Share of the frost branch at a point: none at the optical edge, frostMix in the body. */
export function frostWeight(p: ProfileV2, q: number): number {
  const body = p.frostMix / (p.frostMix + p.transmissionMix);
  return body * smoothstep(0.15, 0.85, q);
}

// ---------------------------------------------------------------- light

/** The global synthetic environment: broad upper-left key, weak lower-right fill, a soft top strip. */
export const KEY: Vec3 = norm3(-0.45, -0.85, 0.3);
export const FILL: Vec3 = norm3(0.55, 0.7, 0.3);
const V: Vec3 = [0, 0, 1];

export function environment(R: Vec3): number {
  const key = Math.pow(Math.max(0, dot(R, KEY)), 3);
  const fill = 0.15 * Math.pow(Math.max(0, dot(R, FILL)), 3);
  const strip = 0.25 * smoothstep(-0.55, -0.85, R[1]);
  return key + fill + strip;
}

export function fresnel(p: ProfileV2, N: Vec3): number {
  const c = Math.max(0, Math.min(1, dot(N, V)));
  return p.fresnelF0 + (1 - p.fresnelF0) * Math.pow(1 - c, p.fresnelPower);
}

/** White light (alpha) and shade (black alpha) on the surface at a point. */
export function lighting(p: ProfileV2, pt: SurfacePoint): { light: number; shade: number } {
  const N = pt.N;
  const nz = N[2];
  const R: Vec3 = [2 * nz * N[0], 2 * nz * N[1], 2 * nz * nz - 1];
  const F = fresnel(p, N);
  const Hk = norm3(KEY[0], KEY[1], KEY[2] + 1);
  const Hf = norm3(FILL[0], FILL[1], FILL[2] + 1);
  // Remove what flat glass would show, so only the curved surface lights up.
  const flatSpecK = Math.pow(Math.max(0, Hk[2]), p.specularExponent);
  const flatSpecF = Math.pow(Math.max(0, Hf[2]), p.specularExponent);
  const specK = Math.max(0, Math.pow(Math.max(0, dot(N, Hk)), p.specularExponent) - flatSpecK);
  const specF = Math.max(0, Math.pow(Math.max(0, dot(N, Hf)), p.specularExponent) - flatSpecF);
  const bevel = 1 - nz; // how far the surface leans; 0 on the flat field
  const lx = KEY[0];
  const ly = KEY[1];
  const ll = Math.hypot(lx, ly);
  const nl = Math.hypot(N[0], N[1]) || 1;
  const facing = (N[0] * lx + N[1] * ly) / (nl * ll); // -1..1, in-plane facing toward the key
  const light =
    p.fresnelGain * F * environment(R) +
    p.specularGain * specK +
    p.secondarySpecular * specF +
    p.innerHighlight * Math.max(0, dot(N, KEY)) * bevel;
  const shade = p.innerShade * Math.max(0, -facing) * bevel;
  return { light: Math.min(1, light), shade: Math.min(1, shade) };
}
