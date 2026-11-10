import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import type { DrawingDocument, DrawingScene, Change } from "./model";
import type { DrawingSession } from "./session";
import { DrawingRenderer, type Viewport } from "./renderer";
import { experimentDifferences, mergeExperiment, type AdoptionChoice, type ExperimentDifference } from "./experiments";
import { sceneChanges } from "./operations";
type ExperimentRow = Awaited<ReturnType<typeof api.drawingExperiments>>[number];

export function ExperimentsPanel({ document, session, canEdit, arabic, commit }: { document: DrawingDocument; session: DrawingSession; canEdit: boolean; arabic: boolean; commit: (label: string, changes: Change[], guard?:undefined, strictBase?:boolean) => string|null|undefined }) {
  const [entries, setEntries] = useState<ExperimentRow[]>([]), [creating, setCreating] = useState(false), [name, setName] = useState(""), [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [comparing, setComparing] = useState<ExperimentRow | null>(null);
  const t = (en: string, ar: string) => arabic ? ar : en;
  const source = document.experiment?.sourceId ?? session.pageId;
  const refresh = () => api.drawingExperiments(source).then(setEntries).catch((e) => setError(errorMessage(e)));
  useEffect(() => { void refresh(); }, [source]);
  if (document.experiment) return <div className="drawing-experiments"><p>{document.experiment.description}</p><p>{t("This is an editable experiment. Open its source drawing to compare and adopt changes.", "هذه تجربة قابلة للتحرير. افتح الرسم الأصلي لمقارنة التغييرات واعتمادها.")}</p><Button onClick={() => useStore.getState().openPage(source, "current")}>{t("Open source drawing", "فتح الرسم الأصلي")}</Button></div>;
  return <div className="drawing-experiments">
    <Button icon="add" disabled={!canEdit} onClick={() => setCreating(true)}>{t("New experiment", "تجربة جديدة")}</Button>
    {entries.map((entry) => <section className="drawing-experiment" key={entry.page.id}>
      <strong dir="auto">{entry.page.title}</strong><p dir="auto">{entry.experiment.description}</p><small>{new Date(entry.experiment.createdAt).toLocaleString()}</small>
      <div className="drawing-step-actions"><Button size="compact" onClick={() => useStore.getState().openPage(entry.page.id, "tab")}>{t("Edit experiment", "تحرير التجربة")}</Button><Button size="compact" onClick={() => setComparing(entry)}>{t("Compare", "مقارنة")}</Button></div>
      <label>{t("Status", "الحالة")}<select disabled={!canEdit} value={entry.experiment.status} onChange={async (e) => { try { await api.setPageMeta(entry.page.id, "experiment", { ...entry.experiment, status: e.target.value }); await refresh(); } catch (e) { setError(errorMessage(e)); } }}><option value="draft">{t("Draft", "تجربة")}</option><option value="review">{t("Review", "قيد المراجعة")}</option><option value="approved">{t("Approved", "معتمدة")}</option></select></label>
    </section>)}
    {error && <p role="alert">{error}</p>}
    {creating && <Modal title={t("New drawing experiment", "تجربة رسم جديدة")} width={500} onClose={() => setCreating(false)} footer={<Button loading={busy} disabled={!name.trim()} onClick={async () => {
      setBusy(true); setError(null);
      try { await session.flush(); if (session.snapshot().pending) throw new Error("Save the source drawing first"); const page = await api.drawingExperimentCreate(session.pageId, name, description); useStore.getState().patchPageLocal(page); await refresh(); setCreating(false); setName(""); setDescription(""); useStore.getState().openPage(page.id, "tab"); }
      catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }}>{t("Create and edit", "إنشاء وتحرير")}</Button>}><div className="drawing-step"><label>{t("Name", "الاسم")}<input dir="auto" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label><label>{t("Description", "الوصف")}<textarea dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} /></label>{error && <p role="alert">{error}</p>}</div></Modal>}
    {comparing && <ExperimentComparison entry={comparing} session={session} canEdit={canEdit} arabic={arabic} commit={commit} onClose={() => setComparing(null)} />}
  </div>;
}

function CanvasComparisonView({ scene, view, onView, marked }: { scene: DrawingScene; view: Viewport; onView: (view: Viewport) => void; marked: Set<string> }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<DrawingRenderer | null>(null);
  const drag = useRef<{ x: number; y: number; view: Viewport } | null>(null), [size, setSize] = useState({ w: 500, h: 400 }),[previewError,setPreviewError]=useState<string|null>(null);
  useEffect(() => { const r = new DrawingRenderer(); renderer.current = r; return () => r.dispose(); }, []);
  useEffect(() => { const observer = new ResizeObserver(() => { if (host.current) setSize({ w: host.current.clientWidth, h: host.current.clientHeight }); }); if (host.current) observer.observe(host.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const r = renderer.current; let active = true;
    const draw = () => { if (active && canvas.current && r) { const dpr = devicePixelRatio || 1; canvas.current.width = Math.max(1, Math.round(size.w * dpr)); canvas.current.height = Math.max(1, Math.round(size.h * dpr)); r.render(canvas.current, scene, { ...view, w: size.w / view.scale, h: size.h / view.scale, scale: view.scale * dpr }); } };
    if (r) { setPreviewError(null);r.onAssetChange = draw; void r.prepare(scene).then(draw).catch(error=>{if(active)setPreviewError(errorMessage(error));}); }
    return () => { active = false; };
  }, [scene, view, size]);
  return <div ref={host} className="drawing-compare-canvas" onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, view }; }} onPointerMove={(e) => { const d = drag.current; if (d) onView({ ...d.view, x: d.view.x - (e.clientX - d.x) / d.view.scale, y: d.view.y - (e.clientY - d.y) / d.view.scale }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onWheel={(e) => { const rect = e.currentTarget.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, scale = Math.max(0.025, Math.min(8, view.scale * Math.exp(-e.deltaY * 0.0015))); onView({ ...view, scale, x: view.x + x / view.scale - x / scale, y: view.y + y / view.scale - y / scale }); }}>
    <canvas ref={canvas} />{previewError&&<p role="alert">{previewError}</p>}{[...marked].map((id) => { const node = scene.nodes[id]; return node ? <div key={id} className="drawing-compare-mark" style={{ left: (node.x - view.x) * view.scale, top: (node.y - view.y) * view.scale, width: node.w * view.scale, height: node.h * view.scale, transform: `rotate(${node.rotation}deg)` }} /> : null; })}
  </div>;
}

function describe(value: unknown): string { if (value === undefined) return "∅"; if (Array.isArray(value)) return `${value.length} items`; if (typeof value === "string") return value.slice(0, 90); if (value && typeof value === "object") return String((value as Record<string, unknown>).name ?? "Element"); return JSON.stringify(value) ?? ""; }
function propertyLabel(path: string[], arabic: boolean): string {
  const key = path.at(-1) ?? "element";
  const labels: Record<string, [string, string]> = { element: ["Element", "العنصر"], x: ["Horizontal position", "الموضع الأفقي"], y: ["Vertical position", "الموضع الرأسي"], w: ["Width", "العرض"], h: ["Height", "الارتفاع"], rotation: ["Rotation", "التدوير"], opacity: ["Opacity", "الشفافية"], fill: ["Fill color", "لون التعبئة"], stroke: ["Stroke color", "لون الخط"], strokeWidth: ["Line width", "عرض الخط"], text: ["Text", "النص"], name: ["Name", "الاسم"], visible: ["Visibility", "الظهور"], locked: ["Locked", "القفل"], font: ["Font", "الخط"], size: ["Size", "الحجم"], color: ["Color", "اللون"], effects: ["Adjustments", "التعديلات"], samples: ["Brush stroke", "ضربة الفرشاة"], nodeOrder: ["Element stacking", "ترتيب العناصر"], layerOrder: ["Layer stacking", "ترتيب الطبقات"], frameOrder: ["Frame order", "ترتيب الإطارات"], stepOrder: ["Step order", "ترتيب الخطوات"], defaultFrameId: ["Default preview", "الإطار الافتراضي"], pinnedVersionId: ["Pinned presentation", "إصدار العرض المثبت"], frameId: ["Frame", "الإطار"], layerId: ["Layer", "الطبقة"], maskId: ["Mask", "القناع"], assetId: ["Original image", "الصورة الأصلية"] };
  return labels[key]?.[arabic ? 1 : 0] ?? key.replace(/([A-Z])/g, " $1");
}
function ExperimentComparison({ entry, session, canEdit, arabic, commit, onClose }: { entry: ExperimentRow; session: DrawingSession; canEdit: boolean; arabic: boolean; commit: (label: string, changes: Change[], guard?:undefined, strictBase?:boolean) => string|null|undefined; onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ main: DrawingDocument; branch: DrawingScene; branchRevision:number; differences: ExperimentDifference[] } | null>(null);
  const [view, setView] = useState<Viewport>({ x: -20, y: -20, w: 1400, h: 800, scale: 0.35 }), [rightView, setRightView] = useState(view);
  const [mode, setMode] = useState<"side" | "wipe" | "changes">("side"), [linked, setLinked] = useState(true), [wipe, setWipe] = useState(50), [scope, setScope] = useState("all");
  const [chosen, setChosen] = useState<Set<string>>(new Set()), [choices, setChoices] = useState<Record<string, AdoptionChoice>>({}), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const t = (en: string, ar: string) => arabic ? ar : en;
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { await session.flush(); const main = session.snapshot().document!; const [branch, base] = await Promise.all([api.drawingLoad(entry.page.id), api.drawingVersionScene(session.pageId, entry.experiment.baseVersionId)]); if (!active) return; const differences = experimentDifferences(base, main.scene, branch.scene, entry.experiment.versionAliases); setLoaded({ main, branch: branch.scene, branchRevision:branch.revision, differences }); setChosen(new Set(differences.map((d) => d.key))); const f = main.scene.frames[main.scene.defaultFrameId], v = { x: f.x - 20, y: f.y - 20, w: f.w + 40, h: f.h + 40, scale: Math.max(0.025, Math.min(0.5, (innerWidth - 100) / 2 / (f.w + 40))) }; setView(v); setRightView(v); }
      catch (e) { if (active) setError(errorMessage(e)); }
    }; void load(); return () => { active = false; };
  }, [entry.page.id, session]);
  const inScope = (difference: ExperimentDifference) => {
    if (scope === "all" || !loaded) return true;
    if (difference.collection === "frames") return difference.id === scope;
    const nodes = [...Object.values(loaded.main.scene.nodes), ...Object.values(loaded.branch.nodes)].filter((n) => n.frameId === scope);
    if (difference.collection === "nodes") return nodes.some((n) => n.id === difference.id);
    const maskIds=new Set(nodes.flatMap(n=>[n.maskId,...n.effects.map(e=>e.maskId)].filter((id):id is string=>!!id)));
    if (difference.collection === "masks") return maskIds.has(difference.id);
    if (difference.collection === "assets") return nodes.some((n) => n.assetId === difference.id || n.brush?.tipAssetId === difference.id)||[loaded.main.scene,loaded.branch].some(scene=>[...maskIds].some(id=>{const mask=scene.masks[id];return !!mask&&(mask.assetId===difference.id||mask.strokes.some(stroke=>stroke.brush.tipAssetId===difference.id));}));
    if (difference.collection === "steps") return (loaded.branch.steps[difference.id] ?? loaded.main.scene.steps[difference.id])?.frameId === scope;
    return false;
  };
  const differences = loaded?.differences.filter(inScope) ?? [], marked = new Set(mode === "changes" ? differences.filter((d) => d.collection === "nodes").map((d) => d.id) : []);
  const setLeft = (next: Viewport) => { setView(next); if (linked) setRightView(next); };
  const setRight = (next: Viewport) => { setRightView(next); if (linked) setView(next); };
  const adopt = async () => {
    if (!loaded) return;
    setBusy(true); setError(null);
    try {
      if (session.snapshot().document!.revision !== loaded.main.revision) throw new Error(t("The source changed. Reopen comparison to include its latest edits.", "تغيّر الأصل. أعد فتح المقارنة لتشمل آخر تعديلاته."));
      const latestBranch=await api.drawingLoad(entry.page.id);if(latestBranch.revision!==loaded.branchRevision)throw new Error(t("The experiment changed. Reopen comparison to review its latest edits.","تغيّرت التجربة. أعد فتح المقارنة لمراجعة آخر تعديلاتها."));
      const selected = differences.filter((d) => chosen.has(d.key)); if (!selected.length) return;
      const merged = mergeExperiment(loaded.main.scene, loaded.branch, selected, choices);
      const owned = await api.drawingMaterializeAssets(session.pageId, merged, entry.page.id);
      if (session.snapshot().document!.revision !== loaded.main.revision) throw new Error("The source changed during adoption. Reopen comparison.");
      const operation=commit(`Adopt experiment: ${entry.page.title}`, sceneChanges(loaded.main.scene, owned),undefined,true);if(!operation)throw new Error(t("The changes could not be applied. Check editing access and locked elements.","تعذر تطبيق التغييرات. تحقق من صلاحية التحرير والعناصر المقفلة."));await session.flush();
      if (session.snapshot().pending) throw new Error(session.snapshot().error ?? "The adoption has not been saved"); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal title={`${t("Compare experiment", "مقارنة التجربة")}: ${entry.page.title}`} width={1160} onClose={onClose} footer={<><Button onClick={onClose}>{t("Close", "إغلاق")}</Button><Button variant="tinted" disabled={!canEdit || !loaded || !differences.some((d) => chosen.has(d.key))} loading={busy} onClick={adopt}>{t("Adopt selected changes", "اعتماد التغييرات المحددة")}</Button></>}>
    {error && <p className="drawing-export-error" role="alert">{error}</p>}
    {!loaded ? !error && <p role="status">{t("Loading comparison", "جارٍ تحميل المقارنة")}</p> : <>
      <div className="drawing-compare-controls"><select aria-label={t("Comparison mode", "طريقة المقارنة")} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="side">{t("Side by side", "جنبًا إلى جنب")}</option><option value="wipe">{t("Before / after slider", "فاصل قبل وبعد")}</option><option value="changes">{t("Highlight changed elements", "إظهار العناصر المتغيرة")}</option></select><label><input type="checkbox" checked={linked} onChange={(e) => { setLinked(e.target.checked); if (e.target.checked) setRightView(view); }} />{t("Link zoom and pan", "ربط التكبير والتحريك")}</label><select aria-label={t("Adoption scope", "نطاق الاعتماد")} value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">{t("Entire experiment", "التجربة كاملة")}</option>{loaded.branch.frameOrder.map((id) => <option key={id} value={id}>{loaded.branch.frames[id].name}</option>)}</select></div>
      <div className={`drawing-compare ${mode === "wipe" ? "is-wipe" : ""}`}>
        <div className="drawing-compare-side"><strong>{t("Current drawing", "الرسم الحالي")}</strong><CanvasComparisonView scene={loaded.main.scene} view={view} onView={setLeft} marked={marked} /></div>
        <div className="drawing-compare-side" style={mode === "wipe" ? { clipPath: `inset(0 ${100 - wipe}% 0 0)` } : undefined}><strong>{entry.page.title}</strong><CanvasComparisonView scene={loaded.branch} view={linked ? view : rightView} onView={setRight} marked={marked} /></div>
      </div>
      {mode === "wipe" && <input aria-label={t("Comparison divider", "فاصل المقارنة")} className="drawing-wipe-slider" type="range" min={0} max={100} value={wipe} onChange={(e) => setWipe(Number(e.target.value))} />}
      <div className="drawing-differences">{differences.length ? differences.map((difference) => <div className={`drawing-difference ${difference.conflict ? "has-conflict" : ""}`} key={difference.key}>
        <label><input type="checkbox" checked={chosen.has(difference.key)} onChange={(e) => setChosen((set) => { const next = new Set(set); if (e.target.checked) next.add(difference.key); else next.delete(difference.key); return next; })} /><span>{(loaded.branch.nodes[difference.id] ?? loaded.main.scene.nodes[difference.id])?.name ?? t("Drawing", "الرسم")}: {propertyLabel(difference.path, arabic)}</span></label>
        <small>{t("Current", "الحالي")}: {describe(difference.current)} · {t("Experiment", "التجربة")}: {describe(difference.experiment)}</small>
        <select aria-label={`${t("Resolve", "اختيار")}: ${propertyLabel(difference.path, arabic)}`} value={choices[difference.key] ?? (difference.conflict ? "" : "experiment")} onChange={(e) => setChoices({ ...choices, [difference.key]: e.target.value as AdoptionChoice })}><option value="" disabled>{t("Choose how to resolve this conflict", "اختر حل التعارض")}</option><option value="current">{t("Keep current", "الإبقاء على الحالي")}</option><option value="experiment">{t("Use experiment", "استخدام التجربة")}</option>{difference.collection === "nodes" && loaded.branch.nodes[difference.id] && <option value="duplicate">{t("Keep both as separate elements", "الاحتفاظ بالاثنين كعنصرين")}</option>}</select>
      </div>) : <p>{t("No changed properties in this scope", "لا توجد خصائص متغيرة في هذا النطاق")}</p>}</div>
    </>}
  </Modal>;
}
