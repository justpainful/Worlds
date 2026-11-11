import { DEFAULT_BRUSH, newNode, type Brush, type DrawingNode, type DrawingScene, type Rect, type Sample, type Shape } from "./model";
import { strokePaintWork as work } from "./brushWork";
import { transformObjects, translateObjects, transformedScene, type ObjectTransform } from "./objectTransforms";
import { validAlphaMaskPreview, type AlphaMaskPreview } from "./pixelSelection";
export interface DrawingDraft {
  id: string;
  sequence: number;
  kind: "stroke" | "shape" | "move" | "transform";
  layerId: string;
  frameId: string;
  rect: Rect;
  samples?: Sample[];
  brush?: Brush;
  erase?: boolean;
  seed?: number;
  shape?: Shape;
  points?: { x: number; y: number }[];
  maskId?: string;
  alphaLock?: boolean;
  nodeIds?: string[];
  delta?: { x: number; y: number };
  transform?: ObjectTransform;
  selection?: AlphaMaskPreview;
}
const number = (value: unknown, min = -1e8, max = 1e8): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const key = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 160 && !["__proto__", "prototype", "constructor"].includes(value);
const shapes = [
  "rect",
  "roundrect",
  "ellipse",
  "triangle",
  "right-triangle",
  "polygon",
  "star",
  "line",
  "polyline",
  "curve",
  "arrow",
  "double-arrow",
  "callout",
  "number",
  "highlight",
];
function brushValid(b: Brush) {
  return (
    !!b &&
    [
      "pencil",
      "hard",
      "soft",
      "ink",
      "marker",
      "highlighter",
      "spray",
      "texture",
      "calligraphy",
      "oil",
      "crayon",
      "natural-pencil",
      "watercolor",
    ].includes(b.kind) &&
    /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(b.color) &&
    number(b.size, 1, 2048) &&
    number(b.spacing, 0.01, 2) &&
    number(b.opacity, 0, 1) &&
    number(b.flow, 0, 1) &&
    number(b.hardness, 0, 1) &&
    number(b.roundness, 0.05, 1) &&
    number(b.angle, -360, 360) &&
    number(b.pressureCurve, 0.1, 4) &&
    ["pressureSize", "pressureOpacity", "pressureFlow"].every((k) => typeof b[k as keyof Brush] === "boolean") &&
    (b.tipAssetId === undefined || key(b.tipAssetId))
  );
}
export function validDrawingDraft(value: unknown): value is DrawingDraft {
  const d = value as DrawingDraft;
  if (d?.selection !== undefined && !validAlphaMaskPreview(d.selection)) return false;
  if (
    !d ||
    !key(d.id) ||
    !Number.isSafeInteger(d.sequence) ||
    !key(d.layerId) ||
    !key(d.frameId) ||
    !d.rect ||
    !number(d.rect.x) ||
    !number(d.rect.y) ||
    !number(d.rect.w, 0.01) ||
    !number(d.rect.h, 0.01) ||
    (d.maskId !== undefined && !key(d.maskId)) ||
    (d.alphaLock !== undefined && typeof d.alphaLock !== "boolean")
  )
    return false;
  if (d.kind === "move")
    return (
      !!d.delta &&
      number(d.delta.x) &&
      number(d.delta.y) &&
      Array.isArray(d.nodeIds) &&
      d.nodeIds.length > 0 &&
      d.nodeIds.length <= 100 &&
      d.nodeIds.every(key)
    );
  if (d.kind === "transform") {
    const t = d.transform;
    return (
      !!t &&
      number(t.centerX, -1e9, 1e9) &&
      number(t.centerY, -1e9, 1e9) &&
      number(t.scale, 1e-15, 1e15) &&
      number(t.rotation, -36000, 36000) &&
      typeof t.flipX === "boolean" &&
      typeof t.flipY === "boolean" &&
      [t.width, t.height].every((v) => v === undefined || number(v, 0.000001, 1e9)) &&
      Array.isArray(d.nodeIds) &&
      d.nodeIds.length > 0 &&
      d.nodeIds.length <= 100 &&
      new Set(d.nodeIds).size === d.nodeIds.length &&
      d.nodeIds.every(key) &&
      (d.nodeIds.length === 1 || (t.width === undefined && t.height === undefined))
    );
  }
  if (!d.brush || !brushValid(d.brush)) return false;
  if (d.kind === "shape")
    return (
      !!d.shape &&
      shapes.includes(d.shape) &&
      (d.points === undefined || (Array.isArray(d.points) && d.points.length <= 64 && d.points.every((p) => number(p.x) && number(p.y))))
    );
  return (
    d.kind === "stroke" &&
    typeof d.erase === "boolean" &&
    Number.isSafeInteger(d.seed) &&
    Array.isArray(d.samples) &&
    d.samples.length > 0 &&
    d.samples.length <= 128 &&
    d.samples.every(
      (p) =>
        number(p.x) &&
        number(p.y) &&
        number(p.pressure, 0, 1) &&
        number(p.tiltX, -90, 90) &&
        number(p.tiltY, -90, 90) &&
        number(p.time, 0, 1e16),
    ) &&
    work(d.samples, d.brush) <= 50000
  );
}
export function drawingDraft(node: DrawingNode, sequence: number, selection?: AlphaMaskPreview): DrawingDraft | null {
  if (!node.frameId || !["stroke", "shape"].includes(node.kind)) return null;
  const brush = structuredClone(node.brush ?? { ...DEFAULT_BRUSH, color: node.paint.stroke, size: Math.max(1, node.paint.strokeWidth) });
  const source = node.samples ?? [],
    count = Math.min(128, source.length),
    samples = Array.from({ length: count }, (_, i) =>
      structuredClone(source[count === 1 ? 0 : Math.round((i * (source.length - 1)) / (count - 1))]),
    );
  // Only the transient preview is sampled to a bounded paint budget. The local
  // gesture and committed journal retain every original pressure sample.
  for (let i = 0; i < 8 && samples.length && work(samples, brush) > 49000; i++) brush.spacing = Math.min(2, brush.spacing * 2);
  const draft: DrawingDraft = {
    id: node.id,
    sequence,
    kind: node.kind as "stroke" | "shape",
    layerId: node.layerId,
    frameId: node.frameId,
    rect: { x: node.x, y: node.y, w: node.w, h: node.h },
    brush,
    maskId: node.maskId,
    alphaLock: node.alphaLock,
    ...(node.kind === "stroke"
      ? { samples, erase: !!node.erase, seed: node.seed ?? 1 }
      : { shape: node.shape, points: node.points?.slice(0, 64) }),
  };
  if (selection) draft.selection = selection;
  return validDrawingDraft(draft) ? draft : null;
}
export function movingDrawingDraft(
  scene: DrawingScene,
  nodeIds: string[],
  delta: { x: number; y: number },
  sequence: number,
): DrawingDraft | null {
  const node = scene.nodes[nodeIds[0]];
  if (!node) return null;
  const draft: DrawingDraft = {
    id: `move:${node.id}`,
    sequence,
    kind: "move",
    layerId: node.layerId,
    frameId: node.frameId ?? scene.defaultFrameId,
    rect: { x: node.x, y: node.y, w: node.w, h: node.h },
    nodeIds: nodeIds.slice(0, 100),
    delta,
  };
  return validDrawingDraft(draft) ? draft : null;
}
export function transformingDrawingDraft(
  scene: DrawingScene,
  nodeIds: string[],
  transform: ObjectTransform,
  sequence: number,
): DrawingDraft | null {
  const node = scene.nodes[nodeIds[0]];
  if (!node || nodeIds.length > 100) return null;
  const draft: DrawingDraft = {
    id: `transform:${node.id}`,
    sequence,
    kind: "transform",
    layerId: node.layerId,
    frameId: node.frameId ?? scene.defaultFrameId,
    rect: { x: node.x, y: node.y, w: Math.max(0.01, node.w), h: Math.max(0.01, node.h) },
    nodeIds: [...nodeIds],
    transform: { ...transform },
  };
  return validDrawingDraft(draft) ? draft : null;
}
export function draftNode(draft: DrawingDraft, scene: DrawingScene): DrawingNode | null {
  if (
    !validDrawingDraft(draft) ||
    draft.kind === "move" ||
    draft.kind === "transform" ||
    scene.nodes[draft.id] ||
    !scene.layers[draft.layerId] ||
    !scene.frames[draft.frameId]
  )
    return null;
  const node = newNode(draft.kind, draft.layerId, draft.frameId, draft.rect);
  node.id = draft.id;
  node.brush = { ...DEFAULT_BRUSH, ...draft.brush };
  if (node.brush.tipAssetId && !scene.assets[node.brush.tipAssetId]) delete node.brush.tipAssetId;
  node.maskId = draft.maskId && scene.masks[draft.maskId] ? draft.maskId : undefined;
  node.alphaLock = draft.alphaLock;
  if (draft.kind === "stroke") {
    node.samples = draft.samples;
    node.erase = draft.erase;
    node.seed = draft.seed;
  } else {
    node.shape = draft.shape;
    node.points = draft.points;
    node.paint = { ...node.paint, stroke: node.brush.color, strokeWidth: node.brush.size };
  }
  return node;
}
/** Local receipt time prevents remote clocks, idle awareness heartbeats and
 * lost final packets from keeping a ghost stroke alive indefinitely. */
export class DrawingDraftBuffer {
  private drafts = new Map<number, { draft: DrawingDraft; receivedAt: number }>();
  update(peers: { clientId: number; presence: { draft?: DrawingDraft | null } }[], now: number) {
    const active = new Set<number>();
    for (const peer of peers.slice(0, 64)) {
      active.add(peer.clientId);
      const draft = peer.presence.draft;
      if (!draft || !validDrawingDraft(draft)) this.drafts.delete(peer.clientId);
      else if (this.drafts.get(peer.clientId)?.draft.sequence !== draft.sequence || this.drafts.get(peer.clientId)?.draft.id !== draft.id)
        this.drafts.set(peer.clientId, { draft, receivedAt: now });
    }
    for (const id of this.drafts.keys()) if (!active.has(id)) this.drafts.delete(id);
  }
  project(scene: DrawingScene, now: number) {
    let visible = scene;
    const nodes: DrawingNode[] = [],
      selections = new Map<string, AlphaMaskPreview>();
    for (const { draft, receivedAt } of this.drafts.values()) {
      if (now - receivedAt > 3000) continue;
      if (draft.kind === "move" || draft.kind === "transform") {
        const originals = (draft.nodeIds ?? []).map((id) => scene.nodes[id]).filter(Boolean);
        if (originals.length !== draft.nodeIds?.length) continue;
        try {
          visible = transformedScene(
            visible,
            draft.kind === "move" ? translateObjects(scene, originals, draft.delta!) : transformObjects(scene, originals, draft.transform!),
          );
        } catch {
          /* Invalid remote geometry cannot disrupt the local canvas. */
        }
      } else {
        const node = draftNode(draft, scene);
        if (node) {
          nodes.push(node);
          if (draft.selection) selections.set(node.id, draft.selection);
        }
      }
    }
    return { scene: visible, nodes, selections };
  }
}
