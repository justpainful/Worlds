import {effectiveLayer,layerDisplayOrder,layerShown} from "./layers";
import type { Anchor, DrawingNode, DrawingScene, Point, Rect } from "./model";
import { localInkRect } from "./brushBounds";
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function bounds(points: Point[], padding = 0): Rect {
  if (!points.length) return { x: 0, y: 0, w: 1, h: 1 };
  let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); r = Math.max(r, p.x); b = Math.max(b, p.y); }
  return { x: x - padding, y: y - padding, w: Math.max(1, r - x + padding * 2), h: Math.max(1, b - y + padding * 2) };
}
export function localToWorld(n: DrawingNode, p: Point): Point {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2, a = n.rotation * Math.PI / 180;
  const x = (p.x - n.w / 2) * (n.flipX ? -1 : 1), y = (p.y - n.h / 2) * (n.flipY ? -1 : 1);
  return { x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a) };
}
export function worldToLocal(n: DrawingNode, p: Point): Point {
  const a = -n.rotation * Math.PI / 180, x = p.x - n.x - n.w / 2, y = p.y - n.y - n.h / 2;
  return { x: (x * Math.cos(a) - y * Math.sin(a)) * (n.flipX ? -1 : 1) + n.w / 2, y: (x * Math.sin(a) + y * Math.cos(a)) * (n.flipY ? -1 : 1) + n.h / 2 };
}
export function contains(n: DrawingNode, p: Point): boolean {
  const q = worldToLocal(n, p), box = localInkRect(n);
  return q.x >= box.x && q.y >= box.y && q.x <= box.x + box.w && q.y <= box.y + box.h;
}
export function inkCorners(n: DrawingNode): Point[] {
  const r = localInkRect(n);
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].map((p) => localToWorld(n, p));
}
export function worldInkBounds(n: DrawingNode): Rect { const scale = n.geometrySize ? Math.max(n.w / n.geometrySize.w, n.h / n.geometrySize.h) : 1; return bounds(inkCorners(n), n.kind === "stroke" ? 0 : n.paint.strokeWidth * scale / 2); }
/** Conservative visible bounds including non-image filter bleed. */
export function worldRenderBounds(n: DrawingNode): Rect {
  const box = worldInkBounds(n);
  if (n.kind === "image" || n.kind === "raster") return box;
  const radius = n.effects.reduce((sum, effect) => sum + (effect.enabled && effect.kind === "blur" ? Math.max(0, effect.amount) * 3 : 0), 0);
  return radius ? { x: box.x - radius, y: box.y - radius, w: box.w + radius * 2, h: box.h + radius * 2 } : box;
}
export function intersects(a: Rect, b: Rect): boolean { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
export function anchorPoint(scene: DrawingScene, anchor: Anchor): { point: Point; missing: boolean } {
  const node = anchor.nodeId ? scene.nodes[anchor.nodeId] : undefined;
  return node ? { point: localToWorld(node, { x: node.w * anchor.u, y: node.h * anchor.v }), missing: false }
    : { point: anchor.fallback, missing: anchor.nodeId !== null };
}
export function frameAt(scene: DrawingScene, p: Point): string | null {
  return [...scene.frameOrder].reverse().find((id) => {
    const f = scene.frames[id]; return p.x >= f.x && p.y >= f.y && p.x < f.x + f.w && p.y < f.y + f.h;
  }) ?? null;
}
export function hitNode(scene: DrawingScene, p: Point): DrawingNode | null {
  const insideClip=(n:DrawingNode)=>{const f=n.frameId?scene.frames[n.frameId]:undefined;return !f?.clip||p.x>=f.x&&p.y>=f.y&&p.x<f.x+f.w&&p.y<f.y+f.h;};
  for(const id of [...scene.nodeOrder].reverse()){const n=scene.nodes[id];if(n.redaction&&n.visible&&!n.locked&&layerShown(scene,n.layerId)&&!effectiveLayer(scene,n.layerId).locked&&insideClip(n)&&contains(n,p))return n;}
  for (const lid of layerDisplayOrder(scene).reverse()) {
    const layer = effectiveLayer(scene,lid);
    if (!layer.visible || layer.locked) continue;
    for (const nid of [...scene.nodeOrder].reverse()) {
      const n = scene.nodes[nid];
      if (n.layerId === lid && n.visible && !n.locked && insideClip(n) && contains(n, p)) return n;
    }
  }
  return null;
}
