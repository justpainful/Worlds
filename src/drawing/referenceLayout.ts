import type { DrawingNode, DrawingScene, Change, Rect } from "./model";
import type { ReferencePreview, ReferenceSnapshot } from "./referenceTypes";
import { bounds, localToWorld } from "./geometry";
import { layerAncestors, effectiveLayer } from "./layers";
export function referenceSourceKey(data: ReferencePreview) {
  return JSON.stringify([
    data.state,
    data.sourceId,
    data.updatedAt,
    data.title,
    data.kind,
    data.excerpt,
    data.tasksDone,
    data.tasksTotal,
    data.imageAttachmentId,
    data.imageWidth,
    data.imageHeight,
    data.imageMime,
  ]);
}
export function referenceNodeKey(scene: DrawingScene, id: string) {
  const n = scene.nodes[id];
  return JSON.stringify([n, n ? layerAncestors(scene, n.layerId) : null, n?.frameId ? scene.frames[n.frameId] : null]);
}
export function referenceSnapshot(data: ReferencePreview): ReferenceSnapshot {
  if (data.state !== "ready") throw Error("Source unavailable");
  return {
    title: data.title ?? "",
    kind: data.kind ?? "page",
    excerpt: data.excerpt,
    updatedAt: data.updatedAt,
    checkedAt: data.checkedAt,
    tasksDone: data.tasksDone,
    tasksTotal: data.tasksTotal,
  };
}
export function suggestedReferenceSize(data: ReferencePreview) {
  const w = Math.max(320, Math.min(640, Math.ceil((data.title?.length ?? 0) * 10 + 28))),
    lines = Math.ceil((data.excerpt?.length ?? 0) / Math.max(15, Math.floor((w - (data.imageAttachmentId ? 128 : 28)) / 8)));
  return { w, h: Math.max(180, Math.min(480, 112 + lines * 23 + (data.imageAttachmentId ? 30 : 0))) };
}
export function referenceLayoutChanges(
  scene: DrawingScene,
  id: string,
  before: string,
  data: ReferencePreview,
  size: { w: number; h: number },
): Change[] {
  const n = scene.nodes[id];
  if (
    !n ||
    referenceNodeKey(scene, id) !== before ||
    n.sourceMode !== "live" ||
    n.sourceId !== data.sourceId ||
    n.locked ||
    effectiveLayer(scene, n.layerId).locked ||
    effectiveLayer(scene, n.layerId).positionLocked
  )
    throw Error("The reference changed or is locked. Reopen its preview.");
  if (data.state !== "ready" || ![size.w, size.h].every((v) => Number.isFinite(v) && v >= 80 && v <= 4096))
    throw Error("Choose card dimensions from 80 to 4096 pixels");
  return [
    {
      type: "patch",
      collection: "nodes",
      id,
      fields: { w: size.w, h: size.h, geometrySize: { w: size.w, h: size.h }, sourceUpdatedAt: data.updatedAt ?? data.checkedAt },
    },
  ];
}
/** Private render-only copy. Never dispatch or serialize this preview scene. */
export function referencePreviewScene(scene: DrawingScene, node: DrawingNode, data: ReferencePreview, size?: { w: number; h: number }) {
  const copy = structuredClone(scene),
    n = copy.nodes[node.id];
  if (!n) throw Error("Reference unavailable");
  n.sourceMode = "snapshot";
  n.referenceSnapshot = referenceSnapshot(data);
  delete n.assetId;
  if (size) Object.assign(n, { ...size, geometrySize: { ...size } });
  if (data.imageAttachmentId) {
    const id = `reference-preview-${node.id}`;
    copy.assets[id] = {
      id,
      attachmentId: data.imageAttachmentId,
      name: data.title ?? "Source preview",
      mime: data.imageMime ?? "image/png",
      width: data.imageWidth ?? 1,
      height: data.imageHeight ?? 1,
    };
    n.assetId = id;
  }
  return copy;
}
export function referencePreviewCamera(a: DrawingNode, b: DrawingNode): Rect {
  return bounds(
    [a, b].flatMap((n) =>
      [
        { x: 0, y: 0 },
        { x: n.w, y: 0 },
        { x: n.w, y: n.h },
        { x: 0, y: n.h },
      ].map((p) => localToWorld(n, p)),
    ),
    24,
  );
}
