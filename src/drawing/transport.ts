import {validateLibraryDirectory} from "./libraryPublication";
import * as Y from "yjs";
import { AttachmentSync, sha256Hex, type LocalFile } from "../sync/attachments";
import { canonicalOperation, drawingLeaseTargets, validateDrawingDocument } from "./canonical";
import { DrawingGestureLeases } from "./gestureLeases";
import { appendOperation } from "./operations";
import type { DrawingReplica, DrawingCheckpointResult } from "./replica";
import { drawingJson, DrawingWireError, validateDrawingDependencies, type DrawingAssetInfo, type DrawingDependencies, type DrawingLeaseProof, type PublicDrawingLease, type DrawingWireState } from "./wire";
export interface DrawingTransportIO {
  snapshot: () => Promise<DrawingReplica>;
  checkpoint: (state: DrawingWireState) => Promise<DrawingCheckpointResult>;
  status: (status: DrawingReplica["status"], error: string) => Promise<void>;
  readOriginal: (id: string) => Promise<LocalFile | null>;
  storeOriginal: (id: string, info: DrawingAssetInfo, bytes: Uint8Array) => Promise<void>;
}
export interface DrawingTransportInfo { status: "connecting" | DrawingReplica["status"]; pending: number; error: string | null; level: DrawingReplica["level"]; revision: number | null; leases?: PublicDrawingLease[] }
/** Read no more than the already validated original size, even if the server
 * sends a misleading Content-Length or an indefinitely growing response. */
async function readDrawingOriginal(response: Response, size: number, signal: AbortSignal): Promise<Uint8Array> {
  const advertised = response.headers.get("content-length");
  const contentEncoding = response.headers.get("content-encoding");
  if (advertised !== null && !contentEncoding && (!/^\d+$/.test(advertised) || Number(advertised) !== size)) throw new DrawingWireError("invalid", "Downloaded drawing original has an unexpected size");
  if (!response.body) throw new DrawingWireError("unavailable", "Could not read the drawing original stream");
  let result: Uint8Array;
  try { result = new Uint8Array(size); }
  catch { throw new DrawingWireError("unavailable", "Not enough memory to download this drawing original. Close other work and retry."); }
  const reader = response.body.getReader(); let offset = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      const { value, done } = await reader.read();
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      if (done) break;
      if (offset + value.byteLength > size) throw new DrawingWireError("invalid", "Downloaded drawing original exceeds its declared size");
      result.set(value, offset); offset += value.byteLength;
    }
    if (offset !== size) throw new DrawingWireError("invalid", "Downloaded drawing original is incomplete");
    return result;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
interface Options { pageId: string; workspaceId: string; serverUrl: string; userId: string; io: DrawingTransportIO; getToken: (refresh?: boolean) => Promise<string | null>; fetcher?: typeof fetch; onInfo?: (info: DrawingTransportInfo) => void }
export function mergeDrawingWire(previous: DrawingWireState | null, incoming: DrawingWireState): DrawingWireState {
  validateDrawingDependencies(incoming);
  if (typeof incoming.generation !== "string" || !Number.isSafeInteger(incoming.revision) || incoming.revision < 0 || !Number.isSafeInteger(incoming.dependencyRevision) || incoming.dependencyRevision < 0) throw new DrawingWireError("invalid", "Invalid shared drawing checkpoint");
  if (previous) {
    if (incoming.generation !== previous.generation || incoming.revision < previous.revision || incoming.dependencyRevision < previous.dependencyRevision) throw new DrawingWireError("conflict", "Shared drawing checkpoint moved backwards or changed generation");
    for (const collection of ["attachments", "versions"] as const) for (const [id, value] of Object.entries(previous[collection])) if (drawingJson(incoming[collection][id]) !== drawingJson(value)) throw new DrawingWireError("conflict", "Immutable drawing dependency changed or disappeared");
    if (incoming.dependencyRevision === previous.dependencyRevision && (drawingJson(incoming.attachments) !== drawingJson(previous.attachments) || drawingJson(incoming.versions) !== drawingJson(previous.versions))) throw new DrawingWireError("conflict", "Drawing dependencies changed without a new revision");
  }
  let document = incoming.document;
  if (!document) {
    if (!previous?.document || incoming.generation !== previous.generation || !Array.isArray(incoming.operations)) throw new DrawingWireError("conflict", "Shared drawing checkpoint generation changed");
    document = previous.document;
    for (const op of incoming.operations) { if (op.base < document.revision) { const old = document.operations.find((item) => item.id === op.id); if (drawingJson(old) !== drawingJson(op)) throw new DrawingWireError("conflict", "Immutable shared drawing history changed"); } else document = appendOperation(document, op); }
  }
  if (document.revision !== incoming.revision) throw new DrawingWireError("invalid", "Shared drawing checkpoint has missing operations");
  validateDrawingDocument(document);
  if (previous?.document && (drawingJson(previous.document.seed) !== drawingJson(document.seed) || drawingJson(previous.document.operations) !== drawingJson(document.operations.slice(0, previous.document.revision)))) throw new DrawingWireError("conflict", "Immutable shared drawing history changed");
  return { ...incoming, document, operations: undefined };
}

/** Network work is separate from pointer input and the native durable writer.
 * One in-flight turn drains acknowledged operations before taking the next one. */
export class DrawingTransport {
  private stopped = false;
  private running: Promise<void> | null = null;
  private recovering: Promise<unknown> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private abort = new AbortController();
  private verified = new Map<string, string>();
  private uploaded = new Map<string, DrawingAssetInfo>();
  private filesDoc = new Y.Doc();
  private files: AttachmentSync;
  private level: DrawingReplica["level"] = "none";
  private pixelGuards=0;
  private libraryPublications=false;
  private strictDrawingBase=false;
  readonly gestures: DrawingGestureLeases;
  private leases: PublicDrawingLease[] = [];
  private info(value: DrawingTransportInfo) { this.o.onInfo?.({ ...value, leases: this.leases }); }
  constructor(private readonly o: Options) {
    this.gestures = new DrawingGestureLeases({ request: async (body) => (await this.request("drawing/leases", "POST", body)).lease ?? null });
    this.files = new AttachmentSync(this.filesDoc, { serverUrl: o.serverUrl, workspaceId: o.workspaceId, docId: o.pageId, getToken: () => o.getToken(), readLocal: o.io.readOriginal, storeLocal: o.io.storeOriginal, fetcher: this.fetch });
  }
  private fetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url, this.o.serverUrl).origin !== new URL(this.o.serverUrl).origin) throw new DrawingWireError("denied", "Drawing original transfer returned another server origin");
    return (this.o.fetcher ?? fetch)(input, { ...init, signal: init?.signal ? AbortSignal.any([this.abort.signal, init.signal]) : this.abort.signal });
  };
  private path(path: string) { return `${this.o.serverUrl.replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(this.o.workspaceId)}/docs/${encodeURIComponent(this.o.pageId)}/${path}`; }
  private async request(path: string, method = "GET", body?: unknown, refreshed = false): Promise<{ state?: DrawingWireState; lease?: DrawingLeaseProof; leases?: PublicDrawingLease[] }> {
    if (this.stopped) throw new DOMException("Stopped", "AbortError");
    const token = await this.o.getToken(refreshed); if (!token) throw new DrawingWireError("unavailable", "Sign in to synchronize this drawing");
    const r = await this.fetch(this.path(path), { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: path === "drawing/leases" ? AbortSignal.timeout(8000) : undefined });
    if (r.status === 401 && !refreshed) return this.request(path, method, body, true);
    const value = await r.json().catch(() => ({})) as { error?: string; code?: string; state?: DrawingWireState; lease?: DrawingLeaseProof; leases?: PublicDrawingLease[]; level?: DrawingReplica["level"];capabilities?:{pixelSourceGuards?:number;libraryPublications?:number;strictDrawingBase?:number} };
    if(path.startsWith("drawing/state"))this.pixelGuards=Number.isSafeInteger(value.capabilities?.pixelSourceGuards)?value.capabilities!.pixelSourceGuards!:0;
    if(path.startsWith("drawing/state"))this.strictDrawingBase=Number.isSafeInteger(value.capabilities?.strictDrawingBase)&&(value.capabilities?.strictDrawingBase??0)>=1;
    if(path.startsWith("drawing/state"))this.libraryPublications=Number.isSafeInteger(value.capabilities?.libraryPublications)&&(value.capabilities?.libraryPublications??0)>=1;
    if (!r.ok) throw new DrawingWireError(r.status === 404 ? "missing" : [401, 403].includes(r.status) ? "denied" : r.status === 423 || r.status === 409 && path === "drawing/leases" ? "lease" : r.status === 409 ? "conflict" : r.status >= 500 ? "unavailable" : "invalid", value.error ?? `Drawing synchronization failed (${r.status})`);
    if (value.level && ["none", "view", "comment", "edit", "full"].includes(value.level)) this.level = value.level;
    return value;
  }
  start() { if (this.stopped || this.timer) return; this.timer = setInterval(() => void this.tick(), 1000); void this.tick(); }
  stop() { this.gestures.stop(); this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.abort.abort(); this.filesDoc.destroy(); }
  async beginGesture(targets: string[]) { const replica = await this.o.io.snapshot(); if (!["edit", "full"].includes(replica.level) || ["view", "comment"].includes(this.level)) throw new DrawingWireError("denied", "Edit access is required to move this element"); return this.gestures.begin(targets, replica.remote?.document?.scene ?? replica.document.scene); }
  async tick(): Promise<void> {
    if (this.stopped || this.recovering) return; if (this.running) return this.running;
    this.running = this.turn().catch((error) => this.report(error)).finally(() => { this.running = null; });
    return this.running;
  }
  private async report(error: unknown) {
      if (this.stopped || (error instanceof DOMException && error.name === "AbortError")) return;
      const code = error instanceof DrawingWireError ? error.code : "unavailable", status = code === "conflict" || code === "invalid" ? "conflict" : code === "denied" ? "denied" : code === "lease" ? "pending" : "offline";
      const replica = await this.o.io.snapshot().catch(() => null), message = error instanceof Error ? error.message : String(error);
      await this.o.io.status(status, message).catch(() => {}); this.info({ status, pending: replica?.pending.length ?? 0, error: message, level: code === "denied" ? "none" : this.level, revision: replica?.remote?.revision ?? null });
  }
  recover<T>(work: (state: DrawingWireState) => Promise<T>): Promise<T> {
    if (this.recovering) return Promise.reject(new Error("Drawing recovery is already running"));
    const running = (async () => {
      // Drain network work before entering the session gate: a running turn may
      // itself be waiting for a session checkpoint.
      await this.running;
      const replica = await this.o.io.snapshot(), reply = (await this.request("drawing/state")).state;
      if (!reply) throw new DrawingWireError("invalid", "The server did not return a recovery checkpoint");
      const state = mergeDrawingWire(replica.remote, reply);if(!this.strictDrawingBase&&state.document?.operations.some(op=>op.type==="edit"&&op.requiresBase))throw new DrawingWireError("unavailable","Update the synchronization service before receiving source-checked drawing history."); this.checkPublications(state); await this.download(state);
      const result = await work(state);
      await this.o.io.status("synced", ""); this.info({ status: "synced", pending: 0, error: null, level: this.level, revision: state.revision }); return result;
    })().catch(async (error) => { await this.report(error); throw error; }).finally(() => { this.recovering = null; });
    this.recovering = running; return running;
  }
  private async download(state: DrawingWireState) {
    for (const [id, info] of Object.entries(state.attachments)) {
      if (this.verified.get(id) === info.sha256) continue;
      const local = await this.o.io.readOriginal(id);
      let bytes: Uint8Array;
      if (local) { bytes = local.bytes; if (bytes.length !== info.size || await sha256Hex(bytes) !== info.sha256) throw new DrawingWireError("conflict", "A local original identifier has different content"); }
      else {
        const token = await this.o.getToken(); if (!token) throw new DrawingWireError("unavailable", "Sign in to download drawing originals");
        const r = await this.fetch(this.path(`attachments/${info.sha256}`), { headers: { authorization: `Bearer ${token}` } }); if (!r.ok) throw new DrawingWireError(r.status === 403 ? "denied" : "unavailable", "A drawing original could not be downloaded");
        const { url } = await r.json() as { url: string }, got = await this.fetch(url); if (!got.ok) throw new Error("Drawing original download failed"); bytes = await readDrawingOriginal(got, info.size, this.abort.signal);
        if (bytes.length !== info.size || await sha256Hex(bytes) !== info.sha256) throw new DrawingWireError("invalid", "Downloaded drawing original checksum does not match");
      }
      try { await this.o.io.storeOriginal(id, info, bytes); }
      catch (error) {
        if (/no space|disk full|not enough space|quota|storage full/i.test(error instanceof Error ? error.message : String(error))) throw new DrawingWireError("unavailable", "Could not save the drawing original. Free storage space and retry.");
        throw error;
      }
      this.verified.set(id, info.sha256);
    }
  }
  private checkPublications(state:DrawingWireState){
    if(!this.libraryPublications&&Object.values(state.versions).some(version=>version.scene.libraryPublication))throw new DrawingWireError("unavailable","Update the synchronization service before receiving library metadata. The local drawing remains unchanged.");
    try{validateLibraryDirectory(state.versions,this.o.pageId);}catch(error){throw new DrawingWireError("invalid",error instanceof Error?error.message:"Invalid library metadata");}
  }
  private async dependencies(replica: DrawingReplica, remote: DrawingWireState | null): Promise<DrawingDependencies> {
    if(!this.libraryPublications&&Object.values(replica.versions).some(version=>version.scene.libraryPublication))throw new DrawingWireError("unavailable","Update the synchronization service before publishing library metadata. This publication remains local.");
    const attachments: DrawingDependencies["attachments"] = {}, versions: DrawingDependencies["versions"] = {};
    for (const id of replica.attachmentIds) {
      if (remote?.attachments[id]) continue;
      let info = this.uploaded.get(id);
      if (!info) { const file = await this.o.io.readOriginal(id); if (!file) throw new DrawingWireError("invalid", "An original referenced by this drawing is missing locally"); info = await this.files.upload(id, file); await this.o.io.storeOriginal(id, info, file.bytes); this.verified.set(id, info.sha256); this.uploaded.set(id, info); }
      attachments[id] = info;
    }
    for (const [id, version] of Object.entries(replica.versions)) {
      if (remote?.versions[id]) { if (drawingJson(remote.versions[id].scene) !== drawingJson(version.scene)) throw new DrawingWireError("conflict", "Saved drawing version identifier has different content"); continue; }
      versions[id] = { ...version, author: version.author === replica.localActor ? replica.userId : version.author.replace(/^remote:/, "") };
    }
    return { attachments, versions };
  }
  private async accept(replica: DrawingReplica, reply: DrawingWireState): Promise<boolean> {
    const state = mergeDrawingWire(replica.remote, reply);if(!this.strictDrawingBase&&state.document?.operations.some(op=>op.type==="edit"&&op.requiresBase))throw new DrawingWireError("unavailable","Update the synchronization service before receiving source-checked drawing history."); this.checkPublications(state); await this.download(state);
    const result = await this.o.io.checkpoint(state); if (result.status === "conflict") throw new DrawingWireError("conflict", "An offline drawing edit conflicts with shared changes. Your copy is preserved."); if (result.status === "accepted") this.gestures.acknowledge(state.document!.operations.map((op) => op.id)); return result.status === "accepted";
  }
  private async turn() {
    let replica = await this.o.io.snapshot(); this.level = replica.level;
    if (replica.status === "conflict") { this.info({ status: "conflict", pending: replica.pending.length, error: replica.error, level: replica.level, revision: replica.remote?.revision ?? null }); return; }
    this.info({ status: "connecting", pending: replica.pending.length, error: null, level: replica.level, revision: replica.remote?.revision ?? null });
    let reply: DrawingWireState;
    try { const cursor = replica.remote ? `?generation=${encodeURIComponent(replica.remote.generation)}&after=${replica.remote.revision}` : ""; reply = (await this.request(`drawing/state${cursor}`)).state!; }
    catch (e) {
      if (!(e instanceof DrawingWireError) || e.code !== "missing") throw e;
      if (replica.remote) throw new DrawingWireError("conflict", "The previously shared drawing is missing. Keep the local recovery copy.");
      if (!["edit", "full"].includes(replica.level)) { await this.o.io.status("pending", "Waiting for an editor to publish this drawing"); return; }
      if(!this.strictDrawingBase&&replica.basis.operations.some(op=>op.type==="edit"&&op.requiresBase))throw new DrawingWireError("unavailable","Update the synchronization service before publishing source-checked history. Your drawing remains local.");
      if(replica.basis.operations.some(op=>op.type==="edit"&&op.pixelGuard&&this.pixelGuards<(op.pixelGuard.expected.ancestors?.length?2:1)))throw new DrawingWireError("unavailable","Update the drawing synchronization service before publishing pixel-edit history. Your drawing remains local.");
      reply = (await this.request("drawing/state", "PUT", { document: replica.basis, localActor: replica.localActor, exportPolicy: replica.exportPolicy, ...await this.dependencies(replica, null) })).state!;
    }
    if (!reply) throw new DrawingWireError("invalid", "The server did not return a drawing checkpoint");
    const listed = (await this.request("drawing/leases")).leases ?? [], mine = this.gestures.proofs();
    this.leases = listed.map(({ target, userId, deviceId, fence, expiresAt }) => ({ target, userId, deviceId, fence, expiresAt, mine: mine.some((proof) => proof.target === target && proof.fence === fence) }));
    const unchanged = replica.remote?.generation === reply.generation && replica.remote.revision === reply.revision && replica.remote.dependencyRevision === reply.dependencyRevision;
    if (!unchanged && !await this.accept(replica, reply)) return;
    replica = await this.o.io.snapshot();
    if (!replica.remote?.document) return;
    if (!["edit", "full"].includes(this.level)) { await this.o.io.status(replica.pending.length ? "denied" : "synced", replica.pending.length ? "Edit access was removed; pending work remains in local recovery" : ""); this.info({ status: replica.pending.length ? "denied" : "synced", pending: replica.pending.length, error: replica.pending.length ? "Edit access was removed; pending work is retained" : null, level: this.level, revision: replica.remote.revision }); return; }
    // Bounded draining keeps a large offline queue from monopolizing the UI.
    for (let count = 0; count < 20 && !this.stopped; count++) {
      const pending = replica.pending[0],operation = pending ? { ...pending.operation, actor: replica.userId } : undefined;
      if(operation?.type==="edit"&&operation.requiresBase&&!this.strictDrawingBase)throw new DrawingWireError("unavailable","Update the synchronization service before sending a source-checked edit. Your edit remains local.");
      if(operation?.type==="edit"&&operation.pixelGuard&&this.pixelGuards<(operation.pixelGuard.expected.ancestors?.length?2:1))throw new DrawingWireError("unavailable","Update the drawing synchronization service before sending destructive pixel edits. Your edit remains local.");
      const dependencies=await this.dependencies(replica,replica.remote);
      if(!pending&&!Object.keys(dependencies.attachments).length&&!Object.keys(dependencies.versions).length)break;
      const canonical = operation ? canonicalOperation(replica.remote!.document!, operation, replica.userId, pending.preconditions) : undefined;
      const targets = canonical ? drawingLeaseTargets(replica.remote!.document!, canonical) : [];
      const hold = targets.length ? await this.gestures.begin(targets, replica.remote!.document!.scene) : null;
      try {
        const incoming = (await this.request("drawing/operations", "POST", { generation: replica.remote!.generation, operation, preconditions: pending?.preconditions, leases: this.gestures.proofs(), ...dependencies })).state;
        if (!incoming || !await this.accept(replica, incoming)) return;
      } finally { hold?.cancel(); }
      replica = await this.o.io.snapshot();
    }
    const pending = replica.pending.length; await this.o.io.status(pending ? "pending" : "synced", ""); this.info({ status: pending ? "pending" : "synced", pending, error: null, level: this.level, revision: replica.remote?.revision ?? null });
  }
}
