/**
 * CollabSession: everything one shared page needs while it is open (or
 * while it has work to finish): its Yjs documents, the provider, and the
 * block mirror that keeps the page's rows current for search, history,
 * MCP and Claude.
 *
 * Sessions are shared per page and reference counted, so two panes on the
 * same page edit one document, and a page closed with unsent changes keeps
 * syncing in the background until they are acknowledged.
 */
import type { JSONContent } from "@tiptap/core";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { newBlockId } from "../editor/extensions/blockIds";
import { AttachmentSync, directoryOf, type AttachmentDeps } from "./attachments";
import { upsertPerson } from "./comments";
import { type SyncUser, onSyncConfigChange, syncConfig } from "./config";
import { type LocalStore, MemoryLocalStore, type MirrorOutcome, TauriLocalStore } from "./localStore";
import { applyRemaps, blocksFromY, ensureBlockIds, foldIntoY, isEmptyY, ORIGIN_FOLD, seedY } from "./mirror";
import { ORIGIN_LOAD, type SyncInfo, WorldsProvider, type ProviderOptions } from "./provider";
import { CH_COMMENTS, CH_CONTENT } from "./protocol";

export interface SessionOptions {
  pageId: string;
  workspaceId: string;
  store: LocalStore;
  /** Overrides for tests (socket factory, timers, server URL, token). */
  provider?: Partial<ProviderOptions>;
  user?: () => SyncUser;
  /** How long a first open waits for the server before seeding from the rows. */
  firstSyncWaitMs?: number;
  mirrorDelayMs?: number;
  /** Called after the block rows changed from the document. */
  onMirrored?: (updatedAt: number | null) => void;
  /** Local file access for attachment sync (the app uses Tauri; tests inject). */
  attachments?: Pick<AttachmentDeps, "readLocal" | "storeLocal"> & Partial<AttachmentDeps>;
}

type Listener = () => void;

export class CollabSession {
  readonly pageId: string;
  readonly workspaceId: string;
  content!: Y.Doc;
  comments!: Y.Doc;
  /** Presence for this page; outlives provider restarts (server or account changes). */
  awareness!: Awareness;
  provider!: WorldsProvider;
  /** Bumps when the documents are rebuilt (the editor must rebind). */
  generation = 0;
  ready = false;
  /** When the block rows last caught up with the document. */
  mirroredAt: number | null = null;
  info: SyncInfo = { state: "offline", level: null, unacked: 0, error: null, attention: null, lastSyncedAt: null, remote: false };

  private o: SessionOptions;
  private listeners = new Set<Listener>();
  private unsubs: (() => void)[] = [];
  private baseRev: string | null = null;
  private mirrorState: Uint8Array | null = null;
  private mirrorTimer: ReturnType<typeof setTimeout> | null = null;
  private mirrorFirstAt = 0;
  private mirroring: Promise<void> | null = null;
  private again = false;
  private destroyed = false;
  private starting: Promise<void> | null = null;
  private files: AttachmentSync | null = null;
  private filesTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(o: SessionOptions) {
    this.o = o;
    this.pageId = o.pageId;
    this.workspaceId = o.workspaceId;
  }

  get user(): SyncUser {
    return (this.o.user ?? syncConfig().user)();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): Promise<void> {
    this.starting ??= this.build();
    return this.starting;
  }

  private async build(reuseDocs = false): Promise<void> {
    const cfg = syncConfig();
    if (!reuseDocs) {
      this.awareness?.destroy();
      this.content = new Y.Doc();
      this.comments = new Y.Doc();
      this.awareness = new Awareness(this.content);
    }
    const opts: ProviderOptions = {
      pageId: this.pageId,
      workspaceId: this.workspaceId,
      content: this.content,
      comments: this.comments,
      awareness: this.awareness,
      store: this.o.store,
      serverUrl: cfg.serverUrl(),
      getToken: (refresh) => syncConfig().getToken(refresh),
      ...this.o.provider,
    };
    const p = new WorldsProvider(opts);
    this.provider = p;
    this.unsubs.push(
      p.onChange((info) => {
        this.info = info;
        if (info.state === "synced" && this.ready) this.scheduleMirror();
        this.emit();
      }),
      p.onReset(() => void this.rebuild("docs")),
      p.onRevoked(() => void this.o.store.purge(this.pageId).catch(() => undefined)),
    );
    const onContent = (_u: Uint8Array, origin: unknown) => {
      if (origin !== ORIGIN_LOAD && this.ready) {
        this.scheduleMirror();
        this.scheduleFiles();
      }
    };
    this.content.on("update", onContent);
    this.unsubs.push(() => this.content.off("update", onContent));
    const serverUrl = opts.serverUrl;
    const fileAccess = this.o.attachments ?? appFileAccess(this.pageId);
    this.files =
      serverUrl && fileAccess
        ? new AttachmentSync(this.content, {
            serverUrl,
            getToken: () => opts.getToken(false),
            workspaceId: this.workspaceId,
            docId: this.pageId,
            ...fileAccess,
          })
        : null;
    await p.init();
    this.info = p.info;
    if (!reuseDocs) await this.initialMirror();
    const u = this.user;
    this.awareness.setLocalStateField("user", { id: u.id, name: u.name, color: u.color });
    this.ready = true;
    this.emit();
    this.scheduleFiles(0);
  }

  /** Upload this page's new attachments and fetch the ones this computer lacks. */
  private scheduleFiles(delay = 1500) {
    if (!this.files) return;
    if (this.filesTimer) clearTimeout(this.filesTimer);
    this.filesTimer = setTimeout(() => {
      this.filesTimer = null;
      void this.syncFiles();
    }, delay);
  }

  syncFiles(): Promise<void> {
    if (!this.files || !this.ready || this.destroyed) return Promise.resolve();
    return this.files.run(blocksFromY(this.content), this.canEdit).catch(() => undefined);
  }

  /** The attachment directory of the shared document (id -> hash, size, type, name). */
  attachmentDirectory() {
    return directoryOf(this.content);
  }

  /**
   * "docs": drop the documents and build them again from the local replica
   * (after a refused write; the editor rebinds). "connection": keep the
   * documents and the editor, restart only the provider (server or account
   * changed).
   */
  async rebuild(kind: "docs" | "connection" = "docs") {
    if (this.destroyed) return;
    await this.mirroring;
    this.teardown();
    if (kind === "docs") {
      this.ready = false;
      this.generation++;
      this.emit();
    }
    this.starting = this.build(kind === "connection");
    await this.starting;
  }

  private teardown() {
    if (this.mirrorTimer) clearTimeout(this.mirrorTimer);
    if (this.filesTimer) clearTimeout(this.filesTimer);
    this.mirrorTimer = null;
    this.filesTimer = null;
    for (const u of this.unsubs.splice(0)) u();
    this.provider?.destroy();
  }

  /** Finish pending mirror and local writes, then stop. */
  async close() {
    if (this.destroyed) return;
    await this.flush().catch(() => undefined);
    this.destroyed = true;
    this.teardown();
    this.awareness?.setLocalState(null);
    this.awareness?.destroy();
    this.listeners.clear();
  }

  async flush() {
    if (!this.ready) return;
    if (this.mirrorTimer) {
      clearTimeout(this.mirrorTimer);
      this.mirrorTimer = null;
      await this.mirrorNow();
    }
    await this.mirroring;
    await this.provider.persisted();
  }

  // -------------------------------------------------------------------------
  // Block mirror
  // -------------------------------------------------------------------------

  private waitForServer(ms: number): Promise<void> {
    if (!this.provider.info.remote) return Promise.resolve();
    return new Promise((resolve) => {
      if (this.provider.info.state === "synced") return resolve();
      const done = () => {
        clearTimeout(t);
        off();
        resolve();
      };
      const t = setTimeout(done, ms);
      const off = this.provider.onChange((i) => (i.state === "synced" || i.state === "error" || i.state === "offline") && done());
    });
  }

  /**
   * First alignment of rows and document when the page opens:
   * - document empty, never mirrored here: take the server's document if it
   *   has one, otherwise seed it from the rows (this device shares the page);
   * - rows changed since the last mirror (Claude, MCP): fold them in;
   * - otherwise just remember where the rows are.
   */
  private async initialMirror() {
    const store = this.o.store;
    let mc = await store.mirrorCheck(this.pageId);
    if (isEmptyY(this.content)) {
      await this.waitForServer(this.o.firstSyncWaitMs ?? 4000);
      mc = await store.mirrorCheck(this.pageId);
      const rows = mc.current ?? [];
      if (isEmptyY(this.content) && !mc.mirrorRev && rows.length) {
        seedY(this.content, rows, ORIGIN_FOLD);
        ensureBlockIds(this.content, newBlockId);
        const state = Y.encodeStateAsUpdate(this.content);
        const r = await store.mirrorAdopt(this.pageId, mc.currentRev, state);
        if (r.status === "written") {
          this.baseRev = r.rev;
          this.mirrorState = state;
          return;
        }
        mc = await store.mirrorCheck(this.pageId);
      }
    }
    this.baseRev = mc.currentRev;
    this.mirrorState = mc.mirrorState;
    if (mc.current && mc.mirrorState && !isEmptyY(this.content)) {
      foldIntoY(this.content, mc.mirrorState, mc.current, ORIGIN_FOLD);
    }
    if (!isEmptyY(this.content) && (mc.current || !mc.mirrorRev)) await this.mirrorNow();
  }

  scheduleMirror() {
    const delay = this.o.mirrorDelayMs ?? 700;
    const now = Date.now();
    if (!this.mirrorTimer) this.mirrorFirstAt = now;
    if (this.mirrorTimer) clearTimeout(this.mirrorTimer);
    // Debounced, but never more than a few seconds behind while typing.
    const wait = now - this.mirrorFirstAt > 3000 ? 0 : delay;
    this.mirrorTimer = setTimeout(() => {
      this.mirrorTimer = null;
      void this.mirrorNow();
    }, wait);
  }

  /** Bring the rows up to date with the document, folding in unseen row edits. */
  mirrorNow(): Promise<void> {
    if (this.mirroring) {
      this.again = true;
      return this.mirroring;
    }
    this.mirroring = (async () => {
      let rounds = 0;
      do {
        this.again = false;
        if (this.destroyed || isEmptyY(this.content) || this.baseRev === null) return;
        ensureBlockIds(this.content, newBlockId);
        const blocks = blocksFromY(this.content);
        const state = Y.encodeStateAsUpdate(this.content);
        let r: MirrorOutcome;
        try {
          r = await this.o.store.mirrorWrite(
            this.pageId,
            blocks.map((b) => ({ id: String(b.attrs?.bid ?? ""), content: b })),
            this.baseRev,
            state,
          );
        } catch {
          return; // the next change retries
        }
        if (r.status === "written") {
          this.baseRev = r.rev;
          this.mirrorState = state;
          if (r.remapped.length) applyRemaps(this.content, r.remapped);
          if (r.updatedAt) {
            this.mirroredAt = r.updatedAt;
            this.o.onMirrored?.(r.updatedAt);
            this.emit();
          }
        } else {
          // Someone wrote the rows directly: fold their change in and write again.
          if (this.mirrorState) foldIntoY(this.content, this.mirrorState, r.current, ORIGIN_FOLD);
          this.baseRev = r.currentRev;
          this.again = true;
        }
      } while (this.again && ++rounds < 5);
    })().finally(() => {
      this.mirroring = null;
    });
    return this.mirroring;
  }

  /** The rows may have changed outside the editor (MCP, automations). */
  reconcile(): Promise<void> {
    if (!this.ready) return Promise.resolve();
    return this.mirrorNow();
  }

  /** Current blocks of the shared document. */
  blocks(): JSONContent[] {
    return blocksFromY(this.content);
  }

  /** Announce this user in the comments directory (for mentions). */
  announce() {
    if (!this.ready) return;
    const level = this.info.level;
    if (level === "comment" || level === "edit" || level === "full" || !this.info.remote) upsertPerson(this.comments, this.user);
  }

  get canEdit(): boolean {
    const l = this.info.level;
    return l === null || l === "edit" || l === "full";
  }

  get canComment(): boolean {
    const l = this.info.level;
    return l === null || l === "comment" || l === "edit" || l === "full";
  }

  static channels = { content: CH_CONTENT, comments: CH_COMMENTS };
}

// ---------------------------------------------------------------------------
// Attachment file access in the app (Tauri)
// ---------------------------------------------------------------------------

function appFileAccess(pageId: string): (Pick<AttachmentDeps, "readLocal" | "storeLocal"> & Partial<AttachmentDeps>) | null {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window) || !(localStore() instanceof TauriLocalStore)) return null;
  const tauri = () => import("@tauri-apps/api/core");
  const meta = async (id: string) => (await tauri()).invoke<{ fileName: string; mime: string } | null>("attachment_get", { id });
  return {
    hasLocal: async (id) => !!(await meta(id)),
    readLocal: async (id) => {
      const m = await meta(id);
      if (!m) return null;
      const r = await fetch(`http://wfile.localhost/${id}`);
      if (!r.ok) return null;
      return { fileName: m.fileName, mime: m.mime, bytes: new Uint8Array(await r.arrayBuffer()) };
    },
    storeLocal: async (id, info, bytes) => {
      const enc = encodeURIComponent;
      await (await tauri()).invoke("sync_attachment_store", bytes, {
        headers: { "x-worlds-id": enc(id), "x-worlds-page": enc(pageId), "x-worlds-name": enc(info.fileName), "x-worlds-mime": enc(info.mime) },
      });
    },
    progress: async (id, status, info) => {
      const { invoke } = await tauri();
      if (status === "uploading" && !info?.partsDone) await invoke("sync_attachment_enqueue", { attachmentId: id, pageId, workspaceId: null }).catch(() => undefined);
      await invoke("sync_attachment_update", {
        attachmentId: id,
        progress: { status, sha256: info?.sha256 ?? null, size: info?.size ?? null, partsDone: info?.partsDone ?? null, error: info?.error ?? null },
      }).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

let store: LocalStore | null = null;

/** The app's local store (SQLite via Tauri, or memory outside the app). */
export function localStore(): LocalStore {
  if (store) return store;
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  // The browser mock (?mock) fakes Tauri but has no sync commands.
  const mock = inTauri && import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock");
  if (inTauri && !mock) store = new TauriLocalStore();
  else {
    const mem = new MemoryLocalStore();
    // The mock keeps pages in its own memory: read their rows from it.
    if (mock) {
      mem.rowsSource = async (pageId) => {
        const { invoke } = await import("@tauri-apps/api/core");
        const page = await invoke<{ blocks: { content: JSONContent }[] } | null>("page_get", { id: pageId, touch: false });
        return page?.blocks.map((b) => b.content) ?? [];
      };
    }
    store = mem;
  }
  return store;
}

/** Ask open editors to re-read a page's sharing mode (after it changed). */
export function announceModeChange(pageId: string) {
  window.dispatchEvent(new CustomEvent("worlds:sync-mode", { detail: { pageId } }));
}

export function setLocalStoreForTests(s: LocalStore | null) {
  store = s;
}

const sessions = new Map<string, { session: CollabSession; refs: number; closeTimer: ReturnType<typeof setTimeout> | null }>();
const sessionWatchers = new Set<() => void>();

export function openSessions(): CollabSession[] {
  return [...sessions.values()].map((s) => s.session);
}

export function onSessionsChange(fn: () => void): () => void {
  sessionWatchers.add(fn);
  return () => sessionWatchers.delete(fn);
}

/** Get (and hold) the session for a shared page. */
export function acquireSession(pageId: string, workspaceId: string, extra: Partial<SessionOptions> = {}): CollabSession {
  let e = sessions.get(pageId);
  if (!e) {
    e = { session: new CollabSession({ pageId, workspaceId, store: localStore(), ...extra }), refs: 0, closeTimer: null };
    sessions.set(pageId, e);
    void e.session.start();
    for (const w of sessionWatchers) w();
  }
  if (e.closeTimer) clearTimeout(e.closeTimer);
  e.closeTimer = null;
  e.refs++;
  return e.session;
}

/**
 * Let go of a session. It closes after a grace period (quick navigation and
 * React remounts reuse it) and only once its changes are acknowledged, or
 * the server is unreachable (the outbox keeps them).
 */
export function releaseSession(session: CollabSession, graceMs = 4000) {
  const e = sessions.get(session.pageId);
  if (!e || e.session !== session) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs > 0) return;
  const attempt = () => {
    if (e.refs > 0) return;
    const busy = session.info.remote && session.info.unacked > 0 && (session.info.state === "syncing" || session.info.state === "connecting");
    if (busy) {
      e.closeTimer = setTimeout(attempt, graceMs);
      return;
    }
    sessions.delete(session.pageId);
    void session.close();
    for (const w of sessionWatchers) w();
  };
  e.closeTimer = setTimeout(attempt, graceMs);
}

/** Rebuild every open session (server or account changed). */
onSyncConfigChange(() => {
  for (const { session } of sessions.values()) void session.rebuild("connection");
});
