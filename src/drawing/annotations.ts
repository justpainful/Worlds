import { anchorPoint, localToWorld } from "./geometry";
import { effectiveLayer } from "./layers";
import { id, newNode, type Anchor, type Change, type DrawingNode, type DrawingScene } from "./model";
export type AnnotationStatus = "open" | "active" | "resolved";
export type AnchorReview = "ok" | "deleted" | "cropped" | "replaced" | "source-changed" | "review" | "unverified";
export const ANNOTATION_STYLES = [
  { id: "note", en: "Note", ar: "ملاحظة", color: "#245b93", background: "#eef5fc" },
  { id: "warning", en: "Warning", ar: "تنبيه", color: "#a14813", background: "#fff4df" },
  { id: "success", en: "Checked", ar: "تم التحقق", color: "#276344", background: "#edf8f0" },
] as const;
const originalHash = (value: unknown) => (typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null);
/** Asset hashes survive owned-original remapping. Legacy originals remain explicitly unverified. */
export function annotationSourceKey(scene: DrawingScene, node: DrawingNode): string {
  const a = scene.assets[node.assetId ?? ""],
    crop = node.crop ?? (a ? { x: 0, y: 0, w: a.width, h: a.height } : null);
  return JSON.stringify({
    sha256: originalHash(a?.sha256),
    mime: a?.mime ?? null,
    width: a?.width ?? null,
    height: a?.height ?? null,
    crop: crop ? [crop.x, crop.y, crop.w, crop.h] : null,
    orientation: a?.orientation ?? 1,
    frameIndex: a?.frameIndex ?? 0,
    sourceId: node.sourceId ?? null,
    sourceMode: node.sourceMode ?? null,
  });
}
export function makeAnnotationAnchor(scene: DrawingScene, nodeId: string | null, u: number, v: number, fallback = { x: 0, y: 0 }): Anchor {
  if (![u, v].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1) throw Error("annotation-anchor");
  const n = nodeId ? scene.nodes[nodeId] : undefined;
  if (nodeId && !n) throw Error("annotation-target");
  return {
    nodeId,
    u,
    v,
    fallback: n ? localToWorld(n, { x: n.w * u, y: n.h * v }) : fallback,
    ...(n ? { sourceKey: annotationSourceKey(scene, n) } : {}),
  };
}
export function reviewAnnotationAnchor(scene: DrawingScene, a: Anchor): AnchorReview {
  if (a.nodeId && !scene.nodes[a.nodeId]) return "deleted";
  if (a.review) return "review";
  if (!a.nodeId) return "ok";
  const n = scene.nodes[a.nodeId],
    asset = scene.assets[n.assetId ?? ""];
  if (!a.sourceKey) return "unverified";
  let before: Record<string, unknown>;
  try {
    before = JSON.parse(a.sourceKey);
    if (!before || typeof before !== "object" || Array.isArray(before)) return "unverified";
  } catch {
    return "unverified";
  }
  const current = JSON.parse(annotationSourceKey(scene, n));
  if (JSON.stringify(before.crop) !== JSON.stringify(current.crop)) return "cropped";
  if (
    before.sha256 !== current.sha256 ||
    before.mime !== current.mime ||
    before.width !== current.width ||
    before.height !== current.height ||
    before.orientation !== current.orientation ||
    before.frameIndex !== current.frameIndex
  )
    return "replaced";
  if (before.sourceId !== current.sourceId || before.sourceMode !== current.sourceMode) return "source-changed";
  if (asset && !originalHash(asset.sha256)) return "unverified";
  return "ok";
}
export function annotationStateKey(scene: DrawingScene): string {
  return JSON.stringify(scene);
}
interface AnnotationLease {
  state: () => string;
  finish: (ids: string[]) => void;
  cancel: () => void;
}
/** Reserve before inspecting the live scene. A delayed dialog never overwrites a remote edit. */
export async function applyAnnotationEdit(
  sourceKey: string,
  changes: Change[],
  io: {
    active: () => boolean;
    current: () => DrawingScene | undefined;
    reserve: () => Promise<AnnotationLease | null>;
    commit: (changes: Change[]) => string | null | undefined;
    flush: () => Promise<unknown>;
  },
): Promise<void> {
  let lease: AnnotationLease | null = null;
  try {
    if (!io.active()) throw Error("annotation-permission");
    lease = await io.reserve();
    if (!io.active() || lease?.state() === "lost") throw Error("annotation-lease");
    const scene = io.current();
    if (!scene || annotationStateKey(scene) !== sourceKey) throw Error("annotation-stale");
    const op = io.commit(changes);
    if (!op) throw Error("annotation-save");
    await io.flush();
    lease?.finish([op]);
    lease = null;
  } finally {
    lease?.cancel();
  }
}
export function annotationMembers(scene: DrawingScene, node: DrawingNode): DrawingNode[] {
  return node.annotationGroup
    ? scene.nodeOrder.map((id) => scene.nodes[id]).filter((n) => n.annotationGroup === node.annotationGroup)
    : [node];
}
export function assertAnnotationEditable(scene: DrawingScene, ids: string[], position = false) {
  for (const key of ids) {
    const n = scene.nodes[key];
    if (!n) throw Error("annotation-missing");
    const l = effectiveLayer(scene, n.layerId);
    if (n.locked || l.locked || (position && l.positionLocked)) throw Error("annotation-locked");
  }
}
export function annotationStatusChanges(scene: DrawingScene, node: DrawingNode, status: AnnotationStatus): Change[] {
  if (!["open", "active", "resolved"].includes(status)) throw Error("annotation-status");
  const members = annotationMembers(scene, node);
  assertAnnotationEditable(
    scene,
    members.map((n) => n.id),
  );
  return members.map((n) => ({ type: "patch", collection: "nodes", id: n.id, fields: { annotationStatus: status } }));
}
export function repairAnnotationChanges(
  scene: DrawingScene,
  id: string,
  key: "anchor" | "endAnchor",
  target: string | null,
  u: number,
  v: number,
): Change[] {
  assertAnnotationEditable(scene, [id], true);
  const old = scene.nodes[id][key];
  if (!old) throw Error("annotation-missing");
  const fallback = anchorPoint(scene, old).point;
  return [{ type: "patch", collection: "nodes", id, fields: { [key]: makeAnnotationAnchor(scene, target, u, v, fallback) } }];
}
export function annotationStyleChanges(scene: DrawingScene, node: DrawingNode, styleId: string): Change[] {
  const style = ANNOTATION_STYLES.find((s) => s.id === styleId);
  if (!style) throw Error("annotation-style");
  const members = annotationMembers(scene, node);
  assertAnnotationEditable(
    scene,
    members.map((n) => n.id),
  );
  return members.map((n) => ({
    type: "patch",
    collection: "nodes",
    id: n.id,
    fields: {
      paint: { ...n.paint, stroke: style.color },
      textStyle: {
        ...n.textStyle,
        color: style.color,
        ...(n.kind === "text" ? { background: style.background, border: style.color } : {}),
      },
    },
  }));
}
export function moveAnnotationLabel(scene: DrawingScene, labelId: string, x: number, y: number): Change[] {
  assertAnnotationEditable(scene, [labelId], true);
  if (scene.nodes[labelId].kind !== "text" || ![x, y].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e9))
    throw Error("annotation-label");
  return [{ type: "patch", collection: "nodes", id: labelId, fields: { x, y } }];
}
export function numberAnnotationChanges(scene: DrawingScene, node: DrawingNode, number: number): Change[] {
  if (!Number.isInteger(number) || number < 1 || number > 9999) throw Error("annotation-number");
  const members = annotationMembers(scene, node);
  assertAnnotationEditable(
    scene,
    members.map((n) => n.id),
    true,
  );
  const existing = members.find((n) => n.kind === "shape" && n.shape === "number");
  if (existing) return [{ type: "patch", collection: "nodes", id: existing.id, fields: { number } }];
  const label = members.find((n) => n.kind === "text") ?? node,
    marker = newNode("shape", label.layerId, label.frameId, { x: label.x - 40, y: label.y, w: 32, h: 32 });
  marker.shape = "number";
  marker.number = number;
  marker.annotationGroup = node.annotationGroup ?? id();
  marker.annotationStatus = node.annotationStatus ?? "open";
  marker.name = String(number);
  marker.paint = { ...label.paint, fill: label.textStyle.background, stroke: label.textStyle.color, strokeWidth: 2 };
  marker.textStyle = { ...label.textStyle, size: 18 };
  return [
    ...(!node.annotationGroup
      ? [{ type: "patch", collection: "nodes", id: node.id, fields: { annotationGroup: marker.annotationGroup } } as Change]
      : []),
    { type: "put", collection: "nodes", id: marker.id, value: marker },
    { type: "order", list: "nodeOrder", ids: [...scene.nodeOrder, marker.id] },
  ];
}
export function createAnnotation(
  scene: DrawingScene,
  layerId: string,
  frameId: string,
  targetId: string,
  text: string,
  arabic: boolean,
): { changes: Change[]; ids: string[] } {
  const target = scene.nodes[targetId];
  if (!target || target.redaction || !scene.frames[frameId] || !scene.layers[layerId]) throw Error("annotation-target");
  const l = effectiveLayer(scene, layerId);
  if (l.locked || l.positionLocked) throw Error("annotation-locked");
  const group = id(),
    p = localToWorld(target, { x: target.w, y: target.h / 2 }),
    label = newNode("text", layerId, frameId, { x: p.x + 60, y: p.y - 24, w: 240, h: 80 });
  label.annotationGroup = group;
  label.annotationStatus = "open";
  label.name = arabic ? "تسمية شرح" : "Annotation label";
  label.text = text.trim().slice(0, 4000) || label.name;
  label.paint.stroke = "#245b93";
  label.textStyle = {
    ...label.textStyle,
    size: arabic ? 20 : 18,
    direction: arabic ? "rtl" : "auto",
    leading: 1.7,
    background: "#eef5fc",
    border: "#245b93",
    color: "#245b93",
  };
  const arrow = newNode("shape", layerId, frameId, { x: p.x, y: p.y, w: 60, h: 1 });
  arrow.shape = "arrow";
  arrow.annotationGroup = group;
  arrow.annotationStatus = "open";
  arrow.name = arabic ? "رابط الشرح" : "Annotation connector";
  arrow.anchor = makeAnnotationAnchor(scene, targetId, 1, 0.5);
  const withLabel = { ...scene, nodes: { ...scene.nodes, [label.id]: label } };
  arrow.endAnchor = makeAnnotationAnchor(withLabel, label.id, 0, 0.5);
  arrow.paint = { ...arrow.paint, stroke: "#245b93", strokeWidth: 2 };
  return {
    changes: [
      { type: "put", collection: "nodes", id: arrow.id, value: arrow },
      { type: "put", collection: "nodes", id: label.id, value: label },
      { type: "order", list: "nodeOrder", ids: [...scene.nodeOrder, arrow.id, label.id] },
    ],
    ids: [label.id],
  };
}
