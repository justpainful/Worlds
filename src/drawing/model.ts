/** Persistent drawing data. Screen state and caches never belong in this model. */
import { MAX_STROKE_WORK, requireStrokeBudget, strokePaintWork } from "./brushWork";
import { validPath } from "./paths";
import { validateLibraryPublication, type PublishedLibraryMetadata } from "./libraryPublication";
export const DRAWING_SCHEMA = 1;
export const TILE_SIZE = 512;
export const MAX_FRAME_SIDE = 16384;
export const MAX_FRAME_PIXELS = 64 * 1024 * 1024;
export const id = () => crypto.randomUUID();

export interface Point {
  x: number;
  y: number;
}
export interface PathVertex extends Point {
  in?: Point;
  out?: Point;
}
export interface DrawingPath {
  vertices: PathVertex[];
  closed: boolean;
}
export interface Rect extends Point {
  w: number;
  h: number;
}
export interface Sample extends Point {
  pressure: number;
  tiltX: number;
  tiltY: number;
  time: number;
}
export type BrushKind =
  | "pencil"
  | "hard"
  | "soft"
  | "ink"
  | "marker"
  | "highlighter"
  | "spray"
  | "texture"
  | "calligraphy"
  | "oil"
  | "crayon"
  | "natural-pencil"
  | "watercolor";
export interface Brush {
  kind: BrushKind;
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  spacing: number;
  angle: number;
  roundness: number;
  smoothing: number;
  stabilizer: number;
  taperStart: number;
  taperEnd: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  pressureFlow: boolean;
  pressureCurve: number;
  color: string;
  tipAssetId?: string;
  straightLine?: boolean;
}
export const DEFAULT_BRUSH: Brush = {
  kind: "hard",
  size: 12,
  opacity: 1,
  flow: 1,
  hardness: 1,
  spacing: 0.12,
  angle: 0,
  roundness: 1,
  smoothing: 0.15,
  stabilizer: 0,
  taperStart: 0,
  taperEnd: 0,
  pressureSize: true,
  pressureOpacity: false,
  pressureFlow: false,
  pressureCurve: 1,
  color: "#202023",
};
export interface Frame extends Rect {
  id: string;
  name: string;
  background: string;
  clip: boolean;
  status: "draft" | "ready" | "approved";
  exportScale: number;
  grid?: { visible: boolean; size: number; snap: boolean };
  guides?: { id: string; axis: "x" | "y"; at: number }[];
  libraryInstanceId?: string;
  librarySourceFrameId?: string;
  libraryItemId?: string;
  libraryVersion?: number;
}
export type Blend = "source-over" | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  positionLocked: boolean;
  alphaLocked: boolean;
  opacity: number;
  blend: Blend;
  parentId: string | null;
  libraryInstanceId?: string;
  librarySourceLayerId?: string;
}
export interface Asset {
  id: string;
  attachmentId: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  sha256?: string;
  size?: number;
  /** EXIF interpretation retained with the immutable original, independent of codec support. */
  orientation?: number;
  /** A frozen composited frame; the encoded animated original remains intact. */
  frameIndex?: number;
}
export interface Gradient {
  type: "linear" | "radial";
  from: Point;
  to: Point;
  stops: { at: number; color: string }[];
}
export interface Paint {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: number[];
  cap: "butt" | "round" | "square";
  radius: number;
  gradient?: Gradient;
}
export interface TextStyle {
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  align: "start" | "center" | "end";
  direction: "auto" | "rtl" | "ltr";
  leading: number;
  background: string;
  color: string;
  border: string;
  resizeMode?: "wrap" | "scale";
}
export interface Effect {
  id: string;
  kind: "brightness" | "contrast" | "saturation" | "temperature" | "grayscale" | "invert" | "blur" | "sharpen" | "pixelate";
  amount: number;
  enabled: boolean;
  maskId?: string;
}
export interface Anchor {
  nodeId: string | null;
  u: number;
  v: number;
  fallback: Point;
  region?: Rect;
  review?: boolean;
  sourceKey?: string;
}
export type Shape =
  | "rect"
  | "roundrect"
  | "ellipse"
  | "triangle"
  | "right-triangle"
  | "polygon"
  | "star"
  | "line"
  | "polyline"
  | "curve"
  | "arrow"
  | "double-arrow"
  | "callout"
  | "number"
  | "highlight";
export type NodeKind = "stroke" | "shape" | "text" | "image" | "reference" | "raster";
export interface DrawingNode extends Rect {
  id: string;
  kind: NodeKind;
  name: string;
  layerId: string;
  frameId: string | null;
  groupId: string | null;
  visible: boolean;
  locked: boolean;
  rotation: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  /** Immutable source box for nondestructive content scaling. w/h are display dimensions. */
  geometrySize?: { w: number; h: number };
  paint: Paint;
  textStyle: TextStyle;
  effects: Effect[];
  shape?: Shape;
  points?: Point[];
  text?: string;
  path?: DrawingPath;
  redaction?: boolean;
  brush?: Brush;
  samples?: Sample[];
  erase?: boolean;
  seed?: number;
  alphaLock?: boolean;
  assetId?: string;
  crop?: Rect;
  maskId?: string;
  anchor?: Anchor;
  endAnchor?: Anchor;
  annotationGroup?: string;
  annotationStatus?: "open" | "active" | "resolved";
  number?: number;
  sourceId?: string;
  sourceMode?: "live" | "snapshot";
  originalSamples?: Sample[];
  sourceUpdatedAt?: number;
  sourceTitle?: string;
  referenceSnapshot?: import("./referenceTypes").ReferenceSnapshot | null;
  libraryItemId?: string;
  libraryVersion?: number;
  libraryInstanceId?: string;
  librarySourceNodeId?: string;
}
export interface Mask {
  id: string;
  name: string;
  assetId?: string;
  enabled: boolean;
  inverted: boolean;
  linked: boolean;
  x: number;
  y: number;
  w?: number;
  h?: number;
  base?: number;
  strokes: { samples: Sample[]; brush: Brush; reveal: boolean }[];
}
export interface Step {
  id: string;
  title: string;
  body: string;
  frameId: string;
  camera: Rect;
  hiddenNodeIds: string[];
  transition: "cut" | "fade";
  duration: number | null;
  pinnedVersionId?: string;
  libraryInstanceId?: string;
  librarySourceStepId?: string;
}
export interface DrawingScene {
  libraryPublication?: PublishedLibraryMetadata;
  schema: typeof DRAWING_SCHEMA;
  defaultFrameId: string;
  frames: Record<string, Frame>;
  frameOrder: string[];
  layers: Record<string, Layer>;
  layerOrder: string[];
  nodes: Record<string, DrawingNode>;
  nodeOrder: string[];
  assets: Record<string, Asset>;
  masks: Record<string, Mask>;
  steps: Record<string, Step>;
  stepOrder: string[];
}
export type EntityMap = "frames" | "layers" | "nodes" | "assets" | "masks" | "steps";
export type SceneList = "frameOrder" | "layerOrder" | "nodeOrder" | "stepOrder";
export type Change =
  | { type: "put"; collection: EntityMap; id: string; value: unknown }
  | { type: "patch"; collection: EntityMap; id: string; fields: Record<string, unknown> }
  | { type: "remove"; collection: EntityMap; id: string }
  | { type: "order"; list: SceneList; ids: string[] }
  | { type: "defaultFrame"; id: string };
export interface EditOperation {
  id: string;
  actor: string;
  base: number;
  at: number;
  label: string;
  type: "edit";
  changes: Change[];
  versionRestore?: { versionId: string; expectedRevision: number; backupId: string };
  pixelGuard?: import("./pixelGuard").PixelGuard;
  requiresBase?: true;
}
export interface ToggleOperation {
  id: string;
  actor: string;
  base: number;
  at: number;
  label: string;
  type: "toggle";
  target: string;
  enabled: boolean;
}
export type DrawingOperation = EditOperation | ToggleOperation;
export interface DrawingDocument {
  revision: number;
  seed: DrawingScene;
  scene: DrawingScene;
  operations: DrawingOperation[];
  experiment?: ExperimentInfo | null;
}
export interface ExperimentInfo {
  sourceId: string;
  baseVersionId: string;
  author: string;
  createdAt: number;
  description: string;
  status: "draft" | "review" | "approved";
  versionAliases?: Record<string, string>;
}

export const DEFAULT_PAINT: Paint = { fill: "transparent", stroke: "#202023", strokeWidth: 3, dash: [], cap: "round", radius: 16 };
export const DEFAULT_TEXT: TextStyle = {
  font: "IBM Plex Sans Arabic",
  size: 28,
  weight: 400,
  italic: false,
  align: "start",
  direction: "auto",
  leading: 1.7,
  background: "transparent",
  color: "#202023",
  border: "transparent",
  resizeMode: "wrap",
};
export function newLayer(name = "Layer 1"): Layer {
  return {
    id: id(),
    name,
    visible: true,
    locked: false,
    positionLocked: false,
    alphaLocked: false,
    opacity: 1,
    blend: "source-over",
    parentId: null,
  };
}
export function newFrame(name = "Frame 1", bounds: Partial<Rect> = {}): Frame {
  return { id: id(), name, x: 0, y: 0, w: 1280, h: 720, background: "#ffffff", clip: true, status: "draft", exportScale: 1, ...bounds };
}
export function newScene(): DrawingScene {
  const f = newFrame(),
    l = newLayer();
  return {
    schema: DRAWING_SCHEMA,
    defaultFrameId: f.id,
    frames: { [f.id]: f },
    frameOrder: [f.id],
    layers: { [l.id]: l },
    layerOrder: [l.id],
    nodes: {},
    nodeOrder: [],
    assets: {},
    masks: {},
    steps: {},
    stepOrder: [],
  };
}
export function newNode(kind: NodeKind, layerId: string, frameId: string | null, rect: Partial<Rect> = {}): DrawingNode {
  return {
    id: id(),
    kind,
    name: kind,
    layerId,
    frameId,
    groupId: null,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    paint: structuredClone(DEFAULT_PAINT),
    textStyle: structuredClone(DEFAULT_TEXT),
    effects: [],
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    w: rect.w ?? 200,
    h: rect.h ?? 120,
  };
}

export function validateScene(value: unknown): asserts value is DrawingScene {
  if (!value || typeof value !== "object") throw new Error("The drawing is not an object");
  const s = value as DrawingScene;
  if (s.schema !== DRAWING_SCHEMA) throw new Error("This drawing format needs a newer version of Worlds");
  for (const key of ["frames", "layers", "nodes", "assets", "masks", "steps"] as const) {
    const m = s[key];
    if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error(`Invalid ${key}`);
    for (const [keyId, entity] of Object.entries(m)) {
      if (!entity || entity.id !== keyId || ["__proto__", "constructor", "prototype"].includes(keyId))
        throw new Error(`Invalid ${key} identifier`);
    }
  }
  for (const [list, map] of [
    ["frameOrder", "frames"],
    ["layerOrder", "layers"],
    ["nodeOrder", "nodes"],
    ["stepOrder", "steps"],
  ] as const) {
    const a = s[list];
    if (
      !Array.isArray(a) ||
      new Set(a).size !== a.length ||
      a.length !== Object.keys(s[map]).length ||
      a.some((k) => !Object.hasOwn(s[map], k))
    )
      throw new Error(`Invalid ${list}`);
  }
  if (!s.frames[s.defaultFrameId] || !s.layerOrder.length) throw new Error("A drawing needs a frame and a layer");
  const rect = (r: Rect) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;
  const finite = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
  const color = (v: unknown) => typeof v === "string" && v.length <= 128 && !/[<>;{}]|url\s*\(/i.test(v);
  const validBrush = (b: Brush) =>
    b &&
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
    finite(b.size, 1, 2048) &&
    finite(b.opacity, 0, 1) &&
    finite(b.flow, 0, 1) &&
    finite(b.hardness, 0, 1) &&
    finite(b.spacing, 0.01, 2) &&
    finite(b.roundness, 0.05, 1) &&
    finite(b.pressureCurve, 0.1, 4) &&
    color(b.color);
  for (const f of Object.values(s.frames)) {
    if (!rect(f) || f.w > MAX_FRAME_SIDE || f.h > MAX_FRAME_SIDE || f.w * f.h > MAX_FRAME_PIXELS)
      throw new Error("Frame dimensions exceed the drawing memory limit");
    if (typeof f.name !== "string" || !color(f.background)) throw new Error("Invalid frame appearance");
    if (f.grid && (typeof f.grid.visible !== "boolean" || typeof f.grid.snap !== "boolean" || !finite(f.grid.size, 1, 10000)))
      throw new Error("Invalid frame grid");
    if (
      f.guides &&
      (!Array.isArray(f.guides) ||
        f.guides.length > 128 ||
        new Set(f.guides.map((g) => g.id)).size !== f.guides.length ||
        f.guides.some(
          (g) => typeof g.id !== "string" || !g.id || g.id.length > 160 || !["x", "y"].includes(g.axis) || !finite(g.at, -1e9, 1e9),
        ))
    )
      throw new Error("Invalid frame guides");
  }
  for (const l of Object.values(s.layers)) {
    if (!Number.isFinite(l.opacity) || l.opacity < 0 || l.opacity > 1) throw new Error("Invalid layer opacity");
    if (typeof l.name !== "string" || !["source-over", "normal", "multiply", "screen", "overlay", "darken", "lighten"].includes(l.blend))
      throw new Error("Invalid layer appearance");
    const ancestors = new Set([l.id]);
    let parent = l.parentId;
    while (parent) {
      if (ancestors.has(parent) || !s.layers[parent]) throw new Error("Invalid layer group");
      ancestors.add(parent);
      parent = s.layers[parent].parentId;
    }
  }
  for (const n of Object.values(s.nodes)) {
    for (const a of [n.anchor, n.endAnchor])
      if (
        a != null &&
        (!a ||
          typeof a !== "object" ||
          Array.isArray(a) ||
          Object.keys(a).some((k) => !["nodeId", "u", "v", "fallback", "region", "review", "sourceKey"].includes(k)) ||
          (a.nodeId !== null &&
            (typeof a.nodeId !== "string" ||
              !a.nodeId ||
              a.nodeId.length > 160 ||
              ["__proto__", "constructor", "prototype"].includes(a.nodeId))) ||
          !finite(a.u, -1e9, 1e9) ||
          !finite(a.v, -1e9, 1e9) ||
          !a.fallback ||
          ![a.fallback.x, a.fallback.y].every(Number.isFinite) ||
          (a.review !== undefined && typeof a.review !== "boolean") ||
          (a.region !== undefined && !rect(a.region)) ||
          (a.sourceKey !== undefined && (typeof a.sourceKey !== "string" || a.sourceKey.length > 4096)))
      )
        throw Error("Invalid annotation anchor");
    if (
      (n.annotationGroup != null &&
        (typeof n.annotationGroup !== "string" ||
          !n.annotationGroup ||
          n.annotationGroup.length > 160 ||
          ["__proto__", "constructor", "prototype"].includes(n.annotationGroup))) ||
      (n.annotationStatus != null && !["open", "active", "resolved"].includes(n.annotationStatus))
    )
      throw Error("Invalid annotation status or group");
    if (
      n.geometrySize !== undefined &&
      (!n.geometrySize || !finite(n.geometrySize.w, 0.000001, 1e9) || !finite(n.geometrySize.h, 0.000001, 1e9))
    )
      throw new Error("Invalid original geometry size");
    if (
      n.kind === "reference" &&
      (typeof n.sourceId !== "string" ||
        !n.sourceId ||
        !["live", "snapshot"].includes(n.sourceMode ?? "") ||
        (n.sourceMode === "live" && (n.referenceSnapshot != null || n.sourceTitle != null)) ||
        (n.sourceMode === "snapshot" &&
          (!n.referenceSnapshot ||
            typeof n.referenceSnapshot.title !== "string" ||
            typeof n.referenceSnapshot.kind !== "string" ||
            JSON.stringify(n.referenceSnapshot).length > 32768)))
    )
      throw new Error("Invalid drawing source reference");
    if (!rect(n) || !Number.isFinite(n.rotation) || !Number.isFinite(n.opacity) || n.opacity < 0 || n.opacity > 1)
      throw new Error("Invalid element geometry");
    if (
      !s.layers[n.layerId] ||
      (n.frameId !== null && !s.frames[n.frameId]) ||
      (n.assetId && !s.assets[n.assetId]) ||
      (n.maskId && !s.masks[n.maskId])
    )
      throw new Error("The drawing contains a missing element dependency");
    if (!["stroke", "shape", "text", "image", "reference", "raster"].includes(n.kind) || typeof n.name !== "string")
      throw new Error("Invalid element type");
    if (
      !n.paint ||
      !color(n.paint.fill) ||
      !color(n.paint.stroke) ||
      !finite(n.paint.strokeWidth, 0, 2048) ||
      !Array.isArray(n.paint.dash) ||
      n.paint.dash.some((v) => !finite(v, 0, 10000))
    )
      throw new Error("Invalid element paint");
    if (n.paint.gradient) {
      const g = n.paint.gradient;
      if (
        !["linear", "radial"].includes(g.type) ||
        ![g.from, g.to].every((p) => p && finite(p.x, -1e9, 1e9) && finite(p.y, -1e9, 1e9)) ||
        !Array.isArray(g.stops) ||
        g.stops.length < 2 ||
        g.stops.length > 32 ||
        g.stops.some((s, i) => !finite(s.at, 0, 1) || !color(s.color) || (i > 0 && s.at < g.stops[i - 1].at))
      )
        throw new Error("Invalid gradient");
    }
    if (
      !n.textStyle ||
      typeof n.textStyle.font !== "string" ||
      !finite(n.textStyle.size, 1, 2048) ||
      !finite(n.textStyle.leading, 0.5, 8) ||
      !["auto", "rtl", "ltr"].includes(n.textStyle.direction) ||
      !color(n.textStyle.color) ||
      !color(n.textStyle.background) ||
      !color(n.textStyle.border) ||
      !finite(n.textStyle.weight, 100, 1000) ||
      typeof n.textStyle.italic !== "boolean" ||
      !["start", "center", "end"].includes(n.textStyle.align) ||
      n.textStyle.font.length > 120 ||
      (n.textStyle.resizeMode !== undefined && !["wrap", "scale"].includes(n.textStyle.resizeMode))
    )
      throw new Error("Invalid text style");
    if (
      !Array.isArray(n.effects) ||
      n.effects.length > 64 ||
      n.effects.some(
        (e) =>
          !["brightness", "contrast", "saturation", "temperature", "grayscale", "invert", "blur", "sharpen", "pixelate"].includes(e.kind) ||
          !finite(e.amount, -1, 256),
      )
    )
      throw new Error("Invalid element effects");
    if (
      n.points &&
      (!Array.isArray(n.points) || n.points.length > 65536 || n.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    )
      throw new Error("Invalid shape path");
    if (n.path !== undefined && !validPath(n.path)) throw new Error("Invalid editable path");
    if (n.redaction !== undefined && typeof n.redaction !== "boolean") throw new Error("Invalid redaction flag");
    if (
      n.redaction &&
      (n.kind !== "shape" ||
        n.shape !== "rect" ||
        n.paint.fill !== "#000000" ||
        n.paint.strokeWidth !== 0 ||
        n.paint.gradient ||
        n.opacity !== 1 ||
        n.rotation !== 0 ||
        n.maskId ||
        n.effects.length ||
        n.anchor ||
        n.endAnchor ||
        n.annotationGroup ||
        n.path ||
        n.erase ||
        n.alphaLock)
    )
      throw new Error("Redaction must remain an opaque unmasked rectangle");
    if (n.kind === "stroke") {
      if (
        !n.brush ||
        !validBrush(n.brush) ||
        !n.samples?.length ||
        n.samples.length > 65536 ||
        n.samples.some(
          (p) =>
            ![p.x, p.y, p.pressure, p.time, p.tiltX, p.tiltY].every(Number.isFinite) ||
            p.x < -2048 ||
            p.y < -2048 ||
            p.x > (n.geometrySize?.w ?? n.w) + 2048 ||
            p.y > (n.geometrySize?.h ?? n.h) + 2048,
        )
      )
        throw new Error("Invalid brush stroke");
      requireStrokeBudget(n.samples, n.brush);
    }
    if ((n.kind === "image" || n.kind === "raster") && !n.assetId) throw new Error("Missing original image");
    if (n.crop && (!rect(n.crop) || n.crop.x < 0 || n.crop.y < 0)) throw new Error("Invalid image crop");
  }
  for (const asset of Object.values(s.assets))
    if (
      typeof asset.attachmentId !== "string" ||
      !asset.attachmentId ||
      typeof asset.mime !== "string" ||
      !finite(asset.width, 1, 1000000) ||
      !finite(asset.height, 1, 1000000) ||
      (asset.orientation !== undefined && (!Number.isInteger(asset.orientation) || asset.orientation < 1 || asset.orientation > 8)) ||
      (asset.frameIndex !== undefined && (!Number.isInteger(asset.frameIndex) || asset.frameIndex < 0 || asset.frameIndex >= 1000))
    )
      throw new Error("Invalid original asset");
  for (const mask of Object.values(s.masks)) {
    if (!Array.isArray(mask.strokes) || (mask.assetId && !s.assets[mask.assetId]) || !Number.isFinite(mask.x) || !Number.isFinite(mask.y))
      throw new Error("Invalid element mask");
    let maskWork = 0;
    for (const stroke of mask.strokes) {
      if (!validBrush(stroke.brush) || !Array.isArray(stroke.samples)) throw new Error("Invalid mask stroke");
      requireStrokeBudget(stroke.samples, stroke.brush);
      maskWork += strokePaintWork(stroke.samples, stroke.brush);
      if (maskWork > MAX_STROKE_WORK) throw new Error("This mask exceeds the paint limit");
    }
  }
  for (const step of Object.values(s.steps))
    if (!s.frames[step.frameId] || !rect(step.camera)) throw new Error("Invalid presentation step");
  if (s.libraryPublication !== undefined) validateLibraryPublication(s.libraryPublication, s);
}

/** Traverse every durable reference, including mask and textured-brush originals. */
export function drawingAttachmentIds(scene: DrawingScene): string[] {
  return [...new Set(Object.values(scene.assets).map((a) => a.attachmentId))];
}
export function drawingSearchText(scene: DrawingScene): string {
  return [
    ...Object.values(scene.frames).map((f) => f.name),
    ...Object.values(scene.nodes).flatMap((n) => [
      n.name,
      n.text ?? "",
      n.sourceMode === "snapshot" ? (n.referenceSnapshot?.title ?? "") : "",
      n.sourceMode === "snapshot" ? (n.referenceSnapshot?.excerpt ?? "") : "",
    ]),
    ...Object.values(scene.steps).flatMap((s) => [s.title, s.body]),
  ].join("\n");
}
