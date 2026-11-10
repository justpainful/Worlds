import { useEffect, useSyncExternalStore } from "react";
import { api, errorMessage, fileUrl } from "../lib/api";
import { accountApi } from "../account/api";
import { useStore } from "../state/store";
import "../sync/appConfig";
import { configureSync, onSyncConfigChange, syncConfig } from "../sync/config";
import { localStore } from "../sync/session";
import { startSyncManager, workspaceFor } from "../sync/manager";
import { drawingSession } from "./session";
import { DrawingTransport, type DrawingTransportInfo } from "./transport";
import { DrawingLiveSession } from "./collaboration";
import { offlineDrawingGesture } from "./gestureLeases";

interface Entry { transport: DrawingTransport; live: DrawingLiveSession; epoch: number; unsubscribe: () => void; retiring?: boolean }
const entries = new Map<string, Entry>(), opening = new Map<string, Promise<void>>(), viewers = new Map<string, number>();
const info = new Map<string, DrawingTransportInfo>(), listeners = new Set<() => void>();
let epoch = 0, started = false;
function notify() { for (const listener of listeners) listener(); }
function publish(page: string, value: DrawingTransportInfo) { info.set(page, value); notify(); }
function retire(page: string, entry: Entry) { if (entries.get(page) !== entry) return; entries.delete(page); entry.unsubscribe(); entry.transport.stop(); void entry.live.close(); notify(); }
function retireIfDrained(page: string, entry: Entry) {
  const drawing = info.get(page), live = entry.live.snapshot();
  if (!entry.retiring && !viewers.has(page) && drawing?.status === "synced" && !drawing.pending && live.ready && live.info?.state === "synced" && !live.info.unacked) {
    entry.retiring = true;
    queueMicrotask(async () => { try { if (entries.get(page) !== entry || viewers.has(page)) return; const native = await api.drawingSyncSnapshot(page); if (!native.pending.length && !drawingSession(page).snapshot().pending) retire(page, entry); else void entry.transport.tick(); } catch { /* The durable writer will retry; keep the session alive. */ } finally { entry.retiring = false; } });
  }
}
async function open(page: string) {
  if (entries.has(page)) return entries.get(page)!.transport.tick();
  if (opening.has(page)) return opening.get(page);
  const openingEpoch = epoch;
  const work = (async () => {
    const mode = await localStore().pageMode(page);
    if (openingEpoch !== epoch) return;
    if (!mode.shared) { info.delete(page); notify(); return; }
    const cfg = syncConfig(), server = cfg.serverUrl(), user = cfg.user().id;
    if (!server) { const level = await accountApi.pageLevel(page); if (openingEpoch === epoch) publish(page, { status: "offline", pending: 0, error: "Configure a synchronization server to share this drawing", level, revision: null }); return; }
    const replica = await api.drawingSyncOpen(page, server, workspaceFor(mode), user);
    if (openingEpoch !== epoch) return;
    const session = drawingSession(page);
    const getToken = async (refresh?: boolean) => { if (openingEpoch !== epoch) return null; const token = await cfg.getToken(refresh); return openingEpoch === epoch ? token : null; };
    const live = new DrawingLiveSession({ pageId: page, workspaceId: replica.workspaceId, serverUrl: server, getToken, store: localStore(), user: cfg.user(), initialLevel: replica.level });
    const entry: Entry = { epoch: openingEpoch, live, unsubscribe: () => {}, transport: new DrawingTransport({ pageId: page, workspaceId: replica.workspaceId, userId: user, serverUrl: server,
      getToken,
      io: {
        snapshot: () => api.drawingSyncSnapshot(page),
        checkpoint: (state) => session.checkpoint((current) => api.drawingSyncAccept(page, current.revision, state)),
        status: (status, error) => api.drawingSyncError(page, status, error),
        readOriginal: async (id) => {
          const attachment = await api.attachment(id); if (!attachment) return null;
          if (attachment.pageId !== page) throw new Error("The drawing original belongs to another resource; make an independent copy before sharing");
          const response = await fetch(fileUrl(id)); if (!response.ok) throw new Error("The drawing original could not be opened");
          return { fileName: attachment.fileName, mime: attachment.mime, bytes: new Uint8Array(await response.arrayBuffer()) };
        },
        storeOriginal: (id, original, bytes) => api.drawingSyncStoreOriginal(page, id, original, bytes),
      },
      onInfo: (value) => {
        if (entries.get(page) !== entry || openingEpoch !== epoch) return;
        const local = session.snapshot();
        publish(page, value.status === "synced" && (local.pending > 0 || local.document && local.document.revision !== value.revision) ? { ...value, status: "pending", pending: Math.max(1, local.pending) } : value);
        // Closed, fully drained pages need no per-second network polling.
        retireIfDrained(page, entry);
      },
    }) };
    entries.set(page, entry); const offLive = live.subscribe(() => retireIfDrained(page, entry)), offDrawing = session.subscribe(() => { const current = info.get(page), local = session.snapshot(); if (current?.status === "synced" && (local.pending || local.document && local.document.revision !== current.revision)) publish(page, { ...current, status: "pending", pending: Math.max(1, local.pending) }); }); entry.unsubscribe = () => { offLive(); offDrawing(); }; notify();
    void live.start().catch((error) => { if (openingEpoch === epoch) publish(page, { status: "offline", pending: replica.pending.length, error: errorMessage(error), level: replica.level, revision: replica.remote?.revision ?? null }); });
    entry.transport.start();
  })().catch((error) => { if (openingEpoch === epoch) publish(page, { status: "denied", pending: 0, error: errorMessage(error), level: "none", revision: null }); })
    .finally(() => { if (opening.get(page) === work) opening.delete(page); });
  opening.set(page, work); return work;
}

async function resumePending() {
  const pages = await api.drawingSyncPendingPages().catch(() => []);
  for (const page of pages ?? []) void open(page);
}
export async function retryDrawingSync(page: string) { const entry = entries.get(page); if (entry?.live.snapshot().info?.resetting && !entry.live.snapshot().error) await entry.live.retryPersistence(); if (entry?.live.snapshot().error) retire(page, entry); else if(entry?.live.snapshot().info?.state!=="synced")entry?.live.reconnect(); return open(page); }
export async function beginDrawingGesture(page: string, ids: string[]) {
  return reserveDrawingTargets(page,ids.map(id=>`node:${id}`));
}
export async function reserveDrawingLayers(page:string,ids:string[],order=false){return reserveDrawingTargets(page,[...ids.map(id=>`layer:${id}`),...(order?["order:layerOrder"]:[])]);}
export async function reserveDrawingRoot(page:string){return reserveDrawingTargets(page,['drawing:root']);}
async function reserveDrawingTargets(page:string,targets:string[]){
  if (!entries.has(page)) await open(page);
  const entry = entries.get(page); if (entry) return entry.transport.beginGesture(targets);
  const mode = await localStore().pageMode(page); if (!mode.shared) return null;
  const level = await accountApi.pageLevel(page); if (level !== "edit" && level !== "full") throw new Error("Edit access is required to move drawing elements");
  return offlineDrawingGesture();
}
export async function reserveDrawingRestore(page: string) {
  await drawingSession(page).flush();
  const mode = await localStore().pageMode(page); if (!mode.shared) return null;
  await open(page); const entry = entries.get(page);
  if (!entry) throw new Error("Connect this shared drawing before restoring a version");
  await entry.transport.tick();
  if ((await api.drawingSyncSnapshot(page)).status !== "synced") throw new Error("Synchronize this drawing before restoring a version");
  const lease = await entry.transport.beginGesture(["drawing:root"]);
  try {
    await entry.transport.tick();
    if (lease.state() !== "locked" || (await api.drawingSyncSnapshot(page)).status !== "synced") throw new Error("The shared drawing could not be reserved. Reconnect before restoring.");
    return lease;
  } catch (error) { lease.cancel(); throw error; }
}
export async function recoverDrawingSync(page: string, title: string) {
  await open(page); const entry = entries.get(page);
  if (!entry) throw new Error("Reconnect to the drawing before resolving its conflict");
  const result = await entry.transport.recover((state) => drawingSession(page).recover((input) => api.drawingSyncRecover(page, input, state, title)));
  await useStore.getState().refreshPages(); return result.copy;
}
/** Refresh a reusable publication without keeping a pane/presence lifetime. */
export async function refreshDrawingResource(page:string){await open(page);const entry=entries.get(page);if(entry)await entry.transport.tick();}
export function startDrawingSyncManager() {
  if (started || typeof window === "undefined") return;
  started = true;
  startSyncManager();
  // On startup, share existing drawing resources even if they have never been
  // opened in this process. Older durable outboxes also drain without a pane.
  for (const page of Object.values(useStore.getState().pages)) if (page.kind === "drawing" && !page.deletedAt) void open(page.id);
  void resumePending(); setInterval(() => void resumePending(), 15_000);
  window.addEventListener("worlds:changed", (event) => {
    const changes = (event as CustomEvent<{ pageId: string | null; kind: string; origin: string }[]>).detail ?? [];
    for (const page of new Set(changes.filter((c) => c.pageId && c.kind === "drawing" && !["ui", "sync"].includes(c.origin)).map((c) => c.pageId!))) void drawingSession(page).refresh().catch(() => {});
    for (const page of new Set(changes.filter((c) => c.pageId && ["drawing", "drawing_library", "page", "tree"].includes(c.kind) && c.origin !== "sync").map((c) => c.pageId!))) {
      if (useStore.getState().pages[page]?.kind === "drawing") void open(page);
    }
  });
  window.addEventListener("worlds:sync-mode", (event) => {
    const page = (event as CustomEvent<{ pageId: string }>).detail.pageId;
    const entry = entries.get(page); if (entry) retire(page, entry);
    void open(page);
  });
  let settings = JSON.stringify([useStore.getState().settings["sync.serverUrl"], useStore.getState().settings["sync.devToken"], useStore.getState().settings["sync.workspaceId"]]);
  useStore.subscribe((state) => {
    const next = JSON.stringify([state.settings["sync.serverUrl"], state.settings["sync.devToken"], state.settings["sync.workspaceId"]]);
    if (next !== settings) { settings = next; configureSync({}); }
  });
  onSyncConfigChange(() => {
    epoch++;
    for (const entry of entries.values()) { entry.unsubscribe(); entry.transport.stop(); void entry.live.close(); } entries.clear(); opening.clear();
    info.clear();
    for (const page of viewers.keys()) info.set(page, { status: "denied", pending: 0, error: "Checking drawing access for the current account", level: "none", revision: null });
    notify();
    for (const page of viewers.keys()) void open(page); void resumePending();
  });
}
export function useDrawingSync(page: string) {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => info.get(page));
  useEffect(() => {
    startDrawingSyncManager(); viewers.set(page, (viewers.get(page) ?? 0) + 1); void open(page);
    return () => { const count = (viewers.get(page) ?? 1) - 1; if (count) viewers.set(page, count); else { viewers.delete(page); const entry = entries.get(page); if (entry) retireIfDrained(page, entry); } };
  }, [page]);
  return current;
}
export function useDrawingLive(page: string) {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => entries.get(page)?.live ?? null);
}
