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
  render: (editor: Editor | null) => ReactNode;
}

export function isSharedPage(page: Page): boolean {
  const ws = (page as Page & { workspaceId?: string | null }).workspaceId;
  const flag = (page.metadata as { sync?: { shared?: unknown } } | undefined)?.sync?.shared;
  return (typeof ws === "string" && ws.length > 0) || flag === true;
}

export function useCollab(page: Page, opts: { onSaved?: (at: number) => void } = {}): Collab {
  // The loaded page says whether it is shared; the store has the last word,
  // so a page switches mode without reopening when sharing changes.
  const [stored, setStored] = useState<{ pageId: string; shared: boolean } | null>(null);
  const shared = stored?.pageId === page.id ? stored.shared : isSharedPage(page);
  const [session, setSession] = useState<CollabSession | null>(null);
  const { ready, generation } = useSessionReady(session);
  const info = useSessionInfo(session);
  const onSaved = useRef(opts.onSaved);
  onSaved.current = opts.onSaved;

  useEffect(() => startSyncManager(), []);

  useEffect(() => {
    let alive = true;
    const check = () =>
      void localStore()
        .pageMode(page.id)
        .then((m) => alive && setStored({ pageId: page.id, shared: m.shared }))
        .catch(() => undefined);
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
  }, [page.id]);

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

  return {
    shared,
    pending: shared && !live,
    key: !shared ? "blocks" : live ? `yjs:${generation}` : "pending",
    extensions,
    starterKit: shared ? { undoRedo: false } : {},
    editable: !shared || (live && canEdit),
    flush: async () => {
      await session?.flush();
    },
    render: (editor) => <CollabRoot pageId={page.id} session={live ? session : null} editor={live ? editor : null} level={info?.level ?? null} />,
  };
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
