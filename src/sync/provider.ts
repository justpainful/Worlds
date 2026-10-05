/**
 * WorldsProvider: keeps one shared page's Yjs documents (content and
 * comments) durable locally and in sync with the sync service.
 *
 * Local first: every change is written to the local replica (and, when it
 * was made here, to the outbox) before anything goes on the wire. Online,
 * the provider runs the handshake from docs/SYNC_PROTOCOL.md, sends live
 * updates with acknowledgements, drains the outbox, relays presence, and
 * reconnects with backoff. A refused write is kept aside and the affected
 * replica rebuilds from the server, so the page never stays diverged.
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { LocalStore } from "./localStore";
import { ORIGIN_FOLD } from "./mirror";
import {
  ACK_OK,
  type AccessLevel,
  BEARER_PREFIX,
  CH_COMMENTS,
  CH_CONTENT,
  CLOSE_REVOKED,
  CLOSE_UNAUTHORIZED,
  MSG_ACK,
  MSG_AUTH_STATE,
  MSG_AWARENESS,
  MSG_NOTICE,
  MSG_SYNC,
  PROTOCOL,
  encodeAuthRefresh,
  encodeAwareness,
  encodeUpdate,
} from "./protocol";

/** Seconds since epoch when a JWT expires, if it says. */
export function tokenExpiry(token: string): number | null {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4))) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export const ORIGIN_REMOTE = "worlds-remote";
export const ORIGIN_LOAD = "worlds-load";

export type SyncState = "offline" | "connecting" | "syncing" | "synced" | "error";

export interface SyncInfo {
  state: SyncState;
  level: AccessLevel | null;
  /** Local changes not yet acknowledged by the server. */
  unacked: number;
  /** Connection problem, cleared once synced again. */
  error: string | null;
  /** Something the user should know about that syncing does not fix (refused changes). */
  attention: string | null;
  lastSyncedAt: number | null;
  /** Whether a sync service is configured at all. */
  remote: boolean;
}

export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

export interface ProviderOptions {
  pageId: string;
  workspaceId: string;
  /** Server document id (defaults to the page id). */
  docId?: string;
  content: Y.Doc;
  comments: Y.Doc;
  /** Presence, when the caller keeps it across providers (defaults to a new one). */
  awareness?: awarenessProtocol.Awareness;
  store: LocalStore;
  /** https://... base of the sync service, or null for local only. */
  serverUrl: string | null;
  getToken: (refresh?: boolean) => Promise<string | null>;
  createSocket?: SocketFactory;
  /** HTTP probe used to tell "signed out" or "no access" from "offline". */
  fetcher?: typeof fetch;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
  compactAfter?: number;
  pingMs?: number;
  silenceMs?: number;
  isOnline?: () => boolean;
  /** Subscribe to connectivity changes; returns an unsubscribe. */
  watchOnline?: (fn: (online: boolean) => void) => () => void;
}

type Pending = { channel: number; outboxIds?: number[]; upto?: number };
type Listener = (info: SyncInfo) => void;

const OPEN = 1;
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;

function defaultSocket(url: string, protocols: string[]): SocketLike {
  return new WebSocket(url, protocols) as unknown as SocketLike;
}

function defaultWatchOnline(fn: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const on = () => fn(true);
  const off = () => fn(false);
  window.addEventListener("online", on);
  window.addEventListener("offline", off);
  return () => {
    window.removeEventListener("online", on);
    window.removeEventListener("offline", off);
  };
}

export class WorldsProvider {
  readonly pageId: string;
  readonly docs: Y.Doc[];
  readonly awareness: awarenessProtocol.Awareness;
  private o: Required<Omit<ProviderOptions, "docId" | "fetcher" | "awareness">> & { docId: string; fetcher: typeof fetch | null };
  private ownsAwareness: boolean;
  private socket: SocketLike | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = new Map<number, Pending>();
  private batch = 1;
  /** Local changes still on their way into the outbox or onto the wire. */
  private inflight = 0;
  private handshake = [false, false];
  private received = [false, false];
  private attempt = 0;
  private failedOpens = 0;
  private refreshToken = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageAt = 0;
  private stopped = false;
  private revoked = false;
  private unwatchOnline: () => void = () => undefined;
  private listeners = new Set<Listener>();
  private resetListeners = new Set<(channel: number, reason: string) => void>();
  private revokeListeners = new Set<() => void>();
  private noticeListeners = new Set<(code: string, message: string) => void>();
  private docListeners: ((update: Uint8Array, origin: unknown) => void)[] = [];
  info: SyncInfo;

  constructor(opts: ProviderOptions) {
    this.pageId = opts.pageId;
    this.o = {
      ...opts,
      docId: opts.docId ?? opts.pageId,
      createSocket: opts.createSocket ?? defaultSocket,
      fetcher: opts.fetcher ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null),
      minBackoffMs: opts.minBackoffMs ?? 500,
      maxBackoffMs: opts.maxBackoffMs ?? 30_000,
      random: opts.random ?? Math.random,
      compactAfter: opts.compactAfter ?? 200,
      pingMs: opts.pingMs ?? 25_000,
      silenceMs: opts.silenceMs ?? 70_000,
      isOnline: opts.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false)),
      watchOnline: opts.watchOnline ?? defaultWatchOnline,
    };
    this.docs = [opts.content, opts.comments];
    this.ownsAwareness = !opts.awareness;
    this.awareness = opts.awareness ?? new awarenessProtocol.Awareness(opts.content);
    this.info = { state: "offline", level: null, unacked: 0, error: null, attention: null, lastSyncedAt: null, remote: !!opts.serverUrl };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Load the local replica, start persisting, then go online if configured. */
  async init(): Promise<void> {
    for (const channel of [CH_CONTENT, CH_COMMENTS]) {
      const l = await this.o.store.load(this.pageId, channel);
      const parts = [...(l.snapshot ? [l.snapshot] : []), ...l.updates];
      if (parts.length) Y.applyUpdate(this.docs[channel], Y.mergeUpdates(parts), ORIGIN_LOAD);
    }
    this.docs.forEach((doc, channel) => {
      const fn = (update: Uint8Array, origin: unknown) => this.onDocUpdate(channel, update, origin);
      this.docListeners[channel] = fn;
      doc.on("update", fn);
    });
    this.awareness.on("update", this.onAwarenessUpdate);
    this.unwatchOnline = this.o.watchOnline((online) => (online ? this.connectSoon(0) : this.socket?.close(4000, "offline")));
    const s = await this.o.store.status(this.pageId).catch(() => null);
    this.patch({
      unacked: s?.pending ?? 0,
      lastSyncedAt: s?.syncedAt ?? null,
      attention: s?.rejected ? `${s.rejected} earlier change${s.rejected === 1 ? " was" : "s were"} not accepted by the server` : null,
    });
    if (this.o.serverUrl) void this.connect();
  }

  destroy() {
    if (this.stopped) return;
    this.stopped = true;
    this.unwatchOnline();
    this.clearTimers();
    if (this.ownsAwareness) this.awareness.setLocalState(null); // tells peers we left
    this.docs.forEach((doc, channel) => this.docListeners[channel] && doc.off("update", this.docListeners[channel]));
    this.awareness.off("update", this.onAwarenessUpdate);
    if (this.ownsAwareness) this.awareness.destroy();
    else {
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.awareness.clientID);
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    }
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close(1000, "closed");
    }
    this.listeners.clear();
  }

  /** Wait until every local change so far is in the local replica. */
  async persisted(): Promise<void> {
    await this.chain;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onReset(fn: (channel: number, reason: string) => void): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }
  onRevoked(fn: () => void): () => void {
    this.revokeListeners.add(fn);
    return () => this.revokeListeners.delete(fn);
  }
  onNotice(fn: (code: string, message: string) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  private patch(p: Partial<SyncInfo>) {
    const next = { ...this.info, ...p };
    if (JSON.stringify(next) === JSON.stringify(this.info)) return;
    this.info = next;
    for (const fn of this.listeners) fn(next);
  }

  private computeState(): SyncState {
    if (this.revoked) return "error";
    if (!this.o.serverUrl) return "offline";
    if (!this.socket) return this.info.state === "error" ? "error" : "offline";
    if (this.socket.readyState !== OPEN) return "connecting";
    const done = this.handshake.every(Boolean) && this.received.every(Boolean) && this.pending.size === 0 && this.inflight === 0;
    return done ? "synced" : "syncing";
  }

  private refresh(extra: Partial<SyncInfo> = {}) {
    const state = extra.state ?? this.computeState();
    const p: Partial<SyncInfo> = { ...extra, state };
    if (state === "synced") {
      p.lastSyncedAt = Date.now();
      p.error = null;
      this.attempt = 0;
      for (const ch of [CH_CONTENT, CH_COMMENTS]) void this.o.store.setCursor(this.pageId, ch, { synced: true, error: null }).catch(() => undefined);
    }
    this.patch(p);
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.tokenTimer = null;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private onDocUpdate(channel: number, update: Uint8Array, origin: unknown) {
    if (origin === ORIGIN_LOAD) return;
    const remote = origin === ORIGIN_REMOTE;
    const kind = remote ? "remote" : origin === ORIGIN_FOLD ? "external" : "local";
    const step = this.chain.then(async () => {
      const r = await this.o.store.append(this.pageId, channel, update, kind, !remote);
      if (r.logLen >= this.o.compactAfter) {
        await this.o.store.compact(this.pageId, channel, Y.encodeStateAsUpdate(this.docs[channel]), r.updateId);
      }
      return r;
    });
    this.chain = step.catch((e) => {
      this.refresh({ state: "error", error: `Could not save locally: ${e instanceof Error ? e.message : String(e)}` });
    });
    if (remote) return;
    this.inflight++;
    this.refresh({ unacked: this.info.unacked + 1 });
    void step
      .then((r) => {
        if (r.outboxId !== null && this.handshake[channel] && this.socket?.readyState === OPEN) this.send(channel, update, { channel, outboxIds: [r.outboxId] });
      })
      .catch(() => undefined)
      .finally(() => {
        this.inflight--;
        this.refresh();
      });
  }

  private send(channel: number, update: Uint8Array, p: Pending) {
    const id = this.batch++;
    this.pending.set(id, p);
    try {
      this.socket!.send(encodeUpdate(id, channel, update));
    } catch {
      this.pending.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  private connectSoon(delay: number) {
    if (this.stopped || this.revoked || !this.o.serverUrl) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private backoff(): number {
    const base = Math.min(this.o.maxBackoffMs, this.o.minBackoffMs * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 16);
    return Math.round(base * (0.7 + 0.6 * this.o.random()));
  }

  /** Reconnect right away (for example after signing in). */
  reconnect() {
    this.revoked = false;
    this.attempt = 0;
    const s = this.socket;
    if (s) s.close(4000, "reconnect");
    else this.connectSoon(0);
  }

  async connect(): Promise<void> {
    if (this.stopped || this.revoked || this.socket || !this.o.serverUrl) return;
    if (!this.o.isOnline()) {
      this.refresh({ state: "offline" });
      return; // the online event reconnects
    }
    this.refresh({ state: "connecting" });
    let token: string | null = null;
    try {
      token = await this.o.getToken(this.refreshToken);
    } catch {
      token = null;
    }
    this.refreshToken = false;
    if (this.stopped || this.socket) return;
    if (!token) {
      this.refresh({ state: "error", error: "Sign in to sync this page" });
      this.connectSoon(Math.max(this.backoff(), 5000));
      return;
    }
    const url = `${this.o.serverUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(this.o.workspaceId)}/docs/${encodeURIComponent(this.o.docId)}/sync`;
    let s: SocketLike;
    try {
      s = this.o.createSocket(url, [PROTOCOL, `${BEARER_PREFIX}${token}`]);
    } catch (e) {
      this.refresh({ state: "error", error: e instanceof Error ? e.message : "Could not connect" });
      this.connectSoon(this.backoff());
      return;
    }
    s.binaryType = "arraybuffer";
    this.socket = s;
    let opened = false;
    s.onopen = () => {
      opened = true;
      this.failedOpens = 0;
      this.lastMessageAt = Date.now();
      for (const channel of [CH_CONTENT, CH_COMMENTS]) {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MSG_SYNC);
        encoding.writeVarUint(e, channel);
        encoding.writeVarUint(e, SYNC_STEP1);
        encoding.writeVarUint8Array(e, Y.encodeStateVector(this.docs[channel]));
        s.send(encoding.toUint8Array(e));
      }
      if (this.awareness.getLocalState() !== null) {
        s.send(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])));
      }
      this.scheduleTokenRefresh(token!);
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastMessageAt > this.o.silenceMs) s.close(4000, "silent");
        else if (s.readyState === OPEN) s.send("ping");
      }, this.o.pingMs);
      this.refresh();
    };
    s.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      if (typeof ev.data === "string") return; // "pong"
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : (ev.data as Uint8Array);
      void this.onMessage(data).catch((e) => this.refresh({ state: "error", error: e instanceof Error ? e.message : String(e) }));
    };
    s.onerror = () => undefined;
    s.onclose = (ev) => {
      if (this.socket !== s) return;
      this.onClosed(ev.code, ev.reason, opened);
    };
  }

  /**
   * Access tokens are short lived (15 minutes). Hand the open connection a
   * fresh one a minute before expiry instead of reconnecting.
   */
  private scheduleTokenRefresh(token: string) {
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    const exp = tokenExpiry(token);
    if (!exp) return;
    const wait = Math.max(1_000, exp * 1000 - Date.now() - 60_000);
    this.tokenTimer = setTimeout(async () => {
      this.tokenTimer = null;
      const s = this.socket;
      if (!s || s.readyState !== OPEN) return;
      const next = await this.o.getToken(true).catch(() => null);
      if (!next || this.socket !== s || s.readyState !== OPEN) return;
      s.send(encodeAuthRefresh(next));
      this.scheduleTokenRefresh(next);
    }, wait);
  }

  private onClosed(code: number, reason: string, opened: boolean) {
    this.socket = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.pingTimer = null;
    this.tokenTimer = null;
    this.handshake = [false, false];
    this.received = [false, false];
    this.pending.clear(); // unacknowledged entries stay in the outbox and are resent
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.awareness.clientID);
    awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    if (this.stopped) return;
    if (code === CLOSE_REVOKED) {
      this.revoked = true;
      this.refresh({ state: "error", error: reason || "Access to this page was removed", level: "none" });
      for (const fn of this.revokeListeners) fn();
      return;
    }
    if (code === CLOSE_UNAUTHORIZED) this.refreshToken = true;
    if (!opened) {
      this.failedOpens++;
      if (this.failedOpens >= 3) {
        void this.probe();
        return;
      }
    }
    this.refresh({ state: this.o.isOnline() ? "connecting" : "offline" });
    this.connectSoon(this.backoff());
  }

  /** After repeated failed upgrades, ask over HTTP why (browsers hide the status). */
  private async probe() {
    let status = 0;
    try {
      const token = await this.o.getToken(true);
      if (this.o.fetcher && token) {
        const base = this.o.serverUrl!.replace(/\/+$/, "");
        const r = await this.o.fetcher(`${base}/v1/workspaces/${encodeURIComponent(this.o.workspaceId)}/docs/${encodeURIComponent(this.o.docId)}/versions`, {
          headers: { authorization: `Bearer ${token}` },
        });
        status = r.status;
      }
    } catch {
      status = 0;
    }
    if (this.stopped) return;
    if (status === 403) {
      this.revoked = true;
      this.refresh({ state: "error", error: "You no longer have access to this page", level: "none" });
      for (const fn of this.revokeListeners) fn();
      return;
    }
    if (status === 401) this.refresh({ state: "error", error: "Sign in again to sync" });
    else if (status >= 200 && status < 300) this.refresh({ state: "connecting" });
    else this.refresh({ state: this.o.isOnline() ? "error" : "offline", error: this.o.isOnline() ? "Can't reach the sync service" : null });
    this.connectSoon(this.backoff());
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private async onMessage(data: Uint8Array) {
    const d = decoding.createDecoder(data);
    const type = decoding.readVarUint(d);
    switch (type) {
      case MSG_SYNC: {
        const channel = decoding.readVarUint(d);
        const kind = decoding.readVarUint(d);
        const payload = decoding.readVarUint8Array(d);
        if (channel !== CH_CONTENT && channel !== CH_COMMENTS) return;
        if (kind === SYNC_STEP1) await this.onServerStep1(channel, payload);
        else {
          Y.applyUpdate(this.docs[channel], payload, ORIGIN_REMOTE);
          if (kind === SYNC_STEP2) {
            this.received[channel] = true;
            this.refresh();
          }
        }
        return;
      }
      case MSG_AUTH_STATE: {
        const level = decoding.readVarString(d) as AccessLevel;
        decoding.readVarString(d);
        for (const ch of [CH_CONTENT, CH_COMMENTS]) void this.o.store.setCursor(this.pageId, ch, { level }).catch(() => undefined);
        this.refresh({ level });
        return;
      }
      case MSG_ACK: {
        const id = decoding.readVarUint(d);
        const status = decoding.readVarUint(d);
        const reason = decoding.readVarString(d);
        await this.onAck(id, status, reason);
        return;
      }
      case MSG_NOTICE: {
        const code = decoding.readVarString(d);
        const message = decoding.readVarString(d);
        for (const fn of this.noticeListeners) fn(code, message);
        return;
      }
      case MSG_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), this);
        return;
      }
    }
  }

  /** The server told us what it has: send everything it lacks, acknowledged. */
  private async onServerStep1(channel: number, serverVector: Uint8Array) {
    await this.chain; // every local change is in the outbox first
    const s = this.socket;
    if (!s || s.readyState !== OPEN) return;
    const upto = await this.o.store.outboxMax(this.pageId, channel);
    const diff = Y.encodeStateAsUpdate(this.docs[channel], serverVector);
    this.send(channel, diff, { channel, upto });
    this.handshake[channel] = true;
    void this.o.store.setCursor(this.pageId, channel, { serverVector }).catch(() => undefined);
    this.refresh();
  }

  private async onAck(id: number, status: number, reason: string) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (status === ACK_OK) {
      if (p.upto !== undefined) await this.o.store.ackUpto(this.pageId, p.channel, p.upto);
      else await this.o.store.ack(p.outboxIds ?? []);
    } else {
      await this.rejectChannel(p.channel, reason || "The server refused this change");
      return;
    }
    const s = await this.o.store.status(this.pageId).catch(() => null);
    this.refresh(s ? { unacked: s.pending } : {});
  }

  /**
   * The server refused a write (rights changed while we were offline). Keep
   * the refused changes aside in the outbox, drop the diverged replica of
   * that channel, and let the owner rebuild it from the server.
   */
  private async rejectChannel(channel: number, reason: string) {
    await this.chain;
    const ids = (await this.o.store.outbox(this.pageId)).filter((o) => o.channel === channel).map((o) => o.id);
    await this.o.store.reject(ids, reason);
    await this.o.store.compact(this.pageId, channel, Y.encodeStateAsUpdate(new Y.Doc()), Number.MAX_SAFE_INTEGER);
    const s = await this.o.store.status(this.pageId).catch(() => null);
    this.refresh({ unacked: s?.pending ?? 0, attention: `Some changes were not accepted: ${reason}` });
    for (const fn of this.resetListeners) fn(channel, reason);
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    const changed = [...added, ...updated, ...removed];
    const s = this.socket;
    if (!s || s.readyState !== OPEN || !changed.length) return;
    s.send(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
  };

}
