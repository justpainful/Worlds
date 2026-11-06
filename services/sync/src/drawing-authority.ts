import { affectedDrawingTargets, canonicalOperation, drawingLeaseCovers, drawingLeaseOverlaps, drawingLeaseTargets, importedDrawing } from "../../../src/drawing/canonical";
import { appendOperation } from "../../../src/drawing/operations";
import { type DrawingDocument, type DrawingOperation, type DrawingScene } from "../../../src/drawing/model";
import { drawingJson, DrawingWireError, validateDrawingDependencies, type DrawingDependencies, type DrawingLeaseProof, type DrawingWireSeed, type DrawingWireState, type DrawingWireVersion, type DrawingWireWrite } from "../../../src/drawing/wire";
export { validateDrawingDependencies } from "../../../src/drawing/wire";
import { ownsDrawingLease, type DrawingLease } from "./drawing-leases";
import { draftNode, type DrawingDraft } from "../../../src/drawing/drafts";
import { DEFAULT_EXPORT_RULES, validExportRules, validExportPolicy, type DrawingExportPolicy, type DrawingExportPolicyUpdate } from "../../../src/drawing/exportPolicy";
import {validateLibraryDirectory} from '../../../src/drawing/libraryPublication';
const MAX_BYTES = 64 * 1024 * 1024, CHUNK = 512 * 1024;
const emptyDependencies = (): DrawingDependencies => ({ attachments: {}, versions: {} });
export function drawingSourcesInDocument(doc: DrawingDocument): Set<string> {
  const ids = new Set<string>();
  for (const s of [doc.seed, doc.scene]) for (const asset of Object.values(s.assets)) ids.add(asset.attachmentId);
  for (const op of doc.operations) if (op.type === "edit") for (const change of op.changes) if (change.type === "put" && change.collection === "assets") { const a = change.value as { attachmentId?: string }; if (typeof a?.attachmentId === "string") ids.add(a.attachmentId); } else if (change.type === "patch" && change.collection === "assets" && typeof change.fields.attachmentId === "string") ids.add(change.fields.attachmentId);
  return ids;
}
function validateReferences(doc: DrawingDocument, dependencies: DrawingDependencies) {
  const originals = drawingSourcesInDocument(doc), scenes = [doc.seed, doc.scene, ...Object.values(dependencies.versions).map((v) => v.scene)];
  for (const s of scenes) {
    for (const a of Object.values(s.assets)) originals.add(a.attachmentId);
    for (const step of Object.values(s.steps)) if (step.pinnedVersionId && !Object.hasOwn(dependencies.versions, step.pinnedVersionId)) throw new DrawingWireError("invalid", "A pinned presentation version is missing");
  }
  for (const id of originals) if (!Object.hasOwn(dependencies.attachments, id)) throw new DrawingWireError("invalid", "An original has not been uploaded before its drawing reference");
}
interface Transactions { transactionSync<T>(fn: () => T): T }
/** Chunked SQLite persistence. Only newly accepted operations and immutable
 * dependencies are written; a stroke never rewrites the whole journal. */
export class DrawingAuthority {
  private cached: DrawingDocument | null | undefined;
  private dependencies: DrawingDependencies | undefined;
  constructor(private readonly sql: SqlStorage, private readonly storage: Transactions) {}
  migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS drawing_wire_chunks(kind TEXT NOT NULL, key TEXT NOT NULL, chunk INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(kind,key,chunk));
      CREATE TABLE IF NOT EXISTS drawing_receipts(id TEXT PRIMARY KEY, revision INTEGER UNIQUE NOT NULL, request_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drawing_policy_receipts(id TEXT PRIMARY KEY, request_hash TEXT NOT NULL);`);
  }
  private meta(key: string) { const row = [...this.sql.exec("SELECT value FROM meta WHERE key = ?", `drawing.${key}`)][0]; return row ? String(row.value) : null; }
  private setMeta(key: string, value: string) { this.sql.exec("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `drawing.${key}`, value); }
  private put(kind: string, key: string, value: unknown) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)); if (bytes.byteLength > MAX_BYTES) throw new DrawingWireError("invalid", "Drawing value exceeds the memory limit");
    for (let at = 0; at < bytes.length; at += CHUNK) this.sql.exec("INSERT INTO drawing_wire_chunks(kind,key,chunk,data) VALUES (?,?,?,?)", kind, key, at / CHUNK, bytes.slice(at, at + CHUNK));
  }
  private get(kind: string, key: string): unknown {
    const rows = [...this.sql.exec("SELECT data FROM drawing_wire_chunks WHERE kind = ? AND key = ? ORDER BY chunk", kind, key)]; if (!rows.length) return null;
    const chunks = rows.map((row) => { const raw: unknown = row.data; if (raw instanceof ArrayBuffer) return new Uint8Array(raw); if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength); throw new DrawingWireError("invalid", "Invalid stored drawing chunk"); }), length = chunks.reduce((n, c) => n + c.byteLength, 0);
    if (length > MAX_BYTES) throw new DrawingWireError("invalid", "Stored drawing value exceeds its size limit");
    const joined = new Uint8Array(length); let at = 0; for (const c of chunks) { joined.set(c, at); at += c.byteLength; } return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(joined));
  }
  document(): DrawingDocument | null {
    if (this.cached !== undefined) return this.cached;
    const seed = this.get("seed", "root") as DrawingScene | null;
    if (!seed) return this.cached = null;
    let doc: DrawingDocument = { revision: 0, seed, scene: seed, operations: [] };
    for (const row of this.sql.exec("SELECT id FROM drawing_receipts ORDER BY revision")) doc = appendOperation(doc, this.get("operation", String(row.id)) as DrawingOperation);
    this.cached = doc; return doc;
  }
  private directory(): DrawingDependencies {
    if (this.dependencies) return this.dependencies;
    const d = emptyDependencies();
    for (const row of this.sql.exec("SELECT DISTINCT kind,key FROM drawing_wire_chunks WHERE kind IN ('attachment','version')")) {
      if (row.kind === "attachment") d.attachments[String(row.key)] = this.get("attachment", String(row.key)) as DrawingDependencies["attachments"][string];
      else d.versions[String(row.key)] = this.get("version", String(row.key)) as DrawingWireVersion;
    }
    this.dependencies = d; return d;
  }
  private mergeDependencies(input: DrawingDependencies, actor: string): DrawingDependencies {
    validateDrawingDependencies(input); const old = this.directory(), next = { attachments: { ...old.attachments }, versions: { ...old.versions } };
    for (const [id, info] of Object.entries(input.attachments)) { if (next.attachments[id] && drawingJson(next.attachments[id]) !== drawingJson(info)) throw new DrawingWireError("conflict", "An original attachment identifier was reused"); next.attachments[id] = structuredClone(info); }
    for (const [id, version] of Object.entries(input.versions)) {
      const normalized = { ...structuredClone(version), author: version.scene.libraryPublication?actor:version.author === actor || version.author.startsWith("imported:") ? version.author : `imported:${version.author}` };
      if (next.versions[id]) { if (drawingJson(next.versions[id]) !== drawingJson(version) && drawingJson(next.versions[id]) !== drawingJson(normalized)) throw new DrawingWireError("conflict", "A saved drawing version identifier was reused"); }
      else next.versions[id] = normalized;
    }
    validateDrawingDependencies(next);
    try{const document=[...this.sql.exec("SELECT value FROM meta WHERE key = ?",'doc')][0];validateLibraryDirectory(next.versions,String(document?.value??''));}catch(error){throw new DrawingWireError('invalid',error instanceof Error?error.message:'Invalid library publication history');}
    return next;
  }
  private persistDependencies(next: DrawingDependencies) {
    const old = this.directory(); let added = false;
    for (const [id, info] of Object.entries(next.attachments)) if (!old.attachments[id]) { this.put("attachment", id, info); added = true; }
    for (const [id, version] of Object.entries(next.versions)) if (!old.versions[id]) { this.put("version", id, version); added = true; }
    if (added) this.setMeta("dependencyRevision", String(Number(this.meta("dependencyRevision") ?? 0) + 1));
  }
  initialize(input: DrawingWireSeed, actor: string): DrawingWireState {
    if (this.document()) return this.state();
    if (input.exportPolicy !== undefined && !validExportRules(input.exportPolicy)) throw new DrawingWireError("invalid","Invalid drawing export policy");
    const doc = importedDrawing(input.document, input.localActor, actor), dependencies = this.mergeDependencies(input, actor); validateReferences(doc, dependencies);
    this.storage.transactionSync(() => {
      this.put("seed", "root", doc.seed); this.setMeta("generation", crypto.randomUUID()); this.setMeta("revision", String(doc.revision));
      if (!this.meta("exportPolicy")) this.setMeta("exportPolicy",JSON.stringify({revision:0,rules:input.exportPolicy ?? DEFAULT_EXPORT_RULES}));
      for (const op of doc.operations) { this.put("operation", op.id, op); this.sql.exec("INSERT INTO drawing_receipts(id, revision, request_hash) VALUES (?,?,?)", op.id, op.base + 1, "imported"); }
      this.persistDependencies(dependencies);
    });
    this.cached = doc; this.dependencies = dependencies; return this.state();
  }
  exportPolicy(): DrawingExportPolicy { const raw=this.meta("exportPolicy"), policy=raw ? JSON.parse(raw) : {revision:0,rules:{...DEFAULT_EXPORT_RULES}}; if(!validExportPolicy(policy)) throw new DrawingWireError("invalid","Invalid stored export policy");return policy; }
  hasExportPolicy(){return this.meta("exportPolicy")!==null;}
  generation(){return this.meta("generation");}
  initializeExportPolicy(rules:unknown){if(!validExportRules(rules))throw new DrawingWireError("invalid","Invalid initial export policy");if(!this.hasExportPolicy())this.setMeta("exportPolicy",JSON.stringify({revision:0,rules}));}
  setExportPolicy(input: DrawingExportPolicyUpdate, actor: string): DrawingExportPolicy {
    if(!input || typeof input.requestId!=="string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<0 || !validExportRules(input.rules)) throw new DrawingWireError("invalid","Invalid export policy update");
    const hash=drawingJson({actor,expectedRevision:input.expectedRevision,rules:input.rules}), old=[...this.sql.exec("SELECT request_hash FROM drawing_policy_receipts WHERE id=?",input.requestId)][0],current=this.exportPolicy();
    if(old){if(old.request_hash!==hash)throw new DrawingWireError("conflict","Export policy request identifier was reused");return current;}
    if(current.revision!==input.expectedRevision)throw new DrawingWireError("conflict","The export policy changed. Review the latest policy before saving.");
    if(current.revision>=Number.MAX_SAFE_INTEGER)throw new DrawingWireError("invalid","Export policy revision limit reached");
    const next={revision:current.revision+1,rules:structuredClone(input.rules)};
    this.storage.transactionSync(()=>{this.setMeta("exportPolicy",JSON.stringify(next));this.sql.exec("INSERT INTO drawing_policy_receipts(id,request_hash) VALUES (?,?)",input.requestId,hash);});return next;
  }
  apply(input: DrawingWireWrite, actor: string, device: string, requestHash: string): DrawingWireState {
    const doc = this.document(); if (!doc) throw new DrawingWireError("missing", "This shared drawing has not been initialized");
    if (input.generation !== this.meta("generation")) throw new DrawingWireError("conflict", "This drawing belongs to another shared generation");
    const dependencies = this.mergeDependencies(input, actor), incoming = input.operation;
    let next = doc, canonical: DrawingOperation | undefined;
    if (incoming) {
      if (incoming.actor !== actor) throw new DrawingWireError("denied", "The drawing operation belongs to another author");
      const old = [...this.sql.exec("SELECT request_hash FROM drawing_receipts WHERE id = ?", incoming.id)][0];
      if (old) {
        const previous = doc.operations.find((op) => op.id === incoming.id);
        if (String(old.request_hash) !== requestHash && !(old.request_hash === "imported" && drawingJson(previous) === drawingJson(incoming))) throw new DrawingWireError("conflict", "Drawing operation identifier was reused");
      } else {
        canonical = canonicalOperation(doc, incoming, actor, input.preconditions);
        this.checkLocks(doc, canonical, input.leases ?? [], actor, device);
        next = appendOperation(doc, canonical, actor);
      }
    }
    validateReferences(next, dependencies);
    this.storage.transactionSync(() => {
      this.persistDependencies(dependencies);
      if (canonical) { this.put("operation", canonical.id, canonical); this.sql.exec("INSERT INTO drawing_receipts(id,revision,request_hash) VALUES (?,?,?)", canonical.id, next.revision, requestHash); this.setMeta("revision", String(next.revision)); }
    });
    this.cached = next; this.dependencies = dependencies; return this.state(input.generation, incoming?.base);
  }
  private checkLocks(doc: DrawingDocument, operation: DrawingOperation, proofs: DrawingLeaseProof[], actor: string, device: string) {
    if (!Array.isArray(proofs) || proofs.length > 256) throw new DrawingWireError("invalid", "Invalid drawing lease proofs");
    const active = [...this.sql.exec("SELECT data FROM drawing_leases")].map((row) => JSON.parse(String(row.data)) as DrawingLease).filter((l) => l.expiresAt > Date.now());
    const owned = active.filter((lease) => proofs.some((proof) => ownsDrawingLease(lease, proof, actor, device, Date.now())));
    const next = appendOperation(doc, operation), affected = affectedDrawingTargets(doc, operation);
    for (const lease of active) if (!owned.includes(lease) && affected.some((target) => drawingLeaseOverlaps(doc.scene, lease.target, target) || drawingLeaseOverlaps(next.scene, lease.target, target))) throw new DrawingWireError("lease", "A drawing lease held elsewhere protects this region");
    for (const target of drawingLeaseTargets(doc, operation)) if (!owned.some((lease) => drawingLeaseCovers(doc.scene, lease.target, target))) throw new DrawingWireError("lease", "A current fenced lease is required for this drawing change");
    if (operation.type === "edit") for (const change of operation.changes) if (change.type === "put" && change.collection === "nodes" || change.type === "patch" && change.collection === "nodes") {
      const node = change.type === "put" ? change.value as DrawingScene["nodes"][string] : doc.scene.nodes[change.id], layer = node && doc.scene.layers[node.layerId];
      if (layer?.locked) throw new DrawingWireError("lease", "Unlock the drawing layer before editing its elements");
      if (node?.locked && change.type === "patch" && change.fields.locked !== false) throw new DrawingWireError("lease", "Unlock the drawing element before editing it");
    }
  }
  previewAllowed(draft: DrawingDraft, user: string, device: string): boolean {
    const doc = this.document(), active = [...this.sql.exec("SELECT data FROM drawing_leases")].map((row) => JSON.parse(String(row.data)) as DrawingLease).filter((lease) => lease.expiresAt > Date.now());
    const own = (lease: DrawingLease) => lease.userId === user && lease.deviceId === device;
    if (draft.kind === "move" || draft.kind === "transform") return !!doc && !!draft.nodeIds?.every((id) => { const node = doc.scene.nodes[id], layer = node && doc.scene.layers[node.layerId]; return !!node && !node.locked && !layer?.locked && !layer?.positionLocked && active.some((lease) => own(lease) && drawingLeaseCovers(doc.scene, lease.target, `node:${id}`)); });
    if (!doc) return true;
    const node = draftNode(draft, doc.scene); if (!node || doc.scene.layers[node.layerId]?.locked) return false;
    if (!active.some((lease) => !own(lease))) return true;
    const preview = { ...doc.scene, nodes: { ...doc.scene.nodes, [node.id]: node } };
    return !active.some((lease) => !own(lease) && drawingLeaseOverlaps(preview, lease.target, `node:${node.id}`));
  }
  leaseOverlaps(a: string, b: string): boolean { const doc = this.document(); return a === b || a === "drawing:root" || b === "drawing:root" || !!doc && drawingLeaseOverlaps(doc.scene, a, b); }
  state(generation?: string, after?: number): DrawingWireState {
    const doc = this.document(); if (!doc) throw new DrawingWireError("missing", "This shared drawing has not been initialized");
    const current = this.meta("generation")!, incremental = generation === current && Number.isSafeInteger(after) && after! >= 0 && after! <= doc.revision;
    return { generation: current, revision: doc.revision, dependencyRevision: Number(this.meta("dependencyRevision") ?? 0), ...structuredClone(this.directory()), ...(incremental ? { operations: structuredClone(doc.operations.slice(after)) } : { document: structuredClone(doc) }) };
  }
}
