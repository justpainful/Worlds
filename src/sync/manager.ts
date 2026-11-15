/**
 * Background side of sync, started once by the first shared page:
 * - folds Claude, MCP and automation writes to shared pages into their Yjs
 *   documents (even when the page is not open);
 * - drains outboxes left from earlier sessions;
 * - polls the notifications feed;
 * - rebuilds sessions when the server or token setting changes.
 */
import { create } from "zustand";
import { useStore } from "../state/store";
import "./appConfig";
import { configureSync, syncConfig } from "./config";
import { fieldsToAdopt, hiddenDocId, hiddenKeys, splitFields } from "../packs/hidden";
import { itemData, replaceItemFields } from "../packs/items";
import type { ItemData } from "../packs/fields";
import { isPackKind, kindDefOf } from "../packs/registry";
import { markKind, pushFields, readFields } from "./fields";
import { MemoryLocalStore } from "./localStore";
import { acquireSession, localStore, openSessions, releaseSession, type CollabSession } from "./session";

export interface Notice {
  id: string;
  kind: "mention" | "reply" | "published";
  workspaceId: string;
  docId: string;
  threadId: string;
  commentId: string;
  from: string;
  fromName?: string;
  excerpt: string;
  createdAt: number;
  readAt?: number | null;
  /** For published: the item as sent, for the reader's own pack (docs/PACKS.md, Design 3). */
  item?: { source: string; target: string; title: string; fields: Record<string, unknown> };
}

const noticeHandlers = new Set<(items: Notice[]) => void>();

/** Called with the feed each time it is fetched; returns a function that stops it. */
export function onNotices(fn: (items: Notice[]) => void): () => void {
  noticeHandlers.add(fn);
  const items = useNotifications.getState().items;
  if (items.length) fn(items);
  return () => noticeHandlers.delete(fn);
}

/** Send a pack item to every member holding a role in its pack. */
export async function publishToMembers(workspaceId: string, docId: string, body: Record<string, unknown>): Promise<{ sent: number } | { error: string }> {
  try {
    const r = await authed(`/v1/workspaces/${encodeURIComponent(workspaceId)}/docs/${encodeURIComponent(docId)}/publish`, { method: "POST", body: JSON.stringify(body) });
    if (!r) return { error: "Sign in and connect to a sync server to send items." };
    if (!r.ok) return { error: r.status === 403 ? "You need edit access to send this item." : `Could not send (${r.status}).` };
    const b = (await r.json()) as { sent?: number };
    return { sent: b.sent ?? 0 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

interface NotificationsState {
  items: Notice[];
  unread: number;
  error: string | null;
  loadedAt: number | null;
  set: (p: Partial<NotificationsState>) => void;
}

export const useNotifications = create<NotificationsState>((set) => ({
  items: [],
  unread: 0,
  error: null,
  loadedAt: null,
  set: (p) => set(p),
}));

/** Workspace for a shared page: its own, or the testing default. */
export function workspaceFor(mode: { workspaceId: string | null }): string {
  const s = useStore.getState().settings["sync.workspaceId"];
  return mode.workspaceId ?? (typeof s === "string" && s.trim() ? s.trim() : "default");
}

async function authed(path: string, init: RequestInit = {}): Promise<Response | null> {
  const cfg = syncConfig();
  const base = cfg.serverUrl();
  const token = await cfg.getToken();
  if (!base || !token) return null;
  return fetch(`${base.replace(/\/+$/, "")}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}

export async function refreshNotifications(): Promise<void> {
  try {
    const r = await authed("/v1/notifications?limit=50");
    if (!r) return;
    if (!r.ok) throw new Error(`notifications: ${r.status}`);
    const body = (await r.json()) as { items: Notice[]; unread: number };
    useNotifications.getState().set({ items: body.items, unread: body.unread, error: null, loadedAt: Date.now() });
    for (const fn of noticeHandlers) fn(body.items);
  } catch (e) {
    useNotifications.getState().set({ error: e instanceof Error ? e.message : String(e) });
  }
}

export async function markNotificationsRead(ids: string[] | null): Promise<void> {
  const st = useNotifications.getState();
  st.set({
    items: st.items.map((n) => (ids === null || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? Date.now() } : n)),
    unread: ids === null ? 0 : Math.max(0, st.unread - st.items.filter((n) => ids.includes(n.id) && !n.readAt).length),
  });
  await authed("/v1/notifications/read", { method: "POST", body: JSON.stringify({ ids }) }).catch(() => null);
}

/** Open a shared page's session in the background, run `fn`, let it go. */
async function withSession(pageId: string, fn: (s: ReturnType<typeof acquireSession>) => Promise<void>) {
  if (useStore.getState().pages[pageId]?.kind === "drawing") return;
  const store = localStore();
  const mode = await store.pageMode(pageId).catch(() => null);
  if (!mode?.shared) return;
  const s = acquireSession(pageId, workspaceFor(mode));
  try {
    await s.start();
    await fn(s);
  } finally {
    releaseSession(s);
  }
}

/** Resolves true once a session has caught up with the server, false if it cannot (denied, offline, too slow). */
function whenSynced(s: CollabSession, ms = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    let stop = () => {};
    const timer = setTimeout(() => finish(false), ms);
    function finish(ok: boolean) {
      clearTimeout(timer);
      stop();
      resolve(ok);
    }
    const check = () => {
      if (s.info.state === "synced") finish(true);
      else if (s.info.state === "error") finish(false);
    };
    stop = s.subscribe(check);
    check();
  });
}

/**
 * A shared item's hidden document (docs/PACKS.md, Design 2), opened in the
 * background: `fn` gets it once synced, or nothing happens when this device
 * may not open it. It is kept in memory only, as when the item is open.
 */
async function withHidden(pageId: string, packId: string, workspaceId: string, fn: (h: CollabSession) => void): Promise<void> {
  const h = acquireSession(hiddenDocId(pageId, packId), workspaceId, { store: new MemoryLocalStore() });
  try {
    await h.start();
    if (await whenSynced(h, 10_000)) fn(h);
  } finally {
    releaseSession(h);
  }
}

let catchingUp = false;

/**
 * Brings shared pack items that are not open up to date with what others
 * changed while this device was away, open and hidden fields both. Items are
 * visited one at a time so the machine and the server stay quiet; an item
 * whose document was never seeded keeps its fields (see `fieldsToAdopt`).
 */
export async function catchUpPackItems(limit = 200): Promise<number> {
  if (catchingUp) return 0;
  catchingUp = true;
  let changed = 0;
  try {
    const ids = Object.values(useStore.getState().pages)
      .filter((p) => isPackKind(p.kind))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((p) => p.id);
    for (const id of ids) {
      if (openSessions().some((s) => s.pageId === id)) continue;
      const def = kindDefOf(useStore.getState().pages[id]?.kind ?? "");
      if (!def) continue;
      await withSession(id, async (s) => {
        if (!(await whenSynced(s))) return;
        const keys = hiddenKeys(def.pack);
        let hidden: ItemData | null = null;
        if (keys.size) {
          await withHidden(id, def.pack.id, s.workspaceId, (h) => {
            hidden = readFields(h.content);
            // Never seeded (made before hidden fields existed): seed it from this device.
            const local = splitFields(itemData(useStore.getState().pages[id]), keys).hidden;
            if (!Object.keys(hidden).length && h.canEdit) pushFields(h.content, local);
          });
        }
        const page = useStore.getState().pages[id];
        if (!page) return;
        const next = fieldsToAdopt(readFields(s.content), hidden, itemData(page), keys);
        if (next) {
          await replaceItemFields(page, next);
          changed++;
        }
      }).catch(() => undefined);
    }
  } finally {
    catchingUp = false;
  }
  return changed;
}

let started = false;

export function startSyncManager() {
  if (started || typeof window === "undefined") return;
  started = true;

  // Writes from Claude (MCP), automations and the runner to shared pages.
  window.addEventListener("worlds:changed", (e) => {
    const changes = (e as CustomEvent<{ pageId: string | null; kind: string; origin: string }[]>).detail ?? [];
    const pages = new Set(changes.filter((c) => c.pageId && c.kind === "blocks" && c.origin !== "ui" && c.origin !== "sync").map((c) => c.pageId!));
    for (const pageId of pages) {
      const open = openSessions().find((s) => s.pageId === pageId);
      if (open) void open.reconcile();
      else void withSession(pageId, (s) => s.reconcile());
    }
  });

  // A shared pack item's fields changed while it is not open (a board, Claude,
  // an automation): bring its documents up to date. Fields every role may see
  // go to the page's document, hidden ones to its hidden document.
  useStore.subscribe((state, prev) => {
    if (state.pages === prev.pages) return;
    for (const [id, p] of Object.entries(state.pages)) {
      const before = prev.pages[id];
      const def = before && p.data !== before.data && isPackKind(p.kind) ? kindDefOf(p.kind) : undefined;
      if (!def) continue;
      const keys = hiddenKeys(def.pack);
      const parts = () => splitFields(itemData(useStore.getState().pages[id] ?? p), keys);
      const open = openSessions().find((x) => x.pageId === id);
      if (open) {
        if (open.ready && open.canEdit) {
          markKind(open.content, p.kind);
          pushFields(open.content, parts().open);
        }
      } else
        void withSession(id, async (x) => {
          if (x.canEdit) {
            markKind(x.content, p.kind);
            pushFields(x.content, parts().open);
          }
          if (keys.size)
            await withHidden(id, def.pack.id, x.workspaceId, (h) => {
              if (h.canEdit) pushFields(h.content, parts().hidden);
            });
        });
    }
  });

  // Outboxes from earlier sessions (typed offline, then quit).
  setTimeout(async () => {
    const pending = await localStore()
      .outbox(null, 10_000)
      .catch(() => []);
    for (const pageId of new Set(pending.map((o) => o.pageId))) void withSession(pageId, async () => undefined);
  }, 3000);

  // Server or token changed in settings: rebuild sessions.
  let last = JSON.stringify([useStore.getState().settings["sync.serverUrl"], useStore.getState().settings["sync.devToken"]]);
  useStore.subscribe((s) => {
    const next = JSON.stringify([s.settings["sync.serverUrl"], s.settings["sync.devToken"]]);
    if (next === last) return;
    last = next;
    configureSync({});
    void refreshNotifications();
  });

  void refreshNotifications();
  setInterval(() => void refreshNotifications(), 60_000);

  // Shared pack items changed by others while closed here: once after start,
  // every ten minutes, and when Worlds comes back to the front (at most every two).
  let lastCatchUp = 0;
  const catchUp = () => {
    if (Date.now() - lastCatchUp < 120_000) return;
    lastCatchUp = Date.now();
    void catchUpPackItems();
  };
  setTimeout(catchUp, 8000);
  setInterval(catchUp, 600_000);
  window.addEventListener("focus", catchUp);

  // Developer handle for testing two PCs before Team workspaces exist.
  (window as unknown as { worldsSync: unknown }).worldsSync = {
    share: (pageId: string) => localStore().setShared(pageId, true),
    unshare: (pageId: string) => localStore().setShared(pageId, false),
    status: (pageId: string) => localStore().status(pageId),
    sessions: () => openSessions().map((s) => ({ pageId: s.pageId, ...s.info })),
  };
}
