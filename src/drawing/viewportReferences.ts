import { intersects, worldRenderBounds } from "./geometry";
import { effectiveLayer } from "./layers";
import type { DrawingNode, DrawingScene, Rect } from "./model";

/** Limit periodic network refresh to references that can contribute pixels.
 * Drawing still uses the complete scene; this subset is only passed to the
 * refresh scheduler. Returning to a stale reference triggers its cache's
 * normal access check when it is drawn. */
export function viewportReferences(scene: DrawingScene, view: Rect): DrawingScene {
  if (![view.x, view.y, view.w, view.h].every(Number.isFinite) || view.w <= 0 || view.h <= 0) return scene;
  // One eighth of the viewport makes small pans smooth without fetching the
  // entire drawing during rapid navigation across a large world.
  const dx = view.w / 8, dy = view.h / 8;
  const region = { x: view.x - dx, y: view.y - dy, w: view.w + dx * 2, h: view.h + dy * 2 };
  const nodes: Record<string, DrawingNode> = {};
  for (const id of scene.nodeOrder) {
    const node = scene.nodes[id];
    if (!node || node.kind !== "reference" || node.sourceMode === "snapshot" || !node.sourceId || !node.visible || node.opacity <= 0 || !effectiveLayer(scene, node.layerId).visible) continue;
    const frame = node.frameId ? scene.frames[node.frameId] : undefined;
    if (frame?.clip && !intersects(frame, region)) continue;
    // Anchors can extend beyond their node bounds, so keep them conservative.
    if (!node.anchor && !node.endAnchor && !intersects(worldRenderBounds(node), region)) continue;
    nodes[id] = node;
  }
  return { ...scene, nodes, nodeOrder: Object.keys(nodes) };
}
