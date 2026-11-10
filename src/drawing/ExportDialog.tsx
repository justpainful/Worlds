import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { errorMessage } from "../lib/api";
import type { DrawingScene } from "./model";
import { DrawingRenderer } from "./renderer";
import { createDrawingPackage } from "./package";
import { copyDrawingImage, saveDrawingBlob } from "./files";
import { drawingProjectExportContext, useDrawingExportPolicy } from "./exportAccess";
import { canDrawingExport, type DrawingExportContext } from "./exportPolicy";
import {exportFrameArchive,exportAnnotatedArchive} from "./frameArchive";
import {flattenedSvg,SvgError,svgErrorMessage} from "./svg";
import { DrawingExportPolicyDialog } from "./ExportPolicyDialog";
import { FontDependencies } from "./FontDependencies";
export function DrawingExportDialog({ scene, frameId, pageId, name, arabic, onClose }: { scene: DrawingScene; frameId: string; pageId: string; name: string; arabic: boolean; onClose: () => void }) {
  const t = (en: string, ar: string) => arabic ? ar : en;
  const [frame, setFrame] = useState(frameId), [format, setFormat] = useState<"png" | "jpeg" | "webp" | "bmp" | "svg" | "frames" | "pair" | "worldsdraw">("png");
  const [scale, setScale] = useState(1), [quality, setQuality] = useState(0.92), [annotations, setAnnotations] = useState(true), [matte, setMatte] = useState("#ffffff");
  const [blob, setBlob] = useState<Blob | null>(null), [url, setUrl] = useState(""), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const saveTask = useRef<{ controller: AbortController; committing: boolean } | null>(null);
  useEffect(() => () => { if (!saveTask.current?.committing) saveTask.current?.controller.abort(); }, []);
  const [context,setContext]=useState<DrawingExportContext|null>(null),[permissions,setPermissions]=useState(false),policy=useDrawingExportPolicy(pageId);
  const [packagePreview,setPackagePreview]=useState(true),[packageHistory,setPackageHistory]=useState(false),[packageExperiments,setPackageExperiments]=useState(false);
  const [copied,setCopied]=useState(false),[batchFrames,setBatchFrames]=useState([frameId]),[batchProgress,setBatchProgress]=useState(0);
  const allowed=!!policy.info&&!policy.error&&canDrawingExport(policy.info.policy,policy.info.level,format==="worldsdraw"?"projects":"images");
  useEffect(() => {
    setBlob(null); setContext(null); setCopied(false); setUrl(""); setError(null); setBatchProgress(0);
    if(format==="worldsdraw"&&!allowed)return;
    const renderer = new DrawingRenderer(), controller = new AbortController(); let active = true, preview = "";
    const generate = async () => {
      try {
        let historySources:DrawingScene[]=[],experimentSources:DrawingScene[]=[],experimentPages:string[]=[];
        const batch=format==="pair"?await exportAnnotatedArchive(scene,frame,scale,controller.signal):format==="frames"?await exportFrameArchive(scene,batchFrames,scale,annotations,controller.signal,done=>{if(active)setBatchProgress(done);}):null;
        const svgPng=format==="svg"?await renderer.exportFrame(scene,scene.frames[frame],scale,annotations):null;
        const result = svgPng?await flattenedSvg(svgPng,controller.signal):batch?batch.blob:format === "worldsdraw" ? await createDrawingPackage(scene, controller.signal, pageId,undefined,{includePreview:packagePreview,includeHistory:packageHistory,includeExperiments:packageExperiments,onExperimentSources:(scenes,pages)=>{experimentSources=scenes;experimentPages=pages;},onHistorySources:scenes=>{historySources=scenes;}}) : await renderer.exportFrame(scene, scene.frames[frame], scale, annotations, `image/${format as "png"|"jpeg"|"webp"|"bmp"}`, quality, matte);
        const prepared = format === "worldsdraw" ? await drawingProjectExportContext(pageId,scene,controller.signal) : {pageId,kind:"images" as const,scenes:format==="pair"?[{scene,frameId:frame,annotations:false},{scene,frameId:frame,annotations:true}]:(format==="frames"?scene.frameOrder.filter(id=>batchFrames.includes(id)):[frame]).map(frameId=>({scene,frameId,annotations}))};
        if(format==="worldsdraw"&&experimentPages.length){prepared.sourcePageIds=experimentPages;prepared.scenes.push(...experimentSources.map(scene=>({scene})));}
        if(format==="worldsdraw"&&historySources.length)prepared.scenes.push(...historySources.map(scene=>({scene})));
        if(format==="worldsdraw"&&new TextEncoder().encode(JSON.stringify(prepared)).length>64*1024*1024)throw Error(t("Project source checks exceed 64 MiB. Include fewer experiments or export without history.","تجاوزت بيانات التحقق 64 ميبيبايت. قلل التجارب أو صدّر دون السجل."));
        if (!active) return;
        setBlob(result); setContext(prepared);
        if (format !== "worldsdraw") { preview = URL.createObjectURL(svgPng??(batch?batch.preview:result)); setUrl(preview); }
      } catch (e) { if (active) { const message=e instanceof SvgError?svgErrorMessage(e.code,arabic):errorMessage(e); setError(arabic ? ({"Choose existing frames for the archive":"اختر إطارًا واحدًا على الأقل من الإطارات الموجودة.","This batch exceeds the export-context limit. Select fewer frames.":"تجاوزت الدفعة حد التصدير. اختر عددًا أقل من الإطارات.","The frame archive exceeds 256 MiB":"تجاوز حجم الأرشيف 256 ميبيبايت. اختر عددًا أقل من الإطارات."} as Record<string,string>)[message]??message : message); } }
    };
    void generate();
    return () => { active = false; controller.abort(); renderer.dispose(); if (preview) URL.revokeObjectURL(preview); };
  }, [scene, frame, scale, annotations, format, quality, matte, pageId, allowed,batchFrames,packagePreview,packageHistory,packageExperiments]);
  const close = () => { if (saveTask.current?.committing) return; saveTask.current?.controller.abort(); onClose(); };
  return <Modal title={t("Export drawing", "تصدير الرسم")} width={720} onClose={close} footer={<><Button onClick={close} disabled={committing}>{t("Cancel", "إلغاء")}</Button>{format==="png"&&<Button disabled={!blob||!context||!allowed||saving} onClick={async()=>{if(!blob||!context)return;setSaving(true);try{await copyDrawingImage(blob,context);setCopied(true);}catch(e){setError(errorMessage(e));}finally{setSaving(false);}}}>{t("Copy PNG","نسخ PNG")}</Button>}<Button variant="tinted" loading={saving} disabled={!blob||!context||!allowed} onClick={async () => { if (!blob||!context||saveTask.current) return; const task={controller:new AbortController(),committing:false};saveTask.current=task;setSaving(true); try { const saved = await saveDrawingBlob(blob, `${name || "Drawing"}.${format === "jpeg" ? "jpg" : ["frames","pair"].includes(format)?"zip":format}`,context,task.controller.signal,()=>{task.committing=true;setCommitting(true);}); if (saved) onClose(); } catch (e) { if (!task.controller.signal.aborted) setError(errorMessage(e)); } finally { if(saveTask.current===task)saveTask.current=null;setSaving(false);setCommitting(false); } }}>{t("Save file", "حفظ الملف")}</Button></>}>
    {committing&&<p role="status">{t("Finishing file save", "جارٍ إكمال حفظ الملف")}</p>}
    <Button icon="lock" variant="quiet" onClick={()=>setPermissions(true)}>{t("Export permissions","صلاحيات التصدير")}</Button>
    {!allowed&&policy.info&&!policy.error&&<p role="status">{t("Your current permission does not allow this export format.","صلاحيتك الحالية لا تسمح بتصدير هذه الصيغة.")}</p>}
    {policy.error&&<p role="alert">{policy.error}<Button size="compact" onClick={policy.refresh}>{t("Check permissions","التحقق من الصلاحيات")}</Button></p>}
    <div className="drawing-export-options">
      <label>{t("Format", "الصيغة")}<select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="bmp">BMP</option><option value="svg">{t("SVG (flattened image)","SVG (صورة مسطّحة)")}</option><option value="frames">{t("Selected frames as PNG archive","الإطارات المحددة كأرشيف PNG")}</option><option value="pair">{t("Clean and annotated PNG archive","أرشيف PNG بنسخة نظيفة وأخرى مشروحة")}</option><option value="worldsdraw">{t("Editable Worlds project", "مشروع وورلدز قابل للتعديل")}</option></select></label>
      {format !== "worldsdraw" && <>
        {format==="frames"?<fieldset><legend>{t("Choose frames","اختيار الإطارات")}</legend>{scene.frameOrder.map(id=><label className="drawing-check" key={id}><input type="checkbox" checked={batchFrames.includes(id)} onChange={e=>setBatchFrames(value=>e.target.checked?[...value,id]:value.filter(v=>v!==id))}/>{scene.frames[id].name}</label>)}<p role="status">{batchProgress} / {batchFrames.length}</p></fieldset>:<label>{t("Frame", "الإطار")}<select value={frame} onChange={(e) => setFrame(e.target.value)}>{scene.frameOrder.map((id) => <option key={id} value={id}>{scene.frames[id].name}</option>)}</select></label>}
        <label>{t("Scale", "المقياس")}<input type="number" min={0.1} max={8} step={0.25} value={scale} onChange={(e) => setScale(Math.max(0.1, Math.min(8, Number(e.target.value) || 1)))} /></label>
        {format!=="pair"&&<label><input type="checkbox" checked={annotations} onChange={(e) => setAnnotations(e.target.checked)} />{t("Include annotations", "تضمين الشروحات")}</label>}
        {!["png","bmp","svg","frames","pair"].includes(format) && <label>{t("Quality", "الجودة")}<input type="range" min={0.1} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /></label>}
        {["jpeg","bmp"].includes(format) && <label>{t("Transparency background", "خلفية الشفافية")}<input type="color" value={matte} onChange={(e) => setMatte(e.target.value)} /></label>}
      </>}
    </div>
    {format==="worldsdraw"&&<fieldset><legend>{t("Project contents","محتويات المشروع")}</legend><label className="drawing-check"><input type="checkbox" checked={packagePreview} onChange={e=>setPackagePreview(e.target.checked)}/>{t("Include a rendered preview","تضمين معاينة مرسومة")}</label><label className="drawing-check"><input type="checkbox" checked={packageHistory} onChange={e=>setPackageHistory(e.target.checked)}/>{t("Include operation history (up to500 operations)","تضمين سجل العمليات (حتى500 عملية)")}</label><label className="drawing-check"><input type="checkbox" checked={packageExperiments} onChange={e=>setPackageExperiments(e.target.checked)}/>{t("Include editable experiments and original comparison bases (up to24)","تضمين التجارب القابلة للتحرير وأسس مقارنتها الأصلية (حتى24)")}</label><p>{t("History imports into a new local drawing, preserving author-only Undo. It includes older originals and edits.","يُستورد السجل إلى رسم محلي جديد مع تراجع كل مؤلف عن عمله. ويتضمن أصولًا وتعديلات سابقة.")}</p></fieldset>}
    <FontDependencies arabic={arabic} mode={format==="worldsdraw"?"project":"image"} scenes={context?.scenes.map(entry=>entry.scene)??[scene]}/>
    {format==="worldsdraw"&&Object.values(scene.nodes).some(n=>n.redaction)&&<p role="status">{t("Editable projects retain the original content beneath redactions. Share a flattened PNG, JPEG, WebP, BMP orSVG for a redacted copy.","يحتفظ المشروع القابل للتعديل بالمحتوى الأصلي تحت التنقيح. شارك PNG أوJPEG أوWebP أوBMP أوSVG مسطحًا للحصول على نسخة منقحة.")}</p>}
    {format==="svg"&&<p>{t("This self-contained SVG embeds the rendered PNG. Text, layers and paths are flattened, and hidden originals are excluded.","يحتوي SVG على صورة PNG مرسومة. النص والطبقات والمسارات مسطّحة، ولا يتضمن الأصول المخفية.")}</p>}
    {format === "worldsdraw" ? <p>{t("This editable project includes original images, masks and hidden layers. Use an image format for a flattened or redacted copy.", "المشروع القابل للتعديل يتضمن الصور الأصلية والأقنعة والطبقات المخفية. استخدم صيغة صورة لإخراج نسخة مسطحة أو منقّحة.")}</p> : <div className="drawing-export-preview">{url ? <img src={url} alt={t("Exact exported image preview", "معاينة الصورة التي ستُحفظ")} /> : !error && <span role="status">{t("Preparing preview", "جارٍ تجهيز المعاينة")}</span>}</div>}
    {blob && <p className="drawing-export-size">{!["worldsdraw","frames","pair"].includes(format) && `${Math.ceil(scene.frames[frame].w * scale)} x ${Math.ceil(scene.frames[frame].h * scale)} px · `}{(blob.size / 1024).toFixed(1)} KB</p>}
    {error && <p role="alert" className="drawing-export-error">{error}</p>}
    {copied&&<p role="status">{t("PNG copied to the clipboard","نُسخت صورة PNG إلى الحافظة")}</p>}
    {permissions&&<DrawingExportPolicyDialog pageId={pageId} arabic={arabic} onClose={()=>{setPermissions(false);policy.refresh();}} />}
  </Modal>;
}
