import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/profiles";
import { Icon } from "../../ui/Icon";
import { relTime } from "../../ui/misc";
import { useStore } from "../../state/store";
import { markNotificationsRead, refreshNotifications, useNotifications, type Notice } from "../manager";
import { useCommentsUi } from "./commentsUi";
import { openDrawingComment } from "../../drawing/navigation";

/** Mentions and replies, newest first, under the bell. */
export function NotificationsPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const { items, unread, error, loadedAt } = useNotifications();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const pages = useStore((s) => s.pages);
  const language = useStore((s) => s.profile?.language), arabic = language === "ar" || language === "auto" && navigator.language.startsWith("ar");
  const t = (en: string, ar: string) => arabic ? ar : en;

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  }, [anchor]);

  useEffect(() => {
    void refreshNotifications();
    const onDown = (e: PointerEvent) => {
      if (panel.current?.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  const openNotice = (n: Notice) => {
    void markNotificationsRead([n.id]);
    if (n.kind === "published") {
      // A sent item opens as this person's own copy of it.
      const mine = Object.values(useStore.getState().pages).find((p) => !p.deletedAt && (p.data as Record<string, unknown> | undefined)?.publishedFrom === n.id);
      if (mine) useStore.getState().openPage(mine.id, "current");
      onClose();
      return;
    }
    if (useStore.getState().pages[n.docId]?.kind === "drawing") openDrawingComment(n.docId, n.threadId);
    else { useStore.getState().openPage(n.docId, "current"); useCommentsUi.getState().openThread(n.docId, n.threadId); }
    onClose();
  };

  if (!pos) return null;
  return createPortal(
    <Glass ref={panel} material="menu" layer={LAYER.popover} className="notif-popover" radius="var(--r-popover)" style={{ top: pos.top, right: pos.right }} role="dialog" dir={arabic ? "rtl" : "ltr"} aria-label={t("Notifications", "الإشعارات")}>
      <header className="np-head">
        <span className="np-title">{t("Notifications", "الإشعارات")}</span>
        <span className="cp-spacer" />
        {unread > 0 && (
          <button type="button" className="cp-link" onClick={() => void markNotificationsRead(null)}>
            {t("Mark all as read", "تحديد الكل كمقروء")}
          </button>
        )}
      </header>
      <div className="np-list">
        {items.length === 0 && (
          <div className="cp-empty">
            <Icon name="bell" size={22} />
            <p>{error ? t("Notifications are unavailable right now.", "الإشعارات غير متاحة حاليًا.") : loadedAt ? t("Mentions and replies show up here.", "تظهر الإشارات والردود هنا.") : t("Connect to a sync server to get mentions.", "اتصل بخادم المزامنة لاستقبال الإشارات.")}</p>
          </div>
        )}
        {items.map((n) => {
          // A sent item's page is in the sender's workspace, not here.
          const page = n.kind === "published" ? undefined : pages[n.docId];
          return (
            <button key={n.id} type="button" className={`np-item ${n.readAt ? "" : "is-unread"}`} onClick={() => openNotice(n)}>
              <span className="np-mark" aria-hidden />
              <span className="np-text">
                <span className="np-line bidi">
                  <strong>{n.fromName || t("Someone", "عضو")}</strong> {n.kind === "mention" ? t("mentioned you", "أشار إليك") : n.kind === "published" ? t("sent you", "أرسل إليك") : t("replied", "ردّ")}
                  {page ? (
                    <>
                      {t(" in ", " في ")}
                      <strong>{page.title || t("Untitled", "بلا عنوان")}</strong>
                    </>
                  ) : null}
                </span>
                <span className="np-excerpt bidi" dir="auto">
                  {n.excerpt}
                </span>
              </span>
              <span className="np-time">{relTime(n.createdAt)}</span>
            </button>
          );
        })}
      </div>
    </Glass>,
    document.body,
  );
}
