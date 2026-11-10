import type { SelectionRaster, SelectionRequest } from "./pixelSelection";
/** Previous selection stays owned by the editor. The optional magic-source
 * image is an owned disposable readback and is transferred to the worker. */
export function runSelectionTask(request:SelectionRequest,signal:AbortSignal):Promise<{result:SelectionRaster;blob:Blob}>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException("Cancelled","AbortError"));return;}
    let previous:Uint8ClampedArray<ArrayBuffer>|undefined;
    try{previous=request.previous?.slice();}catch{reject(new Error("Not enough memory to prepare the selection. The existing selection was kept."));return;}
    let worker:Worker;try{worker=new Worker(new URL("./selection.worker.ts",import.meta.url),{type:"module"});}catch(error){reject(error);return;}
    const task={...request,previous};
    const stop=()=>{worker.terminate();signal.removeEventListener("abort",abort);},abort=()=>{stop();reject(new DOMException("Cancelled","AbortError"));};signal.addEventListener("abort",abort,{once:true});
    worker.onmessage=(event:MessageEvent<{result:SelectionRaster;blob:Blob;error?:string}>)=>{stop();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data);};
    worker.onerror=event=>{stop();reject(new Error(event.message));};
    const transfer:Transferable[]=[];if(task.previous)transfer.push(task.previous.buffer);if(task.operation.kind==="magic")transfer.push(task.operation.image.data.buffer);
    try{worker.postMessage(task,transfer);}catch(error){stop();reject(error);}
  });
}
