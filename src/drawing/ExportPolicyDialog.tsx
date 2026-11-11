import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { readDrawingExportPolicy, useDrawingExportPolicy } from "./exportAccess";
import type { DrawingExportRules, ExportLevel } from "./exportPolicy";
export function DrawingExportPolicyDialog({ pageId, arabic, onClose }: { pageId: string; arabic: boolean; onClose: () => void }) {
  const { info, error, refresh } = useDrawingExportPolicy(pageId),
    [draft, setDraft] = useState<DrawingExportRules | null>(null),
    [expected, setExpected] = useState(0),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const request = useRef(crypto.randomUUID()),
    t = (en: string, ar: string) => (arabic ? ar : en);
  useEffect(() => {
    if (info && !dirty) {
      setDraft({ ...info.policy.rules });
      setExpected(info.policy.revision);
    }
  }, [info, dirty]);
  const stale = !!info && expected !== info.policy.revision,
    canManage = info?.level === "full";
  const options: { value: ExportLevel; label: string }[] = [
    { value: "view", label: t("View or above", "مشاهدة أو أعلى") },
    { value: "comment", label: t("Comment or above", "تعليق أو أعلى") },
    { value: "edit", label: t("Edit or above", "تعديل أو أعلى") },
    { value: "full", label: t("Full access", "صلاحية كاملة") },
  ];
  return (
    <Modal
      title={t("Export permissions", "صلاحيات التصدير")}
      width={560}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t("Close", "إغلاق")}
          </Button>
          {canManage && (
            <Button
              variant="tinted"
              loading={busy}
              disabled={!draft || !dirty || stale || !!error}
              onClick={async () => {
                if (!draft) return;
                setBusy(true);
                setFailure("");
                try {
                  await readDrawingExportPolicy(pageId, { requestId: request.current, expectedRevision: expected, rules: draft });
                  window.dispatchEvent(new CustomEvent("worlds:drawing-policy", { detail: { pageId } }));
                  onClose();
                } catch (e) {
                  setFailure(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Save permissions", "حفظ الصلاحيات")}
            </Button>
          )}
        </>
      }
    >
      <div className="drawing-export-policy" dir={arabic ? "rtl" : "ltr"} aria-busy={busy || (!info && !error)}>
        <p>
          {t(
            "Choose the minimum drawing permission needed for each export. Changes apply to shared saves and clipboard copies. Restoring artwork leaves these permissions in place.",
            "حدد أدنى صلاحية مطلوبة لكل نوع من التصدير. تسري التغييرات على حفظ الملفات المشتركة والنسخ إلى الحافظة. تبقى هذه الصلاحيات عند استعادة الرسم.",
          )}
        </p>
        {!info && !error && <p role="status">{t("Checking permissions", "جارٍ التحقق من الصلاحيات")}</p>}
        {busy && <p role="status">{t("Saving permissions", "جارٍ حفظ الصلاحيات")}</p>}
        {!canManage && info && (
          <p>{t("Full access is required to change these settings.", "يلزم امتلاك صلاحية كاملة لتغيير هذه الإعدادات.")}</p>
        )}
        {draft &&
          (
            [
              ["images", t("Images and presentation steps", "الصور وخطوات العرض")],
              ["projects", t("Editable projects and library items", "المشاريع القابلة للتعديل وعناصر المكتبة")],
              ["comments", t("My refused comment text", "نص تعليقاتي المرفوضة")],
            ] as const
          ).map(([kind, label]) => (
            <label key={kind}>
              {label}
              <select
                value={draft[kind]}
                disabled={!canManage || busy}
                onChange={(e) => {
                  setDraft({ ...draft, [kind]: e.target.value as ExportLevel });
                  setDirty(true);
                  request.current = crypto.randomUUID();
                }}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {stale && (
          <p role="alert">
            {t(
              "Someone changed these permissions. Review the latest settings before saving.",
              "غيّر أحد المشاركين هذه الصلاحيات. راجع أحدث الإعدادات قبل الحفظ.",
            )}
          </p>
        )}
        {(error || failure) && <p role="alert">{error || failure}</p>}
        {(stale || error || failure) && (
          <Button
            icon="preview"
            disabled={busy}
            onClick={() => {
              setDirty(false);
              setFailure("");
              request.current = crypto.randomUUID();
              refresh();
            }}
          >
            {t("Review latest permissions", "مراجعة أحدث الصلاحيات")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
