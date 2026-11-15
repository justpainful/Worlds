import { LayerMergeDialog } from "./LayerMergeDialog";
import { shownName } from "./names";
import { mergedLayerChanges, mergeSourceKey } from "./layerMerge";
import { checkDrawingExport } from "./files";
import { RasterizeImageDialog } from "./RasterizeImageDialog";
import { rasterizedImageChanges } from "./rasterizeImage";
import { isRedaction } from "./redaction";
import { ImageCropDialog } from "./ImageCropDialog";
import { imageCropChanges, imageCropSourceKey } from "./imageCrop";
import { MaskDialog } from "./MaskDialog";
import { maskEditChanges, maskPropertyChanges } from "./maskEdit";
import { LayerBrowser } from "./LayerBrowser";
import { DrawingShortcutsDialog } from "./ShortcutsDialog";
import { drawingShortcutAction, readDrawingShortcuts } from "./shortcuts";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScreenDrawing, type CapturedScreen } from "./ScreenDrawing";
import { localStore } from "../sync/session";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { accountApi, type Level } from "../account/api";
import { promptText } from "../editor/prompt";
import { ResourceHeader } from "../resources/views/ResourceHeader";
import { Icon } from "../ui/Icon";
import { Button, IconButton } from "../ui/Button";
import { EmptyState, Spinner } from "../ui/misc";
import { Modal } from "../ui/Modal";
import { drawingSession } from "./session";
import {
  beginDrawingGesture,
  reserveDrawingRoot,
  recoverDrawingSync,
  retryDrawingSync,
  useDrawingLive,
  useDrawingSync,
} from "./syncManager";
import { drawingDraft, movingDrawingDraft, transformingDrawingDraft } from "./drafts";
import { DrawingCommentsPanel } from "./CommentsPanel";
import { drawingCommentLocation } from "./collaboration";
import { validDrawingAnchor } from "./collaborationTypes";
import { consumeDrawingComment, openDrawingLocation } from "./navigation";
import { useNotifications } from "../sync/manager";
import { NotificationsPopover } from "../sync/ui/Notifications";
import { DrawingStage, type Tool, type PaintContext } from "./Stage";
import { edit, putNode, removeNodes, sceneChanges } from "./operations";
import {
  DEFAULT_BRUSH,
  id,
  newFrame,
  newLayer,
  newNode,
  type Asset,
  type Brush,
  type Change,
  type DrawingNode,
  type DrawingScene,
  type Point,
  type Shape,
} from "./model";
import { DrawingRenderer, unsupportedVectorEffects, type Viewport } from "./renderer";
import { frameAt } from "./geometry";
import { pixelsToPng } from "./files";
import { DrawingExportDialog } from "./ExportDialog";
import { DrawingVersionRestoreDialog } from "./VersionRestoreDialog";
import { DrawingPackageImportDialog } from "./PackageImportDialog";
import { StepsPanel } from "./Steps";
import {
  alignElements,
  duplicateLayerTree,
  reorderLayerTree,
  deleteLayerTree,
  duplicateElements,
  duplicateFrame,
  moveFrame,
} from "./workflows";
import { BrushStylePicker } from "./BrushPicker";
import { BrushSettings, resetToolBrush } from "./BrushSettings";
import { normalizeBrush } from "./brushConfig";
import { decodeBrushTip, ImageHeaderError } from "./imageHeaders";
import { DrawingTransformDialog } from "./TransformDialog";
import { objectTransformChanges, translateObjects } from "./objectTransforms";
import { DrawingColors } from "./Colors";
import { TextInspector } from "./TextInspector";
import { PaintInspector } from "./PaintInspector";
import { PanelResize } from "./PanelResize";
import { effectiveLayer, layerDisplayOrder, layerDescendants, layersAfterChanges, nodeChangesBlockedByLayerLocks } from "./layers";
import { readPanelPreferences, savePanelPreferences } from "./panelPreferences";
import { PathDialog } from "./PathDialog";
import { GridControls } from "./GridControls";
import { readDrawingPreferences, saveDrawingPreferences } from "./preferences";
import { ExperimentsPanel } from "./ExperimentsPanel";
import { LibraryPanel } from "./LibraryPanel";
import { ReferencesPanel } from "./ReferencesPanel";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { applyAnnotationEdit } from "./annotations";
import { consumeDrawingLocation } from "./navigation";
import { trimTransparent, validatePixelDimensions } from "./pixels";
import { usePixelSelection } from "./usePixelSelection";
import { SelectionControls } from "./SelectionControls";
import { maskNewPaint, selectionPresenceMask } from "./selectionPaint";
import type { SelectionKind, SelectionMode } from "./pixelSelection";
import { usePixelEdits } from "./usePixelEdits";
import { PixelSelectionActions, pixelEditMessage } from "./PixelSelectionActions";
import { FloatingPixelsDialog } from "./FloatingPixelsDialog";
import type { PixelSampleSource } from "./floatingPixels";
import { runPixelTask } from "./pixelTasks";
import "./drawing.css";
import { shortcutKey } from "../lib/keys";

const TOOLS: { id: Tool; label: string; ar: string; glyph: string; key?: string }[] = [
  { id: "select", label: "Move", ar: "تحريك", glyph: "↖", key: "V" },
  { id: "brush", label: "Brush", ar: "فرشاة", glyph: "✎", key: "B" },
  { id: "eraser", label: "Eraser", ar: "ممحاة", glyph: "▱", key: "E" },
  { id: "highlighter", label: "Highlighter", ar: "تظليل", glyph: "▰", key: "H" },
  { id: "laser", label: "Laser", ar: "ليزر", glyph: "•", key: "K" },
  { id: "shape", label: "Shape", ar: "شكل", glyph: "△", key: "U" },
  { id: "text", label: "Text", ar: "نص", glyph: "T", key: "T" },
  { id: "redact", label: "Opaque redaction", ar: "تنقيح معتم", glyph: "▰", key: "R" },
  { id: "eyedropper", label: "Eyedropper", ar: "قطّارة", glyph: "⌖", key: "I" },
  { id: "fill", label: "Fill", ar: "تعبئة", glyph: "◩", key: "G" },
  { id: "selection", label: "Select area", ar: "تحديد", glyph: "▧", key: "M" },
];
const SHAPES: Shape[] = [
  "curve",
  "polyline",
  "highlight",
  "rect",
  "roundrect",
  "ellipse",
  "triangle",
  "right-triangle",
  "line",
  "arrow",
  "double-arrow",
  "star",
  "polygon",
  "callout",
  "number",
];
const AR_EFFECTS: Record<string, string> = {
  brightness: "السطوع",
  contrast: "التباين",
  saturation: "التشبع",
  temperature: "حرارة اللون",
  grayscale: "تدرج رمادي",
  invert: "عكس الألوان",
  blur: "ضبابية",
  sharpen: "زيادة الحدة",
  pixelate: "بكسلة",
};
const AR_SHAPES: Record<string, string> = {
  curve: "منحنى",
  polyline: "خط متعدد",
  highlight: "إبراز",
  rect: "مستطيل",
  roundrect: "مستطيل دائري",
  ellipse: "دائرة",
  triangle: "مثلث",
  "right-triangle": "مثلث قائم",
  line: "خط",
  arrow: "سهم",
  "double-arrow": "سهم مزدوج",
  star: "نجمة",
  polygon: "مضلع",
  callout: "تعليق",
  number: "ترقيم",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="drawing-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>
        {Math.round(value * (max === 1 ? 100 : 1))}
        {max === 1 ? "%" : ""}
      </output>
    </Field>
  );
}
export function DrawingView(props: { id: string; paneId: string }) {
  const owner = useStore((s) => s.profile?.id ?? "local");
  // Account and document changes start a new editor lifetime, including input,
  // preference writers and pending file imports. No old tool state is hydrated
  // into the next owner's storage before its own preferences have been read.
  return <DrawingEditor key={JSON.stringify([owner, props.id])} {...props} />;
}
function DrawingEditor({ id: pageId, paneId }: { id: string; paneId: string }) {
  const [screenCapture, setScreenCapture] = useState<CapturedScreen | null>(null);
  const [capturingScreen, setCapturingScreen] = useState(false);
  useEffect(
    () => () => {
      if (screenCapture) void invoke("end_screen_drawing", { wasFullscreen: screenCapture.wasFullscreen }).catch(() => {});
    },
    [screenCapture],
  );
  const session = drawingSession(pageId),
    state = useSyncExternalStore(session.subscribe, session.snapshot);
  const sync = useDrawingSync(pageId);
  const live = useDrawingLive(pageId),
    liveState = useSyncExternalStore(live?.subscribe ?? (() => () => {}), () => live?.snapshot() ?? null);
  const laserSequence = useRef(0);
  const [gestureState, setGestureState] = useState<"waiting" | "locked" | "offline" | "lost" | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [notificationBell, setNotificationBell] = useState<HTMLElement | null>(null),
    unread = useNotifications((state) => state.unread);
  const root = useRef<HTMLDivElement | null>(null);
  const lifetime = useRef({ active: true });
  useEffect(() => {
    lifetime.current.active = true;
    return () => {
      lifetime.current.active = false;
    };
  }, []);
  const meta = useStore((s) => s.pages[pageId]),
    profile = useStore((s) => s.profile),
    toast = useStore((s) => s.toast);
  const initialPreferences = useRef(readDrawingPreferences(profile?.id ?? "local", pageId));
  const [tool, setTool] = useState<Tool>("brush"),
    [brush, setBrush] = useState<Brush>(initialPreferences.current.brushes.brush ?? { ...DEFAULT_BRUSH });
  const currentTool = useRef(tool);
  currentTool.current = tool;
  const [shape, setShape] = useState<Shape>("rect"),
    [autoShape, setAutoShape] = useState(initialPreferences.current.autoShape),
    [laserLifetime, setLaserLifetime] = useState(initialPreferences.current.laserLifetime ?? 1200);
  const [recentColors, setRecentColors] = useState(initialPreferences.current.recent),
    [backgroundColor, setBackgroundColor] = useState(initialPreferences.current.background);
  const [palette, setPalette] = useState(initialPreferences.current.palette ?? []);
  const [librarySaveKind, setLibrarySaveKind] = useState<"brush" | "style" | undefined>();
  const [layerId, setLayerId] = useState(""),
    [frameId, setFrameId] = useState(""),
    [selectedIds, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<Viewport>({ x: -40, y: -65, w: 1400, h: 900, scale: 0.7 });
  const owner = profile?.id ?? "local";
  const [shortcuts, setShortcuts] = useState(() => readDrawingShortcuts(owner)),
    [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [panelDefaults] = useState(() => readPanelPreferences(owner));
  const [inspector, setInspector] = useState(panelDefaults.open),
    [focus, setFocus] = useState(false),
    [tab, setTab] = useState(panelDefaults.tab),
    [panelWidth, setPanelWidth] = useState(panelDefaults.width);
  useEffect(() => savePanelPreferences(owner, { open: inspector, tab, width: panelWidth }), [owner, inspector, tab, panelWidth]);
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof api.drawingVersions>>>([]);
  const [restoreVersion, setRestoreVersion] = useState<(typeof versions)[number] | null>(null);
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [exportScene, setExportScene] = useState<DrawingScene | null>(null);
  const [showTransform, setShowTransform] = useState(false);
  const [pathNodeId, setPathNodeId] = useState<string | null>(null);
  const [rasterizeNodeId, setRasterizeNodeId] = useState<string | null>(null),
    [mergeOpen, setMergeOpen] = useState(false),
    [layerBusy, setLayerBusy] = useState(false);
  const [cropNodeId, setCropNodeId] = useState<string | null>(null),
    [maskTarget, setMaskTarget] = useState<{ nodeId: string; effectId?: string; erase?: boolean } | null>(null);
  const [minimap, setMinimap] = useState(false);
  const [solo, setSolo] = useState<string | null>(null);
  useEffect(() => {
    if (solo && state.document && !state.document.scene.layers[solo]) setSolo(null);
  }, [solo, state.document]);
  const [recoveryName, setRecoveryName] = useState<string | null>(null),
    [recovering, setRecovering] = useState(false);
  const [textEdit, setTextEdit] = useState<{ node: DrawingNode; value: string } | null>(null),
    [busy, setBusy] = useState(false);
  const [selectionKind, setSelectionKind] = useState<SelectionKind>("rect"),
    [selectionMode, setSelectionMode] = useState<SelectionMode>("replace");
  const [pixelSource, setPixelSource] = useState<PixelSampleSource>("current");
  const [access, setAccess] = useState<Level>("none");
  const [tolerance, setTolerance] = useState(24),
    [contiguous, setContiguous] = useState(true),
    [merged, setMerged] = useState(true);
  const [sampleMerged, setSampleMerged] = useState(true);
  const [fillGrow, setFillGrow] = useState(1);
  const [fillPreview, setFillPreview] = useState<{
    url: string;
    blob: Blob;
    revision: number;
    frameId: string;
    layerId: string;
    selectionId: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    alphaLock: boolean;
  } | null>(null);
  const [fillApplying, setFillApplying] = useState(false);
  useEffect(
    () => () => {
      if (fillPreview) URL.revokeObjectURL(fillPreview.url);
    },
    [fillPreview],
  );
  const task = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      task.current?.abort();
      task.current = null;
    },
    [],
  );
  const fileInput = useRef<HTMLInputElement>(null),
    clipboard = useRef<DrawingNode[]>([]),
    toolBrushes = useRef<Partial<Record<Tool, Brush>>>(initialPreferences.current.brushes);
  const scene = state.document?.scene;
  // Open on the whole frame. A fixed starting zoom cut the frame off in narrow windows,
  // so its far edge sat under the tool rail.
  const fittedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!scene || fittedFor.current === pageId) return;
    const stage = root.current?.querySelector(".drawing-stage")?.getBoundingClientRect();
    const f = scene.frames[frameId] ?? scene.frames[scene.defaultFrameId];
    if (!stage || stage.width < 80 || stage.height < 80 || !f) return;
    fittedFor.current = pageId;
    const w = stage.width,
      h = stage.height,
      scale = Math.max(0.025, Math.min(1, w / (f.w + 80), h / (f.h + 80)));
    setView((v) => ({ ...v, x: f.x - (w / scale - f.w) / 2, y: f.y - (h / scale - f.h) / 2, w: w / scale, h: h / scale, scale }));
  });
  const selectedVisible = (id: string) =>
    !!scene?.nodes[id] && scene.nodes[id].visible && effectiveLayer(scene, scene.nodes[id].layerId).visible;
  const selected = selectedIds.every(selectedVisible) ? selectedIds : selectedIds.filter(selectedVisible);
  useEffect(() => {
    if (selected !== selectedIds) setSelected(selected);
  }, [scene, selectedIds]);
  const pixelSelection = usePixelSelection(scene ? (scene.frames[frameId] ?? scene.frames[scene.defaultFrameId]) : null),
    selection = pixelSelection.selection;
  const fillTarget = useRef({ frameId, layerId });
  fillTarget.current = { frameId, layerId };
  const selectionAssets = useRef(new Map<string, Promise<Asset>>());
  const arabic = profile?.language === "ar" || (profile?.language === "auto" && navigator.language.startsWith("ar"));
  const t = (en: string, ar: string) => (arabic ? ar : en);
  const actor = profile?.id ?? "";
  const canEdit =
    (access === "full" || access === "edit") &&
    (!sync || sync.level === "edit" || sync.level === "full") &&
    (!liveState?.info?.level || liveState.info.level === "edit" || liveState.info.level === "full") &&
    !!actor &&
    !state.recovered &&
    !state.restoring &&
    sync?.status !== "conflict";
  const canEditNow = useRef(canEdit);
  canEditNow.current = canEdit;
  const pixelEdits = usePixelEdits({
    pageId,
    canEdit,
    selection,
    layerId,
    frameId,
    source: solo ? "current" : pixelSource,
    scene: () => session.snapshot().document?.scene ?? null,
    commit: (label, changes, guard) => commit(label, changes, guard),
    flush: () => session.flush(),
    onApplied: (node, art, action) => {
      if (node) {
        setLayerId(art.layer.id);
        setSelected([node.id]);
        chooseTool("select");
        pixelSelection.controller.clear();
      } else {
        setSelected([]);
        if (action === "cut") pixelSelection.controller.clear();
      }
    },
  });
  const activePane = useStore((s) => s.layout.activePaneId === paneId);
  useEffect(() => {
    const openComment = () => {
      if (!live || !scene || !activePane || liveState?.info?.state !== "synced") return;
      const id = consumeDrawingComment(pageId);
      if (!id) return;
      const thread = liveState.threads.find((thread) => thread.id === id);
      setActiveThread(id);
      setTab("comments");
      setInspector(true);
      setFocus(false);
      if (thread && validDrawingAnchor(thread.anchor)) {
        const location = drawingCommentLocation(scene, thread.anchor);
        live.follow(null);
        openDrawingLocation(pageId, location.frameId, location.region);
      }
    };
    openComment();
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail?.pageId === pageId) openComment();
    };
    window.addEventListener("worlds:drawing-comment", listener);
    return () => window.removeEventListener("worlds:drawing-comment", listener);
  }, [pageId, live, scene, activePane, liveState?.info?.state, liveState?.threads]);
  useEffect(() => {
    if (live && activePane && frameId)
      live.update({ frameId, tool, selected: selected.slice(0, 100), camera: { x: view.x, y: view.y, w: view.w, h: view.h } });
  }, [live, activePane, frameId, tool, selected, view.x, view.y, view.w, view.h, liveState?.ready]);
  useEffect(() => {
    const peer = liveState?.peers.find((peer) => peer.clientId === liveState.following);
    if (!peer || !scene?.frames[peer.presence.frameId] || !activePane) return;
    setFrameId(peer.presence.frameId);
    const camera = peer.presence.camera;
    setView((old) => {
      const width = old.w * old.scale,
        height = old.h * old.scale,
        scale = Math.max(0.025, Math.min(16, width / camera.w, height / camera.h));
      const next = {
        x: camera.x - (width / scale - camera.w) / 2,
        y: camera.y - (height / scale - camera.h) / 2,
        w: width / scale,
        h: height / scale,
        scale,
      };
      return Object.keys(next).every((key) => Math.abs(next[key as keyof Viewport] - old[key as keyof Viewport]) < 0.001) ? old : next;
    });
  }, [liveState?.peers, liveState?.following, scene, activePane]);
  useEffect(() => {
    let alive = true;
    accountApi.pageLevel(pageId).then(
      (level) => {
        if (alive) setAccess(level);
      },
      () => {
        if (alive) setAccess("none");
      },
    );
    return () => {
      alive = false;
    };
  }, [pageId]);
  const patchBrush = (patch: Partial<Brush>) => setBrush((b) => normalizeBrush({ ...b, ...patch }));
  useEffect(() => {
    if (scene && brush.tipAssetId && !scene.assets[brush.tipAssetId])
      setBrush((b) => ({ ...b, tipAssetId: undefined, kind: b.kind === "texture" ? "hard" : b.kind }));
  }, [scene, brush.tipAssetId]);
  const pickColor = (color: string) => {
    patchBrush({ color });
    setRecentColors((recent) => [color, ...recent.filter((value) => value !== color)].slice(0, 12));
  };
  const colorDestination = useRef<Tool>("brush");
  const sampledColor = (color: string) => {
    const target = colorDestination.current;
    toolBrushes.current[target] = normalizeBrush({ ...(toolBrushes.current[target] ?? DEFAULT_BRUSH), color });
    pickColor(color);
  };
  useEffect(() => {
    toolBrushes.current[tool] = brush;
    saveDrawingPreferences(actor || "local", {
      brushes: toolBrushes.current,
      recent: recentColors,
      background: backgroundColor,
      autoShape,
      palette,
      tipPageId: pageId,
      laserLifetime,
    });
  }, [actor, tool, brush, recentColors, backgroundColor, autoShape, palette, pageId, laserLifetime]);
  const chooseTool = (next: Tool) => {
    if (next === "eyedropper" && ["brush", "highlighter", "shape", "text", "fill", "laser"].includes(tool)) colorDestination.current = tool;
    toolBrushes.current[tool] = brush;
    setBrush(
      toolBrushes.current[next] ??
        (next === "highlighter"
          ? { ...DEFAULT_BRUSH, kind: "highlighter", color: "#f5d742", size: 28, opacity: 0.35, pressureSize: false }
          : next === "laser"
            ? { ...DEFAULT_BRUSH, color: "#ef3d35", size: 6 }
            : { ...DEFAULT_BRUSH, color: brush.color }),
    );
    setTool(next);
    if (next === "selection" || next === "laser" || next === "text") {
      setTab("properties");
      if (innerWidth > 1000) setInspector(true);
    }
  };
  useEffect(() => {
    if (!scene) return;
    if (!scene.layers[layerId]) setLayerId(scene.layerOrder.at(-1)!);
    if (!scene.frames[frameId]) setFrameId(scene.defaultFrameId);
  }, [scene, layerId, frameId]);
  useEffect(() => {
    if (tab === "history")
      api
        .drawingVersions(pageId)
        .then(setVersions)
        .catch((e) => toast({ message: errorMessage(e), tone: "error" }));
  }, [tab, pageId, toast]);
  useEffect(() => {
    if (!scene) return;
    const go = () => {
      if (useStore.getState().layout.activePaneId !== paneId) return;
      const location = consumeDrawingLocation(pageId);
      if (!location || !scene.frames[location.frameId]) return;
      setFrameId(location.frameId);
      const size = root.current?.querySelector(".drawing-stage")?.getBoundingClientRect();
      setView((old) => {
        const width = size?.width || old.w * old.scale,
          height = size?.height || old.h * old.scale,
          scale = Math.max(0.025, Math.min(8, width / (location.camera.w + 50), height / (location.camera.h + 50)));
        return {
          x: location.camera.x - (width / scale - location.camera.w) / 2,
          y: location.camera.y - (height / scale - location.camera.h) / 2,
          w: width / scale,
          h: height / scale,
          scale,
        };
      });
    };
    go();
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail?.pageId === pageId) go();
    };
    window.addEventListener("worlds:drawing-location", listener);
    return () => window.removeEventListener("worlds:drawing-location", listener);
  }, [pageId, paneId, scene]);
  const commit = (label: string, changes: Change[], guard?: import("./pixelGuard").PixelGuard, strictBase = false) => {
    const doc = session.snapshot().document;
    if (!lifetime.current.active || !doc || !canEditNow.current || !changes.length) return;
    const projected = layersAfterChanges(doc.scene, changes);
    changes = changes.map((change) => {
      if (change.type !== "put" || change.collection !== "nodes") return change;
      const node = change.value as DrawingNode;
      if (isRedaction(node) || !effectiveLayer(projected, node.layerId).alphaLocked) return change;
      return node.erase ? change : { ...change, value: { ...node, alphaLock: true } };
    });
    if (
      changes.some(
        (change) =>
          change.type === "put" &&
          change.collection === "nodes" &&
          (change.value as DrawingNode).erase &&
          effectiveLayer(projected, (change.value as DrawingNode).layerId).alphaLocked,
      )
    ) {
      toast({ message: t("Layer transparency is locked", "شفافية الطبقة مقفلة"), tone: "error" });
      return null;
    }
    const blocked = nodeChangesBlockedByLayerLocks(doc.scene, projected, changes);
    if (blocked) {
      toast({ message: t("An element or its parent group is locked", "العنصر أو مجموعته الأم مقفل"), tone: "error" });
      return null;
    }
    const operation = edit(actor, doc.revision, label, changes);
    if (guard) operation.pixelGuard = guard;
    if (strictBase) operation.requiresBase = true;
    return session.dispatch(operation) ? operation.id : null;
  };
  const patchNode = (fields: Partial<DrawingNode>) =>
    commit(
      "Edit elements",
      selected.map((id) => ({ type: "patch", collection: "nodes", id, fields })),
    );
  const applyAnnotation = (sourceKey: string, label: string, changes: Change[]) =>
    applyAnnotationEdit(sourceKey, changes, {
      active: () => lifetime.current.active && canEditNow.current,
      current: () => session.snapshot().document?.scene,
      reserve: () => reserveDrawingRoot(pageId),
      commit: (changes) => commit(label, changes, undefined, true),
      flush: () => session.flush(),
    });
  const layerAction = async (label: string, work: (current: DrawingScene) => { changes: Change[]; nextId?: string }) => {
    if (!scene || !canEditNow.current || layerBusy) return;
    const key = mergeSourceKey(scene);
    let lease: import("./gestureLeases").DrawingGestureLease | null = null;
    setLayerBusy(true);
    try {
      lease = await reserveDrawingRoot(pageId);
      if (!canEditNow.current || lease?.state() === "lost") throw Error("layer-lease");
      const current = session.snapshot().document!.scene;
      if (mergeSourceKey(current) !== key) throw Error("layer-stale");
      const result = work(current);
      if (!result.changes.length) {
        lease?.cancel();
        return;
      }
      const operation = commit(label, result.changes);
      if (!operation) throw Error("layer-locked");
      await session.flush();
      lease?.finish([operation]);
      lease = null;
      if (result.nextId) {
        setLayerId(result.nextId);
        if (solo) setSolo(result.nextId);
      }
      setSelected([]);
    } catch (error) {
      lease?.cancel();
      toast({
        message: t(
          "The layer changed, is locked, or could not be reserved. Try again.",
          "تغيّرت الطبقة أو أصبحت مقفلة أو تعذر حجزها. أعد المحاولة.",
        ),
        tone: "error",
      });
    } finally {
      setLayerBusy(false);
    }
  };
  const patchMask = (
    nodeId: string,
    effectId: string | undefined,
    fields: Partial<Pick<import("./model").Mask, "enabled" | "inverted">>,
  ) => {
    if (!scene) return;
    try {
      const current = session.snapshot().document!.scene;
      commit("Edit mask properties", maskPropertyChanges(current, nodeId, effectId, imageCropSourceKey(scene, nodeId), fields));
    } catch (error) {
      toast({
        message: t("The mask changed or is locked. Reopen its editor.", "تغيّر القناع أو أصبح مقفلًا. أعد فتح محرره."),
        tone: "error",
      });
    }
  };
  const moveSelected = async (ids: string[], dx: number, dy: number, before?: DrawingNode[]) => {
    const current = session.snapshot().document!.scene,
      originals = before ?? ids.map((id) => current.nodes[id]).filter(Boolean);
    return applyObjectTransform(originals, translateObjects(current, originals, { x: dx, y: dy }));
  };
  const applyObjectTransform = async (before: DrawingNode[], after: DrawingNode[]) => {
    if (!lifetime.current.active || !canEditNow.current) throw new Error(t("This drawing is read-only", "هذا الرسم للقراءة فقط"));
    const changes = objectTransformChanges(session.snapshot().document!.scene, before, after);
    if (!changes.length) return [];
    const operation = commit("Transform elements", changes);
    if (!operation) throw new Error(t("The transform could not be applied", "تعذر تطبيق التحويل"));
    await session.flush();
    return [operation];
  };
  const addNode = async (node: DrawingNode, correction?: DrawingNode, context?: PaintContext) => {
    const signal = context?.signal,
      clip = context?.selection?.frame.id === node.frameId ? context.selection : null;
    if (signal?.aborted || !lifetime.current.active || !canEditNow.current || clip?.pixels === 0) return;
    let asset: Asset | undefined;
    if (clip) {
      let pending = selectionAssets.current.get(clip.id);
      if (!pending) {
        pending = (async () => {
          const attachment = await api.importBytes(pageId, "paint-selection.png", new Uint8Array(await clip.blob.arrayBuffer())),
            box = clip.imageBounds;
          return { id: id(), attachmentId: attachment.id, name: "Paint selection", mime: "image/png", width: box.w, height: box.h };
        })();
        selectionAssets.current.set(clip.id, pending);
        if (selectionAssets.current.size > 32) selectionAssets.current.delete(selectionAssets.current.keys().next().value!);
        pending.catch(() => selectionAssets.current.delete(clip.id));
      }
      asset = await pending;
    }
    if (signal?.aborted || !lifetime.current.active || !canEditNow.current) return;
    const current = session.snapshot().document!.scene,
      layer = current.layers[node.layerId],
      frame = node.frameId ? current.frames[node.frameId] : null;
    if (!layer || layer.locked) throw new Error(t("The drawing layer changed or is locked", "تغيّرت طبقة الرسم أو أصبحت مقفلة"));
    if (clip && (!frame || ["x", "y", "w", "h"].some((key) => frame[key as "x"] !== clip.frame[key as "x"])))
      throw new Error(t("The frame changed while preparing the stroke. Try again.", "تغيّر الإطار أثناء تجهيز ضربة القلم. أعد المحاولة."));
    const changes: Change[] = [];
    if (asset && !current.assets[asset.id]) changes.push({ type: "put", collection: "assets", id: asset.id, value: asset });
    if (clip && asset) {
      const masked = maskNewPaint(node, clip, asset);
      node = masked.node;
      changes.push(masked.change);
    }
    const operation = commit(node.name, [...changes, ...putNode(current, node)]);
    if (!operation) throw new Error(t("The stroke could not be applied", "تعذر تطبيق ضربة القلم"));
    setSelected([node.id]);
    if (correction) {
      const extra: Change[] = [];
      if (clip && asset) {
        const masked = maskNewPaint(correction, clip, asset);
        correction = masked.node;
        extra.push(masked.change);
      }
      const { id: _id, ...fields } = correction;
      commit("Correct hand-drawn shape", [...extra, { type: "patch", collection: "nodes", id: node.id, fields }]);
    }
    await session.flush();
  };
  const selectRegion = (points: Point[], mode: SelectionMode, kind: SelectionKind = selectionKind) => {
    if (!scene || !points.length) return;
    setSelected([]);
    const frame = scene.frames[frameId] ?? scene.frames[scene.defaultFrameId];
    if (kind !== "magic") {
      void pixelSelection.controller.run(
        { kind: "shape", shape: kind, points: points.map((p) => ({ x: p.x - frame.x, y: p.y - frame.y })) },
        mode,
      );
      return;
    }
    const source = session.snapshot().document!;
    void pixelSelection.controller.run(async (frame, signal) => {
      const width = Math.ceil(frame.w),
        height = Math.ceil(frame.h);
      validatePixelDimensions(width, height);
      const renderer = new DrawingRenderer(),
        canvas = document.createElement("canvas");
      try {
        await renderer.prepare(source.scene);
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        canvas.width = width;
        canvas.height = height;
        renderer.render(
          canvas,
          source.scene,
          { ...frame, scale: 1 },
          { frameId: frame.id, layerId: merged && !solo ? undefined : layerId, background: merged && !solo },
        );
        if (session.snapshot().document!.revision !== source.revision) throw new Error("The selection source changed");
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height);
        return {
          kind: "magic",
          image: { width, height, data: pixels.data },
          point: { x: points[0].x - frame.x, y: points[0].y - frame.y },
          tolerance,
          contiguous,
        };
      } finally {
        renderer.dispose();
        canvas.width = canvas.height = 1;
      }
    }, mode);
  };
  const fill = async (point: Point) => {
    if (!canEditNow.current || fillApplying) return;
    setFillPreview(null);
    const selectionId = selection?.id ?? null;
    const targetUnchanged = () => {
      const currentSelection = pixelSelection.controller.snapshot();
      return (
        !currentSelection.busy &&
        (currentSelection.selection?.id ?? null) === selectionId &&
        fillTarget.current.frameId === frameId &&
        fillTarget.current.layerId === layerId
      );
    };
    if (!targetUnchanged()) return;
    const current = session.snapshot().document;
    if (!current) return;
    const s = structuredClone(current.scene),
      frame = s.frames[frameId],
      layer = s.layers[layerId];
    if (!frame || !layer || effectiveLayer(s, layerId).locked) return;
    const renderer = new DrawingRenderer(),
      controller = new AbortController();
    task.current?.abort();
    task.current = controller;
    const abort = () => renderer.dispose();
    controller.signal.addEventListener("abort", abort, { once: true });
    const canvas = document.createElement("canvas");
    try {
      setBusy(true);
      await renderer.prepare(s);
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      validatePixelDimensions(Math.ceil(frame.w), Math.ceil(frame.h));
      canvas.width = Math.ceil(frame.w);
      canvas.height = Math.ceil(frame.h);
      renderer.render(
        canvas,
        s,
        { ...frame, scale: 1 },
        { frameId, layerId: merged && !solo ? undefined : layerId, background: merged && !solo },
      );
      const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      const color: [number, number, number, number] = [
        parseInt(brush.color.slice(1, 3), 16),
        parseInt(brush.color.slice(3, 5), 16),
        parseInt(brush.color.slice(5, 7), 16),
        Math.round(brush.opacity * (brush.color.length === 9 ? parseInt(brush.color.slice(7, 9), 16) : 255)),
      ];
      const result = await runPixelTask(
        {
          kind: "fill",
          image: { width: canvas.width, height: canvas.height, data: image.data },
          x: point.x - frame.x,
          y: point.y - frame.y,
          tolerance,
          contiguous,
          color,
          grow: fillGrow,
          selection: selection?.frame.id === frameId ? selection.mask : undefined,
        },
        controller.signal,
      );
      const pixels = trimTransparent(result);
      if (!pixels) return;
      if (controller.signal.aborted) return;
      if (session.snapshot().document!.revision !== current.revision || !targetUnchanged())
        throw new Error(t("The drawing, selection or target changed. Fill again.", "تغيّر الرسم أو التحديد أو الطبقة. أعد التعبئة."));
      const blob = await pixelsToPng(pixels.width, pixels.height, pixels.data);
      if (controller.signal.aborted || !lifetime.current.active) return;
      if (session.snapshot().document?.revision !== current.revision || !targetUnchanged())
        throw new Error(t("The drawing, selection or target changed. Fill again.", "تغيّر الرسم أو التحديد أو الطبقة. أعد التعبئة."));
      setFillPreview({
        url: URL.createObjectURL(blob),
        blob,
        revision: current.revision,
        frameId,
        layerId,
        selectionId,
        x: frame.x + pixels.x,
        y: frame.y + pixels.y,
        w: pixels.width,
        h: pixels.height,
        alphaLock: effectiveLayer(s, layerId).alphaLocked,
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast({ message: errorMessage(e), tone: "error" });
    } finally {
      controller.signal.removeEventListener("abort", abort);
      renderer.dispose();
      canvas.width = canvas.height = 1;
      if (task.current === controller) {
        task.current = null;
        setBusy(false);
      }
    }
  };
  const applyFill = async () => {
    const draft = fillPreview;
    if (!draft || fillApplying || !canEditNow.current) return;
    const unchanged = () => {
      const currentSelection = pixelSelection.controller.snapshot();
      return (
        lifetime.current.active &&
        canEditNow.current &&
        session.snapshot().document?.revision === draft.revision &&
        !currentSelection.busy &&
        (currentSelection.selection?.id ?? null) === draft.selectionId &&
        fillTarget.current.frameId === draft.frameId &&
        fillTarget.current.layerId === draft.layerId
      );
    };
    try {
      setFillApplying(true);
      if (!unchanged()) throw new Error(t("The drawing changed. Cancel and fill again.", "تغيّر الرسم. ألغِ المعاينة ثم أعد التعبئة."));
      const attachment = await api.importBytes(pageId, "fill.png", new Uint8Array(await draft.blob.arrayBuffer()));
      if (!unchanged()) throw new Error(t("The drawing changed. Cancel and fill again.", "تغيّر الرسم. ألغِ المعاينة ثم أعد التعبئة."));
      const aid = id(),
        node = newNode("raster", draft.layerId, draft.frameId, { x: draft.x, y: draft.y, w: draft.w, h: draft.h });
      node.name = "Fill";
      node.assetId = aid;
      node.alphaLock = draft.alphaLock;
      const op = commit(
        "Fill region",
        [
          {
            type: "put",
            collection: "assets",
            id: aid,
            value: { id: aid, attachmentId: attachment.id, name: "Fill", mime: "image/png", width: draft.w, height: draft.h },
          },
          ...putNode(session.snapshot().document!.scene, node),
        ],
        undefined,
        true,
      );
      if (!op) throw new Error(t("The fill could not be applied.", "تعذر تطبيق التعبئة."));
      setSelected([node.id]);
      setFillPreview(null);
    } catch (e) {
      toast({ message: errorMessage(e), tone: "error" });
    } finally {
      if (lifetime.current.active) setFillApplying(false);
    }
  };
  const undo = (redo = false) => {
    const doc = session.snapshot().document;
    if (!doc || !canEdit) return;
    void session.undo(actor, redo).catch((error) => toast({ message: errorMessage(error), tone: "error" }));
  };
  const importImage = async (file: File) => {
    if (!scene || !canEditNow.current) return;
    if (file.name.toLowerCase().endsWith(".worldsdraw")) {
      setPackageFile(file);
      return;
    }
    await pixelEdits.prepareImage(file, "import");
  };
  const pasteImageRef = useRef(pixelEdits.prepareImage);
  pasteImageRef.current = pixelEdits.prepareImage;
  const importBrushTip = async (file: File) => {
    const destinationTool = tool,
      originalBrush = brush;
    if (!canEdit) throw new Error(t("This drawing is read-only", "هذا الرسم للقراءة فقط"));
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || file.size > 16 * 1024 * 1024)
      throw new Error(t("Choose a PNG, JPEG, WebP or BMP tip up to 16 MB", "اختر رأسًا بصيغة PNG أو JPEG أو WebP أو BMP حتى 16 ميجابايت"));
    const decoded = await decodeBrushTip(file).catch((error: unknown) => {
      if (!(error instanceof ImageHeaderError)) throw error;
      if (error.code === "dimensions")
        throw new Error(t("The tip must be at most 2048 by 2048 pixels", "أبعاد الرأس يجب ألا تتجاوز 2048 × 2048 بكسل"));
      if (error.code === "animation") throw new Error(t("Choose a static image for the brush tip", "اختر صورة ثابتة لرأس الفرشاة"));
      throw new Error(t("The image header is incomplete or unsupported", "ترويسة الصورة ناقصة أو غير مدعومة"));
    });
    const { image, bytes, header } = decoded;
    try {
      if (image.width > 2048 || image.height > 2048)
        throw new Error(t("The tip must be at most 2048 by 2048 pixels", "أبعاد الرأس يجب ألا تتجاوز 2048 × 2048 بكسل"));
      if (!lifetime.current.active) return;
      const attachment = await api.importBytes(pageId, file.name, bytes);
      const asset = { id: id(), attachmentId: attachment.id, name: file.name, mime: header.mime, width: image.width, height: image.height };
      if (!commit("Import brush tip", [{ type: "put", collection: "assets", id: asset.id, value: asset }]))
        throw new Error(t("The brush tip could not be added to this drawing", "تعذرت إضافة رأس الفرشاة إلى الرسم"));
      await session.flush();
      if (!lifetime.current.active) return;
      const next = normalizeBrush({ ...originalBrush, kind: "texture", tipAssetId: asset.id });
      toolBrushes.current[destinationTool] = next;
      if (currentTool.current === destinationTool) setBrush(next);
    } finally {
      image.close();
    }
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const store = useStore.getState(),
        pane = store.layout.panes.find((p) => p.id === store.layout.activePaneId),
        route = pane?.tabs.find((tab) => tab.id === pane.activeTabId)?.route;
      if (
        e.defaultPrevented ||
        !canEditNow.current ||
        pixelEdits.busy ||
        pixelEdits.draft ||
        fillPreview ||
        fillApplying ||
        busy ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (store.layout.activePaneId !== paneId) return;
      if (route?.kind !== "page" || route.pageId !== pageId) return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[role="listbox"]',
        )
      )
        return;
      const data = e.clipboardData;
      const file =
        [...(data?.files ?? [])].find((f) => f.type.startsWith("image/")) ??
        [...(data?.items ?? [])]
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .find((item): item is File => !!item);
      if (file) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void pasteImageRef.current(file, "paste");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pageId, paneId, pixelEdits.busy, pixelEdits.draft, fillPreview, fillApplying, busy]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const store = useStore.getState(),
        pane = store.layout.panes.find((p) => p.id === store.layout.activePaneId),
        route = pane?.tabs.find((tab) => tab.id === pane.activeTabId)?.route;
      const isActive = store.layout.activePaneId === paneId && route?.kind === "page" && route.pageId === pageId;
      const modalOpen = !!document.querySelector('[role="dialog"]');
      if (!scene || !isActive || modalOpen || e.isComposing || e.defaultPrevented) return;
      if (
        (e.target as Element | null)?.closest?.(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="listbox"]',
        )
      )
        return;
      if (e.key === "Escape") {
        if (fillPreview && !fillApplying) {
          setFillPreview(null);
          return;
        }
        if (task.current) {
          task.current.abort();
          return;
        }
        setSelected([]);
        if (pixelSelection.busy) pixelSelection.controller.cancel();
        if (pixelEdits.busy && !pixelEdits.saving) pixelEdits.cancel();
        return;
      }
      const action = drawingShortcutAction(e, shortcuts, { activePane: isActive, modalOpen });
      if (!action) {
        if ((e.ctrlKey || e.metaKey) && shortcutKey(e) === "v" && !e.shiftKey && shortcuts.paste !== "Mod+v") e.preventDefault();
        return;
      }
      if (action === "paste" && !clipboard.current.length && (e.ctrlKey || e.metaKey) && shortcutKey(e) === "v" && !e.shiftKey) return;
      if ((action === "copy" || action === "cut") && !selection && !selected.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const tools: Partial<Record<typeof action, Tool>> = {
        move: "select",
        brush: "brush",
        eraser: "eraser",
        highlighter: "highlighter",
        laser: "laser",
        shape: "shape",
        text: "text",
        eyedropper: "eyedropper",
        fill: "fill",
        redact: "redact",
        selection: "selection",
        lasso: "selection",
      };
      const next = tools[action];
      if (next) {
        if (action === "lasso") setSelectionKind("lasso");
        chooseTool(next);
        return;
      }
      switch (action) {
        case "selectAll":
          if (tool === "selection") void pixelSelection.controller.run({ kind: "all" });
          else
            setSelected(
              scene.nodeOrder.filter(
                (id) => scene.nodes[id].visible && !scene.nodes[id].locked && !effectiveLayer(scene, scene.nodes[id].layerId).locked,
              ),
            );
          break;
        case "invert":
          if (tool === "selection" || selection) void pixelSelection.controller.run({ kind: "invert" });
          break;
        case "undo":
          undo();
          break;
        case "redo":
          undo(true);
          break;
        case "copy":
        case "cut":
          if (selection) {
            clipboard.current = [];
            void pixelEdits.run(action);
          } else {
            clipboard.current = selected.map((id) => structuredClone(scene.nodes[id])).filter(Boolean);
            if (action === "cut") {
              commit("Cut elements", removeNodes(scene, selected));
              setSelected([]);
            }
          }
          break;
        case "paste":
          if (clipboard.current.length) {
            const copied = duplicateElements(
              { ...scene, nodes: { ...scene.nodes, ...Object.fromEntries(clipboard.current.map((n) => [n.id, n])) } },
              clipboard.current.map((n) => n.id),
            );
            commit("Paste elements", copied.changes);
            setSelected(copied.nodes.map((n) => n.id));
          } else void pixelEdits.prepareImage();
          break;
        case "save":
          void session.flush();
          break;
        case "deselect":
          setSelected([]);
          pixelSelection.controller.clear();
          break;
        case "fit":
        case "actualSize": {
          const f = scene.frames[frameId] ?? scene.frames[scene.defaultFrameId],
            bounds = root.current?.querySelector(".drawing-stage")?.getBoundingClientRect(),
            w = bounds?.width ?? view.w * view.scale,
            h = bounds?.height ?? view.h * view.scale,
            scale = action === "actualSize" ? 1 : Math.max(0.025, Math.min(16, w / (f.w + 80), h / (f.h + 80)));
          setView({ ...view, x: f.x - (w / scale - f.w) / 2, y: f.y - (h / scale - f.h) / 2, w: w / scale, h: h / scale, scale });
          break;
        }
        case "smaller":
          patchBrush({ size: Math.max(1, brush.size - 2) });
          break;
        case "larger":
          patchBrush({ size: Math.min(2048, brush.size + 2) });
          break;
        case "delete":
          if (selection) void pixelEdits.run("delete");
          else {
            commit("Delete elements", removeNodes(scene, selected));
            setSelected([]);
          }
          break;
        case "swap": {
          const old = brush.color;
          pickColor(backgroundColor);
          setBackgroundColor(old);
          break;
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  const exportImage = () => {
    if (scene) setExportScene(structuredClone(scene));
  };
  if (state.loading)
    return (
      <div className="page-loading">
        <Spinner />
      </div>
    );
  if ((sync?.status === "denied" && sync.level === "none") || (liveState?.ready && liveState.info?.level === "none"))
    return (
      <EmptyState
        icon="lock"
        title={t("Drawing access is unavailable", "الرسم غير متاح حاليًا")}
        text={sync?.error ?? liveState?.info?.error ?? ""}
        action={<Button onClick={() => void retryDrawingSync(pageId)}>{t("Check access", "التحقق من الوصول")}</Button>}
      />
    );
  if (!scene || !meta)
    return (
      <EmptyState
        icon="warning"
        title={t("This drawing could not be opened", "تعذر فتح الرسم")}
        text={
          state.error?.startsWith("Recovery storage is unavailable.")
            ? t(
                "Recovery storage is unavailable. Free space or restore storage access, then retry. Your recovery data has not been replaced.",
                "تعذر الوصول إلى مساحة الاسترداد. وفر مساحة أو أصلح الوصول للتخزين، ثم أعد المحاولة. لم تُستبدل بيانات الاسترداد.",
              )
            : (state.error ?? "")
        }
        action={
          !scene && state.error ? (
            <Button onClick={() => void session.retryLoad()}>{t("Retry opening", "إعادة فتح الرسم")}</Button>
          ) : undefined
        }
      />
    );
  const currentFrame = scene.frames[frameId] ?? scene.frames[scene.defaultFrameId];
  const currentLayer = scene.layers[layerId] ?? scene.layers[scene.layerOrder[0]];
  const one = selected.length === 1 ? scene.nodes[selected[0]] : undefined;
  const unsupportedEffectNode = scene.nodeOrder
    .map((id) => scene.nodes[id])
    .find((node) => node?.visible && effectiveLayer(scene, node.layerId).visible && unsupportedVectorEffects(node));
  const text = (point: Point, existing?: DrawingNode, owner?: string | null) => {
    const node =
      existing ?? newNode("text", currentLayer.id, owner === undefined ? frameAt(scene, point) : owner, { ...point, w: 360, h: 130 });
    if (!existing) node.textStyle.color = brush.color;
    setTextEdit({ node, value: existing?.text ?? "" });
  };
  return (
    <div ref={root} className={`drawing-view ${focus ? "is-focus" : ""}`} dir={arabic ? "rtl" : "ltr"}>
      {!focus && (
        <ResourceHeader
          meta={meta}
          subtitle={
            <span role="status">
              {state.error
                ? t("Save needs attention", "الحفظ يحتاج مراجعة")
                : state.saving
                  ? t("Saving", "جارٍ الحفظ")
                  : state.pending
                    ? t("Waiting to save", "بانتظار الحفظ")
                    : sync
                      ? {
                          connecting: t("Connecting", "جارٍ الاتصال"),
                          pending: t("Waiting to synchronize", "بانتظار المزامنة"),
                          synced: t("Synchronized", "تمت المزامنة"),
                          offline: t("Saved locally, offline", "محفوظ محليًا، دون اتصال"),
                          conflict: t("Your changes need review", "تعديلاتك تحتاج مراجعة"),
                          denied: t("Read only, pending changes kept", "للقراءة فقط، تعديلاتك محفوظة"),
                        }[sync.status]
                      : t("Saved locally", "محفوظ محليًا")}
            </span>
          }
          actions={
            <>
              <Button
                icon="monitor"
                variant="quiet"
                disabled={!canEdit || capturingScreen}
                onClick={async () => {
                  try {
                    setCapturingScreen(true);
                    await session.flush();
                    if (session.snapshot().pending)
                      throw new Error(t("Save the drawing before capturing the screen", "احفظ الرسم قبل التقاط الشاشة"));
                    const capture = await invoke<CapturedScreen>("capture_screen_for_drawing");
                    if (!lifetime.current.active) {
                      await invoke("end_screen_drawing", { wasFullscreen: capture.wasFullscreen });
                      return;
                    }
                    setScreenCapture(capture);
                  } catch (e) {
                    toast({ message: errorMessage(e), tone: "error" });
                  } finally {
                    setCapturingScreen(false);
                  }
                }}
              >
                {t("Draw on screen", "الرسم على الشاشة")}
              </Button>
              <Button icon="keyboard" variant="quiet" onClick={() => setShortcutsOpen(true)}>
                {t("Shortcuts", "الاختصارات")}
              </Button>
              <Button icon="undo" variant="quiet" onClick={() => undo()}>
                {t("Undo", "تراجع")}
              </Button>
              <Button icon="redo" variant="quiet" onClick={() => undo(true)}>
                {t("Redo", "إعادة")}
              </Button>
              <Button icon="download" loading={busy} onClick={exportImage}>
                {t("Export", "تصدير")}
              </Button>
            </>
          }
        />
      )}
      <div className="drawing-options">
        <span className="drawing-active-tool">{TOOLS.find((x) => x.id === tool)?.[arabic ? "ar" : "label"]}</span>
        {(tool === "brush" || tool === "eraser") && <BrushStylePicker brush={brush} arabic={arabic} onChange={setBrush} />}
        {tool === "eraser" && (
          <Button
            size="compact"
            disabled={
              !canEdit ||
              !one ||
              one.erase ||
              isRedaction(one) ||
              one.locked ||
              effectiveLayer(scene, one.layerId).locked ||
              pixelEdits.busy ||
              !!pixelEdits.draft
            }
            onClick={() => one && setMaskTarget({ nodeId: one.id, erase: true })}
          >
            {t("Erase selected with mask", "محو العنصر المحدد بقناع")}
          </Button>
        )}
        {tool !== "redact" && (
          <DrawingColors
            color={brush.color}
            background={backgroundColor}
            recent={recentColors}
            palette={palette}
            arabic={arabic}
            onColor={pickColor}
            onBackground={setBackgroundColor}
          />
        )}
        {tool === "eyedropper" && (
          <Field label={t("Color source", "مصدر اللون")}>
            <select
              disabled={!!solo}
              value={sampleMerged && !solo ? "merged" : "current"}
              onChange={(e) => setSampleMerged(e.target.value === "merged")}
            >
              <option value="merged">{t("Visible merged appearance", "المظهر المرئي المدمج")}</option>
              <option value="current">{t("Current layer before opacity", "الطبقة الحالية قبل الشفافية")}</option>
            </select>
          </Field>
        )}
        {tool !== "redact" && (
          <Range label={t("Size", "الحجم")} value={brush.size} onChange={(size) => patchBrush({ size })} min={1} max={2048} step={1} />
        )}
        {tool !== "redact" && (
          <Range label={t("Opacity", "الشفافية")} value={brush.opacity} onChange={(opacity) => patchBrush({ opacity })} />
        )}
        <IconButton
          icon="upload"
          label={t("Import image", "إضافة صورة")}
          disabled={!canEdit || pixelEdits.busy || !!pixelEdits.draft}
          onClick={() => fileInput.current?.click()}
        />
        <small>{t("SVG imports as a static image", "يُستورد SVG كصورة ثابتة")}</small>
        <Button size="compact" variant="quiet" aria-pressed={minimap} onClick={() => setMinimap((value) => !value)}>
          {t("Minimap", "الخريطة المصغرة")}
        </Button>
        <Button
          size="compact"
          variant="quiet"
          icon="image"
          disabled={!canEdit || pixelEdits.busy || !!pixelEdits.draft}
          onClick={() => void pixelEdits.prepareImage()}
        >
          {t("Paste image", "لصق صورة")}
        </Button>
        <IconButton icon="expand" label={t("Focus mode", "وضع التركيز")} active={focus} onClick={() => setFocus(!focus)} />
        <IconButton icon="layers" label={t("Inspector", "الخصائص")} active={inspector} onClick={() => setInspector(!inspector)} />
        {busy && task.current && (
          <Button size="compact" onClick={() => task.current?.abort()}>
            {t("Cancel", "إلغاء")}
          </Button>
        )}
        <input
          hidden
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/svg+xml,.svg,.worldsdraw"
          onChange={(e) => {
            if (e.target.files?.[0]) void importImage(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </div>
      {sync?.leases?.some((lease) => !lease.mine) && (
        <div className="drawing-reservations" role="status">
          {sync.leases
            .filter((lease) => !lease.mine)
            .map((lease) => {
              const [kind, key] = [lease.target.slice(0, lease.target.indexOf(":")), lease.target.slice(lease.target.indexOf(":") + 1)];
              const name =
                kind === "node"
                  ? scene.nodes[key]?.name
                  : kind === "layer"
                    ? scene.layers[key]?.name
                    : kind === "frame"
                      ? scene.frames[key]?.name
                      : undefined;
              const owner = liveState?.peers.find((peer) => peer.user.id === lease.userId)?.user.name ?? t("another member", "عضو آخر");
              return (
                <span key={lease.target}>
                  <Icon name="lock" size={14} />
                  {t(`${name || "Drawing region"} is reserved by ${owner}`, `${name || "منطقة الرسم"} محجوزة لدى ${owner}`)}
                </span>
              );
            })}
        </div>
      )}
      {gestureState && (
        <div className="drawing-gesture-state" role="status">
          {
            {
              waiting: t("Reserving selected elements", "جارٍ حجز العناصر المحددة"),
              locked: t("Reserved for your edit", "العناصر محجوزة لتعديلك"),
              offline: t("Offline edit, kept locally until synchronization", "تعديل دون اتصال، يُحفظ محليًا حتى المزامنة"),
              lost: t("Reservation unavailable; the element has not moved", "الحجز غير متاح، لم يُنقل العنصر"),
            }[gestureState]
          }
        </div>
      )}
      {state.error && (
        <div className="drawing-error" role="alert">
          <span>{state.error}</span>
          <Button size="compact" onClick={() => session.flush()}>
            {t("Retry save", "إعادة الحفظ")}
          </Button>
        </div>
      )}
      {live && (
        <div className="drawing-live-toolbar" aria-label={t("People in this drawing", "الموجودون في الرسم")}>
          <Button
            size="compact"
            icon="bell"
            aria-label={t("Notifications", "الإشعارات")}
            onClick={(event) => setNotificationBell(event.currentTarget)}
          >
            {unread || t("Notifications", "الإشعارات")}
          </Button>
          <span role="status">
            {liveState?.info?.state === "synced" ? t("Live", "متصل") : t("Connecting collaboration", "جارٍ اتصال التعاون")}
          </span>
          {liveState?.peers.map((peer) => (
            <span key={peer.clientId} className="drawing-live-peer">
              <Button
                size="compact"
                icon="users"
                variant="quiet"
                title={t(`Follow ${peer.user.name}`, `متابعة ${peer.user.name}`)}
                disabled={peer.presence.following !== null}
                onClick={() => live.follow(peer.clientId)}
              >
                {peer.user.name}
              </Button>
              {peer.presence.location && (
                <IconButton
                  icon="preview"
                  label={t(`Show ${peer.user.name}'s shared location`, `عرض الموضع الذي شاركه ${peer.user.name}`)}
                  onClick={() => {
                    const location = peer.presence.location!;
                    live.follow(null);
                    openDrawingLocation(pageId, location.frameId, location.camera);
                  }}
                />
              )}
            </span>
          ))}
          {liveState?.following !== null && liveState?.following !== undefined && (
            <Button size="compact" icon="close" onClick={() => live.follow(null)}>
              {t("Stop following", "إيقاف المتابعة")}
            </Button>
          )}
          <Button
            size="compact"
            icon="preview"
            onClick={() =>
              live.update({
                location: { frameId: currentFrame.id, camera: { x: view.x, y: view.y, w: view.w, h: view.h }, sequence: Date.now() },
              })
            }
          >
            {t("Share my location", "مشاركة موضعي")}
          </Button>
        </div>
      )}
      {(sync?.error || (state.recovered && sync)) && (
        <div className="drawing-error" role="alert">
          <span>
            {sync?.status === "conflict" || state.recovered
              ? t(
                  "Your drawing is preserved. Save an independent copy before adopting shared changes.",
                  "رسمك محفوظ. احفظ نسخة مستقلة قبل اعتماد التعديلات المشتركة.",
                )
              : sync?.error}
          </span>
          {sync?.status === "conflict" || state.recovered ? (
            <Button
              size="compact"
              icon="duplicate"
              onClick={() => setRecoveryName(`${meta.title || t("Drawing", "رسم")} (${t("recovered", "نسخة مسترجعة")})`)}
            >
              {t("Resolve conflict", "معالجة التعارض")}
            </Button>
          ) : (
            <Button size="compact" onClick={() => void retryDrawingSync(pageId)}>
              {t("Retry synchronization", "إعادة المزامنة")}
            </Button>
          )}
        </div>
      )}
      {unsupportedEffectNode && (
        <div className="drawing-error" role="alert">
          <span>
            {t(
              "An element uses an adjustment that cannot be rendered correctly yet. Disable or remove it to export this drawing.",
              "يحتوي عنصر على تعديل لا يمكن عرضه بشكل صحيح بعد. عطّل التعديل أو أزله لتصدير الرسم.",
            )}
          </span>
          <Button
            size="compact"
            onClick={() => {
              setSelected([unsupportedEffectNode.id]);
              setInspector(true);
              setFocus(false);
              setTab("properties");
            }}
          >
            {t("Show element", "عرض العنصر")}
          </Button>
        </div>
      )}
      {fillPreview && (
        <div className="drawing-pixel-progress" role="status">
          <span>{t("Fill preview", "معاينة التعبئة")}</span>
          <Button size="compact" disabled={fillApplying || !canEdit} onClick={() => void applyFill()}>
            {t("Apply", "تطبيق")}
          </Button>
          <Button size="compact" disabled={fillApplying} onClick={() => setFillPreview(null)}>
            {t("Cancel", "إلغاء")}
          </Button>
        </div>
      )}
      {!pixelEdits.draft && tool !== "selection" && pixelEdits.busy && (
        <div className="drawing-pixel-progress" role="status">
          {pixelEdits.saving ? t("Saving pixels", "جارٍ حفظ البكسلات") : t("Preparing image", "جارٍ تجهيز الصورة")}
          {!pixelEdits.saving && (
            <Button size="compact" onClick={pixelEdits.cancel}>
              {t("Cancel", "إلغاء")}
            </Button>
          )}
        </div>
      )}
      {!pixelEdits.draft && tool !== "selection" && !!pixelEdits.error && (
        <div className="drawing-error" role="alert">
          <span>{pixelEditMessage(pixelEdits.error, arabic)}</span>
          <Button size="compact" onClick={pixelEdits.cancel}>
            {t("Dismiss", "إغلاق")}
          </Button>
        </div>
      )}
      <div className="drawing-workspace">
        <div className="drawing-tools" role="toolbar" aria-label={t("Drawing tools", "أدوات الرسم")}>
          {TOOLS.map((item) => (
            <button
              key={item.id}
              title={`${arabic ? item.ar : item.label}${shortcuts[item.id === "select" ? "move" : item.id] ? ` (${shortcuts[item.id === "select" ? "move" : item.id]})` : ""}`}
              aria-label={arabic ? item.ar : item.label}
              aria-pressed={tool === item.id}
              onClick={() => chooseTool(item.id)}
            >
              <span aria-hidden>{item.glyph}</span>
              <small>{arabic ? item.ar : item.label}</small>
            </button>
          ))}
        </div>
        <DrawingStage
          keyboardActive={activePane}
          minimap={minimap}
          onTransform={applyObjectTransform}
          onTransformRequest={() => setShowTransform(true)}
          onObjectTransformDraft={(ids, transform) => {
            if (activePane)
              live?.update({ draft: transform ? transformingDrawingDraft(scene, ids, transform, ++laserSequence.current) : null });
          }}
          onTransformDraft={(ids, delta) => {
            if (activePane) live?.update({ draft: delta ? movingDrawingDraft(scene, ids, delta, ++laserSequence.current) : null });
          }}
          onBeginEdit={(ids) => beginDrawingGesture(pageId, ids)}
          onLeaseState={setGestureState}
          onDraft={(node, clip) => {
            if (activePane)
              live?.update({
                draft: node
                  ? drawingDraft(
                      node,
                      ++laserSequence.current,
                      clip && clip.frame.id === node.frameId ? selectionPresenceMask(clip) : undefined,
                    )
                  : null,
              });
          }}
          peers={liveState?.peers}
          onInteraction={() => live?.follow(null)}
          onPointer={(cursor) => {
            if (activePane) live?.update({ cursor });
          }}
          onLaser={(stroke) =>
            live?.update({
              laser: stroke
                ? {
                    id: stroke.id,
                    color: stroke.color,
                    width: stroke.width,
                    opacity: stroke.opacity ?? 1,
                    points: stroke.points.slice(-256).map((p) => ({ ...p })),
                    released: stroke.releasedAt !== null,
                    lifetime: stroke.lifetime,
                    sequence: ++laserSequence.current,
                  }
                : null,
            })
          }
          commentPins={liveState?.threads.flatMap((thread) => {
            if (thread.resolved || !validDrawingAnchor(thread.anchor)) return [];
            const location = drawingCommentLocation(scene, thread.anchor);
            return location.frameId === currentFrame.id
              ? [{ id: thread.id, point: location.point, label: t("Open comment", "فتح التعليق") }]
              : [];
          })}
          onComment={(id) => {
            setActiveThread(id);
            setTab("comments");
            setInspector(true);
            setFocus(false);
          }}
          scene={scene}
          fillPreview={fillPreview?.frameId === frameId ? fillPreview : null}
          editable={canEdit && !pixelEdits.busy && !pixelEdits.draft && !fillPreview && !busy}
          onError={(message) => toast({ message, tone: "error" })}
          tool={tool}
          brush={brush}
          shape={shape}
          layerId={currentLayer.id}
          frameId={currentFrame.id}
          selected={selected}
          view={view}
          autoShape={autoShape}
          laserLifetime={laserLifetime}
          onView={setView}
          onResize={(width, height) => setView((old) => ({ ...old, w: width / old.scale, h: height / old.scale }))}
          onSelect={setSelected}
          onAdd={addNode}
          onText={text}
          isolatedLayerId={solo ?? undefined}
          sampleMerged={sampleMerged && !solo}
          onColor={sampledColor}
          onFill={(point) => void fill(point)}
          onRegion={(points, mode, kind) => selectRegion(points, mode, kind)}
          selectionKind={selectionKind}
          selectionMode={selectionMode}
          pixelSelection={selection?.frame.id === currentFrame.id ? selection : null}
          onMove={moveSelected}
        />
        {inspector && !focus && (
          <div className="drawing-panel" style={{ width: panelWidth }}>
            <PanelResize width={panelWidth} onChange={setPanelWidth} arabic={arabic} />
            <aside className="drawing-inspector">
              <div className="drawing-tabs">
                {(["layers", "frames", "properties", "history", "steps", "experiments", "library", "links", "comments"] as const).map(
                  (value) => (
                    <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
                      {t(
                        value[0].toUpperCase() + value.slice(1),
                        {
                          layers: "الطبقات",
                          frames: "الإطارات",
                          properties: "الخصائص",
                          history: "الإصدارات",
                          steps: "الخطوات",
                          experiments: "التجارب",
                          library: "المكتبة",
                          links: "الروابط",
                          comments: "التعليقات",
                        }[value],
                      )}
                    </button>
                  ),
                )}
              </div>
              {tab === "layers" && (
                <>
                  <Button
                    icon="add"
                    size="compact"
                    disabled={!canEdit || layerBusy}
                    onClick={() => {
                      const layer = newLayer(t(`Layer ${scene.layerOrder.length + 1}`, `طبقة ${scene.layerOrder.length + 1}`));
                      commit("Add layer", [
                        { type: "put", collection: "layers", id: layer.id, value: layer },
                        { type: "order", list: "layerOrder", ids: [...scene.layerOrder, layer.id] },
                      ]);
                      setLayerId(layer.id);
                    }}
                  >
                    {t("Add layer", "إضافة طبقة")}
                  </Button>
                  <LayerBrowser
                    scene={scene}
                    currentId={currentLayer.id}
                    frameId={currentFrame.id}
                    solo={solo}
                    arabic={arabic}
                    editable={canEdit && !layerBusy}
                    onChange={commit}
                    onSelect={(id) => {
                      setLayerId(id);
                      if (solo) setSolo(id);
                      setSelected([]);
                    }}
                    onSolo={(id) => {
                      setSolo(id);
                      setSelected([]);
                    }}
                  />
                  <fieldset disabled={!canEdit || layerBusy} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>
                    <Field label={t("Layer name", "اسم الطبقة")}>
                      <input
                        value={currentLayer.name}
                        onChange={(e) =>
                          commit("Rename layer", [
                            { type: "patch", collection: "layers", id: currentLayer.id, fields: { name: e.target.value } },
                          ])
                        }
                      />
                    </Field>
                    <Field label={t("Parent group", "المجموعة الأم")}>
                      <select
                        value={currentLayer.parentId ?? ""}
                        disabled={!canEdit || effectiveLayer(scene, currentLayer.id).locked}
                        onChange={(e) =>
                          commit("Change layer parent", [
                            { type: "patch", collection: "layers", id: currentLayer.id, fields: { parentId: e.target.value || null } },
                          ])
                        }
                      >
                        <option value="">{t("No parent", "دون مجموعة")}</option>
                        {layerDisplayOrder(scene)
                          .filter((id) => !layerDescendants(scene, currentLayer.id).has(id))
                          .map((id) => (
                            <option key={id} value={id}>
                              {scene.layers[id].name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <label className="drawing-check">
                      <input
                        type="checkbox"
                        checked={currentLayer.positionLocked}
                        onChange={(e) =>
                          commit("Lock layer position", [
                            { type: "patch", collection: "layers", id: currentLayer.id, fields: { positionLocked: e.target.checked } },
                          ])
                        }
                      />
                      {t("Lock position including child layers", "قفل الموضع مع الطبقات التابعة")}
                    </label>
                    <Range
                      label={t("Layer opacity", "شفافية الطبقة")}
                      value={currentLayer.opacity}
                      onChange={(opacity) =>
                        commit("Layer opacity", [{ type: "patch", collection: "layers", id: currentLayer.id, fields: { opacity } }])
                      }
                    />
                    <Field label={t("Blend", "المزج")}>
                      <select
                        value={currentLayer.blend}
                        onChange={(e) =>
                          commit("Layer blend", [
                            { type: "patch", collection: "layers", id: currentLayer.id, fields: { blend: e.target.value } },
                          ])
                        }
                      >
                        {["source-over", "multiply", "screen", "overlay", "darken", "lighten"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    <label className="drawing-check">
                      <input
                        type="checkbox"
                        checked={currentLayer.alphaLocked}
                        onChange={(e) =>
                          commit("Lock transparency", [
                            { type: "patch", collection: "layers", id: currentLayer.id, fields: { alphaLocked: e.target.checked } },
                          ])
                        }
                      />
                      {t("Lock transparency for new paint", "قفل الشفافية للرسم الجديد")}
                    </label>
                    <div className="drawing-step-actions">
                      {[-1, 1].map((direction) => (
                        <Button
                          key={direction}
                          size="compact"
                          disabled={
                            !canEdit ||
                            layerBusy ||
                            effectiveLayer(scene, currentLayer.id).locked ||
                            !reorderLayerTree(scene, currentLayer.id, direction).length
                          }
                          onClick={() =>
                            void layerAction("Reorder layer group", (current) => ({
                              changes: reorderLayerTree(current, currentLayer.id, direction),
                            }))
                          }
                        >
                          {direction === 1 ? t("Up", "للأعلى") : t("Down", "للأسفل")}
                        </Button>
                      ))}
                      <Button
                        size="compact"
                        disabled={!canEdit || layerBusy}
                        onClick={() =>
                          void layerAction("Duplicate layer group", (current) => {
                            const result = duplicateLayerTree(current, currentLayer.id, t("copy", "نسخة"));
                            return { changes: result.changes, nextId: result.layerId };
                          })
                        }
                      >
                        {t("Duplicate layer and children", "نسخ الطبقة وتوابعها")}
                      </Button>
                      <Button
                        size="compact"
                        disabled={!canEdit || layerBusy}
                        onClick={() => void layerAction("Delete layer group", (current) => deleteLayerTree(current, currentLayer.id))}
                      >
                        {t("Delete layer and children", "حذف الطبقة وتوابعها")}
                      </Button>
                      <Button size="compact" disabled={!canEdit || layerBusy} onClick={() => setMergeOpen(true)}>
                        {t("Merge all visible layers", "دمج كل الطبقات الظاهرة")}
                      </Button>
                    </div>
                  </fieldset>
                </>
              )}
              {tab === "frames" && (
                <>
                  <Button
                    icon="add"
                    size="compact"
                    onClick={() => {
                      const f = newFrame(t(`Frame ${scene.frameOrder.length + 1}`, `إطار ${scene.frameOrder.length + 1}`), {
                        x: currentFrame.x + currentFrame.w + 100,
                      });
                      commit("Add frame", [
                        { type: "put", collection: "frames", id: f.id, value: f },
                        { type: "order", list: "frameOrder", ids: [...scene.frameOrder, f.id] },
                      ]);
                      setFrameId(f.id);
                      setView({ ...view, x: f.x - 40, y: f.y - 65 });
                    }}
                  >
                    {t("Add frame", "إضافة إطار")}
                  </Button>
                  {scene.frameOrder.map((fid) => (
                    <button
                      className="drawing-frame-row"
                      key={fid}
                      aria-pressed={fid === currentFrame.id}
                      onClick={() => {
                        setFrameId(fid);
                        setView({ ...view, x: scene.frames[fid].x - 40, y: scene.frames[fid].y - 65 });
                      }}
                    >
                      {shownName(scene.frames[fid].name, arabic)}
                      <small>
                        {scene.frames[fid].w} × {scene.frames[fid].h}
                      </small>
                    </button>
                  ))}
                  <Field label={t("Name", "الاسم")}>
                    <input
                      value={currentFrame.name}
                      onChange={(e) =>
                        commit("Rename frame", [
                          { type: "patch", collection: "frames", id: currentFrame.id, fields: { name: e.target.value } },
                        ])
                      }
                    />
                  </Field>
                  {(["x", "y"] as const).map((key) => (
                    <Field key={key} label={key}>
                      <input
                        type="number"
                        value={Math.round(currentFrame[key])}
                        onChange={(e) => {
                          const value = e.target.valueAsNumber;
                          if (Number.isFinite(value))
                            commit(
                              "Move frame and contents",
                              moveFrame(scene, currentFrame.id, { x: currentFrame.x, y: currentFrame.y, [key]: value }),
                            );
                        }}
                      />
                    </Field>
                  ))}
                  {(["w", "h"] as const).map((key) => (
                    <Field key={key} label={key === "w" ? t("Width", "العرض") : t("Height", "الارتفاع")}>
                      <input
                        type="number"
                        min={1}
                        max={16384}
                        value={currentFrame[key]}
                        onChange={(e) => {
                          const value = e.target.valueAsNumber;
                          if (Number.isFinite(value) && value >= 1 && value <= 16384)
                            commit("Resize frame", [
                              { type: "patch", collection: "frames", id: currentFrame.id, fields: { [key]: value } },
                            ]);
                        }}
                      />
                    </Field>
                  ))}
                  <label className="drawing-check">
                    <input
                      type="checkbox"
                      checked={currentFrame.clip}
                      disabled={!canEdit}
                      onChange={(e) =>
                        commit("Clip frame content", [
                          { type: "patch", collection: "frames", id: currentFrame.id, fields: { clip: e.target.checked } },
                        ])
                      }
                    />
                    {t("Clip content to frame", "قص المحتوى عند حدود الإطار")}
                  </label>
                  <p className="drawing-selection-help">
                    {t(
                      "Resizing changes the frame boundary without scaling its contents. Turn clipping off to show content outside it.",
                      "تغيير الحجم يغيّر حدود الإطار دون تكبير محتواه. أوقف القص لإظهار المحتوى خارجه.",
                    )}
                  </p>
                  <Field label={t("Background", "الخلفية")}>
                    <input
                      type="color"
                      value={currentFrame.background === "transparent" ? "#ffffff" : currentFrame.background}
                      onChange={(e) =>
                        commit("Frame background", [
                          { type: "patch", collection: "frames", id: currentFrame.id, fields: { background: e.target.value } },
                        ])
                      }
                    />
                  </Field>
                  <label className="drawing-check">
                    <input
                      type="checkbox"
                      checked={currentFrame.background === "transparent"}
                      onChange={(e) =>
                        commit("Frame transparency", [
                          {
                            type: "patch",
                            collection: "frames",
                            id: currentFrame.id,
                            fields: { background: e.target.checked ? "transparent" : "#ffffff" },
                          },
                        ])
                      }
                    />
                    {t("Transparent background", "خلفية شفافة")}
                  </label>
                  <fieldset disabled={!canEdit}>
                    <GridControls
                      frame={currentFrame}
                      arabic={arabic}
                      onChange={(fields) =>
                        commit("Edit frame grid and guides", [{ type: "patch", collection: "frames", id: currentFrame.id, fields }])
                      }
                    />
                  </fieldset>
                  <Field label={t("Frame status", "حالة الإطار")}>
                    <select
                      value={currentFrame.status}
                      onChange={(e) =>
                        commit("Frame status", [
                          { type: "patch", collection: "frames", id: currentFrame.id, fields: { status: e.target.value } },
                        ])
                      }
                    >
                      <option value="draft">{t("Draft", "مسودة")}</option>
                      <option value="ready">{t("Ready", "جاهز")}</option>
                      <option value="approved">{t("Approved", "معتمد")}</option>
                    </select>
                  </Field>
                  <div className="drawing-step-actions">
                    <Button
                      size="compact"
                      disabled={!canEdit}
                      onClick={() => {
                        const copied = duplicateFrame(scene, currentFrame.id);
                        commit("Duplicate frame", copied.changes);
                        setFrameId(copied.frame.id);
                        setView({ ...view, x: copied.frame.x - 40, y: copied.frame.y - 65 });
                      }}
                    >
                      {t("Duplicate frame", "نسخ الإطار")}
                    </Button>
                    <Button
                      size="compact"
                      disabled={!canEdit || scene.defaultFrameId === currentFrame.id}
                      onClick={() => commit("Default preview frame", [{ type: "defaultFrame", id: currentFrame.id }])}
                    >
                      {t("Use as preview", "استخدام كمعاينة")}
                    </Button>
                  </div>
                </>
              )}
              {tab === "properties" && (
                <>
                  {selected.length > 0 && (
                    <div className="drawing-step-actions">
                      <Button
                        size="compact"
                        icon="move"
                        disabled={
                          !canEdit ||
                          selected.some((id) => {
                            const node = scene.nodes[id],
                              layer = node && effectiveLayer(scene, node.layerId);
                            return !node || !layer || node.locked || layer.locked || layer.positionLocked;
                          })
                        }
                        onClick={() => setShowTransform(true)}
                      >
                        {t("Transform elements", "تحويل العناصر")}
                      </Button>
                      <Button
                        size="compact"
                        onClick={() => {
                          const copied = duplicateElements(scene, selected);
                          commit("Duplicate elements", copied.changes);
                          setSelected(copied.nodes.map((n) => n.id));
                        }}
                      >
                        {t("Duplicate", "نسخ")}
                      </Button>
                      <Button
                        size="compact"
                        disabled={selected.length < 2}
                        onClick={() => {
                          const groupId = id();
                          commit(
                            "Group elements",
                            selected.map((id): Change => ({ type: "patch", collection: "nodes", id, fields: { groupId } })),
                          );
                        }}
                      >
                        {t("Group", "تجميع")}
                      </Button>
                      <Button size="compact" onClick={() => patchNode({ groupId: null })}>
                        {t("Ungroup", "فك التجميع")}
                      </Button>
                      <Button
                        size="compact"
                        onClick={() =>
                          commit("Bring to front", [
                            {
                              type: "order",
                              list: "nodeOrder",
                              ids: [
                                ...scene.nodeOrder.filter((id) => !selected.includes(id)),
                                ...scene.nodeOrder.filter((id) => selected.includes(id)),
                              ],
                            },
                          ])
                        }
                      >
                        {t("To front", "إلى الأمام")}
                      </Button>
                      <Button
                        size="compact"
                        onClick={() =>
                          commit("Send to back", [
                            {
                              type: "order",
                              list: "nodeOrder",
                              ids: [
                                ...scene.nodeOrder.filter((id) => selected.includes(id)),
                                ...scene.nodeOrder.filter((id) => !selected.includes(id)),
                              ],
                            },
                          ])
                        }
                      >
                        {t("To back", "إلى الخلف")}
                      </Button>
                      {(["left", "center", "right", "top", "middle", "bottom", "horizontal", "vertical"] as const).map((alignment) => (
                        <Button
                          key={alignment}
                          size="compact"
                          disabled={selected.length < 2}
                          onClick={() => commit("Align elements", alignElements(scene, selected, alignment))}
                        >
                          {t(
                            alignment,
                            {
                              left: "محاذاة لليسار",
                              center: "توسيط أفقي",
                              right: "محاذاة لليمين",
                              top: "محاذاة للأعلى",
                              middle: "توسيط رأسي",
                              bottom: "محاذاة للأسفل",
                              horizontal: "توزيع أفقي",
                              vertical: "توزيع رأسي",
                            }[alignment],
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                  {tool === "selection" && (
                    <SelectionControls
                      kind={selectionKind}
                      mode={selectionMode}
                      setKind={setSelectionKind}
                      setMode={setSelectionMode}
                      selection={selection}
                      busy={pixelSelection.busy}
                      error={pixelSelection.error}
                      arabic={arabic}
                      run={(op) => void pixelSelection.controller.run(op)}
                      clear={pixelSelection.controller.clear}
                      cancel={pixelSelection.controller.cancel}
                      tolerance={tolerance}
                      setTolerance={setTolerance}
                      sourceLocked={!!solo}
                      merged={merged && !solo}
                      setMerged={setMerged}
                      contiguous={contiguous}
                      setContiguous={setContiguous}
                    />
                  )}
                  {tool === "selection" && (
                    <PixelSelectionActions
                      arabic={arabic}
                      canEdit={canEdit}
                      available={!!selection?.pixels && !pixelSelection.busy}
                      busy={pixelEdits.busy}
                      saving={pixelEdits.saving}
                      completed={pixelEdits.completed}
                      sourceLocked={!!solo}
                      source={solo ? "current" : pixelSource}
                      setSource={setPixelSource}
                      run={(action) => void pixelEdits.run(action)}
                      cancel={pixelEdits.cancel}
                      error={pixelEdits.error}
                    />
                  )}
                  {selection && tool !== "selection" && (
                    <Button size="compact" onClick={() => pixelSelection.controller.clear()}>
                      {t("Clear selection", "إلغاء التحديد")}
                    </Button>
                  )}
                  {tool === "fill" && (
                    <>
                      <Range
                        label={t("Fill tolerance", "حساسية التعبئة")}
                        value={tolerance}
                        min={0}
                        max={255}
                        step={1}
                        onChange={setTolerance}
                      />
                      <Range
                        label={t("Fill edge expansion", "توسيع حافة التعبئة")}
                        value={fillGrow}
                        min={-4}
                        max={8}
                        step={1}
                        onChange={setFillGrow}
                      />
                      <label className="drawing-check">
                        <input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} />
                        {t("Contiguous region", "منطقة متصلة")}
                      </label>
                      <label className="drawing-check">
                        <input type="checkbox" disabled={!!solo} checked={merged && !solo} onChange={(e) => setMerged(e.target.checked)} />
                        {t("Sample visible layers", "القراءة من الطبقات الظاهرة")}
                      </label>
                    </>
                  )}
                  {tool !== "redact" && (
                    <BrushSettings
                      tool={tool}
                      brush={brush}
                      arabic={arabic}
                      disabled={!canEdit}
                      tipName={scene.assets[brush.tipAssetId ?? ""]?.name}
                      patch={patchBrush}
                      reset={() => {
                        setBrush(resetToolBrush(brush, tool));
                        if (tool === "laser") setLaserLifetime(1200);
                      }}
                      save={() => {
                        setLibrarySaveKind("brush");
                        setTab("library");
                      }}
                      importTip={importBrushTip}
                      laserLifetime={laserLifetime}
                      onLaserLifetime={setLaserLifetime}
                    />
                  )}
                  {tool === "brush" && (
                    <label className="drawing-check">
                      <input type="checkbox" checked={autoShape} onChange={(e) => setAutoShape(e.target.checked)} />
                      {t("Correct hand-drawn shapes", "تصحيح الأشكال تلقائيًا")}
                    </label>
                  )}
                  {tool === "shape" && (
                    <Field label={t("Shape", "الشكل")}>
                      <select value={shape} onChange={(e) => setShape(e.target.value as Shape)}>
                        {SHAPES.map((s) => (
                          <option value={s} key={s}>
                            {arabic ? AR_SHAPES[s] : s}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {one && (
                    <>
                      <p className="drawing-section-name">{one.name}</p>
                      {(one.anchor || one.endAnchor || one.annotationGroup) && (
                        <AnnotationsPanel
                          compact
                          scene={scene}
                          frameId={currentFrame.id}
                          layerId={currentLayer.id}
                          selected={selected}
                          canEdit={canEdit}
                          arabic={arabic}
                          apply={applyAnnotation}
                          onSelect={setSelected}
                          onSaveStyle={(ids) => {
                            setSelected(ids);
                            setLibrarySaveKind("style");
                            setTab("library");
                          }}
                        />
                      )}
                      <Field label={t("Element frame", "إطار العنصر")}>
                        <select
                          value={one.frameId ?? ""}
                          disabled={
                            !canEdit ||
                            one.locked ||
                            effectiveLayer(scene, one.layerId).locked ||
                            effectiveLayer(scene, one.layerId).positionLocked
                          }
                          onChange={(e) => patchNode({ frameId: e.target.value || null })}
                        >
                          <option value="">{t("World item outside frames", "عنصر في العالم دون إطار")}</option>
                          {scene.frameOrder.map((id) => (
                            <option key={id} value={id}>
                              {shownName(scene.frames[id].name, arabic)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {!isRedaction(one) && (
                        <Range
                          label={t("Element opacity", "شفافية العنصر")}
                          value={one.opacity}
                          onChange={(opacity) => patchNode({ opacity })}
                        />
                      )}
                      {isRedaction(one) && (
                        <p className="drawing-selection-help">
                          {t(
                            "This cover stays opaque in flattened images. The editable project retains the original content.",
                            "يبقى هذا الغطاء معتمًا في الصور المسطحة. المشروع القابل للتعديل يحتفظ بالمحتوى الأصلي.",
                          )}
                        </p>
                      )}
                      {one.kind === "shape" && !isRedaction(one) && (
                        <>
                          {!["arrow", "double-arrow", "callout", "number"].includes(one.shape ?? "") && (
                            <Button
                              size="compact"
                              disabled={!canEdit || one.locked || scene.layers[one.layerId].locked}
                              onClick={() => setPathNodeId(one.id)}
                            >
                              {t("Edit path", "تعديل المسار")}
                            </Button>
                          )}
                          <PaintInspector node={one} arabic={arabic} onChange={(paint) => patchNode({ paint })} />
                          {one.shape === "number" && (
                            <Field label={t("Number", "الرقم")}>
                              <input
                                type="number"
                                value={one.number ?? 1}
                                onChange={(e) => {
                                  if (Number.isFinite(e.target.valueAsNumber)) patchNode({ number: e.target.valueAsNumber });
                                }}
                              />
                            </Field>
                          )}
                        </>
                      )}
                      {one.kind === "text" && (
                        <>
                          <Field label={t("Text", "النص")}>
                            <textarea dir="auto" value={one.text ?? ""} onChange={(e) => patchNode({ text: e.target.value })} />
                          </Field>
                          <TextInspector
                            node={one}
                            arabic={arabic}
                            onChange={(textStyle) => patchNode({ textStyle })}
                            onRotation={(rotation) => patchNode({ rotation })}
                            rotationDisabled={
                              !canEdit ||
                              one.locked ||
                              effectiveLayer(scene, one.layerId).locked ||
                              effectiveLayer(scene, one.layerId).positionLocked
                            }
                          />
                        </>
                      )}
                      {(one.kind === "image" || one.kind === "raster") && (
                        <>
                          {!one.erase && (
                            <Button
                              size="compact"
                              disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                              onClick={() => setCropNodeId(one.id)}
                            >
                              {t("Crop and compare", "اقتصاص ومقارنة")}
                            </Button>
                          )}
                          {!one.erase && (
                            <Button
                              size="compact"
                              disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                              onClick={() => setRasterizeNodeId(one.id)}
                            >
                              {t("Rasterize adjustments", "تثبيت التعديلات كبكسلات")}
                            </Button>
                          )}
                          <Field label={t("Add adjustment", "إضافة تعديل")}>
                            <select
                              value=""
                              onChange={(e) => {
                                const kind = e.target.value as DrawingNode["effects"][number]["kind"];
                                if (kind)
                                  patchNode({
                                    effects: [
                                      ...one.effects,
                                      {
                                        id: id(),
                                        kind,
                                        amount: ["blur", "pixelate"].includes(kind) ? 6 : ["grayscale", "invert"].includes(kind) ? 1 : 0.1,
                                        enabled: true,
                                      },
                                    ],
                                  });
                              }}
                            >
                              <option value="">{t("Choose adjustment", "اختر تعديلًا")}</option>
                              {[
                                "brightness",
                                "contrast",
                                "saturation",
                                "temperature",
                                "grayscale",
                                "invert",
                                "blur",
                                "sharpen",
                                "pixelate",
                              ].map((v) => (
                                <option value={v} key={v}>
                                  {arabic ? AR_EFFECTS[v] : v}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {one.effects.map((effect, index) => (
                            <div className="drawing-effect" key={effect.id}>
                              <label className="drawing-check">
                                <input
                                  type="checkbox"
                                  checked={effect.enabled}
                                  onChange={(e) =>
                                    patchNode({
                                      effects: one.effects.map((f) => (f.id === effect.id ? { ...f, enabled: e.target.checked } : f)),
                                    })
                                  }
                                />
                                {arabic ? AR_EFFECTS[effect.kind] : effect.kind}
                              </label>
                              <Range
                                label={t("Amount", "القيمة")}
                                min={["brightness", "contrast", "saturation", "temperature"].includes(effect.kind) ? -1 : 0}
                                max={["blur", "pixelate"].includes(effect.kind) ? 64 : 1}
                                value={effect.amount}
                                onChange={(amount) =>
                                  patchNode({ effects: one.effects.map((f) => (f.id === effect.id ? { ...f, amount } : f)) })
                                }
                              />
                              <Button
                                size="compact"
                                disabled={index === 0}
                                onClick={() => {
                                  const effects = [...one.effects];
                                  [effects[index - 1], effects[index]] = [effects[index], effects[index - 1]];
                                  patchNode({ effects });
                                }}
                              >
                                {t("Move up", "للأعلى")}
                              </Button>
                              <Button
                                size="compact"
                                disabled={index === one.effects.length - 1}
                                onClick={() => {
                                  const effects = [...one.effects];
                                  [effects[index], effects[index + 1]] = [effects[index + 1], effects[index]];
                                  patchNode({ effects });
                                }}
                              >
                                {t("Move down", "للأسفل")}
                              </Button>
                              <Button
                                size="compact"
                                disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                                onClick={() => setMaskTarget({ nodeId: one.id, effectId: effect.id })}
                              >
                                {effect.maskId ? t("Edit effect mask", "تعديل قناع التأثير") : t("Add effect mask", "إضافة قناع للتأثير")}
                              </Button>
                              {effect.maskId && scene.masks[effect.maskId] && (
                                <label className="drawing-check">
                                  <input
                                    type="checkbox"
                                    checked={scene.masks[effect.maskId].enabled}
                                    disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                                    onChange={(e) => patchMask(one.id, effect.id, { enabled: e.target.checked })}
                                  />
                                  {t("Effect mask enabled", "تفعيل قناع التأثير")}
                                </label>
                              )}
                              {effect.maskId && (
                                <Button
                                  size="compact"
                                  onClick={() =>
                                    patchNode({ effects: one.effects.map((e) => (e.id === effect.id ? { ...e, maskId: undefined } : e)) })
                                  }
                                >
                                  {t("Remove effect mask", "إزالة قناع التأثير")}
                                </Button>
                              )}
                              <Button size="compact" onClick={() => patchNode({ effects: one.effects.filter((f) => f.id !== effect.id) })}>
                                {t("Remove", "حذف")}
                              </Button>
                            </div>
                          ))}
                          <Button size="compact" onClick={() => patchNode({ effects: [] })}>
                            {t("Reset adjustments", "إعادة ضبط التأثيرات")}
                          </Button>
                          <Button
                            size="compact"
                            onClick={() => {
                              try {
                                const current = session.snapshot().document!.scene,
                                  node = current.nodes[one.id],
                                  asset = current.assets[node.assetId ?? ""],
                                  result = imageCropChanges(
                                    current,
                                    node,
                                    { x: 0, y: 0, w: asset.width, h: asset.height },
                                    "trim",
                                    imageCropSourceKey(scene, one.id),
                                  );
                                commit("Restore original", [
                                  ...result.changes,
                                  { type: "patch", collection: "nodes", id: one.id, fields: { effects: [] } },
                                ]);
                              } catch (error) {
                                toast({
                                  message: t(
                                    "The original could not be restored. Check that the image is unlocked and unchanged.",
                                    "تعذرت استعادة الأصل. تأكد من أن الصورة غير مقفلة ولم تتغير.",
                                  ),
                                  tone: "error",
                                });
                              }
                            }}
                          >
                            {t("Restore original", "استعادة الأصل")}
                          </Button>
                        </>
                      )}
                      {one.kind !== "image" && one.kind !== "raster" && !one.erase && !isRedaction(one) && (
                        <>
                          <Field label={t("Add adjustment", "إضافة تعديل")}>
                            <select
                              value=""
                              disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                              onChange={(e) => {
                                const kind = e.target.value as DrawingNode["effects"][number]["kind"];
                                if (kind)
                                  patchNode({
                                    effects: [
                                      ...one.effects,
                                      {
                                        id: id(),
                                        kind,
                                        amount: kind === "blur" ? 6 : ["grayscale", "invert"].includes(kind) ? 1 : 0.1,
                                        enabled: true,
                                      },
                                    ],
                                  });
                              }}
                            >
                              <option value="">{t("Choose adjustment", "اختر تعديلًا")}</option>
                              {["brightness", "contrast", "saturation", "grayscale", "invert", "blur"].map((v) => (
                                <option value={v} key={v}>
                                  {arabic ? AR_EFFECTS[v] : v}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {one.effects.map((effect, index) => (
                            <div className="drawing-effect" key={effect.id}>
                              <label className="drawing-check">
                                <input
                                  type="checkbox"
                                  checked={effect.enabled}
                                  onChange={(e) =>
                                    patchNode({
                                      effects: one.effects.map((f) => (f.id === effect.id ? { ...f, enabled: e.target.checked } : f)),
                                    })
                                  }
                                />
                                {arabic ? AR_EFFECTS[effect.kind] : effect.kind}
                              </label>
                              <Range
                                label={t("Amount", "القيمة")}
                                min={["brightness", "contrast", "saturation"].includes(effect.kind) ? -1 : 0}
                                max={effect.kind === "blur" ? 64 : 1}
                                value={effect.amount}
                                onChange={(amount) =>
                                  patchNode({ effects: one.effects.map((f) => (f.id === effect.id ? { ...f, amount } : f)) })
                                }
                              />
                              <Button
                                size="compact"
                                disabled={index === 0}
                                onClick={() => {
                                  const effects = [...one.effects];
                                  [effects[index - 1], effects[index]] = [effects[index], effects[index - 1]];
                                  patchNode({ effects });
                                }}
                              >
                                {t("Move up", "للأعلى")}
                              </Button>
                              <Button
                                size="compact"
                                disabled={index === one.effects.length - 1}
                                onClick={() => {
                                  const effects = [...one.effects];
                                  [effects[index], effects[index + 1]] = [effects[index + 1], effects[index]];
                                  patchNode({ effects });
                                }}
                              >
                                {t("Move down", "للأسفل")}
                              </Button>
                              <Button
                                size="compact"
                                disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                                onClick={() => setMaskTarget({ nodeId: one.id, effectId: effect.id })}
                              >
                                {effect.maskId ? t("Edit effect mask", "تعديل قناع التأثير") : t("Add effect mask", "إضافة قناع للتأثير")}
                              </Button>
                              {effect.maskId && scene.masks[effect.maskId] && (
                                <label className="drawing-check">
                                  <input
                                    type="checkbox"
                                    checked={scene.masks[effect.maskId].enabled}
                                    onChange={(e) => patchMask(one.id, effect.id, { enabled: e.target.checked })}
                                  />
                                  {t("Effect mask enabled", "تفعيل قناع التأثير")}
                                </label>
                              )}
                              {effect.maskId && (
                                <Button
                                  size="compact"
                                  onClick={() =>
                                    patchNode({ effects: one.effects.map((e) => (e.id === effect.id ? { ...e, maskId: undefined } : e)) })
                                  }
                                >
                                  {t("Remove effect mask", "إزالة قناع التأثير")}
                                </Button>
                              )}
                              <Button size="compact" onClick={() => patchNode({ effects: one.effects.filter((f) => f.id !== effect.id) })}>
                                {t("Remove", "حذف")}
                              </Button>
                            </div>
                          ))}
                        </>
                      )}
                      {!one.erase && !isRedaction(one) && (
                        <Button
                          size="compact"
                          disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                          onClick={() => setMaskTarget({ nodeId: one.id })}
                        >
                          {one.maskId ? t("Edit element mask", "تعديل قناع العنصر") : t("Add element mask", "إضافة قناع للعنصر")}
                        </Button>
                      )}
                      {one.maskId && (
                        <Button
                          size="compact"
                          onClick={() =>
                            commit("Remove element mask", [{ type: "patch", collection: "nodes", id: one.id, fields: { maskId: null } }])
                          }
                        >
                          {t("Remove element mask", "إزالة قناع العنصر")}
                        </Button>
                      )}
                      {one.maskId && scene.masks[one.maskId] && (
                        <>
                          <label className="drawing-check">
                            <input
                              type="checkbox"
                              checked={scene.masks[one.maskId].enabled}
                              disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                              onChange={(e) => patchMask(one.id, undefined, { enabled: e.target.checked })}
                            />
                            {t("Mask", "القناع")}
                          </label>
                          <Button
                            size="compact"
                            disabled={!canEdit || one.locked || effectiveLayer(scene, one.layerId).locked}
                            onClick={() => patchMask(one.id, undefined, { inverted: !scene.masks[one.maskId!].inverted })}
                          >
                            {t("Invert mask", "عكس القناع")}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
              {tab === "history" && (
                <>
                  <Button
                    size="compact"
                    disabled={!canEdit || state.pending > 0}
                    onClick={async () => {
                      try {
                        const label = await promptText({ title: t("Save version", "حفظ إصدار"), confirm: t("Save", "حفظ") });
                        if (label) {
                          await session.flush();
                          await api.drawingVersionSave(pageId, label);
                          setVersions(await api.drawingVersions(pageId));
                        }
                      } catch (e) {
                        toast({ message: errorMessage(e), tone: "error" });
                      }
                    }}
                  >
                    {t("Save named version", "حفظ إصدار مسمّى")}
                  </Button>
                  {versions.map((version) => (
                    <div className="drawing-version" key={version.id}>
                      <span>{version.label}</span>
                      <small>{new Date(version.createdAt).toLocaleString()}</small>
                      <Button icon="preview" size="compact" disabled={!canEdit} onClick={() => setRestoreVersion(version)}>
                        {t("Preview restore", "معاينة الاستعادة")}
                      </Button>
                    </div>
                  ))}
                </>
              )}
              {tab === "steps" && (
                <StepsPanel
                  scene={scene}
                  view={view}
                  frameId={currentFrame.id}
                  selected={selected}
                  canEdit={canEdit}
                  arabic={arabic}
                  session={session}
                  commit={commit}
                />
              )}
              {tab === "experiments" && state.document && (
                <ExperimentsPanel document={state.document} session={session} canEdit={canEdit} arabic={arabic} commit={commit} />
              )}
              {tab === "library" && (
                <LibraryPanel
                  startSaveKind={librarySaveKind}
                  onStartedSave={() => setLibrarySaveKind(undefined)}
                  session={session}
                  scene={scene}
                  selected={selected}
                  frameId={currentFrame.id}
                  brush={brush}
                  colors={palette.length ? palette : [...new Set([brush.color, ...recentColors])]}
                  canEdit={canEdit}
                  arabic={arabic}
                  commit={commit}
                  onBrush={(next) => {
                    chooseTool(next.kind === "highlighter" ? "highlighter" : "brush");
                    setBrush(normalizeBrush(next));
                  }}
                  onPalette={(colors) => {
                    setPalette(colors);
                    if (colors[0]) pickColor(colors[0]);
                  }}
                  onSelect={setSelected}
                />
              )}
              {tab === "links" && (
                <>
                  <AnnotationsPanel
                    scene={scene}
                    frameId={currentFrame.id}
                    layerId={currentLayer.id}
                    selected={selected}
                    canEdit={canEdit}
                    arabic={arabic}
                    apply={applyAnnotation}
                    onSelect={setSelected}
                    onSaveStyle={(ids) => {
                      setSelected(ids);
                      setLibrarySaveKind("style");
                      setTab("library");
                    }}
                  />
                  <ReferencesPanel
                    session={session}
                    scene={scene}
                    frameId={currentFrame.id}
                    layerId={currentLayer.id}
                    selected={selected}
                    canEdit={canEdit}
                    arabic={arabic}
                    commit={commit}
                    onSelect={setSelected}
                  />
                </>
              )}
              {tab === "comments" && (
                <DrawingCommentsPanel
                  pageId={pageId}
                  canReview={access !== "none" && sync?.level !== "none" && liveState?.info?.level !== "none"}
                  onRetry={() => void retryDrawingSync(pageId).catch((e) => toast({ message: errorMessage(e), tone: "error" }))}
                  activeThread={activeThread}
                  session={live}
                  scene={scene}
                  frameId={currentFrame.id}
                  selected={selected}
                  region={
                    selection?.frame.id === currentFrame.id && selection.bounds
                      ? { ...selection.bounds, x: selection.frame.x + selection.bounds.x, y: selection.frame.y + selection.bounds.y }
                      : undefined
                  }
                  arabic={arabic}
                  onGo={(frame, camera) => {
                    live?.follow(null);
                    openDrawingLocation(pageId, frame, camera);
                  }}
                />
              )}
            </aside>
          </div>
        )}
      </div>
      <footer className="drawing-footer">
        <button
          onClick={() => {
            const f = currentFrame,
              bounds = root.current?.querySelector(".drawing-stage")?.getBoundingClientRect();
            if (!bounds) return;
            const w = bounds.width,
              h = bounds.height,
              scale = Math.max(0.025, Math.min(16, w / (f.w + 80), h / (f.h + 80)));
            setView({ ...view, x: f.x - (w / scale - f.w) / 2, y: f.y - (h / scale - f.h) / 2, w: w / scale, h: h / scale, scale });
          }}
        >
          {t("Fit frame", "احتواء الإطار")}
        </button>
        <button
          onClick={() => {
            const bounds = root.current?.querySelector(".drawing-stage")?.getBoundingClientRect(),
              w = bounds?.width ?? view.w * view.scale,
              h = bounds?.height ?? view.h * view.scale,
              cx = view.x + view.w / 2,
              cy = view.y + view.h / 2;
            setView({ ...view, x: cx - w / 2, y: cy - h / 2, w, h, scale: 1 });
          }}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <span>
          {currentFrame.w} × {currentFrame.h} px
        </span>
        <span>{t("Space to pan · Wheel to zoom", "المسافة للتحريك · العجلة للتكبير")}</span>
        <span>
          {scene.layerOrder.length} {t("layers", "طبقات")}
        </span>
      </footer>
      {pixelEdits.draft && (
        <FloatingPixelsDialog
          key={pixelEdits.draft.art.node.id}
          draft={pixelEdits.draft}
          arabic={arabic}
          canEdit={canEdit}
          busy={pixelEdits.busy}
          saving={pixelEdits.saving}
          error={pixelEdits.error}
          leaseState={pixelEdits.leaseState}
          onApply={(node) => void pixelEdits.apply(node)}
          onCancel={pixelEdits.cancel}
          onFrame={(index) => void pixelEdits.chooseFrame(index)}
        />
      )}
      {shortcutsOpen && (
        <DrawingShortcutsDialog owner={owner} arabic={arabic} onClose={() => setShortcutsOpen(false)} onApply={setShortcuts} />
      )}
      {textEdit && (
        <Modal
          title={t("Text", "نص")}
          width={500}
          onClose={() => setTextEdit(null)}
          footer={
            <Button
              variant="tinted"
              onClick={() => {
                const node = { ...textEdit.node, text: textEdit.value };
                if (scene.nodes[node.id])
                  commit("Edit text", [{ type: "patch", collection: "nodes", id: node.id, fields: { text: node.text } }]);
                else addNode(node);
                setTextEdit(null);
              }}
            >
              {t("Apply", "تطبيق")}
            </Button>
          }
        >
          <textarea
            className="drawing-text-input"
            dir="auto"
            autoFocus
            value={textEdit.value}
            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          />
        </Modal>
      )}
      {packageFile && (
        <DrawingPackageImportDialog
          file={packageFile}
          pageId={pageId}
          arabic={arabic}
          canEdit={canEdit}
          revision={() => session.snapshot().document?.revision ?? -1}
          onClose={() => setPackageFile(null)}
          apply={async (imported, revision) => {
            const doc = session.snapshot().document;
            if (!doc || doc.revision !== revision) throw Error(t("The drawing changed", "تغيّر الرسم"));
            const operation = commit("Import drawing project", sceneChanges(doc.scene, imported));
            if (!operation) return [];
            await session.flush();
            setSelected([]);
            pixelSelection.controller.clear();
            return [operation];
          }}
        />
      )}
      {exportScene && (
        <DrawingExportDialog
          scene={exportScene}
          pageId={pageId}
          frameId={exportScene.frames[frameId] ? frameId : exportScene.defaultFrameId}
          name={meta.title}
          arabic={arabic}
          onClose={() => setExportScene(null)}
        />
      )}
      {mergeOpen && (
        <LayerMergeDialog
          pageId={pageId}
          scene={scene}
          canEdit={canEdit}
          arabic={arabic}
          begin={() => reserveDrawingRoot(pageId)}
          onClose={() => setMergeOpen(false)}
          apply={async (plan, frames) => {
            const current = session.snapshot().document!.scene;
            if (mergeSourceKey(current) !== plan.sourceKey) throw Error("merge-stale");
            await checkDrawingExport({
              pageId,
              kind: "images",
              scenes: [
                ...plan.frames.map((frame) => ({ scene: current, frameId: frame.id, annotations: true })),
                ...(plan.world ? [{ scene: current, region: plan.world, annotations: true }] : []),
              ],
            });
            const owned = [];
            for (const frame of frames) {
              const original = await api.importBytes(pageId, `${frame.asset.name}.png`, new Uint8Array(await frame.blob.arrayBuffer()));
              owned.push({ ...frame, asset: { ...frame.asset, attachmentId: original.id } });
            }
            const result = mergedLayerChanges(
                session.snapshot().document!.scene,
                plan,
                owned,
                t("Merged visible content", "المحتوى الظاهر المدمج"),
              ),
              operation = commit("Merge visible layers", result.changes, undefined, true);
            if (!operation) return [];
            await session.flush();
            setLayerId(result.layerId);
            setSolo(null);
            setSelected([]);
            return [operation];
          }}
        />
      )}
      {rasterizeNodeId && scene.nodes[rasterizeNodeId] && (
        <RasterizeImageDialog
          key={rasterizeNodeId}
          scene={scene}
          nodeId={rasterizeNodeId}
          canEdit={canEdit}
          arabic={arabic}
          begin={() => beginDrawingGesture(pageId, [rasterizeNodeId])}
          onClose={() => setRasterizeNodeId(null)}
          apply={async (asset, blob, key) => {
            rasterizedImageChanges(session.snapshot().document!.scene, rasterizeNodeId, key, asset);
            const original = await api.importBytes(pageId, "rasterized-image.png", new Uint8Array(await blob.arrayBuffer())),
              changes = rasterizedImageChanges(session.snapshot().document!.scene, rasterizeNodeId, key, {
                ...asset,
                attachmentId: original.id,
              }),
              operation = commit("Rasterize image adjustments", changes);
            if (!operation) return [];
            await session.flush();
            return [operation];
          }}
        />
      )}
      {cropNodeId && scene.nodes[cropNodeId] && (
        <ImageCropDialog
          key={cropNodeId}
          scene={scene}
          nodeId={cropNodeId}
          canEdit={canEdit}
          arabic={arabic}
          begin={() => beginDrawingGesture(pageId, [cropNodeId])}
          onClose={() => setCropNodeId(null)}
          apply={async (before, crop, mode, key, effects) => {
            const result = imageCropChanges(session.snapshot().document!.scene, before, crop, mode, key),
              mapped = effects.map((effect) => ({
                ...effect,
                maskId: effect.maskId ? (result.node.effects.find((item) => item.id === effect.id)?.maskId ?? effect.maskId) : undefined,
              })),
              operation = commit("Edit image", [
                ...result.changes,
                { type: "patch", collection: "nodes", id: before.id, fields: { effects: mapped } },
              ]);
            if (!operation) return [];
            await session.flush();
            return [operation];
          }}
        />
      )}
      {maskTarget && scene.nodes[maskTarget.nodeId] && (
        <MaskDialog
          key={`${maskTarget.nodeId}/${maskTarget.effectId ?? "element"}`}
          scene={scene}
          nodeId={maskTarget.nodeId}
          effectId={maskTarget.effectId}
          eraseBrush={maskTarget.erase ? { size: brush.size, opacity: brush.opacity, hardness: brush.hardness } : undefined}
          canEdit={canEdit}
          arabic={arabic}
          begin={() => beginDrawingGesture(pageId, [maskTarget.nodeId])}
          onClose={() => setMaskTarget(null)}
          apply={async (mask, asset, blob, key) => {
            const current = session.snapshot().document!.scene;
            maskEditChanges(current, maskTarget.nodeId, maskTarget.effectId, key, mask, asset);
            const original = await api.importBytes(pageId, "alpha-mask.png", new Uint8Array(await blob.arrayBuffer())),
              changes = maskEditChanges(session.snapshot().document!.scene, maskTarget.nodeId, maskTarget.effectId, key, mask, {
                ...asset,
                attachmentId: original.id,
              }),
              operation = commit("Edit alpha mask", changes);
            if (!operation) return [];
            await session.flush();
            return [operation];
          }}
        />
      )}
      {pathNodeId && scene.nodes[pathNodeId] && (
        <PathDialog
          node={scene.nodes[pathNodeId]}
          arabic={arabic}
          canEdit={canEdit && !scene.nodes[pathNodeId].locked && !scene.layers[scene.nodes[pathNodeId].layerId].locked}
          begin={() => beginDrawingGesture(pageId, [pathNodeId])}
          onClose={() => setPathNodeId(null)}
          onApply={(path) => {
            const operation = commit("Edit path", [
              { type: "patch", collection: "nodes", id: pathNodeId, fields: { path, shape: "curve", points: undefined } },
            ]);
            return operation ? [operation] : [];
          }}
        />
      )}
      {showTransform && selected.length > 0 && (
        <DrawingTransformDialog
          scene={scene}
          selected={selected}
          arabic={arabic}
          canEdit={canEdit}
          onClose={() => setShowTransform(false)}
          begin={(ids) => beginDrawingGesture(pageId, ids)}
          apply={applyObjectTransform}
        />
      )}
      {restoreVersion && (
        <DrawingVersionRestoreDialog
          pageId={pageId}
          version={restoreVersion}
          session={session}
          arabic={arabic}
          canEdit={canEdit || state.restoring}
          onClose={() => setRestoreVersion(null)}
          onApplied={() => {
            setRestoreVersion(null);
            setSelected([]);
            pixelSelection.controller.clear();
            void api.drawingVersions(pageId).then(setVersions);
            toast({
              message: t(
                "The previous drawing was kept as a named version. The restored drawing is a new edit.",
                "حُفظ الرسم السابق كإصدار مسمّى، وأُضيف الرسم المستعاد كتعديل جديد.",
              ),
            });
          }}
        />
      )}
      {screenCapture && (
        <ScreenDrawing
          capture={screenCapture}
          arabic={arabic}
          initialBrush={brush}
          laserLifetime={laserLifetime}
          isShared={async () => !!(await localStore().pageMode(pageId)).shared}
          onClose={async () => {
            await invoke("end_screen_drawing", { wasFullscreen: screenCapture.wasFullscreen });
            setScreenCapture(null);
          }}
          onSave={async (blob, width, height, shareConfirmed) => {
            if (!canEditNow.current || !lifetime.current.active) throw new Error(t("This drawing is read-only", "هذا الرسم للقراءة فقط"));
            const shared = !!(await localStore().pageMode(pageId)).shared;
            if (shared && !shareConfirmed) throw new Error(t("Confirm sharing the screen capture first.", "أكد مشاركة لقطة الشاشة أولًا."));
            const lease = shared ? await reserveDrawingRoot(pageId) : null;
            try {
              if (shared && (!lease || lease.state() !== "locked"))
                throw new Error(
                  t("Reconnect to the shared drawing before saving the capture.", "أعد الاتصال بالرسم المشترك قبل حفظ اللقطة."),
                );
              const doc = session.snapshot().document,
                frame = doc?.scene.frames[frameId],
                layer = doc?.scene.layers[layerId];
              if (!doc || !frame || !layer || lease?.state() === "lost" || effectiveLayer(doc.scene, layer.id).locked)
                throw new Error(t("Choose an unlocked frame and layer", "اختر إطارًا وطبقة غير مقفلة"));
              const attachment = await api.importBytes(pageId, "screen-annotation.png", new Uint8Array(await blob.arrayBuffer()));
              if (
                !!(await localStore().pageMode(pageId)).shared !== shared ||
                !canEditNow.current ||
                (shared && (!lease || lease.state() !== "locked")) ||
                session.snapshot().document?.revision !== doc.revision
              )
                throw new Error(t("The drawing changed. Try saving again.", "تغيّر الرسم. أعد محاولة الحفظ."));
              const assetId = id(),
                factor = Math.min(1, frame.w / width, frame.h / height),
                node = newNode("image", layer.id, frame.id, { x: frame.x, y: frame.y, w: width * factor, h: height * factor });
              node.assetId = assetId;
              node.name = t("Screen annotation", "الرسم على الشاشة");
              const op = commit(
                "Save screen annotation",
                [
                  {
                    type: "put",
                    collection: "assets",
                    id: assetId,
                    value: { id: assetId, attachmentId: attachment.id, name: "screen-annotation.png", mime: "image/png", width, height },
                  },
                  ...putNode(doc.scene, node),
                ],
                undefined,
                true,
              );
              if (!op) throw new Error(t("Could not save the screen annotation", "تعذر حفظ الرسم على الشاشة"));
              await session.flush();
              lease?.finish([op]);
              if (session.snapshot().pending)
                toast({
                  message: t("The annotation is waiting to save. Keep Worlds open.", "الرسم بانتظار الحفظ. اترك Worlds مفتوحًا."),
                  tone: "error",
                });
              setSelected([node.id]);
            } catch (error) {
              lease?.cancel();
              throw error;
            }
          }}
        />
      )}
      {notificationBell && <NotificationsPopover anchor={notificationBell} onClose={() => setNotificationBell(null)} />}
      {recoveryName !== null && (
        <Modal
          title={t("Keep your drawing and resolve the conflict", "حفظ رسمك ومعالجة التعارض")}
          width={520}
          onClose={() => {
            if (!recovering) setRecoveryName(null);
          }}
          footer={
            <>
              <Button variant="quiet" disabled={recovering} onClick={() => setRecoveryName(null)}>
                {t("Cancel", "إلغاء")}
              </Button>
              <Button
                variant="tinted"
                icon="duplicate"
                loading={recovering}
                disabled={!recoveryName.trim()}
                onClick={async () => {
                  try {
                    setRecovering(true);
                    const copy = await recoverDrawingSync(pageId, recoveryName);
                    setRecoveryName(null);
                    setSelected([]);
                    pixelSelection.controller.clear();
                    toast({
                      message: t(
                        `Your copy is saved as “${copy.title}”. Shared changes are now open.`,
                        `حُفظت نسختك باسم «${copy.title}». فُتحت التعديلات المشتركة الآن.`,
                      ),
                    });
                  } catch (e) {
                    toast({ message: errorMessage(e), tone: "error" });
                  } finally {
                    setRecovering(false);
                  }
                }}
              >
                {t("Save my copy and use shared version", "حفظ نسختي واعتماد المشتركة")}
              </Button>
            </>
          }
        >
          <p>
            {t(
              "A separate drawing on this computer will keep everything currently visible, including unsent strokes. The shared drawing will then open its latest authorized version. The previous native state also remains in the copy's version history.",
              "ستُنشأ لوحة مستقلة على هذا الجهاز تحتفظ بالرسم الظاهر، بما فيه الضربات التي لم تُرسل. بعدها يُفتح آخر إصدار مشترك مسموح لك. تبقى الحالة المحلية السابقة أيضًا ضمن إصدارات النسخة المسترجعة.",
            )}
          </p>
          <Field label={t("Recovered drawing name", "اسم الرسم المسترجع")}>
            <input maxLength={200} value={recoveryName} onChange={(e) => setRecoveryName(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
