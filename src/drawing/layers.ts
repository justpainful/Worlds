import type { Change, DrawingNode, DrawingScene, Layer } from "./model";
export function layerAncestors(scene: DrawingScene, id: string): Layer[] {
  const result: Layer[] = [],
    seen = new Set<string>();
  let layer: Layer | undefined = scene.layers[id];
  while (layer && !seen.has(layer.id)) {
    seen.add(layer.id);
    result.push(layer);
    layer = layer.parentId ? scene.layers[layer.parentId] : undefined;
  }
  return result;
}
export function effectiveLayer(scene: DrawingScene, id: string) {
  const ancestors = layerAncestors(scene, id);
  return {
    visible: ancestors.length > 0 && ancestors.every((l) => l.visible && l.opacity > 0),
    locked: ancestors.some((l) => l.locked),
    positionLocked: ancestors.some((l) => l.positionLocked),
    alphaLocked: ancestors.some((l) => l.alphaLocked),
    depth: Math.max(0, ancestors.length - 1),
  };
}
/** Account for layers created or changed in the same atomic edit. */
export function layersAfterChanges(scene: DrawingScene, changes: Change[]): DrawingScene {
  const layers = { ...scene.layers };
  for (const change of changes) {
    if (change.type === "order" || change.type === "defaultFrame" || change.collection !== "layers") continue;
    if (change.type === "put") layers[change.id] = change.value as Layer;
    else if (change.type === "patch" && layers[change.id]) layers[change.id] = { ...layers[change.id], ...change.fields } as Layer;
    else if (change.type === "remove") delete layers[change.id];
  }
  return { ...scene, layers };
}
const geometryFields = new Set([
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "flipX",
  "flipY",
  "geometrySize",
  "points",
  "path",
  "layerId",
  "frameId",
  "anchor",
  "endAnchor",
]);
/** Check inherited locks on both source and destination for a node edit. */
export function nodeChangesBlockedByLayerLocks(scene: DrawingScene, projected: DrawingScene, changes: Change[]): boolean {
  return changes.some((change) => {
    if (change.type === "order" || change.type === "defaultFrame" || change.collection !== "nodes") return false;
    const old = scene.nodes[change.id],
      fields = change.type === "patch" ? Object.keys(change.fields) : [];
    const node = change.type === "put" ? (change.value as DrawingNode) : old;
    if (!node) return false;
    if (old) {
      if (!scene.layers[old.layerId]) return true;
      const source = effectiveLayer(scene, old.layerId);
      if (source.locked || (old.locked && !(change.type === "patch" && fields.length === 1 && fields[0] === "locked"))) return true;
      if (source.positionLocked && (change.type !== "patch" || fields.some((key) => geometryFields.has(key)))) return true;
    }
    if (change.type === "remove") return false;
    const target = change.type === "patch" && typeof change.fields.layerId === "string" ? change.fields.layerId : node.layerId;
    if (!projected.layers[target]) return true;
    const destination = effectiveLayer(projected, target);
    if (destination.locked) return true;
    // Moving an existing object onto an alpha-locked layer changes its coverage.
    return !!old && old.layerId !== target && destination.alphaLocked;
  });
}
export function layerShown(scene: DrawingScene, id: string) {
  const ancestors = layerAncestors(scene, id);
  return ancestors.length > 0 && ancestors.every((l) => l.visible);
}
export function layerTree(scene: DrawingScene) {
  const included = new Set(scene.layerOrder),
    children = new Map<string | null, string[]>();
  for (const id of scene.layerOrder) {
    const parent = scene.layers[id].parentId,
      key = parent && included.has(parent) ? parent : null;
    const list = children.get(key) ?? [];
    list.push(id);
    children.set(key, list);
  }
  return children;
}
export function layerDisplayOrder(scene: DrawingScene): string[] {
  const tree = layerTree(scene),
    out: string[] = [],
    pending = [...(tree.get(null) ?? [])].reverse();
  while (pending.length) {
    const id = pending.pop()!;
    out.push(id);
    pending.push(...[...(tree.get(id) ?? [])].reverse());
  }
  return out;
}
export function layerDescendants(scene: DrawingScene, id: string): Set<string> {
  const tree = layerTree(scene),
    out = new Set<string>(),
    pending = [id];
  while (pending.length) {
    const key = pending.pop()!;
    if (out.has(key)) continue;
    out.add(key);
    pending.push(...(tree.get(key) ?? []));
  }
  return out;
}
/** Local visibility projection. Originals and persistent visibility stay intact. */
export function isolateLayerScene(scene: DrawingScene, id: string): DrawingScene {
  if (!scene.layers[id]) return scene;
  const chosen = layerDescendants(scene, id),
    included = new Set([...chosen, ...layerAncestors(scene, id).map((l) => l.id)]);
  return {
    ...scene,
    layerOrder: scene.layerOrder.filter((id) => included.has(id)),
    nodeOrder: scene.nodeOrder.filter((id) => chosen.has(scene.nodes[id].layerId)),
  };
}
