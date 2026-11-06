import { bounds, clamp, distance } from "./geometry";
import type { Point, Rect, Shape } from "./model";

export interface RecognizedShape { shape: Shape; rect: Rect; points?: Point[]; confidence: number }
function lineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  let farthest = tolerance, at = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineDistance(points[i], points[0], points[points.length - 1]);
    if (d > farthest) { at = i; farthest = d; }
  }
  return at < 0 ? [points[0], points[points.length - 1]] : [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}
/** Deliberately confidence-gated: free illustration should stay free illustration. */
export function recognizeShape(points: Point[]): RecognizedShape | null {
  if (points.length < 6) return null;
  const rect = bounds(points), diagonal = Math.hypot(rect.w, rect.h);
  if (diagonal < 24) return null;
  const first = points[0], last = points[points.length - 1];
  const total = points.slice(1).reduce((n, p, i) => n + distance(points[i], p), 0);
  if (distance(first, last) > diagonal * 0.24) {
    const error = points.reduce((n, p) => n + lineDistance(p, first, last), 0) / points.length;
    const straightness = distance(first, last) / Math.max(1, total);
    if (error < diagonal * 0.035 && straightness > 0.94) return { shape: "line", rect, points: [first, last], confidence: straightness };
    return null;
  }
  // Split the closed contour at its farthest pair so a start on an edge is harmless.
  let ai = 0, bi = 0, far = 0;
  const stride = Math.max(1, Math.floor(points.length / 120));
  for (let a = 0; a < points.length; a += stride) for (let b = a + stride; b < points.length; b += stride) {
    const d = distance(points[a], points[b]); if (d > far) { ai = a; bi = b; far = d; }
  }
  const tolerance = diagonal * 0.055;
  const forward = simplify(points.slice(ai, bi + 1), tolerance);
  const backward = simplify([...points.slice(bi), ...points.slice(0, ai + 1)], tolerance);
  let corners = [...forward.slice(0, -1), ...backward.slice(0, -1)];
  // Eliminate a redundant corner where the original stroke closed on an edge.
  corners = corners.filter((p, i, all) => lineDistance(p, all[(i + all.length - 1) % all.length], all[(i + 1) % all.length]) > tolerance * 0.65);
  if (corners.length === 3) {
    if (Math.abs(corners.reduce((a, p, i) => a + p.x * corners[(i + 1) % 3].y - p.y * corners[(i + 1) % 3].x, 0)) < rect.w * rect.h * 0.3) return null;
    for (let i = 0; i < 3; i++) {
      const p = corners[i], a = corners[(i + 1) % 3], b = corners[(i + 2) % 3];
      const ax = a.x - p.x, ay = a.y - p.y, bx = b.x - p.x, by = b.y - p.y;
      const cosine = Math.abs((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1));
      if (cosine < 0.27) {
        // Orthogonal projection preserves the orientation the person actually drew.
        const len = Math.hypot(ax, ay), ux = ax / len, uy = ay / len;
        const signed = bx * -uy + by * ux;
        return { shape: "right-triangle", rect, points: [p, a, { x: p.x - uy * signed, y: p.y + ux * signed }], confidence: 1 - cosine * 0.3 };
      }
    }
    return { shape: "triangle", rect, points: corners, confidence: 0.91 };
  }
  if (corners.length === 4) {
    const closeToBoundary = corners.every((p) => Math.min(Math.abs(p.x - rect.x), Math.abs(p.x - rect.x - rect.w)) < diagonal * 0.09 && Math.min(Math.abs(p.y - rect.y), Math.abs(p.y - rect.y - rect.h)) < diagonal * 0.09);
    if (closeToBoundary) return { shape: "rect", rect, confidence: 0.93 };
  }
  const rx = rect.w / 2, ry = rect.h / 2;
  if (rx < 10 || ry < 10) return null;
  const error = points.reduce((e, p) => e + Math.abs(Math.hypot((p.x - rect.x - rx) / rx, (p.y - rect.y - ry) / ry) - 1), 0) / points.length;
  if (corners.length >= 5 && error < 0.1 && total < Math.PI * (rx + ry) * 1.25) return { shape: "ellipse", rect, confidence: 1 - error };
  return null;
}
