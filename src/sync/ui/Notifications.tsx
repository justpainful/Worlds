import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";
import { Icon } from "../../ui/Icon";
import { relTime } from "../../ui/misc";
import { useStore } from "../../state/store";
import { markNotificationsRead, refreshNotifications, useNotifications, type Notice } from "../manager";
import { useCommentsUi } from "./commentsUi";

/** Mentions and replies, newest first, under the bell. */
export function NotificationsPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const { items, unread, error, loadedAt } = useNotifications();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const pages = useStore((s) => s.pages);

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
    useStore.getState().openPage(n.docId, "current");
    useCommentsUi.getState().openThread(n.docId, n.threadId);
    onClose();
  };

  if (!pos) return null;
  return createPortal(
    <Glass ref={panel} material="dense" layer={LAYER.popover} className="notif-popover" radius="var(--r-popover)" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Notifications">
      <header className="np-head">
        <span className="np-title">Notifications</span>
        <span className="cp-spacer" />
        {unread > 0 && (
          <button type="button" className="cp-link" onClick={() => void markNotificationsRead(null)}>
            Mark all as read
          </button>
        )}
      </header>
      <div className="np-list">
        {items.length === 0 && (
          <div className="cp-empty">
            <Icon name="bell" size={22} />
            <p>{error ? "Notifications are unavailable right now." : loadedAt ? "Mentions and replies show up here." : "Connect to a sync server to get mentions."}</p>
          </div>
        )}
        {items.map((n) => {
          const page = pages[n.docId];
          return (
            <button key={n.id} type="button" className={`np-item ${n.readAt ? "" : "is-unread"}`} onClick={() => openNotice(n)}>
              <span className="np-mark" aria-hidden />
              <span className="np-text">
                <span className="np-line bidi">
                  <strong>{n.fromName || "Someone"}</strong> {n.kind === "mention" ? "mentioned you" : "replied"}
                  {page ? (
                    <>
                      {" in "}
                      <strong>{page.title || "Untitled"}</strong>
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
