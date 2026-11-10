import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Modal, confirmDialog } from "../ui/Modal";
import { captureLibraryScene, detachLibraryInstance, insertLibraryScene, validateLibraryMetadata, type LibraryItem, type LibraryKind, type LibraryMetadata, type LibraryPayload, type LibraryPublication } from "./library";
import { id, newNode, type Brush, type Change, type DrawingScene } from "./model";
import type { DrawingSession } from "./session";
import { sceneChanges } from "./operations";
import { createDrawingPackage, importDrawingPackage, readDrawingPackage } from "./package";
import { saveDrawingBlob } from "./files";
import { drawingProjectExportContext, useDrawingExportPolicy } from "./exportAccess";
import { canDrawingExport } from "./exportPolicy";
import { DrawingExportPolicyDialog } from "./ExportPolicyDialog";
import { DrawingScenePreview } from "./ScenePreview";
import {fontAvailable} from './textLayout';
import {refreshDrawingResource} from './syncManager';
import {effectiveLayer} from './layers';
import {FontDependencies} from './FontDependencies';

const LABELS: Record<LibraryKind, [string, string]> = { brush: ["Brush", "فرشاة"], palette: ["Palette", "لوحة ألوان"], elements: ["Shapes and groups", "أشكال ومجموعات"], style: ["Element style", "نمط عنصر"], frame: ["Frame", "إطار"], template: ["Drawing template", "قالب رسم"], signature: ["Signature", "توقيع"] };
interface Props { session: DrawingSession; scene: DrawingScene; selected: string[]; frameId: string; brush: Brush; colors: string[]; canEdit: boolean; arabic: boolean; commit: (label: string, changes: Change[]) => void; onBrush: (brush: Brush) => void; onPalette: (colors: string[]) => void; onSelect: (ids: string[]) => void; startSaveKind?: LibraryKind; onStartedSave?: () => void }
export function LibraryPanel({ session, scene, selected, frameId, brush, colors, canEdit, arabic, commit, onBrush, onPalette, onSelect, startSaveKind, onStartedSave }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]), [query, setQuery] = useState(""), [scope, setScope] = useState("all"), [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState(false), [name, setName] = useState(""), [tags, setTags] = useState(""), [kind, setKind] = useState<LibraryKind>("elements"), [saveScope, setSaveScope] = useState<"personal" | "workspace">("personal"), [existing, setExisting] = useState("");
  const [opened, setOpened] = useState<LibraryPublication | null>(null), [linked, setLinked] = useState(false), [replacing, setReplacing] = useState(false);
  const [styleParts,setStyleParts]=useState({fill:true,stroke:true,text:true});
  const [showPolicy,setShowPolicy]=useState(false),exportPolicy=useDrawingExportPolicy(opened?.item.page.id??null),canExport=!!exportPolicy.info&&!exportPolicy.error&&canDrawingExport(exportPolicy.info.policy,exportPolicy.info.level,"projects");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [loaded, setLoaded] = useState(false);
  const [missingFonts,setMissingFonts]=useState<string[]>([]),[fontsChecking,setFontsChecking]=useState(false),[allowFallback,setAllowFallback]=useState(false);
  const [fontCheck,setFontCheck]=useState(0),[discovery,setDiscovery]=useState(0),inspectedPages=useRef(new Map<string,string>());
  const file = useRef<HTMLInputElement>(null), request = useRef(0), t = (en: string, ar: string) => arabic ? ar : en;
  const openedId=useRef<string|null>(null);openedId.current=opened?.item.page.id??null;
  const publicationPages=useStore(state=>Object.values(state.pages).filter(page=>page.kind==='drawing'&&!page.deletedAt).map(page=>`${page.id}:${page.updatedAt}`).sort().join('|'));
  useEffect(()=>{let active=true,index=0;const rows=publicationPages?publicationPages.split('|').filter(row=>{const id=row.slice(0,row.lastIndexOf(':'));return inspectedPages.current.get(id)!==row;}):[];const drain=async()=>{while(active&&index<rows.length){const row=rows[index++],id=row.slice(0,row.lastIndexOf(':'));try{const page=await api.page(id);if(active&&page?.metadata.drawingLibrary===true)await refreshDrawingResource(id);if(active)inspectedPages.current.set(id,row);}catch{/* A missing or revoked publication is removed by the permission-filtered list. */}}};void Promise.all([drain(),drain()]).then(()=>{if(active)void refresh().catch(e=>setError(errorMessage(e)));});return()=>{active=false;};},[publicationPages,session.pageId,discovery]);
  useEffect(() => { if (startSaveKind && canEdit) { setKind(startSaveKind); setName(""); setExisting(""); setTags(""); setSaving(true); onStartedSave?.(); } }, [startSaveKind, canEdit, onStartedSave]);
  const refresh = async () => { const rows = await api.drawingLibraryList(session.pageId); setItems(rows); setLoaded(true); };
  useEffect(() => { let alive = true,running=false;const load=async()=>{if(running)return;running=true;try{const rows=await api.drawingLibraryList(session.pageId);if(alive){setItems(rows);setLoaded(true);if(openedId.current&&!rows.some(row=>row.page.id===openedId.current)){request.current++;setOpened(null);setReplacing(false);}}}catch(e){if(alive){setError(errorMessage(e));setItems([]);request.current++;setOpened(null);}}finally{running=false;}};void load();const changed=(event:Event)=>{const rows=(event as CustomEvent<{kind:string}[]>).detail??[];if(rows.some(row=>['drawing_library','page','tree','account'].includes(row.kind)))void load();};window.addEventListener('worlds:changed',changed);const timer=setInterval(()=>void load(),5000);return()=>{alive=false;request.current++;clearInterval(timer);window.removeEventListener('worlds:changed',changed);}; }, [session.pageId]);
  useEffect(()=>{let alive=true;setMissingFonts([]);setAllowFallback(false);if(!opened){setFontsChecking(false);return;}setFontsChecking(true);const styles=[...new Map(Object.values(opened.scene.nodes).filter(n=>n.kind==='text').map(n=>[`${n.textStyle.font}:${n.textStyle.weight}:${n.textStyle.italic}`,n.textStyle])).values()];void Promise.all(styles.map(async style=>({font:style.font,available:await fontAvailable(style).catch(()=>false)}))).then(rows=>{if(alive)setMissingFonts([...new Set(rows.filter(row=>!row.available).map(row=>row.font))]);}).finally(()=>{if(alive)setFontsChecking(false);});return()=>{alive=false;};},[opened,fontCheck]);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); try { await work(); } catch (e) { const message=errorMessage(e);setError(message==="Select drawing elements first"?t("Select drawing elements first","حدد عناصر الرسم أولًا"):message); } finally { setBusy(false); } };
  const open = async (item: LibraryItem, version?: number) => { const token = ++request.current; await run(async () => { const publication = await api.drawingLibraryRead(item.page.id, version); if (request.current === token) { setOpened(publication); setReplacing(false); } }); };
  const linkedNode = selected.map((key) => scene.nodes[key]).find((n) => n?.libraryInstanceId), linkedFrame = scene.frames[frameId]?.libraryInstanceId ? scene.frames[frameId] : undefined, binding = linkedNode ?? linkedFrame;
  const sourceItem = items.find((item) => item.page.id === binding?.libraryItemId);
  const capture = (): { snapshot: DrawingScene; metadata: LibraryMetadata } => {
    const current = session.snapshot().document!.scene, nodeIds = kind === "style" ? selected.filter(key=>{const node=current.nodes[key];return node&&!node.redaction&&(node.kind==='shape'||node.kind==='text');}).slice(0, 1) : ["brush", "palette"].includes(kind) ? [] : selected;
    if(kind==='style'&&!nodeIds.length)throw new Error(t("Select a shape or text element to capture its style", "حدد شكلًا أو عنصر نص لحفظ نمطه"));
    const snapshot = captureLibraryScene(current, kind, nodeIds, frameId, kind === "brush" ? brush : undefined);
    let payload: LibraryPayload = {};
    if (kind === "brush") {
      payload = { brush: structuredClone(brush) };
      const f = snapshot.frames[snapshot.defaultFrameId]; Object.assign(f, { x: 0, y: 0, w: 520 + brush.size, h: 170 + brush.size });
      const n = newNode("stroke", snapshot.layerOrder[0], f.id, { x: brush.size / 2 + 30, y: brush.size / 2 + 30, w: 440, h: 100 });
      n.name = "Brush preview"; n.brush = structuredClone(brush); n.seed = 1; n.samples = Array.from({ length: 50 }, (_, i) => ({ x: 20 + i * 8, y: 50 + Math.sin(i / 9) * 25, pressure: 0.75, tiltX: 0, tiltY: 0, time: i * 8 })); snapshot.nodes[n.id] = n; snapshot.nodeOrder = [n.id];
    } else if (kind === "palette") {
      const palette = [...new Set(colors.length ? colors : [brush.color])].slice(0, 256); payload = { colors: palette };
      const f = snapshot.frames[snapshot.defaultFrameId]; Object.assign(f, { x: 0, y: 0, w: 480, h: Math.max(80, Math.ceil(palette.length / 8) * 60) });
      palette.forEach((color, i) => { const n = newNode("shape", snapshot.layerOrder[0], f.id, { x: i % 8 * 60 + 5, y: Math.floor(i / 8) * 60 + 5, w: 50, h: 50 }); n.shape = "rect"; n.paint.fill = color; n.paint.strokeWidth = 0; snapshot.nodes[n.id] = n; snapshot.nodeOrder.push(n.id); });
    } else if (kind === "style") { const n = snapshot.nodes[snapshot.nodeOrder[0]]; payload = { style: { paint: structuredClone(n.paint), textStyle: structuredClone(n.textStyle) } }; }
    const metadata = { name: name.trim(), kind, tags: [...new Set(tags.split(/[,،]/).map((s) => s.trim()).filter(Boolean))], payload }; validateLibraryMetadata(metadata, snapshot); return { snapshot, metadata };
  };
  const publish = () => run(async () => {
    await session.flush(); if (session.snapshot().pending) throw new Error(t("Save this drawing first", "احفظ الرسم أولًا"));
    const { snapshot, metadata } = capture(), old = items.find((item) => item.page.id === existing);
    const publication = await api.drawingLibraryPublish({ ...metadata, sourceId: session.pageId, itemId: old?.page.id, expectedVersion: old?.version, scope: old?.scope ?? saveScope, scene: snapshot });
    useStore.getState().patchPageLocal(publication.item.page); await refresh(); setSaving(false); setOpened(publication);
  });
  const insert = (replace = false) => run(async () => {
    if (!opened || !canEdit || !canExport || fontsChecking || missingFonts.length&&!allowFallback) return;
    const authorized = await api.drawingLibraryRead(opened.item.page.id, opened.version);
    const owned = opened.item.kind==='style'||opened.item.kind==='palette' ? authorized.scene : await api.drawingMaterializeAssets(session.pageId, authorized.scene, authorized.item.page.id), publication = { ...authorized, scene: owned };
    const current = session.snapshot().document!.scene;
    if (opened.item.kind === "palette") onPalette(authorized.payload.colors!);
    else if (opened.item.kind === "brush") {
      const next = structuredClone(authorized.payload.brush!), tip = next.tipAssetId;
      if (tip) { const aid = id(); commit("Library brush tip", [{ type: "put", collection: "assets", id: aid, value: { ...owned.assets[tip], id: aid } }]); next.tipAssetId = aid; }
      onBrush(next);
    } else if (opened.item.kind === "style") {
      if (!selected.length) throw new Error(t("Select elements to apply this style", "حدد عناصر لتطبيق النمط"));
      if(!styleParts.fill&&!styleParts.stroke&&!styleParts.text)throw new Error(t("Choose at least one style property", "اختر خاصية واحدة للنمط على الأقل"));
      const editable = selected.filter((key) => { const node = current.nodes[key]; return node && !node.redaction && (node.kind==='shape'||node.kind==='text') && !node.locked && !effectiveLayer(current, node.layerId).locked; });
      if (!editable.length) throw new Error(t("Select an unlocked shape or text element", "حدد شكلًا أو نصًا غير مقفل"));
      const source=authorized.payload.style!;
      const changes:Change[]=editable.flatMap((key)=>{const node=current.nodes[key],fields:Record<string,unknown>={};
        if(node.kind==='shape'&&(styleParts.fill||styleParts.stroke)){const paint=structuredClone(node.paint);if(styleParts.fill){paint.fill=source.paint.fill;paint.gradient=structuredClone(source.paint.gradient);}if(styleParts.stroke){paint.stroke=source.paint.stroke;paint.strokeWidth=source.paint.strokeWidth;paint.dash=structuredClone(source.paint.dash);paint.cap=source.paint.cap;paint.radius=source.paint.radius;}fields.paint=paint;}
        if(node.kind==='text'&&styleParts.text)fields.textStyle=structuredClone(source.textStyle);
        return Object.keys(fields).length?[{type:'patch' as const,collection:'nodes' as const,id:key,fields}]:[];});
      if(!changes.length)throw new Error(t("The chosen properties do not match the selected elements", "الخصائص المختارة لا تنطبق على العناصر المحددة"));
      commit("Apply library style", changes);
    } else {
      const f = current.frames[frameId] ?? current.frames[current.defaultFrameId], result = insertLibraryScene(current, publication, { x: f.x + 40, y: f.y + 40 }, f.id, linked || replace, replace ? binding?.libraryInstanceId : undefined);
      commit(replace ? "Update linked library instance" : "Insert library material", sceneChanges(current, result.scene)); onSelect(result.selected);
    }
    setOpened(null); setReplacing(false);
  });
  const visible = items.filter((item) => (filter === "all" || item.kind === filter) && (scope === "all" || item.scope === scope) && `${item.page.title} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="drawing-library">
    <div className="drawing-step-actions"><Button icon="add" disabled={!canEdit || busy} onClick={() => { setSaving(true); setName(""); setExisting(""); }}>{t("Save to library", "حفظ في المكتبة")}</Button><Button icon="upload" disabled={!canEdit || busy} onClick={() => file.current?.click()}>{t("Import", "استيراد")}</Button><Button icon="refresh" disabled={busy} onClick={() => {inspectedPages.current.clear();setDiscovery(value=>value+1);void run(refresh);}}>{t("Refresh", "تحديث")}</Button></div>
    <input hidden type="file" accept=".worldsdraw" ref={file} onChange={(e) => { const chosen = e.target.files?.[0]; e.target.value = ""; if (chosen) void run(async () => { const pack = await readDrawingPackage(chosen), imported = await importDrawingPackage(session.pageId, chosen), metadata = pack.library ?? { name: chosen.name.replace(/\.worldsdraw$/i, ""), kind: "template" as const, tags: [], payload: {} }; const publication = await api.drawingLibraryPublish({ ...metadata, sourceId: session.pageId, scope: "personal", scene: imported }); useStore.getState().patchPageLocal(publication.item.page); await refresh(); setOpened(publication); }); }} />
    {error && <p role="alert" className="drawing-export-error">{error}</p>}
    {binding?.libraryInstanceId && <div className="drawing-library-linked"><p>{t("Linked copy", "نسخة مرتبطة")}: {sourceItem?.page.title ?? t("Source unavailable", "المصدر غير متاح")} · {t("Version", "إصدار")} {binding.libraryVersion}</p><div className="drawing-step-actions">{sourceItem && sourceItem.version > (binding.libraryVersion ?? 0) && <Button disabled={busy || !canEdit} onClick={async () => { await open(sourceItem); setReplacing(true); }}>{t("Review update", "مراجعة التحديث")}</Button>}<Button disabled={!canEdit} onClick={() => commit("Detach library instance", sceneChanges(scene, detachLibraryInstance(scene, binding.libraryInstanceId!)))}>{t("Detach", "فك الارتباط")}</Button></div></div>}
    <label className="drawing-library-search">{t("Search name or tag", "بحث بالاسم أو الوسم")}<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="drawing-library-filters"><select aria-label={t("Category", "الفئة")} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">{t("All categories", "كل الفئات")}</option>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label[arabic ? 1 : 0]}</option>)}</select><select aria-label={t("Library scope", "نطاق المكتبة")} value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">{t("All libraries", "كل المكتبات")}</option><option value="personal">{t("Personal", "شخصية")}</option><option value="workspace">{t("Workspace", "مساحة العمل")}</option></select></div>
    {visible.map((item) => <button className="drawing-library-row" key={item.page.id} disabled={busy} onClick={() => open(item)}><strong dir="auto">{item.page.title}</strong><span>{LABELS[item.kind][arabic ? 1 : 0]} · {t("Version", "إصدار")} {item.version} · {item.scope === "personal" ? t("Personal", "شخصية") : t("Workspace", "مشتركة")}</span>{item.tags.length > 0 && <small dir="auto">{item.tags.join(" · ")}</small>}</button>)}
    {loaded && !visible.length && <p>{t("No library material matches", "لا توجد عناصر مطابقة في المكتبة")}</p>}
    {saving && <Modal title={t("Publish library material", "نشر عنصر في المكتبة")} onClose={() => setSaving(false)} footer={<Button variant="tinted" loading={busy} disabled={!name.trim()} onClick={publish}>{t("Publish version", "نشر الإصدار")}</Button>}><div className="drawing-step">
      <label>{t("Destination", "وجهة الحفظ")}<select value={existing} onChange={(e) => { const old = items.find((item) => item.page.id === e.target.value); setExisting(e.target.value); if (old) { setKind(old.kind); setSaveScope(old.scope); setName(old.page.title); setTags(old.tags.join(", ")); } }}><option value="">{t("New library item", "عنصر مكتبة جديد")}</option>{items.filter((item) => item.canEdit).map((item) => <option key={item.page.id} value={item.page.id}>{item.page.title} (v{item.version + 1})</option>)}</select></label>
      <label>{t("Name", "الاسم")}<input autoFocus dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t("Category", "الفئة")}<select disabled={!!existing} value={kind} onChange={(e) => {setKind(e.target.value as LibraryKind);setError(null);}}>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label[arabic ? 1 : 0]}</option>)}</select></label>
      <label>{t("Scope", "النطاق")}<select disabled={!!existing} value={saveScope} onChange={(e) => setSaveScope(e.target.value as typeof saveScope)}><option value="personal">{t("Personal", "شخصية")}</option><option value="workspace">{t("Current shared workspace", "مساحة العمل المشتركة الحالية")}</option></select></label>
      <label>{t("Tags, separated by commas", "وسوم مفصولة بفواصل")}<input dir="auto" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      {!['brush','palette'].includes(kind)&&<FontDependencies arabic={arabic} scenes={[{...scene,nodes:Object.fromEntries(Object.entries(scene.nodes).filter(([key,node])=>kind==='template'||kind==='frame'&&node.frameId===frameId||kind!=='frame'&&selected.includes(key)))}]}/>}
      <p>{kind === "brush" ? t("Saves your current brush settings and a stroke preview.", "يحفظ إعدادات الفرشاة الحالية ومعاينة لضربتها.") : kind === "palette" ? t("Saves the active palette colors.", "يحفظ ألوان اللوحة الحالية.") : kind === "template" ? t("Saves the entire drawing, its originals and presentation dependencies.", "يحفظ الرسم كاملًا وأصوله وإصدارات عرضه.") : kind === "frame" ? t("Saves the selected frame and its contents.", "يحفظ الإطار الحالي ومحتوياته.") : t("Saves the selected elements and their originals.", "يحفظ العناصر المحددة وأصولها.")}</p>{error && <p role="alert">{error}</p>}
    </div></Modal>}
    {opened && <Modal title={opened.item.page.title} width={720} onClose={() => { request.current++; setOpened(null); }} footer={<><Button icon="lock" onClick={()=>setShowPolicy(true)}>{t("Export permissions","صلاحيات التصدير")}</Button><Button disabled={busy||!canExport} onClick={() => run(async () => { const verified = await api.drawingLibraryRead(opened.item.page.id, opened.version), metadata = { name: verified.item.page.title, kind: verified.item.kind, tags: verified.item.tags, payload: verified.payload }; await saveDrawingBlob(await createDrawingPackage(verified.scene, undefined, verified.item.page.id, metadata), `${metadata.name.replace(/[<>:"/\\|?*]/g, "_")}.worldsdraw`,await drawingProjectExportContext(verified.item.page.id,verified.scene)); })}>{t("Export item", "تصدير العنصر")}</Button><Button variant="tinted" loading={busy} disabled={!canEdit || !canExport || fontsChecking || !!missingFonts.length&&!allowFallback} onClick={() => insert(replacing)}>{replacing ? t("Replace linked instance", "استبدال النسخة المرتبطة") : t("Insert / apply", "إدراج أو تطبيق")}</Button></>}>
      {exportPolicy.info&&!exportPolicy.error&&exportPolicy.info.level!=="none"&&<DrawingScenePreview scene={opened.scene} label={t("Published library preview", "معاينة إصدار المكتبة")} />}
      {opened.item.sourceState&&opened.item.sourceState!=='available'&&<p role="status">{t('The original source is unavailable. This published version keeps its own content; source access and publication access are independent.','المصدر الأصلي غير متاح. يحتفظ الإصدار المنشور بمحتواه المملوك، وصلاحية المصدر مستقلة عن صلاحية المنشور.')}</p>}
      {opened.item.syncStatus&&opened.item.syncStatus!=='synced'&&<p role="status">{t('Publication status','حالة المنشور')}: {t(opened.item.syncStatus,({local:'محلي',pending:'بانتظار المزامنة',offline:'دون اتصال',conflict:'تعارض محفوظ محليًا',denied:'الوصول مرفوض'} as Record<string,string>)[opened.item.syncStatus]??opened.item.syncStatus)}</p>}
      {opened.item.kind==='style'&&<div className="drawing-step"><p>{t('Choose which properties to apply to the selected shapes or text. Locked items and redactions are skipped.','اختر الخصائص التي تطبق على الأشكال أو النص المحدد. تُستثنى العناصر المقفلة والتنقيحات.')}</p>
        <label className="drawing-check"><input type="checkbox" checked={styleParts.fill} onChange={e=>setStyleParts({...styleParts,fill:e.target.checked})}/>{t('Shape fill and gradient','تعبئة الشكل والتدرج')}</label>
        <label className="drawing-check"><input type="checkbox" checked={styleParts.stroke} onChange={e=>setStyleParts({...styleParts,stroke:e.target.checked})}/>{t('Shape outline and corners','حدود الشكل وزواياه')}</label>
        <label className="drawing-check"><input type="checkbox" checked={styleParts.text} onChange={e=>setStyleParts({...styleParts,text:e.target.checked})}/>{t('Text formatting','تنسيق النص')}</label>
        {opened.item.canEdit&&<Button size="compact" disabled={!canEdit||busy} onClick={()=>{setKind('style');setExisting(opened.item.page.id);setName(opened.item.page.title);setTags(opened.item.tags.join(', '));setSaveScope(opened.item.scope);setOpened(null);setSaving(true);}}>{t('Publish new version from selection','نشر إصدار جديد من العنصر المحدد')}</Button>}
      </div>}
      {fontsChecking&&<p role="status">{t('Checking required fonts','جارٍ التحقق من الخطوط المطلوبة')}</p>}
      {Object.values(opened.scene.nodes).some(n=>n.kind==='text')&&<p>{t('Fonts used','الخطوط المستخدمة')}: {[...new Set(Object.values(opened.scene.nodes).filter(n=>n.kind==='text').map(n=>n.textStyle.font))].join('، ')}</p>}
      {!!missingFonts.length&&<div role="status"><p>{t('Missing fonts','خطوط غير متاحة')}: {missingFonts.join('، ')}</p><Button size="compact" icon="refresh" disabled={fontsChecking} onClick={()=>setFontCheck(value=>value+1)}>{t('Check fonts again','إعادة فحص الخطوط')}</Button><label className="drawing-check"><input type="checkbox" checked={allowFallback} onChange={e=>setAllowFallback(e.target.checked)}/>{t('Continue with a fallback font','المتابعة بخط بديل')}</label></div>}
      {Object.values(opened.scene.nodes).some(n=>n.kind==='text')&&<p>{t('Font names are retained; font files are not embedded. Recipients need to install them separately. Check each font license before sharing; the app cannot verify licensing.','تُحفظ أسماء الخطوط دون تضمين ملفاتها، وعلى المستلم تثبيتها بنفسه. تحقّق من ترخيص كل خط قبل المشاركة؛ لا يستطيع التطبيق التحقق من الترخيص.')}</p>}
      {exportPolicy.error ? <p role="alert">{t("Copy permissions could not be checked.", "تعذر التحقق من صلاحيات النسخ.")} <Button onClick={exportPolicy.refresh}>{t("Retry", "إعادة المحاولة")}</Button></p> : !exportPolicy.info ? <p role="status">{t("Checking copy permissions", "جارٍ التحقق من صلاحيات النسخ")}</p> : !canExport && <p role="status">{t("The owner’s project export policy does not allow creating or exporting an editable copy with your current access.", "لا تسمح سياسة تصدير المشاريع بإنشاء نسخة قابلة للتعديل أو تصديرها بصلاحيتك الحالية.")}</p>}
      <p>{t('Version name','اسم الإصدار')}: {opened.scene.libraryPublication?.name??opened.item.page.title}</p><p>{t('Tags','الوسوم')}: {(opened.scene.libraryPublication?.tags??opened.item.tags).join('، ')||t('No tags','دون وسوم')}</p>
      <div className="drawing-step"><p>{LABELS[opened.item.kind][arabic ? 1 : 0]} · {t("Owner", "المالك")}: {opened.item.owner}</p><label>{t("Published version", "الإصدار المنشور")}<select disabled={busy || replacing} value={opened.version} onChange={(e) => open(opened.item, Number(e.target.value))}>{opened.item.versions.map((v) => <option key={v.version} value={v.version}>{v.version} · {new Date(v.createdAt).toLocaleString()}</option>)}</select></label>
      {!["brush", "palette", "style"].includes(opened.item.kind) && !replacing && <label className="drawing-check"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />{t("Link this copy for optional updates", "ربط النسخة لتلقي تحديثات اختيارية")}</label>}
      {replacing && <p>{t("This replaces the linked elements with this published version, including your edits to those elements. Other artwork stays in place. You can undo the replacement.", "يستبدل العناصر المرتبطة بهذا الإصدار، بما فيها تعديلاتك على تلك العناصر. يمكنك التراجع عن الاستبدال.")}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="drawing-step-actions">{opened.item.kind === "template" && <Button disabled={!canEdit || !canExport || busy || fontsChecking || !!missingFonts.length&&!allowFallback} onClick={() => run(async () => { const page = await api.drawingLibraryInstantiate(opened.item.page.id, opened.version); useStore.getState().patchPageLocal(page); useStore.getState().openPage(page.id, "tab"); setOpened(null); })}>{t("Use as new drawing", "استخدام كرسم جديد")}</Button>}{opened.item.canDelete && <Button disabled={busy} onClick={() => run(async () => { const ok = await confirmDialog({ title: t("Remove from library?", "إزالة من المكتبة؟"), message: t("Inserted copies stay available in their drawings.", "تبقى النسخ المدرجة في رسوماتها."), confirm: t("Remove", "إزالة"), danger: true }); if (ok) { await api.drawingLibraryRemove(opened.item.page.id); setOpened(null); await refresh(); } })}>{t("Remove from library", "إزالة من المكتبة")}</Button>}</div></div>
    </Modal>}
    {opened&&showPolicy&&<DrawingExportPolicyDialog pageId={opened.item.page.id} arabic={arabic} onClose={()=>{setShowPolicy(false);exportPolicy.refresh();}} />}
  </div>;
}
