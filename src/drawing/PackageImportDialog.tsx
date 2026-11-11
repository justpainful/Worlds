import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useStore } from "../state/store";
import { errorMessage } from "../lib/api";
import { readDrawingPackage, importDrawingPackage, importDrawingBundlePackage, type DrawingPackage } from "./package";
import { reserveDrawingRestore } from "./syncManager";
import type { DrawingScene } from "./model";
function packageMessage(error: unknown, arabic: boolean, checking = false) {
  const message = errorMessage(error);
  if (message === "This is not a Worlds drawing project")
    return arabic
      ? "الملف ليس مشروع رسم من وورلدز. اختر ملف worldsdraw صالحًا."
      : "This is not a Worlds drawing project. Choose a valid worldsdraw file.";
  if (message === "Unsupported drawing package version" || message === "Unsupported portable history version")
    return arabic ? "إصدار ملف المشروع غير مدعوم في هذا التطبيق." : "This project format version is not supported by this app.";
  if (/package (is too large|exceeds the memory limit)/i.test(message))
    return arabic ? "ملف المشروع أكبر من حد الاستيراد المتاح." : "The project file exceeds the import size limit.";
  if (checking)
    return arabic
      ? "تعذر التحقق من الملف. قد يكون تالفًا أو غير مكتمل؛ لم يتغير الرسم الحالي."
      : "The file could not be verified. It may be damaged or incomplete; the current drawing was not changed.";
  return message;
}
export function DrawingPackageImportDialog(p: {
  file: File;
  pageId: string;
  arabic: boolean;
  canEdit: boolean;
  revision: () => number;
  apply: (scene: DrawingScene, revision: number) => Promise<string[]>;
  onClose: () => void;
}) {
  const [importExperiments, setImportExperiments] = useState(true),
    [committing, setCommitting] = useState(false);
  const [pack, setPack] = useState<DrawingPackage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    active = useRef(true),
    controller = useRef<AbortController | null>(null),
    before = useRef(p.revision());
  const t = (en: string, ar: string) => (p.arabic ? ar : en);
  useEffect(() => {
    active.current = true;
    setPack(null);
    setError("");
    before.current = p.revision();
    const task = new AbortController();
    controller.current = task;
    void readDrawingPackage(p.file, task.signal).then(
      (result) => {
        if (!task.signal.aborted) setPack(result);
      },
      (e) => {
        if (!task.signal.aborted) setError(packageMessage(e, p.arabic, true));
      },
    );
    return () => {
      active.current = false;
      task.abort();
    };
  }, [p.file]);
  const run = async (history: boolean, fresh = false) => {
    if (!pack || busy || !p.canEdit) return;
    setBusy(true);
    setError("");
    let lease: Awaited<ReturnType<typeof reserveDrawingRestore>> = null,
      finished = false;
    const task = controller.current!;
    try {
      if (history || fresh) {
        const result = await importDrawingBundlePackage(p.file, p.file.name.replace(/\.worldsdraw$/i, ""), task.signal, {
            history,
            experiments: importExperiments,
            onCommit: () => setCommitting(true),
          }),
          page = result.page;
        for (const branch of result.experiments) useStore.getState().patchPageLocal(branch);
        if (!active.current) return;
        useStore.getState().patchPageLocal(page);
        useStore.getState().openPage(page.id, "tab");
        p.onClose();
        return;
      }
      lease = await reserveDrawingRestore(p.pageId);
      if (task.signal.aborted || !active.current) return;
      if (lease?.state() === "lost") throw Error(t("Drawing reservation unavailable", "حجز الرسم غير متاح"));
      if (p.revision() !== before.current)
        throw Error(t("The drawing changed. Close this sheet and reopen the project.", "تغيّر الرسم. أغلق هذه النافذة وأعد فتح المشروع."));
      const scene = await importDrawingPackage(p.pageId, p.file, task.signal);
      if (task.signal.aborted || !active.current) return;
      if (p.revision() !== before.current || lease?.state() === "lost")
        throw Error(
          t(
            "The drawing changed before import. Your current artwork was preserved.",
            "تغيّر الرسم قبل الاستيراد. بقي الرسم الحالي محفوظًا.",
          ),
        );
      const operations = await p.apply(scene, before.current);
      if (!operations.length) throw Error(t("The project could not be applied", "تعذر تطبيق المشروع"));
      finished = true;
      lease?.finish(operations);
      p.onClose();
    } catch (e) {
      if (active.current && !task.signal.aborted) {
        setError(packageMessage(e, p.arabic));
        setBusy(false);
        setCommitting(false);
      }
    } finally {
      if (!finished) lease?.cancel();
    }
  };
  return (
    <Modal
      title={t("Import drawing project", "استيراد مشروع رسم")}
      width={640}
      onClose={() => {
        if (!busy) p.onClose();
      }}
      footer={
        <>
          <Button
            disabled={committing}
            onClick={() => {
              controller.current?.abort();
              p.onClose();
            }}
          >
            {t("Cancel", "إلغاء")}
          </Button>
          {!!pack?.experiments?.length && (
            <Button loading={busy} disabled={!p.canEdit} onClick={() => void run(false, true)}>
              {t("New local project", "مشروع محلي جديد")}
            </Button>
          )}
          {pack?.history && (
            <Button loading={busy} disabled={!p.canEdit} onClick={() => void run(true)}>
              {t("History as new local drawing", "السجل كرسم محلي جديد")}
            </Button>
          )}
          <Button variant="tinted" loading={busy} disabled={!pack || !p.canEdit} onClick={() => void run(false)}>
            {t("Replace current drawing", "استبدال الرسم الحالي")}
          </Button>
        </>
      }
    >
      {!pack && !error && <p role="status">{t("Checking project integrity", "جارٍ التحقق من سلامة المشروع")}</p>}
      {pack && (
        <div dir={p.arabic ? "rtl" : "ltr"}>
          <p>
            {pack.scene.frameOrder.length} {t("frames", "إطارات")} · {pack.scene.layerOrder.length} {t("layers", "طبقات")} ·{" "}
            {pack.scene.nodeOrder.length} {t("elements", "عناصر")}
          </p>
          {pack.preview && (
            <div className="drawing-export-preview">
              <img src={`data:image/png;base64,${pack.preview.data}`} alt={t("Embedded project preview", "المعاينة المضمنة في المشروع")} />
            </div>
          )}
          <p>
            {t(
              "Replacing creates one edit. Undo restores the previous drawing. The project originals become owned by this drawing.",
              "الاستبدال ينشئ تعديلًا واحدًا. يعيد التراجع الرسم السابق، وتصبح أصول المشروع مملوكة لهذا الرسم.",
            )}
          </p>
          {!!pack.experiments?.length && (
            <label className="drawing-check">
              <input type="checkbox" checked={importExperiments} disabled={busy} onChange={(e) => setImportExperiments(e.target.checked)} />
              {t(
                `${pack.experiments.length} editable experiments and comparison bases are available in the new local project.`,
                `${pack.experiments.length} تجربة قابلة للتحرير مع أسس مقارنتها متاحة في المشروع المحلي الجديد.`,
              )}
            </label>
          )}
          {pack.history && (
            <p>
              {t(
                `${pack.history.operations.length} historical operations are available. Import them into an independent new local drawing to preserve history.`,
                `${pack.history.operations.length} عملية سابقة متاحة. استوردها إلى رسم محلي جديد مستقل للاحتفاظ بالسجل.`,
              )}
            </p>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
