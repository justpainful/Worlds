import type { Pixels } from "./pixels";
export function extractPixelPng(image:Pixels,alpha:Uint8ClampedArray,signal:AbortSignal):Promise<Blob|null>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException("Cancelled","AbortError"));return;}
    const worker=new Worker(new URL("./floating.worker.ts",import.meta.url),{type:"module"});
    const stop=()=>{worker.terminate();signal.removeEventListener("abort",abort);},abort=()=>{stop();reject(new DOMException("Cancelled","AbortError"));};
    signal.addEventListener("abort",abort,{once:true});
    worker.onmessage=(event:MessageEvent<{blob?:Blob;empty?:boolean;error?:string}>)=>{stop();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.blob??null);};
    worker.onerror=e=>{stop();reject(new Error(e.message));};
    try{worker.postMessage({image,alpha},[image.data.buffer,alpha.buffer]);}catch(error){stop();reject(error);}
  });
}
