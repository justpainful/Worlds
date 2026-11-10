import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { errorMessage } from "../lib/api";
import { DrawingScenePreview } from "./ScenePreview";
import { ObjectTransformError, objectSelectionBounds, objectTransformOrigin, transformObjects, transformedScene, type ObjectTransform } from "./objectTransforms";
import type { DrawingNode, DrawingScene } from "./model";
import type { DrawingGestureLease } from "./gestureLeases";

interface Props { scene: DrawingScene; selected: string[]; arabic: boolean; canEdit: boolean; onClose: () => void; begin: (ids: string[]) => Promise<DrawingGestureLease | null>; apply: (before: DrawingNode[], after: DrawingNode[]) => Promise<string[]> }
export function DrawingTransformDialog({ scene, selected, arabic, canEdit, onClose, begin, apply }: Props) {
  const before = useRef(selected.map((id) => structuredClone(scene.nodes[id])).filter(Boolean)).current;
  const origin = objectTransformOrigin(scene, before), t = (en: string, ar: string) => arabic ? ar : en;
  const describe = (e: unknown) => e instanceof ObjectTransformError ? ({ invalid: t("Enter a valid transform", "أدخل قيم تحويل صحيحة"), multiple: t("Multiple objects use one proportional scale", "العناصر المتعددة تستخدم مقياسًا تناسبيًا واحدًا"), dimensions: t("Enter positive dimensions up to 1 billion pixels", "أدخل أبعادًا موجبة لا تتجاوز مليار بكسل"), locked: t("An element is missing or locked", "أحد العناصر مفقود أو مقفل"), stale: t("An element changed. Close the transform and try again.", "تغيّر أحد العناصر. أغلق التحويل وأعد المحاولة.") })[e.code] : errorMessage(e);
  const [values, setValues] = useState<ObjectTransform>({ centerX: origin.x, centerY: origin.y, scale: 1, rotation: 0, flipX: false, flipY: false });
  const [localSize, setLocalSize] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const active = useRef(true), reservation = useRef<DrawingGestureLease | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; reservation.current?.cancel(); }; }, []);
  const result = useMemo(() => { try { return { nodes: transformObjects(scene, before, values), error: null }; } catch (e) { return { nodes: before, error: describe(e) }; } }, [scene, before, values, arabic]);
  const preview = useMemo(() => transformedScene(scene, result.nodes), [scene, result.nodes]);
  const camera = useMemo(() => { const a = objectSelectionBounds(scene, before), b = objectSelectionBounds(preview, result.nodes), x = Math.min(a.x, b.x) - 30, y = Math.min(a.y, b.y) - 30; return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x + 30, h: Math.max(a.y + a.h, b.y + b.h) - y + 30 }; }, [scene, preview, before, result.nodes]);
  const submit = async () => {
    if (!canEdit || result.error || busy) return; setBusy(true); setError(null);
    try { const lease = await begin(before.map((n) => n.id)); reservation.current = lease; if (!active.current) { lease?.cancel(); return; } if (lease?.state() === "lost") throw new Error(t("The reservation was lost", "فُقد حجز العناصر")); const operations = await apply(before, result.nodes); lease?.finish(operations); reservation.current = null; onClose(); }
    catch (e) { reservation.current?.cancel(); reservation.current = null; if (active.current) setError(describe(e)); }
    finally { if (active.current) setBusy(false); }
  };
  const number = (key: "centerX" | "centerY" | "scale" | "rotation" | "width" | "height", en: string, ar: string, factor = 1) => <label className="drawing-field"><span>{t(en, ar)}</span><input type="number" dir="ltr" aria-invalid={!Number.isFinite(values[key])} step={key === "rotation" ? 1 : 0.1} value={Number.isFinite(values[key]) ? Number(((values[key] ?? 0) * factor).toFixed(4)) : ""} onChange={(e) => { const value = e.target.valueAsNumber; setValues((old) => ({ ...old, [key]: value / factor })); }} /></label>;
  return <Modal title={t("Transform elements", "تحويل العناصر")} width={760} className={`drawing-transform-dialog${arabic?' is-arabic':''}`} onClose={() => { if (!busy) onClose(); }} footer={<><Button disabled={busy} onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button variant="tinted" loading={busy} disabled={!canEdit || !!result.error || !before.length} onClick={submit}>{t("Apply transform", "تطبيق التحويل")}</Button></>}>
    <div dir={arabic?'rtl':'ltr'} lang={arabic?'ar':undefined} aria-busy={busy}>
    <DrawingScenePreview scene={preview} camera={camera} label={t("Transform preview", "معاينة التحويل")} />
    <fieldset className="drawing-transform-fields" disabled={busy || !canEdit}>{number("centerX", "Center X", "المركز الأفقي")}{number("centerY", "Center Y", "المركز الرأسي")}
      {before.length === 1 && <label className="drawing-check"><input type="checkbox" checked={localSize} onChange={(e) => { setLocalSize(e.target.checked); setValues((old) => ({ ...old, scale: 1, width: e.target.checked ? before[0].w : undefined, height: e.target.checked ? before[0].h : undefined })); }} />{t("Set width and height on local axes", "تحديد العرض والارتفاع على محوري العنصر")}</label>}
      {localSize ? <>{number("width", "Width", "العرض")}{number("height", "Height", "الارتفاع")}</> : number("scale", "Scale (%)", "المقياس (%)", 100)}
      {number("rotation", "Rotation change (degrees)", "تغيير الدوران بالدرجات")}
      <label className="drawing-check"><input type="checkbox" checked={values.flipX} onChange={(e) => setValues((old) => ({ ...old, flipX: e.target.checked }))} />{t("Flip horizontally", "قلب أفقي")}</label>
      <label className="drawing-check"><input type="checkbox" checked={values.flipY} onChange={(e) => setValues((old) => ({ ...old, flipY: e.target.checked }))} />{t("Flip vertically", "قلب رأسي")}</label>
    </fieldset>
    <p>{t("Original strokes, paths and images stay intact. Linked endpoints outside this selection stay attached to their targets.", "تبقى نقاط الرسم والمسارات والصور الأصلية محفوظة. أطراف الأسهم المرتبطة بعناصر خارج التحديد تبقى متصلة بها.")}</p>
    {(error || result.error) && <p role="alert">{error ?? result.error}</p>}
    {busy && <p role="status">{t("Applying transform", "جارٍ تطبيق التحويل")}</p>}
    </div>
  </Modal>;
}
