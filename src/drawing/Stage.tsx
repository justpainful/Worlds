import {effectiveLayer,isolateLayerScene} from "./layers";
import {makeAnnotationAnchor} from "./annotations";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { bounds, clamp, frameAt, hitNode, inkCorners, localToWorld, worldToLocal } from "./geometry";
import { samplePointer, smoothSample } from "./brush";
import { DrawingRenderer, type DraftClip, type Viewport } from "./renderer";
import { LaserOverlay, type LaserStroke } from "./laser";
import { id, newNode, type Brush, type DrawingNode, type DrawingScene, type Point, type Sample, type Shape } from "./model";
import { recognizeShape } from "./recognition";
import type { DrawingPeer } from "./collaboration";
import { DrawingDraftBuffer } from "./drafts";
import type { DrawingGestureLease } from "./gestureLeases";
import { StrokeInput } from "./brushWork";
import { brushFootprint, strokeBounds } from "./brushBounds";
import { useStore } from "../state/store";
import { ObjectTransformError, objectTransformOrigin, transformObjects, translateObjects, transformedScene, type ObjectTransform } from "./objectTransforms";
import { gripPoint, gripTransform, resizeGrips, selectionTransformFrame, type TransformFrame, type TransformGrip } from "./transformHandles";
import type { AlphaMaskPreview, SelectionKind, SelectionMode } from "./pixelSelection";
import type { PixelSelection } from "./selectionController";
import { selectionImageRect } from "./selectionPaint";
import {DrawingMinimap} from "./Minimap";
import {snapMove,snapPoint} from "./snapping";
import { pathFromNode } from "./paths";
import { samePixelTransform } from "./floatingPixels";
import {sampleDrawingColor} from "./colorSample";
import {viewportReferences} from "./viewportReferences";

export type Tool = "select" | "brush" | "eraser" | "highlighter" | "laser" | "shape" | "text" | "eyedropper" | "fill" | "selection" | "redact";
function nextBadgeNumber(scene: DrawingScene): number {
  let maximum = 0;
  for (const id of scene.nodeOrder) {
    const node = scene.nodes[id], value = node?.number ?? 1;
    if (node?.kind === "shape" && node.shape === "number" && typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 999999) maximum = Math.max(maximum, value);
  }
  return maximum + 1;
}
export interface PaintContext { selection:PixelSelection|null; signal:AbortSignal }
interface Gesture { type: "pan" | "stroke" | "shape" | "move" | "transform" | "laser" | "selection"; pointerId: number; start: Point; startFrameId?:string|null; screen: Point; view: Viewport; samples: Sample[]; input?: StrokeInput; node?: DrawingNode; laser?: LaserStroke; delta?: Point; ids?: string[]; before?: DrawingNode[]; lease?: Promise<DrawingGestureLease | null>; reservation?: DrawingGestureLease | null; dispose?: () => void; cancelled?: boolean; grip?: TransformGrip; transformFrame?: TransformFrame; sourceScene?: DrawingScene; transform?: ObjectTransform; selection?:PixelSelection|null; releaseSelection?:()=>void; commitController?:AbortController; selectionKind?:SelectionKind; selectionMode?:SelectionMode }
export interface StageProps {
  scene: DrawingScene; tool: Tool; brush: Brush; shape: Shape; layerId: string; frameId: string;
  editable: boolean; onError: (message: string) => void;
  sampleMerged?:boolean;
  isolatedLayerId?:string;
  keyboardActive?:boolean;
  selected: string[]; view: Viewport; autoShape: boolean; laserLifetime: number;
  onView: (view: Viewport) => void; onSelect: (ids: string[]) => void;
  onResize: (width: number, height: number) => void;
  onAdd: (node: DrawingNode, correction?: DrawingNode, context?:PaintContext) => void|Promise<void>;
  onMove: (ids: string[], dx: number, dy: number, before?: DrawingNode[]) => Promise<string[]> | string[] | void;
  onText: (point: Point, node?: DrawingNode, frameId?:string|null) => void; onColor: (color: string) => void;
  onFill: (point: Point) => void; onRegion: (points: Point[], mode: SelectionMode,kind?:SelectionKind) => void;
  selectionKind: SelectionKind; selectionMode?:SelectionMode; pixelSelection?:PixelSelection|null;
  peers?: DrawingPeer[]; onPointer?: (point: Point | null) => void; onLaser?: (stroke: LaserStroke | null) => void; onInteraction?: () => void;
  commentPins?: { id: string; point: Point; label: string }[]; onComment?: (id: string) => void;
  onDraft?: (node: DrawingNode | null,selection?:PixelSelection|null) => void;
  onBeginEdit?: (ids: string[]) => Promise<DrawingGestureLease | null>; onLeaseState?: (state: "waiting" | "locked" | "offline" | "lost" | null) => void;
  onTransformDraft?: (ids: string[], delta: Point | null) => void;
  onObjectTransformDraft?: (ids: string[], transform: ObjectTransform | null) => void;
  onTransform: (before: DrawingNode[], after: DrawingNode[]) => Promise<string[]>;
  onTransformRequest?: () => void;
  minimap?:boolean;
  previewImages?:ReadonlyMap<string,HTMLImageElement>;
  interactiveIds?:string[];
  previewIdentity?:{node:DrawingNode;hiddenIds:string[]};
  fillPreview?: { url: string; frameId: string; layerId: string; alphaLock: boolean; x: number; y: number; w: number; h: number } | null;
}
export function DrawingStage(props: StageProps) {
  const { scene, view } = props;
  const language = useStore((s) => s.profile?.language);
  const arabic = language === "ar" || language === "auto" && navigator.language.startsWith("ar");
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<DrawingRenderer | null>(null), lasers = useRef(new LaserOverlay());
  const gesture = useRef<Gesture | null>(null), space = useRef(false), frame = useRef(0);
  const finishing = useRef<Gesture | null>(null), abortGesture = useRef(() => {});
  const keyboardEpoch = useRef(0), keyboardQueue = useRef<Promise<void>>(Promise.resolve());
  const keyboardMounted = useRef(true);
  const keyboardAction = useRef<(grip: TransformGrip, key: string, shift: boolean, alt: boolean) => Promise<void>>(async () => {});
  const latest = useRef(props); latest.current = props;
  const colorTask=useRef<AbortController|null>(null);
  useEffect(()=>()=>{colorTask.current?.abort();colorTask.current=null;},[props.tool,props.frameId,props.layerId,props.sampleMerged,scene]);
  const [size, setSize] = useState({ w: 800, h: 600 }), [draft, setDraft] = useState<DrawingNode | undefined>();
  const [move, setMove] = useState<Point>({ x: 0, y: 0 });
  const [transformPreview, setTransformPreview] = useState<DrawingNode[] | null>(null);
  const [keyboardPending, setKeyboardPending] = useState(0);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [selectionTrace,setSelectionTrace]=useState<Point[]>([]),[polygon,setPolygon]=useState<Point[]>([]);
  const polygonMode=useRef<SelectionMode>("replace"),finishPolygon=useRef(()=>{}),maskId=`selection-${useId().replace(/:/g,"")}`;
  const peerMasks=useRef(new WeakMap<AlphaMaskPreview,HTMLCanvasElement>());
  const fillPreviewId=`fill-preview-${useId().replace(/:/g,"")}`;
  const [fillImage,setFillImage]=useState<{url:string;image:HTMLImageElement}|null>(null);
  useEffect(()=>{
    const url=props.fillPreview?.url;if(!url){setFillImage(null);return;}
    let active=true;const image=new Image();image.onload=()=>{if(active)setFillImage({url,image});};image.onerror=()=>{if(active)setFillImage(null);};image.src=url;
    return()=>{active=false;image.onload=null;image.onerror=null;};
  },[props.fillPreview?.url]);
  const previewImages=useMemo(()=>{
    if(!fillImage||fillImage.url!==props.fillPreview?.url)return props.previewImages;
    const images=new Map<string,HTMLImageElement>(props.previewImages);images.set(fillPreviewId,fillImage.image);return images;
  },[fillImage,props.fillPreview?.url,props.previewImages,fillPreviewId]);
  useEffect(()=>props.pixelSelection?.retain(),[props.pixelSelection]);
  abortGesture.current = () => { keyboardEpoch.current++; const g = gesture.current ?? finishing.current; if (g) { g.cancelled = true; g.dispose?.(); g.reservation?.cancel(); g.commitController?.abort(); g.releaseSelection?.(); if (g.laser) {g.laser.releasedAt = performance.now();latest.current.onLaser?.(g.laser);} } gesture.current = null; if(!g?.laser)latest.current.onLaser?.(null); latest.current.onDraft?.(null); latest.current.onTransformDraft?.([], null); latest.current.onObjectTransformDraft?.([], null); latest.current.onLeaseState?.(null); setDraft(undefined); setMove({ x: 0, y: 0 }); setTransformPreview(null); setSelectionTrace([]); setPolygon([]); };
  useEffect(() => { if (!props.editable) abortGesture.current(); }, [props.editable]);
  useEffect(() => { abortGesture.current(); }, [props.tool]);
  useEffect(() => { abortGesture.current(); }, [props.frameId,props.selectionKind]);
  useEffect(() => { const g = gesture.current ?? finishing.current; if (g?.ids && (g.type === "transform" && g.ids.length !== props.selected.length || g.ids.some(id => !props.selected.includes(id)))) abortGesture.current(); }, [props.selected]);
  useEffect(() => { const g = gesture.current; if (g?.ids?.some(id => { const n = scene.nodes[id], l = n && effectiveLayer(scene,n.layerId); return !n || n.locked || !l || l.locked || l.positionLocked; })) abortGesture.current(); }, [scene]);
  const remoteSequence = useRef(new Map<number, string>());
  const remoteDrafts = useRef(new DrawingDraftBuffer());
  const [previewClock, setPreviewClock] = useState(0), [assetVersion, setAssetVersion] = useState(0);
  useEffect(() => { remoteDrafts.current.update(props.peers ?? [], performance.now()); setPreviewClock((value) => value + 1); if (!(props.peers ?? []).some((peer) => peer.presence.draft)) return; const timer = setInterval(() => setPreviewClock((value) => value + 1), 250); return () => clearInterval(timer); }, [props.peers]);
  useEffect(() => { props.onDraft?.(draft ?? null,(gesture.current??finishing.current)?.selection??null); }, [draft]);
  const drawOverlay = () => {
    const c = overlay.current; if (!c) return;
    const ctx = c.getContext("2d")!; const p = latest.current, scale = devicePixelRatio || 1;
    ctx.resetTransform(); ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(p.view.scale * scale, 0, 0, p.view.scale * scale, -p.view.x * p.view.scale * scale, -p.view.y * p.view.scale * scale);
    lasers.current.draw(ctx, performance.now(), matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (lasers.current.strokes.size) frame.current = requestAnimationFrame(drawOverlay);
  };
  useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const r = new DrawingRenderer({previewImages:latest.current.previewImages}); renderer.current = r;
    r.onAssetChange = () => setAssetVersion((version) => version + 1);
    const refresh = setInterval(() => { const p=latest.current;void r.refreshReferences(viewportReferences(p.scene,p.view)); }, 15000);
    return () => { clearInterval(refresh); r.dispose(); renderer.current = null; cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(()=>{renderer.current?.setPreviewImages(previewImages);setAssetVersion(v=>v+1);},[previewImages]);
  useEffect(() => {
    keyboardMounted.current = true;
    const keydown = (e: KeyboardEvent) => {
      const hostElement=host.current;if(!hostElement||latest.current.keyboardActive===false||!hostElement.getClientRects().length||e.defaultPrevented||e.isComposing)return;
      const target=e.target as Element|null;if(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="listbox"]'))return;
      const dialogs=document.querySelectorAll('[role="dialog"]'),dialog=dialogs[dialogs.length-1];if(dialog&&!dialog.contains(hostElement))return;
      if(e.code==='Space'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!target?.closest?.('button')){e.preventDefault();space.current=true;}
      if(e.key==='Escape')abortGesture.current();
      if(e.key==='Enter'&&latest.current.tool==='selection'&&latest.current.selectionKind==='polygon'&&hostElement.contains(document.activeElement)){e.preventDefault();finishPolygon.current();}
    };
    const keyup = (e: KeyboardEvent) => { if (e.code === "Space") space.current = false; };
    const blur = () => { space.current = false; abortGesture.current(); latest.current.onPointer?.(null); };
    window.addEventListener("keydown", keydown); window.addEventListener("keyup", keyup); window.addEventListener("blur", blur);
    return () => { keyboardMounted.current = false; keyboardEpoch.current++; window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup); window.removeEventListener("blur", blur); const g = gesture.current ?? finishing.current; if (g) { g.cancelled = true; g.dispose?.(); g.reservation?.cancel(); g.commitController?.abort(); g.releaseSelection?.(); } latest.current.onDraft?.(null); latest.current.onTransformDraft?.([], null); latest.current.onObjectTransformDraft?.([], null); };
  }, []);
  useEffect(() => {
    const c = canvas.current; if (!c || !renderer.current) return;
    const dpr = devicePixelRatio || 1;
    const peerPreview = remoteDrafts.current.project(scene, performance.now());
    let visibleScene = peerPreview.scene;
    const fill=props.fillPreview;
    if(fill&&fillImage?.url===fill.url&&visibleScene.layers[fill.layerId]&&visibleScene.frames[fill.frameId]){
      const node=newNode("raster",fill.layerId,fill.frameId,{x:fill.x,y:fill.y,w:fill.w,h:fill.h});node.id=fillPreviewId;node.assetId=fillPreviewId;node.alphaLock=fill.alphaLock;
      visibleScene={...visibleScene,nodes:{...visibleScene.nodes,[fillPreviewId]:node},nodeOrder:[...visibleScene.nodeOrder,fillPreviewId],assets:{...visibleScene.assets,[fillPreviewId]:{id:fillPreviewId,attachmentId:fillPreviewId,name:"Fill preview",mime:"image/png",width:fill.w,height:fill.h}}};
    }
    if (move.x || move.y) {
      const originals = gesture.current?.before ?? (gesture.current?.ids ?? props.selected).map((id) => scene.nodes[id]).filter(Boolean);
      visibleScene = transformedScene(visibleScene, translateObjects(scene, originals, move));
    }
    if (transformPreview) visibleScene = transformedScene(visibleScene, transformPreview);
    const clips=new Map<string,DraftClip>();
    for(const[id,mask]of peerPreview.selections){let source=peerMasks.current.get(mask);if(!source){source=document.createElement("canvas");source.width=mask.width;source.height=mask.height;const pixels=new Uint8ClampedArray(mask.width*mask.height*4);for(let i=0;i<mask.alpha.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=255;pixels[i*4+3]=mask.alpha[i];}source.getContext("2d")!.putImageData(new ImageData(pixels,mask.width,mask.height),0,0);peerMasks.current.set(mask,source);}clips.set(id,{rect:mask,source});}
    const selection=(gesture.current??finishing.current)?.selection;if(draft&&selection&&draft.frameId===selection.frame.id)clips.set(draft.id,{rect:selectionImageRect(selection),source:selection.image.source});
    if(props.isolatedLayerId)visibleScene=isolateLayerScene(visibleScene,props.isolatedLayerId);
    const identity=props.previewIdentity,hiddenNodeIds=identity&&visibleScene.nodes[identity.node.id]&&samePixelTransform(identity.node,visibleScene.nodes[identity.node.id])?identity.hiddenIds:undefined;
    try{renderer.current.render(c, visibleScene, { ...view, w: size.w / view.scale, h: size.h / view.scale, scale: view.scale * dpr }, {incremental:true,immutableScene:true,activeLayerId:props.layerId, draft, drafts: peerPreview.nodes,draftClips:clips,hiddenNodeIds });}catch(error){c.getContext("2d")?.clearRect(0,0,c.width,c.height);props.onError(error instanceof Error?error.message:String(error));}
    cancelAnimationFrame(frame.current); drawOverlay();
  }, [scene, view, size, draft, move, transformPreview, props.selected, previewClock, assetVersion,props.previewIdentity,props.isolatedLayerId,props.layerId,props.fillPreview,fillImage,fillPreviewId]);
  useEffect(() => { props.onResize?.(size.w, size.h); }, [size]);
  useEffect(()=>{if(props.keyboardActive===false){space.current=false;abortGesture.current();}},[props.keyboardActive]);
  useEffect(() => {
    const active = new Set<number>();
    for (const peer of props.peers ?? []) {
      active.add(peer.clientId); const l = peer.presence.laser, actor = `peer:${peer.clientId}`;
      if (!l) { lasers.current.removeActor(actor); remoteSequence.current.delete(peer.clientId); continue; }
      const sequence = `${l.id}:${l.sequence}`; if (remoteSequence.current.get(peer.clientId) === sequence) continue;
      remoteSequence.current.set(peer.clientId, sequence);
      const now=performance.now(),strokeId=`${actor}:${l.id}`;
      for(const stroke of lasers.current.strokes.values()) if(stroke.actor===actor&&stroke.id!==strokeId&&stroke.releasedAt===null) stroke.releasedAt=now;
      const previous=lasers.current.strokes.get(strokeId);
      lasers.current.update({ id: strokeId, actor, color: l.color, width: l.width, opacity: l.opacity, points: l.points, releasedAt: l.released ? previous?.releasedAt ?? now : null, lifetime: l.lifetime });
    }
    for (const client of remoteSequence.current.keys()) if (!active.has(client)) { lasers.current.removeActor(`peer:${client}`); remoteSequence.current.delete(client); }
    cancelAnimationFrame(frame.current); drawOverlay();
  }, [props.peers]);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.scale + view.x, y: (e.clientY - r.top) / view.scale + view.y };
  };
  const makeStroke = (samples: Sample[], previous = gesture.current?.type === "stroke" ? gesture.current.node : undefined): DrawingNode => {
    const brush = previous?.brush ?? { ...props.brush, kind: props.tool === "highlighter" && props.brush.kind !== "marker" ? "highlighter" as const : props.brush.kind };
    const box = strokeBounds(samples, brush), n = previous ? { ...previous, ...box } : newNode("stroke", props.layerId, props.pixelSelection?.frame.id ?? frameAt(scene, samples[0]), box);
    n.name = props.tool === "eraser" ? "Eraser" : props.tool === "highlighter" ? "Highlighter" : "Brush stroke";
    n.samples = samples.map((p) => ({ ...p, x: p.x - box.x, y: p.y - box.y }));
    n.brush = brush; n.erase = props.tool === "eraser"; n.seed ??= Math.floor(Math.random() * 2147483647);
    n.alphaLock = effectiveLayer(scene,props.layerId).alphaLocked;
    if (gesture.current?.type === "stroke") gesture.current.node = n;
    return n;
  };
  const appendSample = (g: Gesture, sample: Sample) => {
    if (!g.input || g.input.limited) return;
    if (!g.input.append(sample)) props.onError(arabic
      ? "وصلت ضربة الفرشاة إلى حد الرسم. ارفع القلم لحفظ الجزء المرسوم ثم ابدأ ضربة جديدة."
      : "This stroke reached its paint limit. Release to save the painted portion, then start another stroke.");
  };
  finishPolygon.current=()=>{if(polygon.length>=3)props.onRegion(polygon,polygonMode.current,"polygon");setPolygon([]);setSelectionTrace([]);};
  const savePaint=async(g:Gesture,node:DrawingNode,correction?:DrawingNode)=>{
    finishing.current=g;g.commitController=new AbortController();setDraft(node);
    try{await latest.current.onAdd(node,correction,{selection:g.selection??null,signal:g.commitController.signal});}
    catch(error){if(!g.commitController.signal.aborted)latest.current.onError(error instanceof Error?error.message:String(error));}
    finally{g.releaseSelection?.();if(finishing.current===g)finishing.current=null;setDraft(undefined);latest.current.onDraft?.(null);}
  };
  const showTransform = (g: Gesture) => {
    if (g.cancelled || g.lease && g.reservation === undefined || g.reservation?.state() === "lost" || !g.transform) return;
    setTransformPreview(transformObjects(g.sourceScene!, g.before!, g.transform));
    if (g.reservation?.state() === "locked") latest.current.onObjectTransformDraft?.(g.ids!, g.transform);
  };
  const reserve = (g: Gesture) => {
    if (!props.onBeginEdit) return;
    props.onLeaseState?.("waiting");
    g.lease = props.onBeginEdit(g.ids!).then((lease) => {
      g.reservation = lease;
      if (g.cancelled) { lease?.cancel(); return lease; }
      const changed = () => {
        latest.current.onLeaseState?.(lease?.state() ?? null);
        if (lease?.state() === "lost") { if (!g.cancelled) latest.current.onError(arabic ? "فُقد حجز العناصر. أُلغيت المعاينة، أعد المحاولة." : "The element reservation was lost. The preview was cancelled; try again."); g.cancelled = true; setMove({ x: 0, y: 0 }); setTransformPreview(null); latest.current.onTransformDraft?.([], null); latest.current.onObjectTransformDraft?.([], null); }
      };
      g.dispose = lease?.subscribe(changed); changed();
      if (gesture.current === g && !g.cancelled) { if (g.type === "transform") showTransform(g); else if (g.delta) setMove(g.delta); }
      return lease;
    }).catch((error) => { if (!g.cancelled) { g.cancelled = true; latest.current.onLeaseState?.("lost"); latest.current.onError(error instanceof Error ? error.message : String(error)); } return null; });
  };
  const beginHandle = (grip: TransformGrip, pointer: Point, pointerId: number): Gesture | null => {
    if (gesture.current || finishing.current || props.tool !== "select" || !props.editable || !props.selected.length) return null;
    const nodes = props.selected.map(id => scene.nodes[id]);
    if (nodes.some(n => !n || n.locked || !scene.layers[n.layerId] || effectiveLayer(scene,n.layerId).locked || effectiveLayer(scene,n.layerId).positionLocked)) return null;
    const g: Gesture = { type: "transform", pointerId, start: pointer, screen: { x: 0, y: 0 }, view, samples: [], ids: [...props.selected], before: structuredClone(nodes), sourceScene: scene, grip, transformFrame: selectionTransformFrame(scene, nodes) };
    gesture.current = g; props.onInteraction?.(); reserve(g); return g;
  };
  const updateHandle = (g: Gesture, point: Point, shift: boolean, alt: boolean) => {
    g.transform = gripTransform(g.sourceScene!, g.before!, g.transformFrame!, g.grip!, g.start, point, { shift, alt }); showTransform(g);
  };
  const finishEdit = async (g: Gesture) => {
    gesture.current = null; finishing.current = g;
    try {
      const lease = await g.lease;
      if (g.cancelled) { lease?.cancel(); return; }
      if (lease?.state() === "lost") throw new Error(arabic ? "فُقد حجز العناصر. أعد المحاولة." : "The element reservation was lost. Try again.");
      const p = latest.current;
      const operations = g.type === "transform"
        ? g.transform ? await p.onTransform(g.before!, transformObjects(g.sourceScene!, g.before!, g.transform)) : []
        : g.delta && (g.delta.x || g.delta.y) ? await p.onMove(g.ids ?? [], g.delta.x, g.delta.y, g.before) : [];
      lease?.finish(operations ?? []);
    } catch (error) {
      g.reservation?.cancel();
      const message = error instanceof ObjectTransformError ? error.code === "stale" ? arabic ? "تغيّر أحد العناصر. أعد التحويل." : "An element changed. Try the transform again." : arabic ? "تعذر تحويل العناصر المحددة." : "The selected elements could not be transformed." : error instanceof Error ? error.message : String(error);
      latest.current.onError(message);
    } finally { g.dispose?.(); finishing.current = null; setMove({ x: 0, y: 0 }); setTransformPreview(null); latest.current.onTransformDraft?.([], null); latest.current.onObjectTransformDraft?.([], null); latest.current.onLeaseState?.(null); }
  };
  keyboardAction.current = async (grip, key, shift, alt) => {
    const nodes = props.selected.map(id => scene.nodes[id]).filter(Boolean); if (!nodes.length) return;
    const point = gripPoint(selectionTransformFrame(scene, nodes), grip, view.scale), g = beginHandle(grip, point, -1); if (!g) return;
    const sign = ["ArrowLeft", "ArrowUp"].includes(key) ? -1 : 1;
    let target: Point;
    if (grip === "rotate") { const o = objectTransformOrigin(scene, g.before!), a = sign * (shift ? 15 : 1) * Math.PI / 180, dx = point.x - o.x, dy = point.y - o.y; target = { x: o.x + dx * Math.cos(a) - dy * Math.sin(a), y: o.y + dx * Math.sin(a) + dy * Math.cos(a) }; }
    else { const step = shift ? 10 : 1; target = { x: point.x + (key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0), y: point.y + (key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0) }; }
    updateHandle(g, target, false, alt); await finishEdit(g);
  };
  const pointerDown = (e: ReactPointerEvent) => {
    if (gesture.current || finishing.current || (e.button !== 0 && e.button !== 1)) return;
    props.onInteraction?.();
    e.preventDefault(); host.current!.focus(); e.currentTarget.setPointerCapture(e.pointerId);
    const raw=at(e),under=frameAt(scene,raw),p=(props.tool==="shape"||props.tool==="text")&&under?snapPoint(scene.frames[under],raw,view.scale,e.altKey):raw, base = { pointerId: e.pointerId, start: p, startFrameId:under, screen: { x: e.clientX, y: e.clientY }, view, samples: [samplePointer(e.nativeEvent, p.x, p.y)] };
    if (space.current || e.button === 1 || e.pointerType === "touch") { gesture.current = { ...base, type: "pan" }; return; }
    if (props.tool === "eyedropper") {
      colorTask.current?.abort();const controller=new AbortController();colorTask.current=controller;
      void sampleDrawingColor(scene,p,props.frameId,props.layerId,props.sampleMerged!==false,controller.signal).then(color=>{if(!controller.signal.aborted&&latest.current.scene===scene)props.onColor(color);}).catch(error=>{if(!controller.signal.aborted)props.onError(arabic?'تعذّر التقاط اللون من هذا الموضع':error instanceof Error?error.message:'The color could not be sampled');}).finally(()=>{if(colorTask.current===controller)colorTask.current=null;});
      return;
    }
    if (props.tool === "select") {
      const hit = renderer.current?.hitTest(props.isolatedLayerId?isolateLayerScene(scene,props.isolatedLayerId):props.interactiveIds?{...scene,nodeOrder:props.interactiveIds}:scene, p) ?? null;
      const hitIds = hit?.groupId ? scene.nodeOrder.filter((id) => scene.nodes[id].groupId === hit.groupId) : hit ? [hit.id] : [];
      const ids = hit ? e.shiftKey ? [...new Set([...props.selected, ...hitIds])] : props.selected.includes(hit.id) ? props.selected : hitIds : [];
      props.onSelect(ids);
      if (hit && props.editable && !scene.layers[hit.layerId].positionLocked) {
        const movable = ids.filter((id) => {const node=scene.nodes[id],layer=node&&effectiveLayer(scene,node.layerId);return!!node&&!!layer&&!node.locked&&!layer.locked&&!layer.positionLocked;});
        if (!movable.length) return;
        const g: Gesture = { ...base, type: "move", node: hit, ids: movable, before: movable.map((id) => structuredClone(scene.nodes[id])) }; gesture.current = g;
        reserve(g);
      }
      return;
    }
    if (props.tool === "selection") {
      const mode:SelectionMode=e.shiftKey&&e.altKey?"intersect":e.shiftKey?"add":e.altKey?"subtract":props.selectionMode??"replace";
      if(props.selectionKind==="magic"){props.onRegion([p],mode,"magic");return;}
      if(props.selectionKind==="polygon"){
        if(polygon.length>=65536){props.onError(arabic?"التحديد يحتوي نقاطًا كثيرة. أغلقه ثم استخدم الإضافة لبقية المنطقة.":"This selection has too many points. Close it and use Add for the rest.");return;}
        if(!polygon.length)polygonMode.current=mode;
        setPolygon(points=>{const last=points.at(-1);return last&&Math.hypot(last.x-p.x,last.y-p.y)*view.scale<2?points:[...points,p];});return;
      }
      gesture.current = { ...base, type: "selection",selectionKind:props.selectionKind,selectionMode:mode };setSelectionTrace([p]);return;
    }
    if (props.tool === "laser") {
      const laser: LaserStroke = { id: id(), actor: "local", points: [p], color: props.brush.color, width: props.brush.size, opacity: props.brush.opacity, releasedAt: null, lifetime: props.laserLifetime };
      lasers.current.update(laser); props.onLaser?.(laser); gesture.current = { ...base, type: "laser", laser }; cancelAnimationFrame(frame.current); drawOverlay(); return;
    }
    const layer = effectiveLayer(scene,props.layerId); if (!scene.layers[props.layerId] || layer.locked || !props.editable) return;
    if(props.tool==="eraser"&&layer.alphaLocked){props.onError(arabic?"شفافية هذه الطبقة مقفلة":"This layer transparency is locked");return;}
    if (props.tool === "fill") { props.onFill(p); return; }
    if (props.tool === "text") { props.onText(p,undefined,under); return; }
    gesture.current = { ...base, type: props.tool === "shape"||props.tool === "redact" ? "shape" : "stroke" };
    const selection=props.pixelSelection??null;gesture.current.selection=selection;gesture.current.releaseSelection=selection?.retain();
    if (props.tool !== "shape"&&props.tool!=="redact") {
      const node = makeStroke(base.samples), input = new StrokeInput(base.samples[0], node.brush!);
      gesture.current.input = input; gesture.current.samples = input.samples;
      setDraft(node);
    }
  };
  const pointerMove = (e: ReactPointerEvent) => {
    const p = at(e), r = host.current!.getBoundingClientRect(); setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    props.onPointer?.(p);
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    if (g.type === "pan") { props.onView({ ...g.view, x: g.view.x - (e.clientX - g.screen.x) / g.view.scale, y: g.view.y - (e.clientY - g.screen.y) / g.view.scale }); return; }
    if (g.type === "move") { const nodes=g.before??[],owner=nodes[0]?.frameId,frame=owner&&nodes.every(n=>n.frameId===owner)?scene.frames[owner]:undefined,delta={x:p.x-g.start.x,y:p.y-g.start.y};g.delta=frame?snapMove(scene,frame,nodes,delta,view.scale,e.altKey):delta; if (g.cancelled || g.lease && g.reservation === undefined || g.reservation?.state() === "lost") return; setMove(g.delta); if (g.reservation?.state() === "locked") props.onTransformDraft?.(g.ids ?? [], g.delta); return; }
    if (g.type === "transform") { updateHandle(g, p, e.shiftKey, e.altKey); return; }
    if (g.type === "laser") { const events=e.nativeEvent.getCoalescedEvents?.()??[];for(const event of events.length?events:[e.nativeEvent])g.laser!.points.push(at(event));if (g.laser!.points.length > 2048) g.laser!.points.splice(0, g.laser!.points.length - 2048); props.onLaser?.(g.laser!); return; }
    if (g.type === "selection") {
      const events=e.nativeEvent.getCoalescedEvents?.()??[e.nativeEvent];
      for(const event of events.length?events:[e.nativeEvent]){if(g.samples.length>=65536){abortGesture.current();props.onError(arabic?"التحديد يحتوي نقاطًا كثيرة. أعد رسم حدوده على أجزاء باستخدام الإضافة.":"This selection has too many points. Select its boundary in parts using Add.");return;}const q=at(event);g.samples.push(samplePointer(event,q.x,q.y));}
      setSelectionTrace(g.selectionKind==="lasso"?[...g.samples]:[g.start,p]);return;
    }
    if (g.type === "shape") {
      const owner=g.startFrameId,snapped=owner?snapPoint(scene.frames[owner],p,view.scale,e.altKey):p;
      const end = e.shiftKey ? { x: g.start.x + Math.sign(p.x - g.start.x) * Math.max(Math.abs(p.x - g.start.x), Math.abs(p.y - g.start.y)), y: g.start.y + Math.sign(p.y - g.start.y) * Math.max(Math.abs(p.x - g.start.x), Math.abs(p.y - g.start.y)) } : snapped;
      const box = bounds([g.start, end]), n = g.node ? { ...g.node, ...box } : newNode("shape", props.layerId, g.selection?.frame.id ?? g.startFrameId ?? null, box);
      n.shape = props.shape;n.alphaLock=effectiveLayer(scene,props.layerId).alphaLocked; n.paint = { ...n.paint, stroke: props.brush.color, strokeWidth: props.brush.size };
      if (n.shape === "number" && n.number === undefined) n.number = nextBadgeNumber(scene);
      if(props.shape==="curve"||props.shape==="polyline")n.path=pathFromNode({...n,path:undefined});
      if(props.shape==="highlight"){n.paint={...n.paint,fill:props.brush.color,stroke:"transparent"};n.opacity=0.35;}
      if (["line", "arrow", "double-arrow"].includes(props.shape)) n.points = [g.start, end].map((p) => ({ x: p.x - box.x, y: p.y - box.y }));
      if (["arrow", "double-arrow"].includes(props.shape)) {
        const makeAnchor = (point: Point) => {
          const target = hitNode(scene, point), local = target ? worldToLocal(target, point) : point;
          return {...makeAnnotationAnchor(scene,target?.id??null,target?clamp(local.x/target.w,0,1):0,target?clamp(local.y/target.h,0,1):0,point),u:target?local.x/target.w:0,v:target?local.y/target.h:0,fallback:point};
        };
        n.anchor = makeAnchor(g.start); n.endAnchor = makeAnchor(end); n.annotationGroup = n.id; n.annotationStatus = "open";
      }
      if(props.tool==="redact"){n.redaction=true;n.shape="rect";n.name="Redaction";n.opacity=1;n.rotation=0;n.alphaLock=false;n.paint={...n.paint,fill:"#000000",stroke:"#000000",strokeWidth:0,gradient:undefined};n.effects=[];delete n.maskId;delete n.path;delete n.anchor;delete n.endAnchor;delete n.annotationGroup;delete n.annotationStatus;}
      g.node = n; setDraft(n); return;
    }
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const event of events.length ? events : [e.nativeEvent]) {
      const q = at(event), sample = samplePointer(event, q.x, q.y);
      if (e.shiftKey && props.tool === "highlighter") sample.y = g.start.y;
      appendSample(g, smoothSample(g.samples[g.samples.length - 1], sample, g.input!.brush));
      if (g.input?.limited) break;
    }
    setDraft(makeStroke(g.samples));
  };
  const pointerUp = async (e: ReactPointerEvent) => {
    const g = gesture.current; if (g && g.pointerId !== e.pointerId) return; gesture.current = null; setDraft(undefined);
    if (!g) return;
    if (g.type === "move" || g.type === "transform") { if (g.type === "transform") updateHandle(g, at(e), e.shiftKey, e.altKey); await finishEdit(g); return; }
    if (g.type === "laser") { g.laser!.points.push(at(e));if(g.laser!.points.length>2048)g.laser!.points.shift();g.laser!.releasedAt = performance.now(); props.onLaser?.(g.laser!); return; }
    if (g.type === "selection") { const end=at(e);setSelectionTrace([]);props.onRegion(g.selectionKind==="lasso"?[...g.samples,end]:[g.start,end],g.selectionMode??"replace",g.selectionKind);return; }
    if (g.type === "shape") {
      // Number badges can be placed by a single click as well as by dragging.
      // Keep the same selection, layer locks and single-edit Undo as other shapes.
      if (!g.node && props.tool === "shape" && props.shape === "number") {
        const size=clamp(40/view.scale,16,256), owner=g.selection?.frame.id??g.startFrameId??null;
        const node=newNode("shape",props.layerId,owner,{x:g.start.x-size/2,y:g.start.y-size/2,w:size,h:size});
        node.shape="number";node.number=nextBadgeNumber(scene);node.alphaLock=effectiveLayer(scene,props.layerId).alphaLocked;
        node.paint={...node.paint,stroke:props.brush.color,strokeWidth:props.brush.size};g.node=node;
      }
      if(g.node)await savePaint(g,g.node);else g.releaseSelection?.();return;
    }
    if (g.type === "stroke") {
      const end = at(e); appendSample(g, { ...samplePointer(e.nativeEvent, end.x, end.y), pressure: g.samples.at(-1)!.pressure });
      const n = makeStroke(g.samples, g.node);
      const recognized = props.autoShape && props.tool === "brush" ? recognizeShape(g.samples) : null;
      let corrected: DrawingNode | undefined;
      if (recognized) {
        corrected = { ...n, ...recognized.rect, kind: "shape", shape: recognized.shape, samples: undefined, originalSamples: n.samples?.map(sample=>({...sample,x:sample.x+n.x-recognized.rect.x,y:sample.y+n.y-recognized.rect.y})),
          points: recognized.points?.map((p) => ({ x: p.x - recognized.rect.x, y: p.y - recognized.rect.y })), paint: { ...n.paint, stroke: props.brush.color, strokeWidth: props.brush.size } };
      }
      await savePaint(g,n,corrected);
    }
  };
  const dpr = devicePixelRatio || 1;
  const displayScene = transformedScene(scene, transformPreview ?? ((move.x || move.y) ? translateObjects(scene, (gesture.current?.before ?? finishing.current?.before ?? props.selected.map(id => scene.nodes[id]).filter(Boolean)), move) : []));
  const visibleIds=props.isolatedLayerId?new Set(isolateLayerScene(scene,props.isolatedLayerId).nodeOrder):null;
  const selected = props.selected.filter(id=>!visibleIds||visibleIds.has(id)).map((id) => displayScene.nodes[id]).filter(Boolean);
  const handles = props.tool === "select" && props.editable && selected.length > 0 && selected.every(n => !n.locked && !effectiveLayer(scene,n.layerId).locked && !effectiveLayer(scene,n.layerId).positionLocked) ? selectionTransformFrame(displayScene, selected) : null;
  const uniformCursor = props.tool === "laser" || props.tool === "highlighter" || props.brush.kind === "marker" || props.brush.kind === "highlighter";
  const cursorTip = uniformCursor ? { x: props.brush.size / 2, y: props.brush.size / 2 } : brushFootprint({ ...props.brush, angle: 0 });
  const squareCursor = props.tool !== "laser" && (props.tool === "highlighter" ? props.brush.kind !== "marker" : ["texture", "highlighter"].includes(props.brush.kind));
  return <div className={`drawing-stage tool-${props.tool}`} ref={host} tabIndex={0} role="application" aria-label="Drawing canvas" aria-busy={keyboardPending > 0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={e => { if (gesture.current?.pointerId === e.pointerId) abortGesture.current(); }} onLostPointerCapture={e => { if (gesture.current?.pointerId === e.pointerId) abortGesture.current(); }} onPointerLeave={() => { setCursor(null); props.onPointer?.(null); }} onContextMenu={e => { if(props.tool==="selection"&&props.selectionKind==="polygon"&&polygon.length){e.preventDefault();e.stopPropagation();setPolygon(points=>points.slice(0,-1));} }} onDoubleClick={(e) => { if(props.tool==="selection"&&props.selectionKind==="polygon"){e.preventDefault();finishPolygon.current();return;} const node = hitNode(props.isolatedLayerId?isolateLayerScene(scene,props.isolatedLayerId):scene, at(e)); if (props.editable && node?.kind === "text") props.onText(at(e), node); }} onWheel={(e) => {
    e.preventDefault(); props.onInteraction?.(); const p = at(e), scale = clamp(view.scale * Math.exp(-e.deltaY * 0.0015), 0.025, 16), r = host.current!.getBoundingClientRect();
    props.onView({ ...view, scale, x: p.x - (e.clientX - r.left) / scale, y: p.y - (e.clientY - r.top) / scale, w:r.width/scale, h:r.height/scale });
  }}>
    <canvas ref={canvas} width={Math.round(size.w * dpr)} height={Math.round(size.h * dpr)} className="drawing-pixels" />
    <canvas ref={overlay} width={Math.round(size.w * dpr)} height={Math.round(size.h * dpr)} className="drawing-overlay" />
    <div className="drawing-decorations" aria-hidden="true">
      {scene.frameOrder.map((fid) => { const f = scene.frames[fid]; return <div key={fid} className={`drawing-frame-edge ${fid === props.frameId ? "selected" : ""}`} style={{ left: (f.x - view.x) * view.scale, top: (f.y - view.y) * view.scale, width: f.w * view.scale, height: f.h * view.scale }}><span>{f.name}</span></div>; })}
      {selected.map((n) => { if (n.kind === "stroke") { const points = inkCorners(n).map((p) => `${(p.x - view.x) * view.scale},${(p.y - view.y) * view.scale}`).join(" "); return <svg key={n.id} className="drawing-region-outline" width={size.w} height={size.h}><polygon points={points} fill="none" stroke="#ffffff" strokeWidth="3" /><polygon points={points} fill="none" stroke="#007aff" strokeWidth="1.5" /></svg>; } const p = localToWorld(n, { x: n.w / 2, y: n.h / 2 }); return <div key={n.id} className="drawing-selection" style={{ left: (p.x - n.w / 2 - view.x) * view.scale, top: (p.y - n.h / 2 - view.y) * view.scale, width: n.w * view.scale, height: n.h * view.scale, transform: `rotate(${n.rotation}deg)` }} />; })}
      {handles && <svg className="drawing-region-outline" width={size.w} height={size.h}>{["#ffffff", "#007aff"].map((color, i) => { const points = (["nw", "ne", "se", "sw"] as const).map(grip => gripPoint(handles, grip, view.scale)).map(p => `${(p.x - view.x) * view.scale},${(p.y - view.y) * view.scale}`).join(" "), top = gripPoint(handles, "n", view.scale), rotation = gripPoint(handles, "rotate", view.scale); return <g key={color} stroke={color} strokeWidth={i ? 1.5 : 3} fill="none"><polygon points={points}/><line x1={(top.x-view.x)*view.scale} y1={(top.y-view.y)*view.scale} x2={(rotation.x-view.x)*view.scale} y2={(rotation.y-view.y)*view.scale}/></g>; })}</svg>}
      {(props.peers ?? []).flatMap((peer) => peer.presence.selected.map((id) => { const n = scene.nodes[id]; return n ? <svg key={`${peer.clientId}:${id}`} className="drawing-region-outline" width={size.w} height={size.h}><polygon points={inkCorners(n).map((p) => `${(p.x - view.x) * view.scale},${(p.y - view.y) * view.scale}`).join(" ")} fill="none" stroke={peer.user.color} strokeWidth="1.5" strokeDasharray="5 3" /></svg> : null; }))}
      {(props.peers ?? []).map((peer) => peer.presence.cursor && <span key={peer.clientId} className="drawing-peer-cursor" style={{ color: peer.user.color, left: (peer.presence.cursor.x - view.x) * view.scale, top: (peer.presence.cursor.y - view.y) * view.scale }}><b aria-hidden>↖</b><small>{peer.user.name}</small></span>)}
      {props.pixelSelection&&props.pixelSelection.pixels>0&&(()=>{const rect=selectionImageRect(props.pixelSelection!);return <svg className="drawing-region-outline" width={size.w} height={size.h}><defs><pattern id={`${maskId}-stripe`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="#ffffff"/><rect width="4" height="8" fill="#202023"/></pattern><filter id={`${maskId}-edge`} filterUnits="userSpaceOnUse" x="0" y="0" width={size.w} height={size.h}><feComponentTransfer in="SourceAlpha" result="binary"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer><feMorphology in="binary" operator="dilate" radius="1" result="outer"/><feMorphology in="binary" operator="erode" radius="1" result="inner"/><feComposite in="outer" in2="inner" operator="out" result="edge"/><feFlood floodColor="#ffffff" result="white"/><feComposite in="white" in2="edge" operator="in"/></filter><mask id={`${maskId}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={size.w} height={size.h}><image href={props.pixelSelection!.image.url} x={(rect.x-view.x)*view.scale} y={(rect.y-view.y)*view.scale} width={rect.w*view.scale} height={rect.h*view.scale} preserveAspectRatio="none" filter={`url(#${maskId}-edge)`}/></mask></defs><rect width={size.w} height={size.h} fill={`url(#${maskId}-stripe)`} mask={`url(#${maskId}-mask)`}/></svg>;})()}
      {(selectionTrace.length>1||polygon.length>0)&&<svg className="drawing-region-outline" width={size.w} height={size.h}>{["#202023","#ffffff"].map((color,i)=>{const trace=polygon.length?[...polygon,...(cursor?[{x:cursor.x/view.scale+view.x,y:cursor.y/view.scale+view.y}]:[])]:selectionTrace,points=trace.map(p=>`${(p.x-view.x)*view.scale},${(p.y-view.y)*view.scale}`).join(" "),r=bounds(trace),common={fill:"none",stroke:color,strokeWidth:i?1:2,strokeDasharray:"5 5"};return props.selectionKind==="rect"?<rect key={color} x={(r.x-view.x)*view.scale} y={(r.y-view.y)*view.scale} width={r.w*view.scale} height={r.h*view.scale} {...common}/>:props.selectionKind==="ellipse"?<ellipse key={color} cx={(r.x+r.w/2-view.x)*view.scale} cy={(r.y+r.h/2-view.y)*view.scale} rx={r.w*view.scale/2} ry={r.h*view.scale/2} {...common}/>:<polyline key={color} points={points} {...common}/>;})}</svg>}
      {cursor && ["brush", "eraser", "highlighter", "laser"].includes(props.tool) && <span className="drawing-brush-cursor" style={{ left: cursor.x, top: cursor.y, width: Math.max(3, cursorTip.x * 2 * view.scale), height: Math.max(3, cursorTip.y * 2 * view.scale), borderRadius: squareCursor ? 0 : "50%", transform: `translate(-50%, -50%) rotate(${uniformCursor || props.brush.kind === "spray" ? 0 : props.brush.angle}deg)` }} />}
    </div>
    {handles && <div className="drawing-transform-handles">{[...resizeGrips, "rotate" as const].map(grip => {
      const names = { nw: "أعلى اليسار", n: "الأعلى", ne: "أعلى اليمين", e: "اليمين", se: "أسفل اليمين", s: "الأسفل", sw: "أسفل اليسار", w: "اليسار" };
      const point = gripPoint(handles, grip, view.scale), label = grip === "rotate" ? arabic ? "تدوير التحديد" : "Rotate selection" : arabic ? `تحجيم التحديد: ${names[grip]}` : `Resize selection ${grip.toUpperCase()}`;
      return <button key={grip} type="button" className={`drawing-transform-grip ${grip === "rotate" ? "is-rotation" : ""}`} data-grip={grip} aria-label={label} title={`${label}. ${arabic ? "الأسهم للتعديل، Enter للقيم الدقيقة، Escape للإلغاء" : "Arrow keys adjust, Enter opens exact values, Escape cancels"}`} style={{ left: (point.x - view.x) * view.scale, top: (point.y - view.y) * view.scale }} onPointerDown={e => { e.stopPropagation(); if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); const g = beginHandle(grip, at(e), e.pointerId); if (g) host.current!.setPointerCapture(e.pointerId); }} onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); abortGesture.current(); props.onTransformRequest?.(); return; }
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const epoch = keyboardEpoch.current, selection = [...props.selected].sort().join("\0"), key = e.key, shift = e.shiftKey, alt = e.altKey;
        setKeyboardPending(count => count + 1);
        keyboardQueue.current = keyboardQueue.current.then(async () => {
          const p = latest.current;
          if (epoch !== keyboardEpoch.current || !p.editable || p.tool !== "select" || selection !== [...p.selected].sort().join("\0")) return;
          await keyboardAction.current(grip, key, shift, alt);
          // The next key reads the committed React scene, not the stale closure
          // from the previous key while its persistence was still in flight.
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }).catch(error => latest.current.onError(error instanceof Error ? error.message : String(error))).finally(() => { if (keyboardMounted.current) setKeyboardPending(count => Math.max(0, count - 1)); });
      }}><span aria-hidden="true" /></button>;
    })}</div>}
    {(()=>{const f=scene.frames[props.frameId],grid=f.grid,guides=f.guides??[],step=(grid?.size??20)*view.scale,x=(f.x-view.x)*view.scale,y=(f.y-view.y)*view.scale;return <svg className="drawing-grid-overlay" width={size.w} height={size.h} aria-hidden="true">{grid?.visible&&step>=5&&<><defs><pattern id={`${maskId}-grid`} x={x} y={y} width={step} height={step} patternUnits="userSpaceOnUse"><path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="#666666" strokeOpacity={0.25} strokeWidth={1}/></pattern></defs><rect x={x} y={y} width={f.w*view.scale} height={f.h*view.scale} fill={`url(#${maskId}-grid)`}/></>}{guides.map(g=>g.axis==="x"?<line key={g.id} x1={x+g.at*view.scale} x2={x+g.at*view.scale} y1={y} y2={y+f.h*view.scale} stroke="#007aff" strokeWidth={1}/>:<line key={g.id} x1={x} x2={x+f.w*view.scale} y1={y+g.at*view.scale} y2={y+g.at*view.scale} stroke="#007aff" strokeWidth={1}/>)}</svg>;})()}
    {props.minimap&&<DrawingMinimap scene={scene} view={view} onView={next=>{props.onInteraction?.();props.onView(next);}} arabic={arabic}/>}
    <div className="drawing-comment-pins">{props.commentPins?.map((pin, index) => <button key={pin.id} aria-label={pin.label} title={pin.label} style={{ left: (pin.point.x - view.x) * view.scale, top: (pin.point.y - view.y) * view.scale }} onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onComment?.(pin.id)}>{index + 1}</button>)}</div>
  </div>;
}
