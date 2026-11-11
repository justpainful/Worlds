import { layerAncestors } from "./layers";
import type { Asset, DrawingNode, DrawingScene, Frame, Layer, Mask } from "./model";
import { drawingJson } from "./wire";
export interface PixelGuard {
  frameId: string;
  layerId: string;
  source: "current" | "visible";
  expected: {
    frame: Frame;
    layers: Layer[];
    ancestors?: Layer[];
    nodes: DrawingNode[];
    targets: Record<string, DrawingNode | null>;
    masks: Record<string, Mask>;
    assets: Record<string, Asset>;
  };
}
/** A durable read precondition for destructive pixel edits. No source geometry
 * is rewritten. Layer membership is checked as well as the sampled originals,
 * so an offline erase cannot silently remove a newly arrived source stroke. */
export function pixelGuard(scene: DrawingScene, frameId: string, layerId: string, source: "current" | "visible"): PixelGuard {
  if (
    ![frameId, layerId].every((v) => typeof v === "string" && v.length > 0 && v.length <= 160) ||
    !["current", "visible"].includes(source) ||
    !scene.frames[frameId] ||
    !scene.layers[layerId]
  )
    throw new Error("Invalid pixel source guard");
  const layers = scene.layerOrder
      .filter((id) => (source === "visible" || id === layerId) && scene.layers[id].visible && scene.layers[id].opacity > 0)
      .map((id) => scene.layers[id]),
    ids = new Set(layers.map((l) => l.id));
  const nodes = scene.nodeOrder
      .map((id) => scene.nodes[id])
      .filter((n) => ids.has(n.layerId) && (n.frameId === null || n.frameId === frameId)),
    masks = new Set<string>(),
    assets = new Set<string>(),
    targets = new Set<string>();
  for (const n of nodes) {
    if (n.assetId) assets.add(n.assetId);
    if (n.brush?.tipAssetId) assets.add(n.brush.tipAssetId);
    if (n.maskId) masks.add(n.maskId);
    for (const e of n.effects) if (e.maskId) masks.add(e.maskId);
    for (const a of [n.anchor, n.endAnchor]) if (a?.nodeId) targets.add(a.nodeId);
  }
  for (const id of masks) {
    const m = scene.masks[id];
    if (m?.assetId) assets.add(m.assetId);
    for (const stroke of m?.strokes ?? []) if (stroke.brush.tipAssetId) assets.add(stroke.brush.tipAssetId);
  }
  const parents = new Set(
      layers.flatMap((l) =>
        layerAncestors(scene, l.id)
          .slice(1)
          .map((p) => p.id),
      ),
    ),
    ancestors = scene.layerOrder.filter((id) => parents.has(id) && !ids.has(id)).map((id) => scene.layers[id]);
  return structuredClone({
    frameId,
    layerId,
    source,
    expected: {
      frame: scene.frames[frameId],
      layers,
      ...(ancestors.length ? { ancestors } : {}),
      nodes,
      targets: Object.fromEntries([...targets].map((id) => [id, scene.nodes[id] ?? null])),
      masks: Object.fromEntries([...masks].map((id) => [id, scene.masks[id]])),
      assets: Object.fromEntries([...assets].map((id) => [id, scene.assets[id]])),
    },
  });
}
export function checkPixelGuard(scene: DrawingScene, guard: PixelGuard) {
  if (!guard || typeof guard !== "object" || !guard.expected || new TextEncoder().encode(JSON.stringify(guard)).length > 32 * 1024 * 1024)
    throw new Error("Invalid pixel source guard");
  const actual = pixelGuard(scene, guard.frameId, guard.layerId, guard.source);
  if (drawingJson(actual) !== drawingJson(guard))
    throw new Error("conflict: the sampled pixel source changed; keep this edit for recovery");
}
