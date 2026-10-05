import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { menuAt, type MenuItem } from "../../ui/Menu";
import { relTime } from "../../ui/misc";
import { useStore } from "../../state/store";
import { selectionAnchor } from "../extensions";
import { useNotifications } from "../manager";
import type { SyncInfo } from "../provider";
import { announceModeChange, localStore, type CollabSession } from "../session";
import { CommentsPanel } from "./CommentsPanel";
import { useCommentsUi } from "./commentsUi";
import { useComments, usePresence, useSessionInfo, type Peer } from "./hooks";
import { NotificationsPopover } from "./Notifications";
import { VersionsSheet } from "./VersionsSheet";

export type StatusKind = "synced" | "syncing" | "offline" | "attention";

export function statusOf(info: SyncInfo | null): { kind: StatusKind; label: string; detail: string } {
  if (!info) return { kind: "syncing", label: "Syncing", detail: "Opening the shared page" };
  if (info.attention) return { kind: "attention", label: "Needs attention", detail: info.attention };
  if (info.level === "none") return { kind: "attention", label: "Needs attention", detail: info.error ?? "You no longer have access to this page" };
  if (info.state === "error") return { kind: "attention", label: "Needs attention", detail: info.error ?? "Sync stopped" };
  if (!info.remote) return { kind: "offline", label: "Offline", detail: "Saved on this computer. Add a sync server to share live." };
  if (info.state === "offline") {
    const n = info.unacked;
    return { kind: "offline", label: "Offline", detail: n ? `${n} change${n === 1 ? "" : "s"} will sync when you are back online` : "Changes are saved here and sync when you are back online" };
  }
  if (info.state === "synced") return { kind: "synced", label: "Synced", detail: info.lastSyncedAt ? `Up to date, ${relTime(info.lastSyncedAt)}` : "Up to date" };
  return { kind: "syncing", label: "Syncing", detail: info.unacked ? `Sending ${info.unacked} change${info.unacked === 1 ? "" : "s"}` : "Catching up" };
}

const LEVEL_TEXT: Record<string, string> = {
  full: "Full access",
  edit: "Can edit",
  comment: "Can comment",
  view: "Can view",
  none: "No access",
};

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => [...w][0] ?? "")
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function Presence({ peers }: { peers: Peer[] }) {
  if (!peers.length) return null;
  const shown = peers.slice(0, 4);
  const extra = peers.length - shown.length;
  return (
    <span className="presence" aria-label={`${peers.length} ${peers.length === 1 ? "person" : "people"} here`}>
      {shown.map((p) => (
        <span key={p.id} className="presence-avatar" style={{ ["--peer" as string]: p.color }} data-tip={p.name}>
          <span className="bidi">{initials(p.name)}</span>
        </span>
      ))}
      {extra > 0 && <span className="presence-avatar is-more">+{extra}</span>}
    </span>
  );
}

/** Find the page's action capsule so sync controls sit with the other page actions. */
function useActionsHost(wrap: HTMLElement | null): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!wrap) return;
    const actions = wrap.closest(".page-view, .page-column, .doc-view")?.querySelector(".page-actions-row, .page-actions") as HTMLElement | null;
    if (!actions) return;
    const slot = document.createElement("span");
    slot.className = "collab-slot";
    actions.insertBefore(slot, actions.firstChild);
    setHost(slot);
    return () => {
      slot.remove();
      setHost(null);
    };
  }, [wrap]);
  return host;
}

/** Floating "Comment" control in the margin next to a text selection. */
function CommentAffordance({ editor, session, wrap }: { editor: Editor; session: CollabSession; wrap: HTMLElement }) {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      if (editor.isDestroyed || editor.state.selection.empty || !editor.isFocused) return setTop(null);
      const text = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ").trim();
      if (!text) return setTop(null);
      const c = editor.view.coordsAtPos(editor.state.selection.from);
      setTop(c.top - wrap.getBoundingClientRect().top);
    };
    editor.on("selectionUpdate", update);
    editor.on("blur", update);
    editor.on("focus", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", update);
      editor.off("focus", update);
    };
  }, [editor, wrap]);
  if (top === null || !session.canComment) return null;
  return (
    <button
      type="button"
      className="comment-affordance"
      style={{ top }}
      aria-label="Comment on the selection"
      data-tip="Comment  Ctrl+Alt+M"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => startComment(editor, session)}
    >
      <Icon name="dm" size={16} />
    </button>
  );
}

export function startComment(editor: Editor, session: CollabSession) {
  const a = selectionAnchor(editor);
  if (!a || !session.canComment) return;
  useCommentsUi.getState().startDraft(session.pageId, a.anchor, a.quote);
}

/** Presence, sync status, comments and notifications for a shared page. */
export function CollabChrome({
  session,
  editor,
  wrap,
  onSettings,
}: {
  session: CollabSession;
  editor: Editor | null;
  wrap: HTMLElement | null;
  onSettings: () => void;
}) {
  const info = useSessionInfo(session);
  const peers = usePresence(session);
  const { threads } = useComments(session);
  const unread = useNotifications((s) => s.unread);
  const panelOpen = useCommentsUi((s) => s.pageId === session.pageId);
  const host = useActionsHost(wrap);
  const [bell, setBell] = useState<HTMLElement | null>(null);
  const [history, setHistory] = useState(false);
  const status = statusOf(info);
  const open = threads.filter((t) => !t.resolved).length;

  useEffect(() => {
    if (session.ready) session.announce();
  }, [session, info?.level, info?.state]);

  const statusMenu = (el: HTMLElement) => {
    const items: MenuItem[] = [
      { kind: "label", label: status.detail },
      ...(info?.level ? [{ kind: "label" as const, label: LEVEL_TEXT[info.level] ?? info.level }] : []),
      { kind: "separator" },
      { label: "Sync Now", icon: "refresh", disabled: !info?.remote, onSelect: () => session.provider.reconnect() },
      { label: "Shared History", icon: "history", disabled: !info?.remote, onSelect: () => setHistory(true) },
      { label: "Live Sync Settings", icon: "settings", onSelect: onSettings },
    ];
    void localStore()
      .pageMode(session.pageId)
      .then((m) => {
        if (m.flagged && !m.workspaceId) {
          items.push({ kind: "separator" }, { label: "Stop Sharing This Page", icon: "lock", onSelect: () => void localStore().setShared(session.pageId, false).then(() => announceModeChange(session.pageId)) });
        }
      })
      .finally(() => menuAt(el, items, "end"));
  };

  const controls = (
    <span className="collab-actions">
      <Presence peers={peers} />
      <button
        type="button"
        className={`sync-pill is-${status.kind}`}
        aria-label={`${status.label}. ${status.detail}`}
        data-tip={status.detail}
        onClick={(e) => statusMenu(e.currentTarget)}
      >
        <span className="sync-dot" aria-hidden />
        <span className="sync-label">{status.label}</span>
      </button>
      <span className="badge-host">
        <IconButton
          icon="dm"
          label={panelOpen ? "Hide comments" : "Comments"}
          active={panelOpen}
          onClick={() => (panelOpen ? useCommentsUi.getState().close() : useCommentsUi.getState().open(session.pageId))}
        />
        {open > 0 && <span className="count-badge">{open}</span>}
      </span>
      <span className="badge-host">
        <IconButton icon="bell" label="Notifications" active={!!bell} onClick={(e) => setBell(bell ? null : (e.currentTarget.parentElement as HTMLElement))} />
        {unread > 0 && <span className="count-badge is-accent">{unread > 9 ? "9+" : unread}</span>}
      </span>
    </span>
  );

  return (
    <>
      {host ? createPortal(controls, host) : <div className="collab-inline">{controls}</div>}
      {editor && wrap && !editor.isDestroyed && <CommentAffordance editor={editor} session={session} wrap={wrap} />}
      <CommentsPanel session={session} editor={editor} />
      {bell && <NotificationsPopover anchor={bell} onClose={() => setBell(null)} />}
      {history && <VersionsSheet session={session} onClose={() => setHistory(false)} />}
      {status.kind === "attention" && info?.level === "none" && <RevokedNote />}
    </>
  );
}

function RevokedNote() {
  useEffect(() => {
    useStore.getState().toast({ message: "Your access to this page was removed. Its shared copy on this computer was cleared.", tone: "error" });
  }, []);
  return null;
}
