import { imageHeader } from "./imageHeaders";
import {validateAnimation} from "./animatedImageLimits";
export interface AnimatedFrameRequest { bytes:Uint8Array;mime:string;index:number;orientation:number }
export interface AnimatedFrameResult {blob:Blob;frameCount:number;index:number;width:number;height:number}
/** A disposable decoder worker owns its VideoFrames and terminates immediately
 * on cancellation. Only the selected full composited frame returns as PNG. */
export function decodeAnimatedFrame(request:AnimatedFrameRequest,signal?:AbortSignal):Promise<AnimatedFrameResult>{
  const header=imageHeader(request.bytes,1_000_000,256*1024*1024,true);validateAnimation(header,request.index);
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException("Cancelled","AbortError"));return;}
    const worker=new Worker(new URL("./animatedImage.worker.ts",import.meta.url),{type:"module"});
    const stop=()=>{worker.terminate();signal?.removeEventListener("abort",abort);},abort=()=>{stop();reject(new DOMException("Cancelled","AbortError"));};signal?.addEventListener("abort",abort,{once:true});
    worker.onmessage=(event:MessageEvent<AnimatedFrameResult&{error?:string}>)=>{stop();event.data.error?reject(new Error(event.data.error)):resolve(event.data);};
    worker.onerror=event=>{stop();reject(new Error(event.message));};
    try{const bytes=request.bytes.slice();worker.postMessage({...request,bytes},[bytes.buffer]);}catch(error){stop();reject(error);}
  });
}
