import { layerAncestors } from "./layers";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { checkDrawingExport, copyDrawingImage } from "./files";
import { captureSelectedPixels, pixelExportContext } from "./pixelCapture";
import {
  checkPixelSource,
  floatingPixelArtwork,
  imagePixelArtwork,
  pixelArtworkChanges,
  pixelSourcePlan,
  samePixelTransform,
  PixelEditError,
  type FloatingPixelArtwork,
  type PixelAction,
  type PixelEditAction,
  type PixelSampleSource,
  type PixelSourcePlan,
} from "./floatingPixels";
import { reserveDrawingLayers } from "./syncManager";
import type { Change, DrawingNode, DrawingScene, Frame, Rect } from "./model";
import type { PixelSelection } from "./selectionController";
import type { DrawingGestureLease } from "./gestureLeases";
import { pixelGuard, type PixelGuard } from "./pixelGuard";
import { decodeDrawingImage, readDrawingClipboard, type DecodedDrawingImage } from "./imageIngest";

interface PreparedPixelBase {
  scene: DrawingScene;
  frame: Frame;
  region: Rect;
  fileName: string;
  blob: Blob;
  art: FloatingPixelArtwork;
  images: ReadonlyMap<string, HTMLImageElement>;
  lease: DrawingGestureLease | null;
  dispose: () => void;
  signal: AbortSignal;
  acknowledging?: boolean;
}
export type PreparedPixelEdit = PreparedPixelBase &
  (
    | { kind: "selection"; action: PixelAction; selection: PixelSelection; plan: PixelSourcePlan }
    | { kind: "image"; action: "paste" | "import"; convertedFromSvg: boolean; animation?: { frameCount: number; index: number } }
  );
interface Options {
  pageId: string;
  canEdit: boolean;
  selection: PixelSelection | null;
  layerId: string;
  frameId: string;
  source: PixelSampleSource;
  scene: () => DrawingScene | null;
  commit: (label: string, changes: Change[], guard?: PixelGuard) => string | null | undefined;
  flush: () => Promise<void>;
  onApplied: (node: DrawingNode | null, art: FloatingPixelArtwork, action: PixelEditAction) => void;
}
const abort = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
};
export function usePixelEdits(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(true),
    controller = useRef<AbortController | null>(null),
    frameController = useRef<AbortController | null>(null),
    prepared = useRef<PreparedPixelEdit | null>(null),
    applying = useRef(false);
  const [draft, setDraft] = useState<PreparedPixelEdit | null>(null),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<unknown>(null),
    [leaseState, setLeaseState] = useState<"locked" | "offline" | "lost" | null>(null),
    [completed, setCompleted] = useState<PixelEditAction | null>(null);
  const cancel = () => {
    if (applying.current) return;
    controller.current?.abort();
    controller.current = null;
    frameController.current?.abort();
    frameController.current = null;
    const old = prepared.current;
    prepared.current = null;
    old?.lease?.cancel();
    old?.dispose();
    setDraft(null);
    setBusy(false);
    setError(null);
    setLeaseState(null);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      frameController.current?.abort();
      prepared.current?.lease?.cancel();
      prepared.current?.dispose();
      prepared.current = null;
    };
  }, []);
  useEffect(() => {
    if (!options.canEdit) cancel();
  }, [options.canEdit]);
  const valid = (p: PreparedPixelEdit) => {
    abort(p.signal);
    const o = latest.current,
      current = o.scene();
    if (!mounted.current || !o.canEdit) throw new Error("This drawing is read-only");
    if (p.lease?.state() === "lost") throw new Error("The pixel selection reservation was lost");
    if (!current) throw new PixelEditError("stale");
    if (p.kind === "selection") {
      if (o.selection?.id !== p.selection.id || o.frameId !== p.frame.id) throw new PixelEditError("stale");
      checkPixelSource(current, p.selection, p.plan, p.art.erasers.length > 0);
    } else {
      const frame = current.frames[p.frame.id];
      if (!frame || ["x", "y", "w", "h"].some((key) => frame[key as "x"] !== p.frame[key as "x"])) throw new PixelEditError("stale");
    }
    return current;
  };
  const persist = async (p: PreparedPixelEdit, node: DrawingNode | null) => {
    let current = valid(p);
    const o = latest.current;
    const context = p.kind === "selection" && p.action !== "delete" ? pixelExportContext(o.pageId, p.scene, p.plan) : null;
    if (context) await checkDrawingExport(context);
    valid(p);
    const art = { ...p.art, asset: { ...p.art.asset }, eraseAsset: { ...p.art.eraseAsset } };
    if (node) {
      const attachment = await api.importBytes(o.pageId, p.fileName, new Uint8Array(await p.blob.arrayBuffer()));
      art.asset.attachmentId = attachment.id;
      valid(p);
    }
    if (art.erasers.length) {
      if (p.kind !== "selection") throw new PixelEditError("invalid");
      const attachment = await api.importBytes(o.pageId, "pixel-selection-erase.png", new Uint8Array(await p.selection.blob.arrayBuffer()));
      art.eraseAsset.attachmentId = attachment.id;
      valid(p);
    }
    if (context) await checkDrawingExport(context);
    current = valid(p);
    const guard =
      p.kind === "selection" && art.erasers.length ? pixelGuard(current, p.plan.frame.id, p.plan.layerId, p.plan.source) : undefined;
    const operation = o.commit(
      p.kind === "image" ? `${p.action} image` : `${p.action} selected pixels`,
      pixelArtworkChanges(current, art, node),
      guard,
    );
    if (!operation) throw new Error("The selected pixels could not be saved");
    p.acknowledging = true;
    p.lease?.finish([operation]);
    if (prepared.current === p) {
      prepared.current = null;
      setDraft(null);
    }
    if (controller.current?.signal === p.signal) controller.current = null;
    p.dispose();
    o.onApplied(node, art, p.action);
    setCompleted(p.action);
    await o.flush();
  };
  const apply = async (node: DrawingNode) => {
    const p = prepared.current;
    if (!p || applying.current) return;
    if (p.action === "move" && samePixelTransform(p.art.node, node)) {
      cancel();
      return;
    }
    applying.current = true;
    setSaving(true);
    setBusy(true);
    setError(null);
    try {
      await persist(p, node);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      applying.current = false;
      if (mounted.current) {
        setBusy(false);
        setSaving(false);
      }
    }
  };
  const run = async (action: PixelAction) => {
    if (controller.current || applying.current) return;
    const o = latest.current,
      selection = o.selection,
      scene = o.scene();
    if (!selection || !scene) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setError(null);
    setCompleted(null);
    let release = selection.retain(),
      lease: DrawingGestureLease | null = null,
      handedOff = false,
      imageDispose: (() => void) | undefined,
      job: PreparedPixelEdit | undefined;
    try {
      const destructive = action === "move" || action === "cut" || action === "delete";
      const currentSelection = () => latest.current.selection?.id === selection.id && latest.current.frameId === selection.frame.id;
      if (!currentSelection()) throw new PixelEditError("stale");
      if (action !== "copy" && !o.canEdit) throw new Error("This drawing is read-only");
      const plan = pixelSourcePlan(scene, selection, o.layerId, o.source, destructive);
      if (destructive || (action === "duplicate" && o.source === "current")) {
        lease = await reserveDrawingLayers(
          o.pageId,
          [...new Set(plan.layers.flatMap((id) => layerAncestors(scene, id).map((l) => l.id)))],
          (action === "move" || action === "duplicate") && o.source === "current",
        );
        abort(task.signal);
        if (lease?.state() === "lost") throw new Error("The pixel selection reservation was lost");
      }
      const captured = await captureSelectedPixels(o.pageId, scene, selection, o.layerId, o.source, task.signal, action !== "delete");
      abort(task.signal);
      const current = latest.current.scene();
      if (!current || !currentSelection()) throw new PixelEditError("stale");
      checkPixelSource(current, selection, plan, destructive);
      if (action === "copy" || action === "cut") {
        await copyDrawingImage(captured.blob, pixelExportContext(o.pageId, scene, plan));
        abort(task.signal);
        if (action === "copy") {
          setCompleted("copy");
          return;
        }
      }
      const art = floatingPixelArtwork(scene, plan, action);
      let disposed = false,
        unsubscribe: (() => void) | undefined;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        unsubscribe?.();
        imageDispose?.();
        release();
      };
      const images = new Map<string, HTMLImageElement>([[art.eraseAsset.attachmentId, selection.image.source]]);
      const p: PreparedPixelEdit = {
        kind: "selection",
        action,
        scene,
        frame: plan.frame,
        region: plan.region,
        fileName: "selected-pixels.png",
        selection,
        plan,
        blob: captured.blob,
        art,
        images,
        lease,
        dispose,
        signal: task.signal,
      };
      job = p;
      if (action === "cut" || action === "delete") {
        applying.current = true;
        setSaving(true);
        try {
          await persist(p, null);
        } finally {
          applying.current = false;
          if (mounted.current) setSaving(false);
        }
        return;
      }
      const url = URL.createObjectURL(captured.blob),
        image = new Image();
      imageDispose = () => URL.revokeObjectURL(url);
      image.src = url;
      await image.decode();
      abort(task.signal);
      images.set(art.asset.attachmentId, image);
      const updateLease = () => {
        if (mounted.current) setLeaseState(lease?.state() ?? null);
      };
      unsubscribe = lease?.subscribe(updateLease);
      updateLease();
      prepared.current = p;
      handedOff = true;
      setDraft(p);
    } catch (e) {
      if (mounted.current && !task.signal.aborted) setError(e);
    } finally {
      if (!handedOff) {
        if (!job?.acknowledging) lease?.cancel();
        imageDispose?.();
        release();
        if (controller.current === task) controller.current = null;
      }
      if (mounted.current && (controller.current === task || !controller.current)) setBusy(false);
    }
  };
  const prepareImage = async (input?: Blob, action: "paste" | "import" = "paste") => {
    if (controller.current || applying.current) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setError(null);
    setCompleted(null);
    setLeaseState(null);
    let decoded: DecodedDrawingImage | undefined,
      handedOff = false;
    try {
      const o = latest.current,
        initial = o.scene();
      if (!o.canEdit) throw new Error("This drawing is read-only");
      if (!initial) throw new PixelEditError("stale");
      const frame = structuredClone(initial.frames[o.frameId] ?? initial.frames[initial.defaultFrameId]);
      const file = input ?? (await readDrawingClipboard(task.signal));
      abort(task.signal);
      decoded = await decodeDrawingImage(file, task.signal);
      abort(task.signal);
      const current = latest.current.scene(),
        now = current?.frames[frame.id];
      if (!mounted.current || !latest.current.canEdit) throw new Error("This drawing is read-only");
      if (!current || !now || ["x", "y", "w", "h"].some((key) => now[key as "x"] !== frame[key as "x"])) throw new PixelEditError("stale");
      const art = imagePixelArtwork(
        frame,
        decoded.header.width,
        decoded.header.height,
        decoded.header.mime,
        decoded.name,
        decoded.orientation,
      );
      if (decoded.animation) art.asset.frameIndex = decoded.animation.index;
      const p: PreparedPixelEdit = {
        kind: "image",
        action,
        animation: decoded.animation,
        convertedFromSvg: decoded.convertedFromSvg,
        scene: current,
        frame,
        region: { x: art.node.x, y: art.node.y, w: art.node.w, h: art.node.h },
        fileName: decoded.name,
        blob: decoded.original,
        art,
        images: new Map([[art.asset.attachmentId, decoded.source]]),
        lease: null,
        dispose: decoded.dispose,
        signal: task.signal,
      };
      prepared.current = p;
      handedOff = true;
      setDraft(p);
    } catch (e) {
      if (mounted.current && !task.signal.aborted) setError(e);
    } finally {
      if (!handedOff) {
        decoded?.dispose();
        if (controller.current === task) controller.current = null;
      }
      if (mounted.current && (controller.current === task || !controller.current)) setBusy(false);
    }
  };
  const chooseFrame = async (index: number) => {
    const p = prepared.current;
    if (
      !p ||
      p.kind !== "image" ||
      !p.animation ||
      applying.current ||
      index === p.animation.index ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= p.animation.frameCount
    )
      return;
    frameController.current?.abort();
    const task = new AbortController();
    frameController.current = task;
    const stop = () => task.abort();
    p.signal.addEventListener("abort", stop, { once: true });
    setBusy(true);
    setError(null);
    let decoded: DecodedDrawingImage | undefined,
      handedOff = false;
    try {
      valid(p);
      decoded = await decodeDrawingImage(p.blob, task.signal, undefined, index);
      abort(task.signal);
      valid(p);
      if (prepared.current !== p) throw new PixelEditError("stale");
      const next: PreparedPixelEdit = {
        ...p,
        animation: decoded.animation,
        art: { ...p.art, asset: { ...p.art.asset, frameIndex: index } },
        images: new Map([[p.art.asset.attachmentId, decoded.source]]),
        dispose: decoded.dispose,
      };
      prepared.current = next;
      handedOff = true;
      setDraft(next);
      p.dispose();
    } catch (error) {
      if (mounted.current && !task.signal.aborted) setError(error);
    } finally {
      p.signal.removeEventListener("abort", stop);
      if (!handedOff) decoded?.dispose();
      if (frameController.current === task) {
        frameController.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  };
  return { draft, busy, saving, error, completed, leaseState, run, apply, cancel, prepareImage, chooseFrame };
}
