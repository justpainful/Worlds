import { localToWorld } from "./geometry";
import type { DrawingScene, Point, Rect } from "./model";
import { validDrawingAnchor, type DrawingCommentAnchor } from "./collaborationTypes";
export function drawingCommentAnchor(scene: DrawingScene, frameId: string, nodeId: string | null = null, region?: Rect): DrawingCommentAnchor {
  const node = nodeId ? scene.nodes[nodeId] : null, frame = scene.frames[node?.frameId ?? frameId]; if (!frame) throw new Error("Choose an available frame for this comment");
  const point = node ? localToWorld(node, { x: node.w / 2, y: node.h / 2 }) : region ? { x: region.x + region.w / 2, y: region.y + region.h / 2 } : { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const camera = region ?? (node ? { x: point.x - Math.max(200, node.w) / 2, y: point.y - Math.max(150, node.h) / 2, w: Math.min(32768, Math.max(200, node.w)), h: Math.min(32768, Math.max(150, node.h)) } : frame);
  const anchor: DrawingCommentAnchor = { kind: "drawing", frameId: frame.id, nodeId: node?.id ?? null, u: 0.5, v: 0.5, region: { x: camera.x - frame.x, y: camera.y - frame.y, w: camera.w, h: camera.h }, fallback: point };
  if (!validDrawingAnchor(anchor)) throw new Error("The drawing comment region is invalid"); return anchor;
}
export function drawingCommentLocation(scene: DrawingScene, anchor: DrawingCommentAnchor): { point: Point; region: Rect; frameId: string; missing: boolean } {
  const node = anchor.nodeId ? scene.nodes[anchor.nodeId] : null, frame = scene.frames[node?.frameId ?? anchor.frameId];
  const point = node ? localToWorld(node, { x: node.w * anchor.u, y: node.h * anchor.v }) : frame ? { x: frame.x + anchor.region.x + anchor.region.w / 2, y: frame.y + anchor.region.y + anchor.region.h / 2 } : anchor.fallback;
  return { point, region: { x: point.x - anchor.region.w / 2, y: point.y - anchor.region.h / 2, w: anchor.region.w, h: anchor.region.h }, frameId: frame?.id ?? anchor.frameId, missing: !frame || !!anchor.nodeId && !node };
}
