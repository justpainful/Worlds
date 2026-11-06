import { id, type Frame } from "./model";
import { validatePixelDimensions } from "./pixels";
import type { SelectionMode, SelectionOperation, SelectionRaster, SelectionRequest } from "./pixelSelection";
import { runSelectionTask } from "./selectionTasks";

export interface SelectionImage { source: HTMLImageElement; url: string; dispose: () => void }
export interface PixelSelection extends SelectionRaster { id: string; frame: Frame; blob: Blob; image: SelectionImage; retain: () => () => void }
interface OwnedSelection extends PixelSelection { releaseOwner: () => void }
export interface SelectionState { selection: PixelSelection | null; busy: boolean; error: string | null }
export type SelectionFactory = (frame: Frame, signal: AbortSignal) => Promise<SelectionOperation>;
export interface SelectionIO {
  compute: (request: SelectionRequest, signal: AbortSignal) => Promise<{ result: SelectionRaster; blob: Blob }>;
  image: (blob: Blob) => Promise<SelectionImage>;
}
const sameFrame = (a: Frame | null, b: Frame | null) => a?.id===b?.id && a?.x===b?.x && a?.y===b?.y && a?.w===b?.w && a?.h===b?.h;
const defaultIO: SelectionIO = {
  compute: runSelectionTask,
  image: async blob => { const url=URL.createObjectURL(blob),source=new Image();source.src=url;try{await source.decode();return{source,url,dispose:()=>URL.revokeObjectURL(url)};}catch(error){URL.revokeObjectURL(url);throw error;} },
};
/** Selection state never writes artwork or assets. Queued add/subtract/edge
 * operations use the preceding result; a replacement supersedes pending work.
 * Each decoded image is retained across any stroke that snapshots this state. */
export class PixelSelectionController {
  private frame: Frame | null = null;
  private state: SelectionState = {selection:null,busy:false,error:null};
  private listeners=new Set<()=>void>(); private epoch=0; private pending=0;
  private queue:Promise<void>=Promise.resolve();private active:AbortController|null=null;
  constructor(private readonly io:SelectionIO=defaultIO){}
  snapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(patch:Partial<SelectionState>){this.state={...this.state,...patch};for(const fn of this.listeners)fn();}
  configure(frame:Frame|null){if(sameFrame(this.frame,frame))return;this.clear();this.frame=frame?structuredClone(frame):null;}
  cancel=()=>{this.epoch++;this.active?.abort();this.active=null;this.pending=0;this.queue=Promise.resolve();this.set({busy:false,error:null});};
  clear=()=>{this.cancel();(this.state.selection as OwnedSelection|null)?.releaseOwner();this.set({selection:null});};
  close=()=>{this.clear();this.frame=null;};
  run=(operation:SelectionOperation|SelectionFactory,mode:SelectionMode="replace"):Promise<void>=>{
    if(mode==="replace"&&(typeof operation==="function"||operation.kind==="shape"||operation.kind==="magic"||operation.kind==="all"))this.cancel();
    const epoch=this.epoch,frame=this.frame&&structuredClone(this.frame);if(!frame)return Promise.resolve();
    this.pending++;this.set({busy:true,error:null});
    const run=this.queue.then(async()=>{
      if(epoch!==this.epoch)return;
      const controller=new AbortController();this.active=controller;
      let image:SelectionImage|undefined;
      try{
        const width=Math.ceil(frame.w),height=Math.ceil(frame.h);validatePixelDimensions(width,height);
        const op=typeof operation==="function"?await operation(frame,controller.signal):operation;
        if(epoch!==this.epoch||controller.signal.aborted)return;
        const {result,blob}=await this.io.compute({width,height,previous:this.state.selection?.mask,mode,operation:op},controller.signal);
        if(epoch!==this.epoch||controller.signal.aborted)return;
        image=await this.io.image(blob);
        if(epoch!==this.epoch||controller.signal.aborted){image.dispose();return;}
        let references=1,owner=true;const resource=image;
        const release=()=>{references--;if(!references)resource.dispose();};
        const next:OwnedSelection={...result,id:id(),frame,blob,image:resource,retain:()=>{if(!references)throw new Error("The selection image was released");references++;let active=true;return()=>{if(active){active=false;release();}};},releaseOwner:()=>{if(owner){owner=false;release();}}};
        (this.state.selection as OwnedSelection|null)?.releaseOwner();this.set({selection:next,error:null});
      }catch(error){if(epoch===this.epoch&&!controller.signal.aborted)this.set({error:error instanceof Error?error.message:String(error)});}
      finally{if(this.active===controller)this.active=null;}
    }).finally(()=>{if(epoch===this.epoch){this.pending--;this.set({busy:this.pending>0});}});
    this.queue=run.catch(()=>{});return run;
  };
}
