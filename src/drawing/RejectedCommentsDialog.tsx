import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { localStore } from "../sync/session";
import { syncConfig } from "../sync/config";
import type { RejectedPage, RejectedSnapshotInfo } from "../sync/localStore";
import { errorMessage } from "../lib/api";
import type { DrawingLiveSession } from "./collaboration";
import { drawingCommentAnchor, drawingCommentLocation } from "./commentAnchors";
import type { DrawingScene } from "./model";
import { rejectedComments, rejectedCommentsText, type RejectedComment } from "./rejectedComments";
import { saveDrawingBlob } from "./files";
import { useDrawingExportPolicy } from "./exportAccess";
import { canDrawingExport } from "./exportPolicy";
const subscribeNone = () => () => {};
function displayDate(value: number, arabic: boolean) {
  const date = Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new Date(value) : null;
  return {
    label: date?.toLocaleString(arabic ? "ar" : "en") ?? (arabic ? "تاريخ غير متاح" : "Date unavailable"),
    iso: date?.toISOString(),
  };
}
export function DrawingRejectedCommentsDialog({
  pageId,
  session,
  scene,
  arabic,
  canReview,
  onClose,
}: {
  pageId: string;
  session: DrawingLiveSession | null;
  scene: DrawingScene;
  arabic: boolean;
  canReview: boolean;
  onClose: () => void;
}) {
  const live = useSyncExternalStore(session?.subscribe ?? subscribeNone, () => session?.snapshot() ?? null),
    owner = syncConfig().user().id;
  const t = (en: string, ar: string) => (arabic ? ar : en);
  const exportPolicy = useDrawingExportPolicy(canReview ? pageId : null),
    canExport =
      !!exportPolicy.info && !exportPolicy.error && canDrawingExport(exportPolicy.info.policy, exportPolicy.info.level, "comments");
  const [items, setItems] = useState<RejectedSnapshotInfo[]>([]),
    [next, setNext] = useState<RejectedPage["next"]>(null),
    [selected, setSelected] = useState<RejectedSnapshotInfo | null>(null);
  const [comments, setComments] = useState<RejectedComment[]>([]),
    [limit, setLimit] = useState(50),
    [posted, setPosted] = useState(new Map<string, string>());
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setItems([]);
    setComments([]);
    setSelected(null);
    setNext(null);
    setPosted(new Map());
    setError("");
    setLoading(true);
    if (canReview)
      void localStore()
        .rejected(pageId, owner)
        .then((page) => {
          if (active) {
            setItems(page.items.filter((r) => r.channel === 1));
            setNext(page.next);
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    else setLoading(false);
    return () => {
      active = false;
    };
  }, [pageId, owner, canReview]);
  useEffect(() => {
    let active = true;
    setComments([]);
    setLimit(50);
    if (selected && canReview) {
      setLoading(true);
      void localStore()
        .rejectedSnapshot(pageId, selected.id, owner)
        .then((data) => {
          if (active) setComments(rejectedComments(data, owner));
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [selected?.id, pageId, owner, canReview]);
  const run = async (work: () => Promise<void>) => {
    if (busy || !canReview) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("Review refused comments", "مراجعة التعليقات المرفوضة")}
      width={720}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t("Close", "إغلاق")}</Button>}
    >
      <div className="drawing-rejected-comments" dir={arabic ? "rtl" : "ltr"}>
        {!canReview ? (
          <p>{t("Drawing access is required to read these local copies.", "يلزم الوصول إلى الرسم لقراءة النسخ المحلية.")}</p>
        ) : (
          <>
            <p>
              {t(
                "Each copy includes your text at the time the server refused an update. It may also include your earlier synchronized comments. Review a copy or send your text as a new discussion with your current permissions.",
                "تتضمن كل نسخة نصك وقت رفض الخادم للتعديل، وقد تشمل تعليقاتك السابقة التي تمت مزامنتها. يمكنك مراجعتها أو إرسال نصك كنقاش جديد بصلاحيتك الحالية.",
              )}
            </p>
            <label>
              {t("Local copy", "النسخة المحلية")}
              <select
                disabled={busy}
                value={selected?.id ?? ""}
                onChange={(e) => {
                  setSelected(items.find((r) => r.id === e.target.value) ?? null);
                  setError("");
                }}
              >
                <option value="">{t("Choose a copy", "اختر نسخة")}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {displayDate(item.createdAt, arabic).label} · {(item.size / 1024).toFixed(1)} KB
                  </option>
                ))}
              </select>
            </label>
            {next && (
              <Button
                disabled={busy}
                size="compact"
                onClick={() =>
                  void run(async () => {
                    const page = await localStore().rejected(pageId, owner, next);
                    setItems((old) => [...old, ...page.items.filter((r) => r.channel === 1)]);
                    setNext(page.next);
                  })
                }
              >
                {t("Load older copies", "تحميل النسخ الأقدم")}
              </Button>
            )}
            {selected && (
              <>
                <p>
                  {t("Server reason", "سبب الرفض من الخادم")}: <span dir="auto">{selected.reason}</span>
                </p>
                <Button
                  icon="download"
                  disabled={busy || loading || !comments.length || !canExport}
                  onClick={() =>
                    void run(async () => {
                      const fresh = rejectedComments(await localStore().rejectedSnapshot(pageId, selected.id, owner), owner);
                      await saveDrawingBlob(
                        new Blob([rejectedCommentsText(fresh, arabic)], { type: "text/plain;charset=utf-8" }),
                        "drawing-refused-comments.txt",
                        { pageId, kind: "comments", scenes: [], archiveId: selected.id },
                      );
                    })
                  }
                >
                  {t("Save my text", "حفظ نصوصي")}
                </Button>
              </>
            )}
            {comments.slice(0, limit).map((comment) => {
              const current = live?.threads
                  .flatMap((thread) => thread.comments)
                  .find((c) => c.id === comment.commentId && c.body === comment.body && !c.deleted),
                sent = posted.get(`${selected?.id}:${comment.commentId}`);
              return (
                <article key={comment.commentId}>
                  <time dateTime={displayDate(comment.createdAt, arabic).iso}>{displayDate(comment.createdAt, arabic).label}</time>
                  <p dir="auto">{comment.body}</p>
                  {current || sent ? (
                    <p role="status">
                      {current
                        ? t("Already in the shared drawing", "موجود في الرسم المشترك")
                        : t(
                            "A new discussion was created; check saving and synchronization in Comments.",
                            "أُنشئ نقاش جديد؛ تابع الحفظ والمزامنة في التعليقات.",
                          )}
                    </p>
                  ) : (
                    <Button
                      icon="send"
                      size="compact"
                      disabled={busy || !session?.canComment}
                      onClick={() =>
                        void run(async () => {
                          await localStore().rejectedSnapshot(pageId, selected!.id, owner);
                          if (!session?.canComment || syncConfig().user().id !== owner)
                            throw new Error(t("Comment access is required", "يلزم السماح بالتعليق"));
                          const location = drawingCommentLocation(scene, comment.anchor),
                            frame = scene.frames[location.frameId] ? location.frameId : scene.defaultFrameId;
                          const anchor = drawingCommentAnchor(
                            scene,
                            frame,
                            location.missing ? null : comment.anchor.nodeId,
                            location.region,
                          );
                          const id = session.thread(anchor, comment.body);
                          setPosted((old) => new Map(old).set(`${selected!.id}:${comment.commentId}`, id));
                          await session.persisted();
                        })
                      }
                    >
                      {t("Send as new discussion", "إرسال كنقاش جديد")}
                    </Button>
                  )}
                </article>
              );
            })}
            {comments.length > limit && (
              <Button size="compact" onClick={() => setLimit((value) => value + 50)}>
                {t("Show more comments", "عرض تعليقات إضافية")}
              </Button>
            )}
            {loading && <p role="status">{t("Reading local copies", "جارٍ قراءة النسخ المحلية")}</p>}
            {!loading && !items.length && (
              <p>{t("No refused comment copies in this batch.", "لا توجد نسخ تعليقات مرفوضة في هذه الدفعة.")}</p>
            )}
            {selected && !loading && !comments.length && (
              <p>
                {t(
                  "This copy contains no visible drawing comments authored by your current account.",
                  "لا تتضمن هذه النسخة تعليقات رسم ظاهرة كتبها حسابك الحالي.",
                )}
              </p>
            )}
          </>
        )}
        {canReview && exportPolicy.info && !canExport && (
          <p role="status">
            {t("Your current permission does not allow comment-text exports.", "صلاحيتك الحالية لا تسمح بتصدير نص التعليقات.")}
          </p>
        )}
        {exportPolicy.error && <p role="alert">{exportPolicy.error}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
