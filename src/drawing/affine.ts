import type { DrawingNode, Point } from "./model";

/** Compose in JavaScript doubles before passing a small device-space matrix to
 * Canvas. Some engines round individual translate/scale calls to floats. */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }
export const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
export function multiply(a: Affine, b: Affine): Affine {
  return { a: a.a * b.a + a.c * b.b, b: a.b * b.a + a.d * b.b, c: a.a * b.c + a.c * b.d, d: a.b * b.c + a.d * b.d, e: a.a * b.e + a.c * b.f + a.e, f: a.b * b.e + a.d * b.f + a.f };
}
export const translate = (m: Affine, x: number, y: number): Affine => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.a * x + m.c * y + m.e, f: m.b * x + m.d * y + m.f });
export const scale = (m: Affine, x: number, y: number): Affine => ({ a: m.a * x, b: m.b * x, c: m.c * y, d: m.d * y, e: m.e, f: m.f });
export function rotate(m: Affine, radians: number): Affine {
  const c = Math.cos(radians), s = Math.sin(radians);
  return multiply(m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 });
}
export const transformPoint = (m: Affine, p: Point): Point => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export function inverse(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}
export function nodeMatrix(base: Affine, n: DrawingNode): Affine {
  const center = translate(base, n.x + n.w / 2, n.y + n.h / 2), turned = rotate(center, n.rotation * Math.PI / 180);
  const pivot = translate(scale(turned, n.flipX ? -1 : 1, n.flipY ? -1 : 1), -n.w / 2, -n.h / 2);
  return n.geometrySize&&!(n.kind==="text"&&n.textStyle.resizeMode==="wrap") ? scale(pivot, n.w / n.geometrySize.w, n.h / n.geometrySize.h) : pivot;
}
