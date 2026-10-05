/**
 * An in-memory stand-in for the sync service, speaking the same wire
 * protocol over fake sockets. Used by the provider tests; it mirrors the
 * Durable Object's rules (persist before ack, per-level writes, presence).
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import type { SocketLike } from "./provider";
import {
  ACK_DENIED,
  ACK_OK,
  type AccessLevel,
  CH_COMMENTS,
  CH_CONTENT,
  CLOSE_REVOKED,
  MSG_AUTH_REFRESH,
  MSG_AWARENESS,
  MSG_SYNC,
  MSG_UPDATE,
  canWrite,
  encodeAck,
  encodeAuthState,
  encodeAwareness,
} from "./protocol";

const OPEN = 1;
const CLOSED = 3;

export class FakeSocket implements SocketLike {
  binaryType = "arraybuffer";
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  peer: ServerConn | null = null;
  sent = 0;

  send(data: Uint8Array | string) {
    if (this.readyState !== OPEN) throw new Error("socket not open");
    this.sent++;
    const copy = typeof data === "string" ? data : data.slice();
    const peer = this.peer;
    queueMicrotask(() => peer?.receive(copy));
  }

  close(code = 1000, reason = "") {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    const peer = this.peer;
    this.peer = null;
    peer?.closedByClient();
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }

  /** Server side: deliver a frame. */
  deliver(data: Uint8Array | string) {
    if (this.readyState !== OPEN) return;
    const payload = typeof data === "string" ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    queueMicrotask(() => this.onmessage?.({ data: payload }));
  }

  /** Server side: drop the connection. */
  drop(code: number, reason = "") {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.peer = null;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

export class ServerConn {
  constructor(
    readonly server: FakeSyncServer,
    readonly socket: FakeSocket,
    readonly userId: string,
    public level: AccessLevel,
  ) {}
  clients = new Set<number>();

  receive(data: Uint8Array | string) {
    this.server.onMessage(this, data);
  }
  send(frame: Uint8Array | string) {
    this.socket.deliver(frame);
  }
  closedByClient() {
    this.server.drop(this);
  }
}

export class FakeSyncServer {
  docs = [new Y.Doc(), new Y.Doc()];
  levels = new Map<string, AccessLevel>();
  conns = new Set<ServerConn>();
  awareness = new Map<number, Uint8Array>();
  /** Every accepted write, in order (what the Durable Object persists). */
  log: { channel: number; userId: string; update: Uint8Array }[] = [];
  /** When false, connection attempts fail like an unreachable host. */
  up = true;
  connects = 0;
  tokens: (string | null)[] = [];
  /** Tokens handed to open connections (MSG_AUTH_REFRESH). */
  refreshed: string[] = [];

  /** Socket factory for a provider acting as `userId`. */
  socketFor(userId: string) {
    return (_url: string, protocols: string[]): SocketLike => {
      const sock = new FakeSocket();
      this.tokens.push(protocols.find((p) => p.startsWith("bearer."))?.slice(7) ?? null);
      queueMicrotask(() => this.accept(sock, userId));
      return sock;
    };
  }

  private accept(sock: FakeSocket, userId: string) {
    this.connects++;
    const level = this.levels.get(userId) ?? "none";
    if (!this.up || level === "none") {
      sock.drop(1006, "");
      return;
    }
    const conn = new ServerConn(this, sock, userId, level);
    sock.peer = conn;
    sock.readyState = OPEN;
    this.conns.add(conn);
    sock.onopen?.({});
    conn.send(encodeAuthState(level, userId));
    for (const ch of [CH_CONTENT, CH_COMMENTS]) conn.send(this.syncFrame(ch, 0, Y.encodeStateVector(this.docs[ch])));
    for (const u of this.awareness.values()) conn.send(encodeAwareness(u));
  }

  syncFrame(channel: number, kind: number, payload: Uint8Array) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_SYNC);
    encoding.writeVarUint(e, channel);
    encoding.writeVarUint(e, kind);
    encoding.writeVarUint8Array(e, payload);
    return encoding.toUint8Array(e);
  }

  drop(conn: ServerConn) {
    this.conns.delete(conn);
    // Like the Durable Object: a closed connection's presence goes away.
    const gone = [...conn.clients].filter((id) => this.awareness.has(id));
    if (!gone.length) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, gone.length);
    for (const id of gone) {
      this.awareness.delete(id);
      encoding.writeVarUint(e, id);
      encoding.writeVarUint(e, 1 << 30);
      encoding.writeVarString(e, "null");
    }
    const update = encoding.toUint8Array(e);
    for (const c of this.conns) c.send(encodeAwareness(update));
  }

  onMessage(conn: ServerConn, data: Uint8Array | string) {
    if (typeof data === "string") {
      if (data === "ping") conn.send("pong");
      return;
    }
    const d = decoding.createDecoder(data);
    const type = decoding.readVarUint(d);
    if (type === MSG_SYNC) {
      const ch = decoding.readVarUint(d);
      const kind = decoding.readVarUint(d);
      const payload = decoding.readVarUint8Array(d);
      if (kind === 0) conn.send(this.syncFrame(ch, 1, Y.encodeStateAsUpdate(this.docs[ch], payload)));
      else this.write(conn, ch, payload);
    } else if (type === MSG_UPDATE) {
      const batch = decoding.readVarUint(d);
      const ch = decoding.readVarUint(d);
      const payload = decoding.readVarUint8Array(d);
      const ok = this.write(conn, ch, payload);
      conn.send(encodeAck(batch, ok ? ACK_OK : ACK_DENIED, ok ? "" : `${conn.level} access cannot write`));
    } else if (type === MSG_AUTH_REFRESH) {
      this.refreshed.push(decoding.readVarString(d));
    } else if (type === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(d);
      const dd = decoding.createDecoder(update);
      const n = decoding.readVarUint(dd);
      for (let i = 0; i < n; i++) {
        const id = decoding.readVarUint(dd);
        decoding.readVarUint(dd);
        const state = decoding.readVarString(dd);
        conn.clients.add(id);
        if (state === "null") this.awareness.delete(id);
        else this.awareness.set(id, update);
      }
      for (const c of this.conns) if (c !== conn) c.send(encodeAwareness(update));
    }
  }

  private write(conn: ServerConn, ch: number, update: Uint8Array): boolean {
    const doc = this.docs[ch];
    let changed = false;
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    scratch.on("update", () => (changed = true));
    Y.applyUpdate(scratch, update);
    if (!changed) return true;
    if (!canWrite(conn.level, ch)) return false;
    Y.applyUpdate(doc, update);
    this.log.push({ channel: ch, userId: conn.userId, update });
    for (const c of this.conns) if (c !== conn) c.send(this.syncFrame(ch, 2, update));
    return true;
  }

  /** Close every connection as if the network dropped. */
  dropAll(code = 1006) {
    for (const c of [...this.conns]) {
      this.conns.delete(c);
      c.socket.drop(code);
    }
  }

  revoke(userId: string) {
    this.levels.set(userId, "none");
    for (const c of [...this.conns]) {
      if (c.userId !== userId) continue;
      this.conns.delete(c);
      c.socket.drop(CLOSE_REVOKED, "access revoked");
    }
  }

  text(field = "t") {
    return this.docs[CH_CONTENT].getText(field).toString();
  }
}

