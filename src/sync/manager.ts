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
import { acquireSession, localStore, openSessions, releaseSession } from "./session";

export interface Notice {
  id: string;
  kind: "mention" | "reply";
  workspaceId: string;
  docId: string;
  threadId: string;
  commentId: string;
  from: string;
  excerpt: string;
  createdAt: number;
  readAt?: number | null;
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

  // Developer handle for testing two PCs before Team workspaces exist.
  (window as unknown as { worldsSync: unknown }).worldsSync = {
    share: (pageId: string) => localStore().setShared(pageId, true),
    unshare: (pageId: string) => localStore().setShared(pageId, false),
    status: (pageId: string) => localStore().status(pageId),
    sessions: () => openSessions().map((s) => ({ pageId: s.pageId, ...s.info })),
  };
}
