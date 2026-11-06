import { api } from "../lib/api";
import type { ReferencePreview } from "./referenceTypes";
export type { ReferencePreview, ReferenceSnapshot } from "./referenceTypes";
/** Private session cache. Artwork contains source IDs, never live titles. Refresh
 * clears the old display before checking rights and discards late responses. */
export class DrawingReferenceCache {
  private values = new Map<string, ReferencePreview>();
  private pending = new Map<string, Promise<void>>();
  private generations = new Map<string, number>();
  private disposed = false;
  onChange?: () => void;
  private invalidate=()=>{for(const source of this.values.keys()){this.generations.set(source,(this.generations.get(source)??0)+1);this.pending.delete(source);void this.refresh(source);}};
  constructor(private load: (source: string) => Promise<ReferencePreview> = readDrawingReference) {if(typeof window!=="undefined"){window.addEventListener('offline',this.invalidate);window.addEventListener('online',this.invalidate);window.addEventListener('focus',this.invalidate);}}

  async ensure(source:string):Promise<ReferencePreview>{const value=this.get(source);if(value.state==="loading"||Date.now()-value.checkedAt>15000)await this.refresh(source);return this.values.get(source)??value;}
  get(source: string): ReferencePreview {
    const value = this.values.get(source);
    if (!value || (Date.now() - value.checkedAt > 15000 && !this.pending.has(source))) void this.refresh(source);
    return this.values.get(source) ?? { state: "loading", checkedAt: Date.now() };
  }
  refresh(source: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const running = this.pending.get(source); if (running) return running;
    const generation = (this.generations.get(source) ?? 0) + 1; this.generations.set(source, generation);
    const previous=this.values.get(source),lastReadyAt=previous?.state==="ready"?previous.checkedAt:previous?.lastReadyAt,lastUpdatedAt=previous?.state==="ready"?previous.updatedAt:previous?.lastUpdatedAt;
    this.values.set(source, { state: "loading", checkedAt: Date.now(),lastReadyAt,lastUpdatedAt });
    const work = Promise.resolve().then(() => this.load(source)).then((value) => {
      if (this.disposed || this.generations.get(source) !== generation) return;
      this.values.set(source, value.state === "ready" ? { ...value, checkedAt: Date.now() } : { state: value.state==="offline"?"offline":"unavailable", checkedAt: Date.now(),lastReadyAt,lastUpdatedAt });
    }).catch(() => { if (!this.disposed && this.generations.get(source) === generation) this.values.set(source, { state: "unavailable", checkedAt: Date.now(),lastReadyAt,lastUpdatedAt }); }).finally(() => {
      if (this.generations.get(source) === generation) this.pending.delete(source);
      if (!this.disposed) this.onChange?.();
    });
    this.pending.set(source, work); this.onChange?.(); return work;
  }
  dispose() { if(typeof window!=="undefined"){window.removeEventListener("offline",this.invalidate);window.removeEventListener("online",this.invalidate);window.removeEventListener("focus",this.invalidate);}this.disposed = true; this.onChange = undefined; this.values.clear(); this.generations.clear(); this.pending.clear(); }
}

/** Native source authorization runs again for each refresh. No source data is
 * retained in the offline/denied result. Local sources remain usable offline. */
export async function readDrawingReference(source:string):Promise<ReferencePreview>{
 let token:string|null=null;try{const{syncConfig}=await import('../sync/config');token=await syncConfig().getToken();}catch{}
 try{return await api.drawingReferenceRead(source,token,typeof navigator!=="undefined"&&!navigator.onLine);}catch{return{state:typeof navigator!=="undefined"&&!navigator.onLine?"offline":"unavailable",checkedAt:Date.now()};}
}

export async function searchDrawingReferences(query:string,editable=false){let token:string|null=null;try{const{syncConfig}=await import('../sync/config');token=await syncConfig().getToken();}catch{}return api.drawingReferenceSearch(query,editable,token,typeof navigator!=="undefined"&&!navigator.onLine);}
