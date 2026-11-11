import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, errorMessage } from "../lib/api";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { DrawingDocument, DrawingScene } from "./model";
import type { DrawingSession } from "./session";
import { reserveDrawingRestore } from "./syncManager";
import { DrawingScenePreview } from "./ScenePreview";

export function DrawingVersionRestoreDialog({
  pageId,
  version,
  session,
  arabic,
  canEdit,
  onClose,
  onApplied,
}: {
  pageId: string;
  version: { id: string; label: string; revision: number };
  session: DrawingSession;
  arabic: boolean;
  canEdit: boolean;
  onClose: () => void;
  onApplied: (backupId: string) => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot),
    t = (en: string, ar: string) => (arabic ? ar : en);
  const [preview, setPreview] = useState<{ before: DrawingDocument; after: DrawingScene } | null>(null),
    [frameId, setFrameId] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState<"reserving" | "restoring" | null>(null),
    [refresh, setRefresh] = useState(0);
  const requestId = useRef(crypto.randomUUID()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setError("");
    requestId.current = crypto.randomUUID();
    void Promise.all([api.drawingVersionScene(pageId, version.id), session.flush()])
      .then(([after]) => {
        const before = session.snapshot().document;
        if (!before || session.snapshot().pending || session.snapshot().recovered)
          throw new Error(t("Save the current drawing before previewing a restore", "احفظ الرسم الحالي قبل معاينة الاستعادة"));
        if (active) {
          setPreview({ before: structuredClone(before), after });
          setFrameId(after.defaultFrameId);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [pageId, version.id, session, refresh]);
  const stale = !!preview && state.document?.revision !== preview.before.revision;
  const restore = async () => {
    if (!preview || !canEdit || busy) return;
    setBusy(true);
    setError("");
    setPhase("reserving");
    let lease: Awaited<ReturnType<typeof reserveDrawingRestore>> = null,
      handedOff = false;
    try {
      lease = await reserveDrawingRestore(pageId);
      setPhase("restoring");
      const result = await session.restore(async () => {
        if (lease && lease.state() !== "locked")
          throw new Error(
            t("The shared reservation was lost. Review before trying again.", "فُقد حجز الرسم المشترك. راجع المعاينة قبل المحاولة مجددًا."),
          );
        return api.drawingVersionRestore(
          pageId,
          version.id,
          preview.before.revision,
          requestId.current,
          t(`Restore: ${version.label}`, `استعادة: ${version.label}`).slice(0, 200),
          t(`Before restoring: ${version.label}`, `قبل استعادة: ${version.label}`).slice(0, 200),
        );
      });
      lease?.finish([result.operationId]);
      handedOff = true;
      if (mounted.current) onApplied(result.backupId);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (!handedOff) lease?.cancel();
      if (mounted.current) {
        setBusy(false);
        setPhase(null);
      }
    }
  };
  return (
    <Modal
      title={t("Preview version restore", "معاينة استعادة الإصدار")}
      width={900}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t("Cancel", "إلغاء")}
          </Button>
          <Button
            icon="undo"
            variant="tinted"
            loading={busy}
            disabled={!preview || !canEdit || stale || !!state.error}
            onClick={() => void restore()}
          >
            {t("Keep current version and restore", "حفظ الحالية واستعادة الإصدار")}
          </Button>
        </>
      }
    >
      <div className="drawing-version-restore" dir={arabic ? "rtl" : "ltr"}>
        <p>
          {t(
            `“${version.label}” will replace the whole drawing as one new, undoable edit. The current drawing will first be kept as a named version in the same transaction.`,
            `سيحل «${version.label}» محل الرسم كاملًا كتعديل جديد يمكن التراجع عنه. يُحفظ الرسم الحالي أولًا كإصدار مسمّى ضمن العملية نفسها.`,
          )}
        </p>
        {!preview && !error && <p role="status">{t("Loading saved artwork", "جارٍ تحميل الرسم المحفوظ")}</p>}
        {preview && (
          <>
            <label>
              {t("Preview frame from saved version", "إطار المعاينة من الإصدار المحفوظ")}
              <select disabled={busy} value={frameId} onChange={(e) => setFrameId(e.target.value)}>
                {preview.after.frameOrder.map((id) => (
                  <option value={id} key={id}>
                    {preview.after.frames[id].name}
                  </option>
                ))}
              </select>
            </label>
            <div className="drawing-version-comparison">
              <section>
                <h3>{t("Current drawing to keep", "الرسم الحالي الذي سيُحفظ")}</h3>
                <DrawingScenePreview
                  scene={preview.before.scene}
                  frameId={preview.before.scene.frames[frameId] ? frameId : preview.before.scene.defaultFrameId}
                  label={t("Current drawing", "الرسم الحالي")}
                />
                <p>
                  {preview.before.scene.nodeOrder.length} {t("elements", "عناصر")} · {preview.before.scene.frameOrder.length}{" "}
                  {t("frames", "إطارات")} · {preview.before.scene.layerOrder.length} {t("layers", "طبقات")}
                </p>
              </section>
              <section>
                <h3>{version.label}</h3>
                <DrawingScenePreview
                  scene={preview.after}
                  frameId={frameId || preview.after.defaultFrameId}
                  label={t("Saved drawing after restore", "الرسم المحفوظ بعد الاستعادة")}
                />
                <p>
                  {preview.after.nodeOrder.length} {t("elements", "عناصر")} · {preview.after.frameOrder.length} {t("frames", "إطارات")} ·{" "}
                  {preview.after.layerOrder.length} {t("layers", "طبقات")}
                </p>
              </section>
            </div>
          </>
        )}
        {stale && (
          <p role="alert">
            {t(
              "The drawing changed after this preview. Refresh it before restoring.",
              "تغيّر الرسم بعد هذه المعاينة. حدّثها قبل الاستعادة.",
            )}
          </p>
        )}
        {phase && (
          <p role="status">
            {phase === "reserving"
              ? t("Checking shared changes and reserving the drawing", "جارٍ التحقق من التعديلات المشتركة وحجز الرسم")
              : t("Saving the current version and restoring", "جارٍ حفظ الإصدار الحالي والاستعادة")}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {(stale || error) && (
          <Button icon="preview" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
            {t("Refresh preview", "تحديث المعاينة")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
