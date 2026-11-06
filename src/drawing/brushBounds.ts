import type { Brush, DrawingNode, Point, Rect } from "./model";
import { normalizeBrush } from "./brushConfig";
import {pathBounds} from "./paths";

/** Maximum unrotated-node influence, before the two-pixel raster margin. */
export function brushFootprint(raw: Brush): Point {
  const b = normalizeBrush(raw), radius = b.size / 2;
  if (b.kind === "highlighter" || b.kind === "marker") return { x: radius, y: radius };
  if (b.kind === "spray") { const r = radius + Math.max(0.5, b.size / 48); return { x: r, y: r }; }
  const angle = b.angle * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  if (b.kind === "texture") return { x: radius * (c + b.roundness * s), y: radius * (s + b.roundness * c) };
  let r = radius;
  if (b.kind === "crayon" || b.kind === "natural-pencil") r += Math.max(0.3, b.size * (b.kind === "crayon" ? 0.035 : 0.065));
  if (b.kind === "watercolor") r = Math.max(r, r * 0.9 + Math.max(0.5, r * 0.04) / 2);
  return { x: r * Math.hypot(c, b.roundness * s), y: r * Math.hypot(s, b.roundness * c) };
}
export function strokeBounds(points: Point[], brush: Brush): Rect {
  if (!points.length) return { x: 0, y: 0, w: 1, h: 1 };
  if(brush.straightLine&&(brush.kind==="highlighter"||brush.kind==="marker")&&points.length>1)points=[points[0],points.at(-1)!];
  const tip = brushFootprint(brush); let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return { x: x - tip.x - 2, y: y - tip.y - 2, w: Math.max(1, right - x + 2 * tip.x + 4), h: Math.max(1, bottom - y + 2 * tip.y + 4) };
}
export function sourceInkRect(node: DrawingNode): Rect {
  if (node.kind === "stroke" && node.brush && node.samples?.length) return strokeBounds(node.samples, node.brush);
  if(node.path)return pathBounds(node.path);
  return { x: 0, y: 0, w: node.geometrySize?.w ?? node.w, h: node.geometrySize?.h ?? node.h };
}
export function localInkRect(node: DrawingNode): Rect {
  const r = sourceInkRect(node), sx = node.w / (node.geometrySize?.w ?? node.w), sy = node.h / (node.geometrySize?.h ?? node.h);
  return { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy };
}
