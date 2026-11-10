import { useEffect, useMemo, useRef, useState } from "react";
import { DrawingStage, type Tool } from "./Stage";
import { BrushStylePicker } from "./BrushPicker";
import { DEFAULT_BRUSH, id, newLayer, newNode, newScene, type Brush, type DrawingNode, type Point, type Shape } from "./model";
import { DrawingRenderer, type Viewport } from "./renderer";
import { translateObjects } from "./objectTransforms";
import "./screenDrawing.css";

export type CapturedScreen = { dataUrl: string; width: number; height: number; wasFullscreen: boolean };
type Props = { capture: CapturedScreen; arabic: boolean; initialBrush: Brush; laserLifetime: number; onClose: () => Promise<void>; isShared: () => Promise<boolean>; onSave: (blob: Blob, width: number, height: number, shareConfirmed: boolean) => Promise<void> };

/** A still capture and edits remain local until the user chooses Save. */
export function ScreenDrawing({ capture, arabic, initialBrush, laserLifetime: initialLifetime, onClose, isShared, onSave }: Props) {
  const t = (en: string, ar: string) => arabic ? ar : en;
  const [base] = useState(() => {
    const scene = newScene(), frame = scene.frames[scene.defaultFrameId], layer = scene.layers[scene.layerOrder[0]];
    frame.w = capture.width; frame.h = capture.height; frame.background = "transparent";
    layer.name = "Screen"; layer.locked = true;
    const paint = newLayer("Annotations"); scene.layers[paint.id] = paint; scene.layerOrder.push(paint.id);
    const assetId = id(), node = newNode("image", layer.id, frame.id, { x: 0, y: 0, w: capture.width, h: capture.height });
    node.assetId = assetId; node.locked = true;
    scene.assets[assetId] = { id: assetId, attachmentId: "screen-capture", name: "Screen", mime: "image/png", width: capture.width, height: capture.height };
    scene.nodes[node.id] = node; scene.nodeOrder.push(node.id);
    return { scene, layerId: paint.id, frameId: frame.id };
  });
  const [scene, setScene] = useState(base.scene), [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("brush"), [brush, setBrush] = useState<Brush>(() => ({ ...DEFAULT_BRUSH, ...initialBrush, tipAssetId: undefined }));
  const brushes = useRef<Partial<Record<Tool, Brush>>>({});
  const [shape, setShape] = useState<Shape>("line"), [lifetime, setLifetime] = useState(initialLifetime), [autoShape, setAutoShape] = useState(false);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, w: capture.width, h: capture.height, scale: 1 });
  const [screenImage, setScreenImage] = useState<HTMLImageElement | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirmClose, setConfirmClose] = useState(false), [confirmShare, setConfirmShare] = useState(false);
  const [textEdit, setTextEdit] = useState<{ point: Point; value: string; node?: DrawingNode } | null>(null);
  const [past, setPast] = useState<typeof scene[]>([]), [future, setFuture] = useState<typeof scene[]>([]);
  const fitted = useRef(false), stageHost = useRef<HTMLDivElement>(null), alive = useRef(true), sceneRef = useRef(scene); sceneRef.current = scene;
  useEffect(() => { alive.current = true; const image = new Image(); image.onload = () => { if (alive.current) setScreenImage(image); }; image.onerror = () => { if (alive.current) setError(t("The capture could not be opened", "تعذر فتح لقطة الشاشة")); }; image.src = capture.dataUrl; return () => { alive.current = false; image.onload = null; image.onerror = null; }; }, [capture.dataUrl]);
  const images = useMemo(() => screenImage ? new Map([["screen-capture", screenImage]]) : undefined, [screenImage]);
  const change = (next: typeof scene) => { setPast(p => [...p.slice(-49), sceneRef.current]); setFuture([]); sceneRef.current = next; setScene(next); };
  const put = (node: DrawingNode) => { const current = sceneRef.current; change({ ...current, nodes: { ...current.nodes, [node.id]: node }, nodeOrder: current.nodeOrder.includes(node.id) ? current.nodeOrder : [...current.nodeOrder, node.id] }); setSelected([node.id]); };
  const undo = () => { if (!past.length) return; const previous = past[past.length - 1]; setPast(past.slice(0, -1)); setFuture(f => [...f, sceneRef.current]); sceneRef.current = previous; setScene(previous); setSelected([]); };
  const redo = () => { if (!future.length) return; const next = future[future.length - 1]; setFuture(future.slice(0, -1)); setPast(p => [...p, sceneRef.current]); sceneRef.current = next; setScene(next); setSelected([]); };
  const patchNode = (fields: Partial<DrawingNode>) => { const node = selected.length === 1 && sceneRef.current.nodes[selected[0]]; if (node && !node.locked) put({ ...node, ...fields }); };
  const selectedNode = selected.length === 1 ? scene.nodes[selected[0]] : undefined;
  const selectTool = (next: Tool) => {
    brushes.current[tool] = brush;
    const saved = brushes.current[next];
    if (saved) setBrush(saved);
    else if (next === "highlighter") setBrush({ ...DEFAULT_BRUSH, kind: "highlighter", color: "#f5d742", opacity: 0.35, size: 28, pressureSize: false });
    else if (next === "laser") setBrush({ ...DEFAULT_BRUSH, color: "#ef3d35", size: 6 });
    else if (next === "brush") setBrush({ ...DEFAULT_BRUSH, ...initialBrush, tipAssetId: undefined });
    setTool(next);
  };
  const save = async (shareConfirmed = false) => { if (!screenImage || busy) return; setBusy(true); setError(""); const renderer = new DrawingRenderer({ previewImages: images });
    try { const shared = await isShared(); if (shared && !shareConfirmed) { setConfirmShare(true); return; } const frame = sceneRef.current.frames[base.frameId], blob = await renderer.exportFrame(sceneRef.current, frame, 1, true); await onSave(blob, capture.width, capture.height, shareConfirmed); await onClose(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); } finally { renderer.dispose(); if (alive.current) setBusy(false); }
  };
  const requestClose = () => { if (busy) return; if (past.length) setConfirmClose(true); else void onClose(); };
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !textEdit && !confirmClose) { e.preventDefault(); e.stopPropagation(); requestClose(); } }; window.addEventListener("keydown", key, true); return () => window.removeEventListener("keydown", key, true); }, [past.length, busy, textEdit, confirmClose]);
  const tools: { value: Tool; en: string; ar: string; icon: string }[] = [
    { value: "select", en: "Move", ar: "تحريك", icon: "↖" }, { value: "brush", en: "Brush", ar: "فرشاة", icon: "✎" }, { value: "highlighter", en: "Highlighter", ar: "تحديد", icon: "▰" }, { value: "eraser", en: "Eraser", ar: "ممحاة", icon: "▱" }, { value: "laser", en: "Laser", ar: "ليزر", icon: "●" }, { value: "shape", en: "Shape", ar: "شكل", icon: "△" }, { value: "text", en: "Text", ar: "نص", icon: "T" },
  ];
  return <div className="screen-drawing" dir={arabic ? "rtl" : "ltr"}>
    <div className="screen-drawing-stage" ref={stageHost}><DrawingStage scene={scene} tool={tool} brush={brush} shape={shape} layerId={base.layerId} frameId={base.frameId} editable={!!screenImage && !busy && !confirmClose && !textEdit} onError={setError} selected={selected} view={view} autoShape={autoShape} laserLifetime={lifetime} previewImages={images} keyboardActive={true}
      onView={setView} onResize={(width, height) => { const host = stageHost.current; if (!host || width <= 0 || height <= 0 || Math.abs(host.clientWidth - width) > 1 || Math.abs(host.clientHeight - height) > 1) return; const fit = !fitted.current; if (fit) fitted.current = true; setView(old => { const scale = fit ? Math.max(0.001, Math.min(width / capture.width, height / capture.height)) : old.scale; return { ...old, scale, w: width / scale, h: height / scale }; }); }} onSelect={setSelected}
      onAdd={(node, correction) => put(correction ?? node)} onMove={(ids, dx, dy) => { const current = sceneRef.current, nodes = ids.map(key => current.nodes[key]).filter(Boolean), moved = translateObjects(current, nodes, { x: dx, y: dy }); change({ ...current, nodes: { ...current.nodes, ...Object.fromEntries(moved.map(node => [node.id, node])) } }); return ids; }}
      onTransform={async (_before, after) => { const current = sceneRef.current; change({ ...current, nodes: { ...current.nodes, ...Object.fromEntries(after.map(node => [node.id, node])) } }); return after.map(node => node.id); }}
      onText={(point, node) => setTextEdit({ point, value: node?.text ?? "", node })} onColor={color => setBrush(b => ({ ...b, color }))} onFill={() => {}} onRegion={() => {}} selectionKind="rect" /> </div>
    <div className="screen-drawing-bar" role="toolbar" aria-label={t("Screen drawing tools", "أدوات الرسم على الشاشة")}>
      {tools.map(item => <button key={item.value} type="button" title={t(item.en,item.ar)} aria-label={t(item.en,item.ar)} aria-pressed={tool===item.value} onClick={() => selectTool(item.value)}>{item.icon}</button>)}
      <span className="screen-drawing-divider" />
      {tool === "brush" && <BrushStylePicker brush={brush} arabic={arabic} onChange={setBrush} />}
      <label>{t("Color", "اللون")} <input type="color" value={/^#[0-9a-f]{6}/i.test(brush.color) ? brush.color.slice(0,7) : "#202023"} onChange={e => setBrush(b => ({ ...b, color: e.target.value }))}/></label>
      <label>{t("Size", "الحجم")} <input type="range" min="1" max="150" value={Math.min(150,brush.size)} onChange={e => setBrush(b => ({ ...b, size: Number(e.target.value) }))}/><output>{Math.round(brush.size)}</output></label>
      {tool === "laser" && <label>{t("Fade", "مدة الليزر")} <input type="range" min="0.2" max="10" step="0.1" value={lifetime / 1000} onChange={e => setLifetime(Number(e.target.value) * 1000)}/><output>{(lifetime / 1000).toFixed(1)} {t("s", "ث")}</output></label>}
      {tool === "brush" && <label><input type="checkbox" checked={autoShape} onChange={e => setAutoShape(e.target.checked)}/>{t("Correct shapes", "تصحيح الأشكال")}</label>}
      {tool === "shape" && <select aria-label={t("Shape", "الشكل")} value={shape} onChange={e => setShape(e.target.value as Shape)}><option value="line">{t("Line", "خط")}</option><option value="arrow">{t("Arrow", "سهم")}</option><option value="rect">{t("Rectangle", "مستطيل")}</option><option value="ellipse">{t("Ellipse", "دائرة")}</option><option value="triangle">{t("Triangle", "مثلث")}</option><option value="right-triangle">{t("Right triangle", "مثلث قائم")}</option></select>}
      {selectedNode?.kind === "text" && <><label>{t("Text size", "حجم النص")} <input type="number" min="1" max="2048" value={selectedNode.textStyle.size} onChange={e => { const value = e.target.valueAsNumber; if (value >= 1 && value <= 2048) patchNode({ textStyle: { ...selectedNode.textStyle, size: value } }); }}/></label><button type="button" aria-label={t("Bold", "عريض")} aria-pressed={selectedNode.textStyle.weight >= 700} onClick={() => patchNode({ textStyle: { ...selectedNode.textStyle, weight: selectedNode.textStyle.weight >= 700 ? 400 : 700 } })}>B</button><button type="button" aria-label={t("Italic", "مائل")} aria-pressed={selectedNode.textStyle.italic} onClick={() => patchNode({ textStyle: { ...selectedNode.textStyle, italic: !selectedNode.textStyle.italic } })}>I</button><label>{t("Rotation", "الدوران")} <input type="number" min="-360" max="360" value={selectedNode.rotation} onChange={e => { const value = e.target.valueAsNumber; if (Number.isFinite(value)) patchNode({ rotation: value }); }}/></label></>}
      <span className="screen-drawing-divider" /><button type="button" onClick={undo} disabled={!past.length}>{t("Undo", "تراجع")}</button><button type="button" onClick={redo} disabled={!future.length}>{t("Redo", "إعادة")}</button><button type="button" onClick={() => void save()} disabled={busy || !screenImage}>{busy ? t("Saving", "جارٍ الحفظ") : t("Save to drawing", "حفظ في الرسم")}</button><button type="button" onClick={requestClose} disabled={busy}>{t("Exit", "خروج")}</button>
    </div>
    <div className="screen-drawing-still" role="status">{t("Still capture; video behind it may continue playing.", "صورة ثابتة، وقد يستمر تشغيل الفيديو خلفها.")}</div>
    {error && <div className="screen-drawing-alert" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div>}
    {textEdit && <div className="screen-drawing-prompt" role="dialog" aria-modal="true" aria-label={t("Enter text", "إضافة نص")}><textarea autoFocus dir="auto" value={textEdit.value} onChange={e => setTextEdit({ ...textEdit, value: e.target.value })}/><div><button type="button" onClick={() => setTextEdit(null)}>{t("Cancel", "إلغاء")}</button><button type="button" onClick={() => { if (!textEdit.value.trim()) return; const node = textEdit.node ?? newNode("text", base.layerId, base.frameId, { ...textEdit.point, w: 360, h: 130 }); put({ ...node, text: textEdit.value, textStyle: { ...node.textStyle, color: textEdit.node?.textStyle.color ?? brush.color } }); setTextEdit(null); }}>{t("Apply", "تطبيق")}</button></div></div>}
    {confirmClose && <div className="screen-drawing-prompt" role="dialog" aria-modal="true"><p>{t("Exit without saving your annotations?", "الخروج دون حفظ الكتابة على الشاشة؟")}</p><div><button type="button" onClick={() => setConfirmClose(false)}>{t("Keep editing", "متابعة الرسم")}</button><button type="button" onClick={() => void onClose()}>{t("Discard and exit", "خروج دون حفظ")}</button></div></div>}
    {confirmShare && <div className="screen-drawing-prompt" role="dialog" aria-modal="true"><p>{t("This is a shared drawing. Saving sends your screen capture to its collaborators.", "هذا رسم مشترك. سيؤدي الحفظ إلى مشاركة لقطة الشاشة مع المشاركين.")}</p><div><button type="button" onClick={() => setConfirmShare(false)}>{t("Cancel", "إلغاء")}</button><button type="button" onClick={() => { setConfirmShare(false); void save(true); }}>{t("Share and save", "مشاركة وحفظ")}</button></div></div>}
  </div>;
}
