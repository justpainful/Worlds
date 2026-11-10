import { useEffect, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { api } from "../../lib/api";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { DrawingScenePreview } from "../../drawing/ScenePreview";
import type { DrawingScene } from "../../drawing/model";
import { isDrawingCamera, openDrawingLocation } from "../../drawing/navigation";
import { readDrawingReference } from "../../drawing/references";
import "../../drawing/drawing.css";

export function DrawingEmbedView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const { pageId, frameId, versionId } = node.attrs as { pageId: string; frameId: string; versionId?: string | null };
  const camera = isDrawingCamera(node.attrs.camera) ? node.attrs.camera : null, language = useStore((s) => s.profile?.language), arabic = language === "ar" || language === "auto" && navigator.language.startsWith("ar");
  const [loaded, setLoaded] = useState<{ scene: DrawingScene; title: string; checkedAt: number } | null>(null), [unavailable, setUnavailable] = useState<"offline"|"unavailable"|null>(null);
  useEffect(() => {
    let active = true, generation = 0;
    const refresh = async () => {
      const token = ++generation; setLoaded(null); setUnavailable(null);
      try {
        const rights = await readDrawingReference(pageId);
        if (rights.state !== "ready" || rights.kind !== "drawing") {if(active&&token===generation)setUnavailable(rights.state==='offline'?'offline':'unavailable');return;}
        const scene = versionId ? await api.drawingVersionScene(pageId, versionId) : (await api.drawingLoad(pageId)).scene;
        if (!scene.frames[frameId]) throw new Error("Unavailable");
        if (active && token === generation) setLoaded({ scene, title: rights.title ?? "", checkedAt: Date.now() });
      } catch { if (active && token === generation) { setLoaded(null); setUnavailable("unavailable"); } }
    };
    const changed = (event: Event) => { const rows=(event as CustomEvent<unknown>).detail;if(Array.isArray(rows)&&rows.some(row=>row&&typeof row==='object'&&['account','page','tree'].includes(String((row as {kind?:unknown}).kind))))void refresh(); };
    const visible = () => { if(document.visibilityState==='visible')void refresh(); };
    void refresh(); const timer = setInterval(refresh, 15000);window.addEventListener('worlds:changed',changed);window.addEventListener('online',refresh);window.addEventListener('offline',refresh);document.addEventListener('visibilitychange',visible);
    return () => { active = false; clearInterval(timer);window.removeEventListener('worlds:changed',changed);window.removeEventListener('online',refresh);window.removeEventListener('offline',refresh);document.removeEventListener('visibilitychange',visible); };
  }, [pageId, frameId, versionId]);
  return <NodeViewWrapper className={`drawing-embed ${selected ? "is-selected" : ""}`} contentEditable={false} data-drag-handle>
    {loaded ? <><DrawingScenePreview scene={loaded.scene} frameId={frameId} camera={camera ?? undefined} label={loaded.title || (arabic ? "معاينة الرسم" : "Drawing preview")} /><div className="drawing-step-actions"><Button icon="openExternal" onClick={() => openDrawingLocation(pageId, frameId, camera ?? loaded.scene.frames[frameId])}>{loaded.title || (arabic ? "فتح الرسم" : "Open drawing")}</Button><small>{versionId ? (arabic ? "إصدار مثبت" : "Pinned version") : (arabic ? "معاينة مرتبطة" : "Live preview")} · {new Date(loaded.checkedAt).toLocaleString(arabic?'ar':undefined)}</small></div></> : <p role="status">{unavailable==='offline'?(arabic?'تحتاج معاينة الرسم المشترك إلى اتصال':'An internet connection is needed to preview this shared drawing'):unavailable ? (arabic ? "الرسم غير متاح أو لا تملك صلاحية فتحه" : "Drawing unavailable or access restricted") : (arabic ? "جارٍ تحميل الرسم" : "Loading drawing")}</p>}
    {editor.isEditable && <Button variant="quiet" icon="close" onClick={deleteNode}>{arabic ? "إزالة التضمين" : "Remove embed"}</Button>}
  </NodeViewWrapper>;
}
