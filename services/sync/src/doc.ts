/**
 * DocRoom: one Durable Object per shared document.
 *
 * Holds the content and comments Yjs documents, persists every accepted
 * update to its SQLite storage before it is broadcast or acknowledged,
 * compacts the update log into snapshots, cuts author-attributed versions,
 * relays presence, and enforces access on every connection and message.
 */
import { DurableObject } from "cloudflare:workers";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { accessFor } from "./access";
import { addedComments, commentsJSON, validateCommentsChange } from "./comments";
import { type Env, num } from "./env";
import {
  ACK_DENIED,
  ACK_INVALID,
  ACK_OK,
  type AccessLevel,
  type AwarenessEntry,
  CH_COMMENTS,
  CH_CONTENT,
  CLOSE_RETRY,
  CLOSE_REVOKED,
  CLOSE_TOO_LARGE,
  CLOSE_UNAUTHORIZED,
  MSG_AWARENESS,
  MSG_QUERY_AWARENESS,
  MSG_SYNC,
  MSG_UPDATE,
  canWrite,
  decodeAwarenessUpdate,
  encodeAck,
  encodeAuthState,
  encodeAwareness,
  encodeAwarenessUpdate,
  encodeNotice,
} from "./protocol";

/** y-protocols sync message kinds (kept local so the server never applies updates unchecked). */
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024; // SQLite values in Durable Objects are capped at 2 MB
const MAX_VERSIONS = 200;
/** How long a cached access level may be used when the identity service is unreachable. */
const MAX_STALE_ACCESS_MS = 5 * 60 * 1000;

export interface Session {
  userId: string;
  deviceId: string;
  level: AccessLevel;
  exp: number; // token expiry, seconds
  checkedAt: number; // ms
  clients: number[]; // awareness client ids announced on this socket
}

export interface VersionInfo {
  id: string;
  createdAt: number;
  label: string | null;
  authors: string[];
  size: number;
}

export interface WriteResult {
  status: number;
  reason: string;
}

type Row = Record<string, SqlStorageValue>;

const bytes = (v: SqlStorageValue): Uint8Array =>
  v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(0);

/** Send without throwing on a socket that is closing. */
function send(ws: WebSocket, frame: Uint8Array): boolean {
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}

function syncFrame(channel: number, kind: number, payload: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_SYNC);
  encoding.writeVarUint(e, channel);
  encoding.writeVarUint(e, kind);
  encoding.writeVarUint8Array(e, payload);
  return encoding.toUint8Array(e);
}

export class DocRoom extends DurableObject<Env> {
  private docs: Y.Doc[] = [new Y.Doc({ gc: true }), new Y.Doc({ gc: true })];
  private awareness = new Map<number, { clock: number; state: string }>();
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.load();
    });
  }

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        channel INTEGER NOT NULL,
        data BLOB NOT NULL,
        user_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS updates_channel ON updates(channel, seq);
      CREATE TABLE IF NOT EXISTS snapshots (
        channel INTEGER NOT NULL,
        chunk INTEGER NOT NULL,
        upto INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (channel, chunk)
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        label TEXT,
        authors TEXT NOT NULL,
        size INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS version_chunks (
        version_id TEXT NOT NULL,
        chunk INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (version_id, chunk)
      );
    `);
  }

  private load() {
    for (const channel of [CH_CONTENT, CH_COMMENTS]) {
      const doc = this.docs[channel];
      const chunks = this.sql.exec("SELECT data FROM snapshots WHERE channel = ? ORDER BY chunk", channel).toArray();
      if (chunks.length) Y.applyUpdate(doc, concat(chunks.map((r) => bytes(r.data))));
      for (const r of this.sql.exec("SELECT data FROM updates WHERE channel = ? ORDER BY seq", channel)) {
        Y.applyUpdate(doc, bytes(r.data));
      }
    }
  }

  private meta(key: string): string | null {
    const r = this.sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return r ? String(r.value) : null;
  }

  private setMeta(key: string, value: string) {
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  private identify(workspaceId: string, docId: string) {
    if (!this.meta("workspace")) {
      this.setMeta("workspace", workspaceId);
      this.setMeta("doc", docId);
    }
  }

  private get workspaceId() {
    return this.meta("workspace") ?? "";
  }
  private get docId() {
    return this.meta("doc") ?? "";
  }

  private append(channel: number, update: Uint8Array, userId: string) {
    this.sql.exec("INSERT INTO updates (channel, data, user_id, created_at) VALUES (?, ?, ?, ?)", channel, update, userId, Date.now());
    const count = Number(this.sql.exec("SELECT COUNT(*) AS n FROM updates WHERE channel = ?", channel).one().n);
    if (count >= num(this.env.COMPACT_EVERY, 500)) this.compact(channel);
  }

  /** Fold the update log of one channel into a single snapshot. */
  compact(channel: number): boolean {
    const doc = this.docs[channel];
    // Never drop updates that are still waiting for missing dependencies.
    if (doc.store.pendingStructs || doc.store.pendingDs) return false;
    const upto = Number(this.sql.exec("SELECT COALESCE(MAX(seq), 0) AS m FROM updates WHERE channel = ?", channel).one().m);
    if (!upto) return false;
    const state = Y.encodeStateAsUpdate(doc);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM snapshots WHERE channel = ?", channel);
      split(state).forEach((part, i) => {
        this.sql.exec("INSERT INTO snapshots (channel, chunk, upto, data, created_at) VALUES (?, ?, ?, ?, ?)", channel, i, upto, part, Date.now());
      });
      this.sql.exec("DELETE FROM updates WHERE channel = ? AND seq <= ?", channel, upto);
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Versions (history attributed to authors)
  // -------------------------------------------------------------------------

  private pendingAuthors(): string[] {
    try {
      return JSON.parse(this.meta("authors") ?? "[]") as string[];
    } catch {
      return [];
    }
  }

  private noteAuthor(userId: string) {
    const authors = this.pendingAuthors();
    if (!authors.includes(userId)) this.setMeta("authors", JSON.stringify([...authors, userId]));
    const last = Number(this.meta("lastVersionAt") ?? 0);
    if (!last) this.setMeta("lastVersionAt", String(Date.now()));
    else if (Date.now() - last >= num(this.env.VERSION_INTERVAL_MS, 10 * 60 * 1000)) this.cutVersion(null, false);
  }

  private cutVersion(label: string | null, force: boolean, extraAuthor?: string): VersionInfo | null {
    const authors = this.pendingAuthors();
    if (extraAuthor && !authors.includes(extraAuthor)) authors.push(extraAuthor);
    if (!authors.length && !force) return null;
    const state = Y.encodeStateAsUpdate(this.docs[CH_CONTENT]);
    const v: VersionInfo = { id: crypto.randomUUID(), createdAt: Date.now(), label, authors, size: state.byteLength };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO versions (id, created_at, label, authors, size) VALUES (?, ?, ?, ?, ?)", v.id, v.createdAt, label, JSON.stringify(authors), v.size);
      split(state).forEach((part, i) => this.sql.exec("INSERT INTO version_chunks (version_id, chunk, data) VALUES (?, ?, ?)", v.id, i, part));
      this.setMeta("authors", "[]");
      this.setMeta("lastVersionAt", String(v.createdAt));
      const old = this.sql.exec("SELECT id FROM versions ORDER BY created_at DESC LIMIT -1 OFFSET ?", MAX_VERSIONS).toArray();
      for (const r of old) {
        this.sql.exec("DELETE FROM version_chunks WHERE version_id = ?", r.id);
        this.sql.exec("DELETE FROM versions WHERE id = ?", r.id);
      }
    });
    return v;
  }

  async listVersions(workspaceId: string, docId: string): Promise<VersionInfo[]> {
    this.identify(workspaceId, docId);
    return this.sql
      .exec("SELECT id, created_at, label, authors, size FROM versions ORDER BY created_at DESC")
      .toArray()
      .map((r: Row) => ({
        id: String(r.id),
        createdAt: Number(r.created_at),
        label: r.label === null ? null : String(r.label),
        authors: JSON.parse(String(r.authors)) as string[],
        size: Number(r.size),
      }));
  }

  async getVersion(versionId: string): Promise<Uint8Array | null> {
    const chunks = this.sql.exec("SELECT data FROM version_chunks WHERE version_id = ? ORDER BY chunk", versionId).toArray();
    return chunks.length ? concat(chunks.map((r) => bytes(r.data))) : null;
  }

  async createVersion(workspaceId: string, docId: string, userId: string, label: string | null): Promise<VersionInfo> {
    this.identify(workspaceId, docId);
    return this.cutVersion(label, true, userId)!;
  }

  /** Full state of one channel (HTTP catch-up for clients without a socket). */
  async getState(workspaceId: string, docId: string, channel: number): Promise<Uint8Array> {
    this.identify(workspaceId, docId);
    return Y.encodeStateAsUpdate(this.docs[channel === CH_COMMENTS ? CH_COMMENTS : CH_CONTENT]);
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const h = request.headers;
    const workspaceId = h.get("x-worlds-workspace") ?? "";
    const docId = h.get("x-worlds-doc") ?? "";
    this.identify(workspaceId, docId);
    const session: Session = {
      userId: h.get("x-worlds-user") ?? "",
      deviceId: h.get("x-worlds-device") ?? "",
      level: (h.get("x-worlds-level") ?? "none") as AccessLevel,
      exp: Number(h.get("x-worlds-exp") ?? 0),
      checkedAt: Date.now(),
      clients: [],
    };
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`u:${session.userId}`, `d:${session.deviceId}`]);
    server.serializeAttachment(session);

    server.send(encodeAuthState(session.level, session.userId));
    for (const channel of [CH_CONTENT, CH_COMMENTS]) server.send(syncFrame(channel, SYNC_STEP1, Y.encodeStateVector(this.docs[channel])));
    if (this.awareness.size) server.send(encodeAwareness(this.awarenessSnapshot()));

    await this.env.HUBS.getByName(workspaceId).register(workspaceId, docId);
    const headers = new Headers();
    if (h.get("x-worlds-subprotocol")) headers.set("Sec-WebSocket-Protocol", h.get("x-worlds-subprotocol")!);
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === "string") return;
    if (message.byteLength > MAX_MESSAGE_BYTES) {
      ws.close(CLOSE_TOO_LARGE, "message too large");
      return;
    }
    const session = ws.deserializeAttachment() as Session;
    if (session.exp * 1000 < Date.now()) {
      send(ws, encodeNotice("expired", "Access token expired"));
      ws.close(CLOSE_UNAUTHORIZED, "token expired");
      return;
    }
    let d: decoding.Decoder;
    let type: number;
    try {
      d = decoding.createDecoder(new Uint8Array(message));
      type = decoding.readVarUint(d);
    } catch {
      return;
    }
    try {
      switch (type) {
        case MSG_SYNC: {
          const channel = decoding.readVarUint(d);
          const kind = decoding.readVarUint(d);
          const payload = decoding.readVarUint8Array(d);
          if (channel !== CH_CONTENT && channel !== CH_COMMENTS) return;
          if (kind === SYNC_STEP1) {
            send(ws, syncFrame(channel, SYNC_STEP2, Y.encodeStateAsUpdate(this.docs[channel], payload)));
          } else if (kind === SYNC_STEP2 || kind === SYNC_UPDATE) {
            const r = await this.write(ws, channel, payload);
            if (r.status !== ACK_OK) send(ws, encodeNotice("denied", r.reason));
          }
          return;
        }
        case MSG_UPDATE: {
          const batch = decoding.readVarUint(d);
          const channel = decoding.readVarUint(d);
          const payload = decoding.readVarUint8Array(d);
          const r = await this.write(ws, channel, payload);
          send(ws, encodeAck(batch, r.status, r.reason));
          return;
        }
        case MSG_AWARENESS: {
          this.onAwareness(ws, session, decoding.readVarUint8Array(d));
          return;
        }
        case MSG_QUERY_AWARENESS: {
          send(ws, encodeAwareness(this.awarenessSnapshot()));
          return;
        }
      }
    } catch (e) {
      send(ws, encodeNotice("invalid", e instanceof Error ? e.message : "invalid message"));
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.dropSocket(ws);
    try {
      ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, "closing");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropSocket(ws);
  }

  private dropSocket(ws: WebSocket) {
    const session = ws.deserializeAttachment() as Session | null;
    if (session?.clients.length) {
      const gone: AwarenessEntry[] = [];
      for (const id of session.clients) {
        const cur = this.awareness.get(id);
        gone.push({ clientID: id, clock: (cur?.clock ?? 0) + 1, state: "null" });
        this.awareness.delete(id);
      }
      this.broadcast(encodeAwareness(encodeAwarenessUpdate(gone)), ws);
    }
    const others = this.ctx.getWebSockets().filter((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (!others.length) {
      // Everyone left: close the editing session's version and leave the hub.
      this.cutVersion(null, false);
      const ws_ = this.workspaceId;
      if (ws_) this.ctx.waitUntil(this.env.HUBS.getByName(ws_).unregister(ws_, this.docId));
    }
  }

  private broadcast(frame: Uint8Array, except?: WebSocket) {
    for (const s of this.ctx.getWebSockets()) {
      if (s === except || s.readyState !== WebSocket.OPEN) continue;
      send(s, frame);
    }
  }

  // -------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------

  /** Re-check the socket's rights when the cached answer is old. Returns null when the socket was closed. */
  private async ensureAccess(ws: WebSocket): Promise<Session | null> {
    const s = ws.deserializeAttachment() as Session;
    const ttl = num(this.env.ACCESS_TTL_MS, 30_000);
    if (Date.now() - s.checkedAt < ttl) return s;
    let level: AccessLevel;
    try {
      level = (await accessFor(this.env).checkAccess({ userId: s.userId, workspaceId: this.workspaceId, docId: this.docId })).level;
    } catch {
      if (Date.now() - s.checkedAt > MAX_STALE_ACCESS_MS) {
        ws.close(CLOSE_RETRY, "access check unavailable");
        return null;
      }
      return s;
    }
    // The socket may have been revoked while we waited.
    if (ws.readyState !== WebSocket.OPEN) return null;
    const cur = ws.deserializeAttachment() as Session;
    if (level === "none") {
      send(ws, encodeNotice("revoked", "Access to this page was removed"));
      ws.close(CLOSE_REVOKED, "access revoked");
      return null;
    }
    const next = { ...cur, level, checkedAt: Date.now() };
    ws.serializeAttachment(next);
    if (level !== cur.level) send(ws, encodeAuthState(level, cur.userId));
    return next;
  }

  /** Apply a client write after checking rights. Persisted before broadcast or ack. */
  private async write(ws: WebSocket, channel: number, update: Uint8Array): Promise<WriteResult> {
    if (channel !== CH_CONTENT && channel !== CH_COMMENTS) return { status: ACK_INVALID, reason: "unknown channel" };
    const session = await this.ensureAccess(ws);
    if (!session) return { status: ACK_DENIED, reason: "access revoked" };
    if (!canWrite(session.level, channel)) {
      // Read-only clients still answer the server's sync step with an empty
      // diff; only refuse writes that would change something.
      if (!wouldChange(this.docs[channel], update)) return { status: ACK_OK, reason: "" };
      return { status: ACK_DENIED, reason: channel === CH_CONTENT ? `${session.level} access cannot edit the page` : `${session.level} access cannot comment` };
    }
    const doc = this.docs[channel];
    let before: ReturnType<typeof commentsJSON> | null = null;
    if (channel === CH_COMMENTS) {
      const scratch = new Y.Doc();
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
      before = commentsJSON(scratch);
      try {
        Y.applyUpdate(scratch, update);
      } catch {
        return { status: ACK_INVALID, reason: "malformed update" };
      }
      const reason = validateCommentsChange(before, commentsJSON(scratch), session.userId, session.level);
      if (reason) return { status: ACK_DENIED, reason };
    }
    let changed = false;
    const onUpdate = () => (changed = true);
    doc.on("update", onUpdate);
    try {
      Y.applyUpdate(doc, update, ws);
    } catch {
      return { status: ACK_INVALID, reason: "malformed update" };
    } finally {
      doc.off("update", onUpdate);
    }
    const pending = !!(doc.store.pendingStructs || doc.store.pendingDs);
    if (!changed && !pending) return { status: ACK_OK, reason: "" };
    this.append(channel, update, session.userId);
    if (channel === CH_CONTENT) this.noteAuthor(session.userId);
    this.broadcast(syncFrame(channel, SYNC_UPDATE, update), ws);
    if (channel === CH_COMMENTS && before) this.notifyMentions(before, commentsJSON(doc), session.userId);
    return { status: ACK_OK, reason: "" };
  }

  private notifyMentions(before: ReturnType<typeof commentsJSON>, after: ReturnType<typeof commentsJSON>, from: string) {
    const added = addedComments(before, after);
    if (!added.length) return;
    const workspaceId = this.workspaceId;
    const docId = this.docId;
    const access = accessFor(this.env);
    const work = (async () => {
      for (const a of added) {
        const mentioned = new Set((a.comment.mentions ?? []).filter((u) => u !== from));
        const recipients = new Map<string, "mention" | "reply">();
        for (const u of mentioned) recipients.set(u, "mention");
        for (const u of a.participants) if (!recipients.has(u) && u !== from) recipients.set(u, "reply");
        for (const [userId, kind] of recipients) {
          // Never tell someone about a page they cannot open.
          const { level } = await access.checkAccess({ userId, workspaceId, docId }).catch(() => ({ level: "none" as const }));
          if (level === "none") continue;
          await this.env.INBOXES.getByName(userId).add({
            id: `${a.comment.id}:${userId}`,
            kind,
            workspaceId,
            docId,
            threadId: a.threadId,
            commentId: a.comment.id,
            from,
            excerpt: a.comment.body.slice(0, 200),
            createdAt: a.comment.createdAt || Date.now(),
          });
        }
      }
    })().catch(() => undefined);
    this.ctx.waitUntil(work);
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  private awarenessSnapshot(): Uint8Array {
    return encodeAwarenessUpdate([...this.awareness].map(([clientID, v]) => ({ clientID, clock: v.clock, state: v.state })));
  }

  private onAwareness(ws: WebSocket, session: Session, update: Uint8Array) {
    const entries = decodeAwarenessUpdate(update);
    const accepted: AwarenessEntry[] = [];
    let clients = session.clients;
    for (const en of entries) {
      const cur = this.awareness.get(en.clientID);
      if (cur && cur.clock >= en.clock && en.state !== "null") continue;
      let state = en.state;
      if (state !== "null") {
        // Presence always carries the real user id, whatever the client says.
        try {
          const parsed = JSON.parse(state) as Record<string, unknown> | null;
          if (parsed && typeof parsed === "object") {
            const user = (parsed.user && typeof parsed.user === "object" ? parsed.user : {}) as Record<string, unknown>;
            parsed.user = { ...user, id: session.userId };
            state = JSON.stringify(parsed);
          }
        } catch {
          continue;
        }
        this.awareness.set(en.clientID, { clock: en.clock, state });
        if (!clients.includes(en.clientID)) clients = [...clients, en.clientID];
      } else {
        this.awareness.delete(en.clientID);
        clients = clients.filter((c) => c !== en.clientID);
      }
      accepted.push({ ...en, state });
    }
    if (clients !== session.clients) ws.serializeAttachment({ ...(ws.deserializeAttachment() as Session), clients });
    if (accepted.length) this.broadcast(encodeAwareness(encodeAwarenessUpdate(accepted)), ws);
  }

  // -------------------------------------------------------------------------
  // Revocation and diagnostics
  // -------------------------------------------------------------------------

  /**
   * Apply a permission change at once. With no level (or "none") the user's
   * sockets close; with a lower level they stay open and learn it.
   */
  async revoke(input: { userId: string; deviceId?: string; level?: AccessLevel }): Promise<number> {
    let affected = 0;
    for (const ws of this.ctx.getWebSockets(`u:${input.userId}`)) {
      const s = ws.deserializeAttachment() as Session;
      if (input.deviceId && s.deviceId !== input.deviceId) continue;
      affected++;
      if (!input.level || input.level === "none") {
        try {
          ws.send(encodeNotice("revoked", "Access to this page was removed"));
          ws.close(CLOSE_REVOKED, "access revoked");
        } catch {
          /* already closing */
        }
        this.dropSocket(ws);
      } else {
        ws.serializeAttachment({ ...s, level: input.level, checkedAt: Date.now() });
        send(ws, encodeAuthState(input.level, s.userId));
      }
    }
    // Everyone else re-checks on their next write.
    for (const ws of this.ctx.getWebSockets()) {
      const s = ws.deserializeAttachment() as Session | null;
      if (s && s.userId !== input.userId) ws.serializeAttachment({ ...s, checkedAt: 0 });
    }
    return affected;
  }

  async sessions(): Promise<{ userId: string; deviceId: string; level: AccessLevel }[]> {
    return this.ctx
      .getWebSockets()
      .filter((s) => s.readyState === WebSocket.OPEN)
      .map((s) => s.deserializeAttachment() as Session)
      .map((s) => ({ userId: s.userId, deviceId: s.deviceId, level: s.level }));
  }

  async storageStats(): Promise<{ updates: number; snapshots: number; versions: number }> {
    return {
      updates: Number(this.sql.exec("SELECT COUNT(*) AS n FROM updates").one().n),
      snapshots: Number(this.sql.exec("SELECT COUNT(*) AS n FROM snapshots").one().n),
      versions: Number(this.sql.exec("SELECT COUNT(*) AS n FROM versions").one().n),
    };
  }
}

function wouldChange(doc: Y.Doc, update: Uint8Array): boolean {
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
  let changed = false;
  scratch.on("update", () => (changed = true));
  try {
    Y.applyUpdate(scratch, update);
  } catch {
    return true;
  }
  return changed || !!scratch.store.pendingStructs;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

function split(data: Uint8Array): Uint8Array[] {
  if (data.byteLength <= CHUNK_BYTES) return [data];
  const out: Uint8Array[] = [];
  for (let o = 0; o < data.byteLength; o += CHUNK_BYTES) out.push(data.subarray(o, o + CHUNK_BYTES));
  return out;
}
