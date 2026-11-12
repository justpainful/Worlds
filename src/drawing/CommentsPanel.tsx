import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../ui/Button";
import { listPeople, type ThreadData } from "../sync/comments";
import { syncConfig } from "../sync/config";
import { useStore } from "../state/store";
import { errorMessage } from "../lib/api";
import { drawingCommentAnchor, drawingCommentLocation, type DrawingLiveSession } from "./collaboration";
import { validDrawingAnchor, type DrawingCommentAnchor } from "./collaborationTypes";
import type { DrawingScene, Rect } from "./model";
import { DrawingRejectedCommentsDialog } from "./RejectedCommentsDialog";
const subscribeNone = () => () => {};
function safeCommentTime(value: number, arabic: boolean) {
  const date = typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new Date(value) : null;
  return {
    iso: date?.toISOString(),
    label: date?.toLocaleString(arabic ? "ar" : "en") ?? (arabic ? "تاريخ غير متاح" : "Date unavailable"),
  };
}
export function DrawingCommentsPanel({
  pageId,
  canReview,
  session,
  scene,
  frameId,
  selected,
  region,
  arabic,
  onGo,
  activeThread,
  onRetry,
}: {
  pageId: string;
  canReview: boolean;
  session: DrawingLiveSession | null;
  scene: DrawingScene;
  frameId: string;
  selected: string[];
  region?: Rect;
  arabic: boolean;
  onGo: (frame: string, region: Rect) => void;
  activeThread?: string | null;
  onRetry: () => void;
}) {
  const state = useSyncExternalStore(session?.subscribe ?? subscribeNone, () => session?.snapshot() ?? null);
  const [anchor, setAnchor] = useState<DrawingCommentAnchor | null>(null),
    [body, setBody] = useState(""),
    [resolved, setResolved] = useState(false),
    [query, setQuery] = useState("");
  const [review, setReview] = useState(false);
  // The query and results stay inside this authorized drawing session.
  useEffect(() => {
    setQuery("");
  }, [pageId, session, activeThread]);
  const t = (en: string, ar: string) => (arabic ? ar : en);
  const fail = (work: () => void) => {
    try {
      work();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  const reviewControl = (
    <>
      <Button icon="preview" size="compact" disabled={!canReview} onClick={() => setReview(true)}>
        {t("Review refused comments", "مراجعة التعليقات المرفوضة")}
      </Button>
      {review && canReview && (
        <DrawingRejectedCommentsDialog
          pageId={pageId}
          session={session}
          scene={scene}
          arabic={arabic}
          canReview={canReview}
          onClose={() => setReview(false)}
        />
      )}
    </>
  );
  if (!canReview || !session || !state?.ready || !state.info?.level || state.info.level === "none")
    return (
      <>
        <p>
          {state?.error ??
            state?.info?.error ??
            t(
              "Comments become available when this drawing connects to its shared workspace.",
              "تتوفر التعليقات عند اتصال الرسم بمساحة العمل المشتركة.",
            )}
        </p>
        {(state?.error || state?.info?.error) && (
          <Button size="compact" onClick={onRetry}>
            {t("Reconnect comments", "إعادة اتصال التعليقات")}
          </Button>
        )}
        {reviewControl}
      </>
    );
  const people = listPeople(session.comments),
    user = syncConfig().user().id;
  const search = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\p{M}/gu, "");
  const terms = search(query.trim()).split(/\s+/u).filter(Boolean);
  const visibleThreads = state.threads.filter(
    (thread) =>
      (resolved || !thread.resolved || thread.id === activeThread) &&
      (!terms.length ||
        terms.every((term) =>
          thread.comments.some(
            (comment) =>
              !comment.deleted &&
              (search(comment.body).includes(term) ||
                search(people.find((person) => person.id === comment.author)?.name ?? "").includes(term)),
          ),
        )),
  );
  const go = (anchor: DrawingCommentAnchor) => {
    const location = drawingCommentLocation(scene, anchor);
    if (scene.frames[location.frameId]) onGo(location.frameId, location.region);
  };
  return (
    <section className="drawing-comments" aria-label={t("Drawing comments", "تعليقات الرسم")}>
      {reviewControl}
      {state.error && <p role="alert">{state.error}</p>}
      {state.info?.error && <p role="alert">{state.info.error}</p>}
      {state.info?.attention && <p role="alert">{state.info.attention}</p>}
      <p role="status">
        {state.info?.unacked
          ? t(`${state.info.unacked} comment changes waiting to synchronize`, `تعديلات على التعليقات بانتظار المزامنة: ${state.info.unacked}`)
          : state.info?.state === "synced"
            ? t("Comments synchronized", "تمت مزامنة التعليقات")
            : t("Comments saved on this computer", "التعليقات محفوظة على هذا الجهاز")}
      </p>
      {session.canComment && (
        <>
          <Button
            icon="add"
            size="compact"
            onClick={() => fail(() => setAnchor(drawingCommentAnchor(scene, frameId, selected.length === 1 ? selected[0] : null, region)))}
          >
            {selected.length === 1
              ? t("Comment on selected element", "تعليق على العنصر المحدد")
              : t("Comment on this region", "تعليق على هذه المنطقة")}
          </Button>
          {anchor && (
            <div className="drawing-comment-draft">
              <Button variant="quiet" icon="preview" size="compact" onClick={() => go(anchor)}>
                {t("Show comment location", "عرض موضع التعليق")}
              </Button>
              <label>
                {t("Comment", "التعليق")}
                <textarea dir="auto" maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
              </label>
              <label>
                {t("Mention a member", "الإشارة إلى عضو")}
                <select
                  value=""
                  onChange={(e) => {
                    const p = people.find((p) => p.id === e.target.value);
                    if (p) setBody((old) => `${old}${old ? " " : ""}@${p.name} `);
                  }}
                >
                  <option value="">{t("Choose a member", "اختر عضوًا")}</option>
                  {people
                    .filter((p) => p.id !== user)
                    .map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="drawing-step-actions">
                <Button
                  icon="send"
                  size="compact"
                  disabled={!body.trim()}
                  onClick={() =>
                    fail(() => {
                      session.thread(anchor, body);
                      setAnchor(null);
                      setBody("");
                    })
                  }
                >
                  {t("Post comment", "إضافة التعليق")}
                </Button>
                <Button size="compact" variant="quiet" onClick={() => setAnchor(null)}>
                  {t("Cancel", "إلغاء")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <label className="drawing-field">
        <span>{t("Search comments in this drawing", "البحث في تعليقات هذا الرسم")}</span>
        <input type="search" dir="auto" maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <label className="drawing-check">
        <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />
        {t("Include resolved threads", "عرض التعليقات المحلولة")}
      </label>
      {visibleThreads.map((thread) => (
        <DrawingThread
          key={thread.id}
          active={activeThread === thread.id}
          thread={thread}
          session={session}
          scene={scene}
          arabic={arabic}
          onGo={go}
        />
      ))}
      {!!terms.length && (
        <p role="status">
          {visibleThreads.length
            ? t(`${visibleThreads.length} matching discussions`, `المناقشات المطابقة: ${visibleThreads.length}`)
            : t("No matching discussions", "لا توجد مناقشات مطابقة")}
        </p>
      )}
      {!state.threads.length && (
        <p>
          {t(
            "No comments yet. Select an element or region to start a discussion.",
            "لا توجد تعليقات بعد. حدّد عنصرًا أو منطقة لبدء النقاش.",
          )}
        </p>
      )}
    </section>
  );
}
function DrawingThread({
  thread,
  session,
  scene,
  arabic,
  onGo,
  active,
}: {
  thread: ThreadData;
  session: DrawingLiveSession;
  scene: DrawingScene;
  arabic: boolean;
  onGo: (anchor: DrawingCommentAnchor) => void;
  active: boolean;
}) {
  const [body, setBody] = useState(""),
    t = (en: string, ar: string) => (arabic ? ar : en);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active) {
      element.current?.focus({ preventScroll: true });
      element.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);
  const people = listPeople(session.comments),
    user = syncConfig().user().id,
    anchor = thread.anchor;
  const missing = validDrawingAnchor(anchor) && drawingCommentLocation(scene, anchor).missing;
  const run = (work: () => void) => {
    try {
      work();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  return (
    <article
      ref={element}
      tabIndex={-1}
      aria-label={t("Comment thread", "مناقشة التعليق")}
      className={`drawing-comment-thread ${active ? "is-active" : ""}`}
    >
      <header>
        <Button
          icon="preview"
          variant="quiet"
          size="compact"
          onClick={() => {
            if (validDrawingAnchor(anchor)) onGo(anchor);
          }}
        >
          {missing ? t("Original target is missing", "العنصر الأصلي مفقود") : t("Show on drawing", "عرض على الرسم")}
        </Button>
        {session.canComment && (
          <Button icon="check" size="compact" onClick={() => run(() => session.resolve(thread.id, !thread.resolved))}>
            {thread.resolved ? t("Reopen", "إعادة فتح") : t("Resolve", "حل التعليق")}
          </Button>
        )}
      </header>
      {thread.comments
        .filter((c) => !c.deleted)
        .map((c) => (
          <div className="drawing-comment-body" key={c.id}>
            <strong>{people.find((p) => p.id === c.author)?.name || t("Member", "عضو")}</strong>
            <time dateTime={safeCommentTime(c.createdAt, arabic).iso}>{safeCommentTime(c.createdAt, arabic).label}</time>
            <p dir="auto">{c.body}</p>
            {session.canComment && (c.author === user || session.snapshot().info?.level === "full") && (
              <Button icon="delete" size="compact" variant="quiet" onClick={() => run(() => session.remove(thread.id, c.id))}>
                {t("Delete comment", "حذف التعليق")}
              </Button>
            )}
          </div>
        ))}
      {session.canComment && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => {
              session.reply(thread.id, body);
              setBody("");
            });
          }}
        >
          <label>
            {t("Reply", "الرد")}
            <textarea dir="auto" maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <Button icon="send" size="compact" disabled={!body.trim()} type="submit">
            {t("Reply", "إرسال الرد")}
          </Button>
        </form>
      )}
    </article>
  );
}
