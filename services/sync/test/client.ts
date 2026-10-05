/**
 * Test helpers: token minting, grants on the fake identity service, and a
 * small sync client that speaks the wire protocol like the desktop app.
 */
import { env, SELF } from "cloudflare:test";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { bytesToB64url } from "../src/auth";
import {
  type AccessLevel,
  CH_COMMENTS,
  CH_CONTENT,
  MSG_ACK,
  MSG_AUTH_STATE,
  MSG_AWARENESS,
  MSG_NOTICE,
  MSG_SYNC,
  encodeAwareness,
  encodeUpdate,
} from "../src/protocol";

export const BASE = "https://sync.test";

let keyPromise: Promise<CryptoKey> | null = null;
function signingKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey("jwk", JSON.parse(env.TEST_PRIVATE_JWK), { name: "Ed25519" }, false, ["sign"]);
  return keyPromise;
}

export async function mintToken(sub: string, opts: { dev?: string; exp?: number; iat?: number; kid?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const header = enc({ alg: "EdDSA", typ: "JWT", kid: opts.kid ?? "test-key" });
  const payload = enc({ sub, dev: opts.dev ?? `${sub}-device`, iat: opts.iat ?? now, exp: opts.exp ?? now + 600 });
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, await signingKey(), new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function grant(userId: string, workspaceId: string, docId: string | null, level: AccessLevel) {
  await env.IDENTITY.fetch("https://identity/grant", { method: "POST", body: JSON.stringify({ userId, workspaceId, docId, level }) });
}

export async function identityDown(on: boolean) {
  await env.IDENTITY.fetch("https://identity/fail", { method: "POST", body: JSON.stringify({ on }) });
}

let unique = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(unique++).toString(36)}`;

export async function until(pred: () => boolean, what = "condition", timeout = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const syncUrl = (ws: string, doc: string) => `${BASE}/v1/workspaces/${ws}/docs/${doc}/sync`;

/** A desktop-like client: two Yjs docs, an outbox with acks, presence. */
export class TestClient {
  readonly content = new Y.Doc();
  readonly comments = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  ws: WebSocket | null = null;
  level: AccessLevel | null = null;
  notices: { code: string; message: string }[] = [];
  acks = new Map<number, { status: number; reason: string }>();
  closed: { code: number; reason: string } | null = null;
  synced = [false, false];
  private batch = 1;
  /** Updates made while offline, sent on reconnect (the outbox). */
  outbox: { channel: number; update: Uint8Array }[] = [];

  constructor(
    readonly userId: string,
    readonly workspaceId: string,
    readonly docId: string,
  ) {
    this.awareness = new awarenessProtocol.Awareness(this.content);
    const onLocal = (channel: number) => (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.synced[channel]) this.send(channel, update);
      else this.outbox.push({ channel, update });
    };
    this.content.on("update", onLocal(CH_CONTENT));
    this.comments.on("update", onLocal(CH_COMMENTS));
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const changed = [...added, ...updated, ...removed];
      this.ws.send(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
    });
  }

  send(channel: number, update: Uint8Array): number {
    const id = this.batch++;
    this.ws!.send(encodeUpdate(id, channel, update));
    return id;
  }

  async connect(opts: { token?: string; viaSubprotocol?: boolean } = {}): Promise<Response> {
    const token = opts.token ?? (await mintToken(this.userId));
    const headers: Record<string, string> = { upgrade: "websocket" };
    if (opts.viaSubprotocol) headers["sec-websocket-protocol"] = `worlds-sync.v1, bearer.${token}`;
    else headers.authorization = `Bearer ${token}`;
    const res = await SELF.fetch(syncUrl(this.workspaceId, this.docId), { headers });
    const ws = res.webSocket;
    if (!ws) return res;
    ws.binaryType = "arraybuffer";
    ws.accept();
    this.ws = ws;
    this.closed = null;
    this.synced = [false, false];
    ws.addEventListener("message", (e) => this.onMessage(new Uint8Array(e.data as ArrayBuffer)));
    ws.addEventListener("close", (e) => {
      this.closed = { code: e.code, reason: e.reason };
      this.synced = [false, false];
    });
    // Ask for what we are missing.
    for (const channel of [CH_CONTENT, CH_COMMENTS]) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_SYNC);
      encoding.writeVarUint(e, channel);
      encoding.writeVarUint(e, 0);
      encoding.writeVarUint8Array(e, Y.encodeStateVector(this.doc(channel)));
      ws.send(encoding.toUint8Array(e));
    }
    if (this.awareness.getLocalState()) ws.send(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.content.clientID])));
    return res;
  }

  disconnect() {
    this.ws?.close(1000, "bye");
    this.ws = null;
    this.synced = [false, false];
  }

  doc(channel: number) {
    return channel === CH_COMMENTS ? this.comments : this.content;
  }

  private onMessage(data: Uint8Array) {
    const d = decoding.createDecoder(data);
    const type = decoding.readVarUint(d);
    if (type === MSG_SYNC) {
      const channel = decoding.readVarUint(d);
      const kind = decoding.readVarUint(d);
      const payload = decoding.readVarUint8Array(d);
      const doc = this.doc(channel);
      if (kind === 0) {
        // Server asked: send everything it lacks, acknowledged (outbox drain).
        const diff = Y.encodeStateAsUpdate(doc, payload);
        this.send(channel, diff);
        this.outbox = this.outbox.filter((o) => o.channel !== channel);
        this.synced[channel] = true;
      } else {
        Y.applyUpdate(doc, payload, this);
      }
    } else if (type === MSG_AUTH_STATE) {
      this.level = decoding.readVarString(d) as AccessLevel;
    } else if (type === MSG_ACK) {
      const id = decoding.readVarUint(d);
      const status = decoding.readVarUint(d);
      const reason = decoding.readVarString(d);
      this.acks.set(id, { status, reason });
    } else if (type === MSG_NOTICE) {
      this.notices.push({ code: decoding.readVarString(d), message: decoding.readVarString(d) });
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), this);
    }
  }

  text(): string {
    return this.content.getText("t").toString();
  }

  destroy() {
    this.awareness.destroy();
    this.disconnect();
  }
}
