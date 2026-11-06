import { localInkRect } from "./brushBounds";
import { localToWorld } from "./geometry";
import { objectSelectionBounds, objectTransformOrigin, type ObjectTransform } from "./objectTransforms";
import type { DrawingNode, DrawingScene, Point } from "./model";

export const resizeGrips = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type TransformGrip = typeof resizeGrips[number] | "rotate";
export interface TransformFrame { center: Point; x: Point; y: Point; w: number; h: number; single: boolean }
const direction = (grip: TransformGrip) => ({ x: grip.includes("w") ? -1 : grip.includes("e") ? 1 : 0, y: grip.includes("n") ? -1 : grip.includes("s") ? 1 : 0 });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export function selectionTransformFrame(scene: DrawingScene, nodes: DrawingNode[]): TransformFrame {
  if (nodes.length === 1 && !nodes[0].anchor) {
    const n = nodes[0], r = localInkRect(n), a = n.rotation * Math.PI / 180, fx = n.flipX ? -1 : 1, fy = n.flipY ? -1 : 1;
    return { center: localToWorld(n, { x: r.x + r.w / 2, y: r.y + r.h / 2 }), x: { x: Math.cos(a) * fx, y: Math.sin(a) * fx }, y: { x: -Math.sin(a) * fy, y: Math.cos(a) * fy }, w: r.w, h: r.h, single: true };
  }
  const r = objectSelectionBounds(scene, nodes);
  return { center: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, x: { x: 1, y: 0 }, y: { x: 0, y: 1 }, w: r.w, h: r.h, single: false };
}
export function gripPoint(frame: TransformFrame, grip: TransformGrip, zoom: number): Point {
  const d = grip === "rotate" ? { x: 0, y: -1 } : direction(grip), x = d.x * frame.w / 2, y = d.y * (frame.h / 2 + (grip === "rotate" ? 32 / zoom : 0));
  return { x: frame.center.x + frame.x.x * x + frame.y.x * y, y: frame.center.y + frame.x.y * x + frame.y.y * y };
}
export function gripTransform(scene: DrawingScene, nodes: DrawingNode[], frame: TransformFrame, grip: TransformGrip, start: Point, pointer: Point, modifiers: { shift: boolean; alt: boolean }): ObjectTransform {
  const origin = objectTransformOrigin(scene, nodes), base: ObjectTransform = { centerX: origin.x, centerY: origin.y, scale: 1, rotation: 0, flipX: false, flipY: false };
  if (pointer.x === start.x && pointer.y === start.y) return base;
  if (grip === "rotate") {
    let degrees = (Math.atan2(pointer.y - origin.y, pointer.x - origin.x) - Math.atan2(start.y - origin.y, start.x - origin.x)) * 180 / Math.PI;
    degrees = (degrees + 540) % 360 - 180;
    return { ...base, rotation: modifiers.shift ? Math.round(degrees / 15) * 15 : degrees };
  }
  const d = direction(grip), anchor = modifiers.alt ? frame.center : gripPoint(frame, ({ nw: "se", n: "s", ne: "sw", e: "w", se: "nw", s: "n", sw: "ne", w: "e" } as const)[grip], 1);
  const delta = minus(pointer, start), initial = minus(gripPoint(frame, grip, 1), anchor), target = { x: initial.x + delta.x, y: initial.y + delta.y };
  let sx = d.x ? dot(target, frame.x) / dot(initial, frame.x) : 1, sy = d.y ? dot(target, frame.y) / dot(initial, frame.y) : 1;
  if (!frame.single || modifiers.shift) {
    const uniform = d.x && d.y ? dot(target, initial) / dot(initial, initial) : d.x ? sx : sy;
    sx = sy = uniform;
  }
  let minX = 0, minY = 0, maxX = Infinity, maxY = Infinity;
  for (const n of nodes) { minX = Math.max(minX, 0.000001 / n.w); minY = Math.max(minY, 0.000001 / n.h); maxX = Math.min(maxX, 1e9 / n.w); maxY = Math.min(maxY, 1e9 / n.h); }
  if (!frame.single || modifiers.shift) sx = sy = Math.max(Math.max(minX, minY), Math.min(Math.min(maxX, maxY), sx));
  else { sx = Math.max(minX, Math.min(maxX, sx)); sy = Math.max(minY, Math.min(maxY, sy)); }
  const offset = minus(origin, anchor), ox = dot(offset, frame.x) * sx, oy = dot(offset, frame.y) * sy;
  const next = { ...base, centerX: anchor.x + frame.x.x * ox + frame.y.x * oy, centerY: anchor.y + frame.x.y * ox + frame.y.y * oy };
  return frame.single ? { ...next, width: nodes[0].w * sx, height: nodes[0].h * sy } : { ...next, scale: sx };
}
