/**
 * Liquid Glass V2: one optical surface.
 *
 * Everything the glass does comes from a single pseudo-height field built on
 * the shape's signed distance field (SDF):
 *
 *   d  = distance inside the edge            nO = outward in-plane direction (SDF gradient)
 *   macro bevel  Hb * (1 - (1 - d/W)^P)       the thick-glass slope that bends the backdrop
 *   micro lip    a rounded edge about 1px wide just inside the interface; its slope rises to
 *                a peak at rimPeakPosition across the lip and falls back to the bevel
 *   dome         Hd * (1 - rx^2 - ry^2)       a very low dome over the flat field only
 *
 *   N      = normalize(-grad(all three), 1)   lights the surface (Fresnel, environment, specular)
 *   Nmacro = normalize(-grad(bevel + dome), 1)  bends the backdrop (the lip is too thin to)
 *
 * The outer interface is the outermost sliver of the shape where the glass
 * meets the scene: a darker hairline on bright scenes, weaker where the edge
 * faces the light.
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
  Wr: number; // micro lip width (px)
  Wo: number; // outer interface width (px): the lip starts just inside it
  lipSlope: number; // peak slope of the micro lip
  lipPeak: number; // where across the lip it peaks (0..1)
  Hd: number; // dome height (px)
  K: number; // displacement per unit slope
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
  const midRatio = Math.pow(0.5, P - 1); // slope(q = 0.5) / slope(0)
  const gamma = Math.log(p.midDisplacement / p.edgeDisplacement) / Math.log(midRatio);
  const K = (p.edgeDisplacement * t) / Math.pow(edgeSlope, gamma);
  // Micro lip: its own slope at the very edge reaches rimTiltDeg (on top of the bevel).
  const Wr = p.rimWidth;
  const lipSlope = Wr > 0 ? Math.max(0, Math.tan((p.rimTiltDeg * Math.PI) / 180) - edgeSlope) : 0;
  // Dome: lives only in the flat field (faded in over q 0.6..1); its slope where the flat field
  // starts gives centerDisplacement.
  const hx = w / 2;
  const hy = h / 2;
  const half = Math.min(hx, hy);
  const rFlat = Math.max(0.25, (half - W) / half);
  const domeSlopeNeeded = Math.pow((p.centerDisplacement * t) / K, 1 / gamma);
  const Hd = (domeSlopeNeeded * half) / (2 * rFlat); // |grad(Hd(1 - r^2))| = 2 Hd r / half
  return { W, P, Hb, Wr, Wo: p.outerEdgeAlpha > 0 ? p.outerEdgeWidth : 0, lipSlope, lipPeak: p.rimPeakPosition, Hd, K, gamma, cx: hx, cy: hy, hx, hy };
}

export interface SurfacePoint {
  /** distance inside the outline (negative outside) */
  d: number;
  /** outward in-plane direction */
  nOx: number;
  nOy: number;
  /** grad(height) of the macro surface (bevel + dome): what bends the backdrop */
  gx: number;
  gy: number;
  /** full surface normal (with the micro lip): what catches the light */
  N: Vec3;
  /** macro normal */
  Nm: Vec3;
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
  // Heights rise inward, so their gradients point along -nO.
  const dBevel = d >= 0 && q < 1 ? (s.Hb * s.P * Math.pow(1 - q, s.P - 1)) / s.W : 0;
  const qr = s.Wr > 0 ? Math.min(1, Math.max(0, (d - s.Wo) / s.Wr)) : 1;
  const dLip = d >= 0 && qr < 1 ? s.lipSlope * lipShape(qr, s.lipPeak) : 0;
  const dome = smoothstep(0.6, 1, q);
  const rx = (x - s.cx) / s.hx;
  const ry = (y - s.cy) / s.hy;
  const gx = -dBevel * nOx + (dome * -2 * s.Hd * rx) / s.hx;
  const gy = -dBevel * nOy + (dome * -2 * s.Hd * ry) / s.hy;
  const fx = gx - dLip * nOx;
  const fy = gy - dLip * nOy;
  return { d, nOx, nOy, gx, gy, N: norm3(-fx, -fy, 1), Nm: norm3(-gx, -gy, 1), q };
}

/** Lip slope across the lip (0..1), normalised to 1 at its peak. Peak 0 is a linear fall from the
 * outer start (a quarter-round); a later peak rises smoothly to it and falls back smoothly. */
export function lipShape(qr: number, peak: number): number {
  if (peak <= 0) return 1 - qr;
  if (qr < peak) return Math.sin((Math.PI / 2) * (qr / peak));
  return Math.cos((Math.PI / 2) * ((qr - peak) / (1 - peak)));
}

/** Sampling offset of the refraction at a point (px). Along the macro slope; sign picks inward or outward. */
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

/** The global synthetic environment: an upper-left key, a weak lower-right fill, a soft top strip. */
export const KEY: Vec3 = norm3(-0.45, -0.85, 0.3);
export const FILL: Vec3 = norm3(0.55, 0.7, 0.3);
const V: Vec3 = [0, 0, 1];

/**
 * Radiance seen along a reflection vector R. `facing` (0..1) is how much the
 * reflecting edge faces the key; grazing reflections (R pointing into the
 * screen) see a bright horizon, strongest on the key side.
 */
export function environment(p: ProfileV2, R: Vec3, facing = 0.5): number {
  const key = Math.pow(Math.max(0, dot(R, KEY)), p.keyPower);
  const fill = 0.15 * Math.pow(Math.max(0, dot(R, FILL)), p.keyPower);
  const strip = p.stripStrength * smoothstep(-0.55, -0.85, R[1]);
  const horizon = p.horizonStrength * smoothstep(-0.2, -0.75, R[2]) * (p.horizonCounter + (1 - p.horizonCounter) * facing);
  return key + fill + strip + horizon;
}

export function fresnel(p: ProfileV2, N: Vec3): number {
  const c = Math.max(0, Math.min(1, dot(N, V)));
  return p.fresnelF0 + (1 - p.fresnelF0) * Math.pow(1 - c, p.fresnelPower);
}

/** In-plane facing toward the key light: 1 facing it, 0 facing away. */
function keyFacing(nOx: number, nOy: number): number {
  const l = Math.hypot(KEY[0], KEY[1]);
  return clamp01(0.5 + 0.5 * ((nOx * KEY[0] + nOy * KEY[1]) / l));
}

/** Highest exposure the light map is baked for; the layer's opacity brings it down per scene. */
export function maxExposure(p: ProfileV2): number {
  return Math.max(p.fresnelExposure.light, p.fresnelExposure.mid, p.fresnelExposure.dark, 1);
}

export interface Lighting {
  /** white alpha (baked at maxExposure) */
  light: number;
  /** black alpha: bevel facing away from the key */
  shade: number;
  /** black alpha of the outer interface (on bright scenes) */
  edge: number;
  /** white alpha: scene light carried through the bevel (scaled by scene lightness at runtime) */
  glow: number;
  /** parts, for the debug views */
  fresnel: number;
  rim: number;
}

/** White light, shade and the outer interface at a point. */
export function lighting(p: ProfileV2, pt: SurfacePoint, pxSize = 0.5): Lighting {
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
  const bevel = 1 - pt.Nm[2]; // how far the macro surface leans; 0 on the flat field
  const facing = keyFacing(pt.nOx, pt.nOy);
  const fres = p.fresnelGain * F * environment(p, R, facing);
  // The outermost sliver belongs to the interface: light starts just inside it.
  const inside = p.outerEdgeAlpha > 0 ? smoothstep(p.outerEdgeWidth * 0.5, p.outerEdgeWidth + pxSize, pt.d) : 1;
  const raw = fres + p.specularGain * specK + p.secondarySpecular * specF;
  const light = Math.min(1, raw * inside * maxExposure(p));
  // The bevel glow is scene light carried through the glass: its own layer, strong on bright
  // scenes and faint on dark ones (no broad sheen over black).
  // Counter side: the weak fill light on the bevel, only just inside the lip, decaying fast.
  const past = Math.max(0, pt.d - (p.outerEdgeAlpha > 0 ? p.outerEdgeWidth : 0) - p.rimWidth * 0.5);
  const counter = p.counterGlow * Math.max(0, dot(N, FILL)) * bevel * Math.exp(-past / Math.max(0.1, p.counterGlowWidth));
  const glow = Math.min(1, (p.innerHighlight * Math.max(0, dot(N, KEY)) * bevel + counter) * inside);
  const shade = Math.min(1, p.innerShade * Math.max(0, 1 - 2 * facing) * bevel);
  // Outer interface: a hairline at the very edge, lighter where the edge faces the key.
  const band = pt.d >= 0 ? 1 - smoothstep(p.outerEdgeWidth * 0.6, p.outerEdgeWidth + pxSize, pt.d) : 0;
  const edge = p.outerEdgeAlpha * band * (0.7 + 0.3 * (1 - facing));
  const rim = p.rimWidth > 0 ? 1 - smoothstep(0, p.rimWidth + pxSize, pt.d) : 0;
  return { light, shade, edge, glow, fresnel: fres, rim: rim * inside };
}
