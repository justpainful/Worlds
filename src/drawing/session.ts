import { api, errorMessage } from "../lib/api";
import type { DrawingDocument, DrawingOperation } from "./model";
import { appendOperation } from "./operations";
import { canonicalOperation, drawingPreconditions } from "./canonical";
import type { DrawingPrecondition } from "./wire";
import type {DrawingHistoryResult,PendingHistoryRequest} from './undo';

export interface RecoveryRecord { acknowledged: DrawingDocument; pending: DrawingOperation[]; preconditions?: Record<string, DrawingPrecondition[]>; recoveryId?: string; history?:PendingHistoryRequest }
export interface DrawingRecoveryInput { document: DrawingDocument; record: RecoveryRecord; expectedRevision: number; recoveryId: string }
export interface DrawingSessionIO {
  load: (pageId: string) => Promise<DrawingDocument>;
  apply: (pageId: string, operation: DrawingOperation) => Promise<DrawingDocument>;
  read: (pageId: string) => Promise<RecoveryRecord | undefined>;
  write: (pageId: string, record: RecoveryRecord) => Promise<void>;
  history?: (pageId:string,expectedRevision:number,requestId:string,redo:boolean,actor:string)=>Promise<DrawingHistoryResult>;
}
export interface DrawingState { document: DrawingDocument | null; loading: boolean; pending: number; saving: boolean; error: string | null; recovered: boolean; restoring: boolean }
const sessions = new Map<string, DrawingSession>();
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("worlds-drawing-recovery", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("journal");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function recoveryRead(key: string): Promise<RecoveryRecord | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("journal").objectStore("journal").get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function recoveryWrite(key: string, value: RecoveryRecord): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("journal", "readwrite");
    transaction.objectStore("journal").put(value, key);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Local recovery storage is unavailable"));
  });
}

/** One serial writer per resource, retained while panes are switched or unmounted. */
export class DrawingSession {
  private state: DrawingState = { document: null, loading: true, pending: 0, saving: false, error: null, recovered: false, restoring: false };
  private listeners = new Set<() => void>();
  private pending: DrawingOperation[] = [];
  private acknowledged: DrawingDocument | null = null;
  private flushing: Promise<void> | null = null;
  private ready: Promise<void>;
  private pendingBefore: Record<string, DrawingPrecondition[]> = {};
  private checkpointing: Promise<void> | null = null;
  private checkpoints: Promise<void> = Promise.resolve();
  private recoveryId: string | undefined;
  private historyRequest:PendingHistoryRequest|undefined;
  private historyFinishing=false;
  constructor(readonly pageId: string, private readonly io: DrawingSessionIO = { load: api.drawingLoad, apply: api.drawingApply, read: recoveryRead, write: recoveryWrite,history:api.drawingHistoryToggle }) { this.ready = this.load(); }
  private write(record:RecoveryRecord){return this.io.write(this.pageId,{...record,...(this.historyRequest?{history:this.historyRequest}:{})});}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private set(patch: Partial<DrawingState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }
  private async load() {
    try {
      const native = await this.io.load(this.pageId);
      this.acknowledged = native;
      const stored = await this.io.read(this.pageId);
      this.historyRequest=stored?.history&&!native.operations.some(op=>op.id===stored.history!.id)?stored.history:undefined;
      this.recoveryId = stored?.recoveryId;
      this.pendingBefore = stored?.preconditions ?? {};
      this.pending = (stored?.pending ?? []).filter((op) => !native.operations.some((p) => p.id === op.id));
      let document = native;
      try { for (const op of this.pending) document = appendOperation(document, op); }
      catch {
        // A complete recovery copy is preserved rather than overwritten by remote state.
        if (stored) {
          this.acknowledged = stored.acknowledged; this.pending = stored.pending;
          document = stored.acknowledged;
          for (const op of stored.pending) document = appendOperation(document, op);
          this.set({ document, loading: false, pending: this.pending.length, recovered: true, error: "This drawing changed elsewhere. Your recovered copy is preserved; export it before resolving the conflict." });
          return;
        }
      }
      this.set({ document, loading: false, pending: this.pending.length,...(this.historyRequest?{error:`An interrupted ${this.historyRequest.redo?'Redo':'Undo'} is preserved. Use that command again to finish it before editing.`}:{}) });
      if (this.pending.length) void this.flush();
    } catch (e) { this.set({ loading: false, error: errorMessage(e) }); }
  }
  dispatch(op: DrawingOperation): boolean {
    if (!this.state.document || this.state.recovered || this.state.restoring || this.historyRequest) return false;
    try {
      const document = appendOperation(this.state.document, op);
      this.pendingBefore[op.id] = drawingPreconditions(this.state.document.scene, op);
      this.pending.push(op); this.set({ document, pending: this.pending.length, error: null });
      if (this.acknowledged) void this.write( { acknowledged: this.acknowledged, pending: [...this.pending], preconditions: { ...this.pendingBefore } }).catch((e) => this.set({ error: errorMessage(e) }));
      void this.flush(); return true;
    } catch (e) { this.set({ error: errorMessage(e) }); return false; }
  }
  async flush(): Promise<void> {
    await this.ready;
    if(this.historyRequest&&!this.historyFinishing)return;
    if (this.checkpointing) await this.checkpointing;
    if (this.state.recovered || !this.acknowledged) return;
    if (!this.flushing) {
      const running = this.flushQueue(); this.flushing = running;
      void running.finally(() => { if (this.flushing === running) this.flushing = null; });
    }
    await this.flushing;
    // An edit arriving just as the previous queue drained must also be awaited.
    if (this.pending.length && !this.state.error && !this.state.recovered) return this.flush();
  }
  private async flushQueue(): Promise<void> {
    if (!this.acknowledged) return;
    this.set({ saving: true, error: null });
    try {
      while (this.pending.length) {
        // Crash recovery is durable before the native operation is sent.
        await this.write( { acknowledged: this.acknowledged, pending: [...this.pending], preconditions: { ...this.pendingBefore } });
        const op = this.pending[0];
        const result = await this.io.apply(this.pageId, op);
        this.acknowledged = result; this.pending.shift();
        delete this.pendingBefore[op.id];
        await this.write( { acknowledged: result, pending: [...this.pending], preconditions: { ...this.pendingBefore } });
        this.set({ pending: this.pending.length, error: null });
      }
    } catch (e) {
      const error = errorMessage(e);
      this.set({ error, recovered: error.startsWith("conflict:") });
    } finally { this.set({ saving: false }); }
  }
  /** Serialize a canonical native checkpoint with the local writer. Pointer input
   * can continue; its unsent operations are conditionally rebased afterwards. */
  checkpoint<T>(work: (document: DrawingDocument) => Promise<T>): Promise<T> {
    const running = this.checkpoints.then(() => this.checkpointNow(work));
    this.checkpoints = running.then(() => undefined, () => undefined);
    return running;
  }
  private async checkpointNow<T>(work: (document: DrawingDocument) => Promise<T>,allowHistory=false): Promise<T> {
    if(this.historyRequest&&!allowHistory)throw new Error("Finish the interrupted Undo or Redo before accepting other changes");
    await this.ready;
    if (this.checkpointing) await this.checkpointing;
    await this.flush();
    if (!this.acknowledged || this.state.recovered || this.pending.length) throw new Error("Save or recover the local drawing before accepting shared changes");
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); this.checkpointing = gate;
    const old = this.acknowledged;
    try {
      const result = await work(old), native = await this.io.load(this.pageId);
      let projected = native; const next: DrawingOperation[] = [], before: Record<string, DrawingPrecondition[]> = {};
      try {
        for (const raw of this.pending) {
          if (native.operations.some((op) => op.id === raw.id)) continue;
          const op = canonicalOperation(projected, raw, raw.actor, this.pendingBefore[raw.id]); before[op.id] = drawingPreconditions(projected.scene, op); projected = appendOperation(projected, op); next.push(op);
        }
      } catch (e) {
        await this.write( { acknowledged: old, pending: [...this.pending], preconditions: { ...this.pendingBefore } });
        this.set({ recovered: true, error: `conflict: ${errorMessage(e)}` }); return result;
      }
      this.acknowledged = native; this.pending = next; this.pendingBefore = before;
      await this.write( { acknowledged: native, pending: next, preconditions: before });
      this.set({ document: projected, pending: next.length, error: null }); return result;
    } finally { if (this.checkpointing === gate) this.checkpointing = null; release(); if (this.pending.length && !this.state.recovered) void this.flush(); }
  }
  /** Native SQLite chooses from its bounded author window. Recovery persists
   * the request before IPC, so retries never accidentally toggle a second edit. */
  undo(actor:string,redo=false):Promise<void>{
    const running=this.checkpoints.then(async()=>{
      this.historyFinishing=true;
      this.set({restoring:true});
      try{
        await this.checkpointNow(async(document)=>{
          if(!this.io.history)throw new Error("Native history is unavailable in this editor");
          if(this.historyRequest&&(this.historyRequest.actor!==actor||this.historyRequest.redo!==redo))throw new Error("Finish the interrupted Undo or Redo with its original account and command");
          this.historyRequest??={id:crypto.randomUUID(),revision:document.revision,actor,redo};
          await this.write({acknowledged:this.acknowledged!,pending:[...this.pending],preconditions:{...this.pendingBefore}});
          const request=this.historyRequest;
          this.set({saving:true});
          try{await this.io.history(this.pageId,request.revision,request.id,request.redo,request.actor);}
          catch(error){
            if(errorMessage(error).startsWith('history-stale:')){
              const native=await this.io.load(this.pageId);
              if(!native.operations.some(op=>op.id===request.id)){
                await this.io.write(this.pageId,{acknowledged:native,pending:[],preconditions:{}});
                this.historyRequest=undefined;this.acknowledged=native;this.set({document:native,pending:0});
              }
            }
            throw error;
          }
        },true);
        const record={acknowledged:this.acknowledged!,pending:[...this.pending],preconditions:{...this.pendingBefore}};
        await this.io.write(this.pageId,record);this.historyRequest=undefined;
      }catch(e){this.set({error:errorMessage(e)});throw e;}
      finally{this.historyFinishing=false;this.set({restoring:false,saving:false});}
    });
    this.checkpoints=running.then(()=>undefined,()=>undefined);return running;
  }
  async refresh(): Promise<void> { await this.checkpoint(async () => undefined); }
  async restore<T>(work: (document: DrawingDocument) => Promise<T>): Promise<T> {
    if (this.state.restoring) throw new Error("A version restore is already running");
    this.set({ restoring: true });
    try { return await this.checkpoint(work); }
    finally { this.set({ restoring: false }); }
  }
  /** Preserve renderer-only input before asking native storage to archive both
   * copies and adopt a shared checkpoint. A stable ID makes IPC retries safe. */
  recover<T>(work: (input: DrawingRecoveryInput) => Promise<T>): Promise<T> {
    const running = this.checkpoints.then(async () => {
      await this.ready;
      if(this.historyRequest)throw new Error("Finish the interrupted Undo or Redo before recovering other changes");
      if (this.flushing) await this.flushing;
      if (!this.state.document || !this.acknowledged) throw new Error("Open the drawing before recovering it");
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); this.checkpointing = gate;
      this.set({ recovered: true, saving: true });
      try {
        const native = await this.io.load(this.pageId);
        this.recoveryId ??= crypto.randomUUID();
        const record: RecoveryRecord = { acknowledged: this.acknowledged, pending: [...this.pending], preconditions: { ...this.pendingBefore }, recoveryId: this.recoveryId };
        await this.write( record);
        const result = await work({ document: structuredClone(this.state.document), record, expectedRevision: native.revision, recoveryId: this.recoveryId });
        const accepted = await this.io.load(this.pageId);
        await this.write( { acknowledged: accepted, pending: [], preconditions: {} });
        this.acknowledged = accepted; this.pending = []; this.pendingBefore = {}; this.recoveryId = undefined;
        this.set({ document: accepted, recovered: false, pending: 0, error: null }); return result;
      } catch (e) { this.set({ error: errorMessage(e), recovered: true }); throw e; }
      finally { this.set({ saving: false }); if (this.checkpointing === gate) this.checkpointing = null; release(); }
    });
    this.checkpoints = running.then(() => undefined, () => undefined); return running;
  }
}
export function drawingSession(pageId: string): DrawingSession {
  let session = sessions.get(pageId);
  if (!session) { session = new DrawingSession(pageId); sessions.set(pageId, session); }
  return session;
}
