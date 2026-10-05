/**
 * The one hook PageEditor uses for live collaboration.
 *
 * Personal pages get nothing: no extensions, the usual block save path.
 * Shared pages (a Team workspace, or the testing flag) edit through Yjs:
 * the editor is created once the page's documents are loaded, saving goes
 * through the session's block mirror, and the collaboration UI renders
 * next to the page actions.
 */
import type { AnyExtension, Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Page } from "../lib/types";
import { useStore } from "../state/store";
import { collabExtensions } from "./extensions";
import { startSyncManager, workspaceFor } from "./manager";
import { acquireSession, localStore, releaseSession, type CollabSession } from "./session";
import { StableEditor } from "./stableEditor";
import { CollabChrome, startComment } from "./ui/CollabChrome";
import { useSessionInfo, useSessionReady } from "./ui/hooks";
import { SyncSettings } from "./ui/SyncSettings";
import "./ui/sync.css";

export interface Collab {
  /** The page edits through Yjs. */
  shared: boolean;
  /** Shared, but its documents are still loading (the editor is a read-only preview). */
  pending: boolean;
  /** Changes when the editor must be created again. */
  key: string;
  extensions: AnyExtension[];
  /** StarterKit options: Yjs brings its own undo history. */
  starterKit: { undoRedo?: false };
  editable: boolean;
  /** Save now (shared pages: mirror and persist). */
  flush: () => Promise<void>;
  /** The editor to hand to surrounding views (null until it is the final one). */
  expose: (editor: Editor | null) => Editor | null;
  render: (editor: Editor | null) => ReactNode;
}

export function isSharedPage(page: Page): boolean {
  const ws = (page as Page & { workspaceId?: string | null }).workspaceId;
  const flag = (page.metadata as { sync?: { shared?: unknown } } | undefined)?.sync?.shared;
  return (typeof ws === "string" && ws.length > 0) || flag === true;
}

export function useCollab(page: Page, opts: { onSaved?: (at: number) => void } = {}): Collab {
  // The loaded page says whether it is shared; the local store confirms it
  // (a page can be in a Team workspace before the loaded copy knows). The
  // mode is settled once per open page: views around the editor keep the
  // editor they were handed, so a later change reopens the page instead.
  const guess = isSharedPage(page);
  const [settled, setSettled] = useState<{ pageId: string; shared: boolean } | null>(null);
  const known = settled?.pageId === page.id;
  const shared = known ? settled.shared : guess;
  const [session, setSession] = useState<CollabSession | null>(null);
  const { ready, generation } = useSessionReady(session);
  const info = useSessionInfo(session);
  const onSaved = useRef(opts.onSaved);
  onSaved.current = opts.onSaved;
  const stable = useRef<StableEditor | null>(null);

  useEffect(() => startSyncManager(), []);

  useEffect(() => {
    let alive = true;
    let first: boolean | null = null;
    const check = () =>
      void localStore()
        .pageMode(page.id)
        .then((m) => {
          if (!alive) return;
          const next = m.shared || guess;
          if (first === null) {
            first = next;
            setSettled({ pageId: page.id, shared: next });
          } else if (next !== first) {
            alive = false;
            reopenPage(page.id);
          }
        })
        .catch(() => alive && first === null && ((first = guess), setSettled({ pageId: page.id, shared: guess })));
    const onMode = (e: Event) => (e as CustomEvent<{ pageId: string }>).detail?.pageId === page.id && check();
    const onChanged = (e: Event) => {
      const list = (e as CustomEvent<{ pageId: string | null; kind: string }[]>).detail ?? [];
      if (list.some((c) => c.pageId === page.id && c.kind === "page")) check();
    };
    check();
    window.addEventListener("worlds:sync-mode", onMode);
    window.addEventListener("worlds:changed", onChanged);
    return () => {
      alive = false;
      window.removeEventListener("worlds:sync-mode", onMode);
      window.removeEventListener("worlds:changed", onChanged);
    };
  }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shared) return;
    const ws = workspaceFor({ workspaceId: (page as Page & { workspaceId?: string | null }).workspaceId ?? null });
    const s = acquireSession(page.id, ws);
    setSession(s);
    let last = s.mirroredAt;
    const off = s.subscribe(() => {
      if (s.mirroredAt !== last) {
        last = s.mirroredAt;
        if (last) onSaved.current?.(last);
      }
    });
    return () => {
      off();
      setSession(null);
      releaseSession(s);
    };
  }, [shared, page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = shared && !!session && ready;
  const extensions = useMemo(() => (live && session ? collabExtensions(session) : []), [live, session, generation]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = !!session && session.canEdit;
  const pending = !known || (shared && !live);

  return {
    shared,
    pending,
    key: !shared ? "blocks" : live ? `yjs:${generation}` : "pending",
    extensions,
    starterKit: shared ? { undoRedo: false } : {},
    editable: !shared || (live && canEdit),
    flush: async () => {
      await session?.flush();
    },
    expose: (editor) => {
      if (pending || !editor) return null;
      if (!shared) return editor;
      if (!stable.current) stable.current = new StableEditor(editor);
      else stable.current.swap(editor);
      return stable.current.proxy;
    },
    render: (editor) => <CollabRoot pageId={page.id} session={live ? session : null} editor={live ? editor : null} level={info?.level ?? null} />,
  };
}

/** Open the page again (its editing mode changed while it was open). */
function reopenPage(pageId: string) {
  const st = useStore.getState();
  const paneId = st.layout.activePaneId;
  st.open({ kind: "home" }, "current", paneId);
  requestAnimationFrame(() => {
    const now = useStore.getState();
    now.goBack(paneId);
    const tab = now.layout.panes.find((p) => p.id === paneId);
    const route = tab?.tabs.find((t) => t.id === tab.activeTabId)?.route as { kind: string; pageId?: string } | undefined;
    if (route?.kind !== "page" || route.pageId !== pageId) now.openPage(pageId, "current");
  });
}

function CollabRoot({ pageId, session, editor, level }: { pageId: string; session: CollabSession | null; editor: Editor | null; level: string | null }) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const [settings, setSettings] = useState(false);
  const wrap = anchor?.parentElement ?? null;

  // Rights can change while the page is open.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !session) return;
    const locked = !!(useStore.getState().pages[pageId]?.look as { locked?: boolean } | undefined)?.locked;
    if (!session.canEdit) editor.setEditable(false);
    else if (!locked) editor.setEditable(true);
  }, [editor, session, level, pageId]);

  useEffect(() => {
    if (!wrap) return;
    const onKey = (e: KeyboardEvent) => {
      if (!wrap.contains(document.activeElement)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.altKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setSettings(true);
      } else if (mod && e.altKey && !e.shiftKey && e.key.toLowerCase() === "m" && editor && session) {
        e.preventDefault();
        startComment(editor, session);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wrap, editor, session]);

  return (
    <>
      <span ref={setAnchor} hidden />
      {session && <CollabChrome session={session} editor={editor} wrap={wrap} onSettings={() => setSettings(true)} />}
      {settings && <SyncSettings pageId={pageId} onClose={() => setSettings(false)} />}
    </>
  );
}
