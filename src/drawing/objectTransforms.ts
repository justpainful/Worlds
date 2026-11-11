import { effectiveLayer } from "./layers";
import { anchorPoint, bounds, localToWorld, worldInkBounds, worldToLocal } from "./geometry";
import { drawingJson } from "./wire";
import type { Anchor, Change, DrawingNode, DrawingScene, Point, Rect } from "./model";

export interface ObjectTransform {
  centerX: number;
  centerY: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  width?: number;
  height?: number;
}
const keys = [
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "flipX",
  "flipY",
  "geometrySize",
  "anchor",
  "endAnchor",
  "layerId",
  "frameId",
  "locked",
] as const;
const sourceGeometry = (n: DrawingNode) => [
  n.kind,
  n.samples,
  n.points,
  n.path,
  n.assetId,
  n.crop,
  n.shape,
  n.brush && [
    n.brush.kind,
    n.brush.size,
    n.brush.angle,
    n.brush.roundness,
    n.brush.pressureSize,
    n.brush.pressureCurve,
    n.brush.taperStart,
    n.brush.taperEnd,
    n.brush.straightLine,
    n.brush.tipAssetId,
  ],
];
export class ObjectTransformError extends Error {
  constructor(readonly code: "invalid" | "multiple" | "dimensions" | "locked" | "stale") {
    super(code);
    this.name = "ObjectTransformError";
  }
}
export function objectSelectionBounds(scene: DrawingScene, nodes: DrawingNode[]): Rect {
  return bounds(
    nodes.flatMap((n) => {
      if (n.anchor) {
        const a = anchorPoint(scene, n.anchor).point,
          b = n.endAnchor ? anchorPoint(scene, n.endAnchor).point : { x: n.x + n.w, y: n.y + n.h },
          scale = n.geometrySize ? Math.sqrt(((n.w / n.geometrySize.w) * n.h) / n.geometrySize.h) : 1,
          r = bounds([a, b], Math.max(10, n.paint.strokeWidth * 4) * scale);
        return [
          { x: r.x, y: r.y },
          { x: r.x + r.w, y: r.y + r.h },
        ];
      }
      const b = worldInkBounds(n);
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
      ];
    }),
  );
}
export function objectTransformOrigin(scene: DrawingScene, nodes: DrawingNode[]): Point {
  if (nodes.length === 1) return { x: nodes[0].x + nodes[0].w / 2, y: nodes[0].y + nodes[0].h / 2 };
  const b = objectSelectionBounds(scene, nodes);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
export function transformObjects(scene: DrawingScene, nodes: DrawingNode[], t: ObjectTransform): DrawingNode[] {
  if (![t.centerX, t.centerY, t.scale, t.rotation].every(Number.isFinite) || t.scale <= 0) throw new ObjectTransformError("invalid");
  if (nodes.length !== 1 && (t.width !== undefined || t.height !== undefined)) throw new ObjectTransformError("multiple");
  const origin = objectTransformOrigin(scene, nodes),
    angle = (t.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle),
    selected = new Set(nodes.map((n) => n.id));
  if (
    t.centerX === origin.x &&
    t.centerY === origin.y &&
    t.scale === 1 &&
    t.rotation === 0 &&
    !t.flipX &&
    !t.flipY &&
    (t.width === undefined || t.width === nodes[0]?.w) &&
    (t.height === undefined || t.height === nodes[0]?.h)
  )
    return nodes.map((n) => ({ ...n }));
  const point = (p: Point) => {
    const x = (p.x - origin.x) * t.scale * (t.flipX ? -1 : 1),
      y = (p.y - origin.y) * t.scale * (t.flipY ? -1 : 1);
    return { x: t.centerX + x * c - y * s, y: t.centerY + x * s + y * c };
  };
  const anchor = (a: Anchor, old: DrawingNode, next: DrawingNode): Anchor => {
    // External attachments stay attached. Selected targets carry their own UV
    // coordinates through exactly the same similarity transform.
    if (a.nodeId && scene.nodes[a.nodeId] && !selected.has(a.nodeId)) return structuredClone(a);
    const original = anchorPoint(scene, a).point,
      q = worldToLocal(old, original);
    const fallback =
      nodes.length === 1 && (t.width !== undefined || t.height !== undefined)
        ? localToWorld(next, { x: (q.x * next.w) / old.w, y: (q.y * next.h) / old.h })
        : point(original);
    return { ...a, fallback };
  };
  return nodes.map((n) => {
    const center = point({ x: n.x + n.w / 2, y: n.y + n.h / 2 }),
      w = t.width ?? n.w * t.scale,
      h = t.height ?? n.h * t.scale;
    if (![w, h].every((v) => Number.isFinite(v) && v >= 0.000001 && v <= 1e9)) throw new ObjectTransformError("dimensions");
    const next: DrawingNode = {
      ...n,
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
      rotation: t.rotation + (t.flipX !== t.flipY ? -n.rotation : n.rotation),
      flipX: n.flipX !== t.flipX,
      flipY: n.flipY !== t.flipY,
    };
    if (w !== n.w || h !== n.h) next.geometrySize = n.geometrySize ?? { w: n.w, h: n.h };
    if (n.anchor) {
      next.anchor = anchor(n.anchor, n, next);
      next.endAnchor = anchor(n.endAnchor ?? { nodeId: null, u: 0, v: 0, fallback: { x: n.x + n.w, y: n.y + n.h } }, n, next);
    }
    return next;
  });
}
export function transformedScene(scene: DrawingScene, nodes: DrawingNode[]): DrawingScene {
  const changed = { ...scene.nodes };
  for (const n of nodes) {
    if (!changed[n.id]) continue;
    const patch: Record<string, unknown> = {};
    for (const k of keys) if (n[k] !== undefined) patch[k] = n[k];
    changed[n.id] = { ...changed[n.id], ...patch };
  }
  return { ...scene, nodes: changed };
}
/** Geometry dependencies are protected; a simultaneous independent color edit
 * survives. Apply is one journal edit and never replaces another author's node. */
export function objectTransformChanges(scene: DrawingScene, before: DrawingNode[], after: DrawingNode[]): Change[] {
  const originals = new Map(before.map((n) => [n.id, n]));
  if (after.length !== before.length || new Set(after.map((n) => n.id)).size !== after.length) throw new ObjectTransformError("invalid");
  return after.flatMap((next): Change[] => {
    const old = originals.get(next.id),
      current = scene.nodes[next.id],
      layer = current && effectiveLayer(scene, current.layerId);
    if (!old || !current || current.locked || !layer || layer.locked || layer.positionLocked) throw new ObjectTransformError("locked");
    if (current.redaction && next.rotation !== 0) throw new ObjectTransformError("invalid");
    if (
      keys.some((key) => drawingJson(current[key]) !== drawingJson(old[key])) ||
      drawingJson(sourceGeometry(current)) !== drawingJson(sourceGeometry(old))
    )
      throw new ObjectTransformError("stale");
    if (keys.every((key) => drawingJson(next[key]) === drawingJson(old[key]))) return [];
    const fields: Record<string, unknown> = {};
    for (const key of keys) if (next[key] !== undefined) fields[key] = structuredClone(next[key]);
    return [{ type: "patch", collection: "nodes", id: next.id, fields }];
  });
}
export function translateObjects(scene: DrawingScene, nodes: DrawingNode[], delta: Point): DrawingNode[] {
  const o = objectTransformOrigin(scene, nodes);
  return transformObjects(scene, nodes, {
    centerX: o.x + delta.x,
    centerY: o.y + delta.y,
    scale: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  });
}
