import { useEffect, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { api } from "../../lib/api";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { DrawingScenePreview } from "../../drawing/ScenePreview";
import type { DrawingScene, Rect } from "../../drawing/model";
import { openDrawingLocation } from "../../drawing/navigation";
import "../../drawing/drawing.css";

export function DrawingEmbedView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const { pageId, frameId, versionId } = node.attrs as { pageId: string; frameId: string; versionId?: string | null };
  const camera = node.attrs.camera as Rect | null, language = useStore((s) => s.profile?.language), arabic = language === "ar" || language === "auto" && navigator.language.startsWith("ar");
  const [loaded, setLoaded] = useState<{ scene: DrawingScene; title: string; checkedAt: number } | null>(null), [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true, generation = 0;
    const refresh = async () => {
      const token = ++generation; setLoaded(null); setUnavailable(false);
      try {
        const rights = await api.drawingReferenceRead(pageId); if (rights.state !== "ready" || rights.kind !== "drawing") throw new Error("Unavailable");
        const scene = versionId ? await api.drawingVersionScene(pageId, versionId) : (await api.drawingLoad(pageId)).scene;
        if (!scene.frames[frameId]) throw new Error("Unavailable");
        if (active && token === generation) setLoaded({ scene, title: rights.title ?? "", checkedAt: Date.now() });
      } catch { if (active && token === generation) { setLoaded(null); setUnavailable(true); } }
    };
    void refresh(); const timer = setInterval(refresh, 15000); return () => { active = false; clearInterval(timer); };
  }, [pageId, frameId, versionId]);
  return <NodeViewWrapper className={`drawing-embed ${selected ? "is-selected" : ""}`} contentEditable={false} data-drag-handle>
    {loaded ? <><DrawingScenePreview scene={loaded.scene} frameId={frameId} camera={camera ?? undefined} label={loaded.title} /><div className="drawing-step-actions"><Button icon="openExternal" onClick={() => openDrawingLocation(pageId, frameId, camera ?? loaded.scene.frames[frameId])}>{loaded.title || (arabic ? "فتح الرسم" : "Open drawing")}</Button><small>{versionId ? (arabic ? "إصدار مثبت" : "Pinned version") : (arabic ? "معاينة مرتبطة" : "Live preview")} · {new Date(loaded.checkedAt).toLocaleString()}</small></div></> : <p role="status">{unavailable ? (arabic ? "الرسم غير متاح أو لا تملك صلاحية فتحه" : "Drawing unavailable or access restricted") : (arabic ? "جارٍ تحميل الرسم" : "Loading drawing")}</p>}
    {editor.isEditable && <Button variant="quiet" icon="close" onClick={deleteNode}>{arabic ? "إزالة التضمين" : "Remove embed"}</Button>}
  </NodeViewWrapper>;
}
