export interface LoadedImageElement {source:HTMLImageElement;dispose:()=>void}
/** One owned decode, cancellable before publication. External URLs are never
 * revoked; blob URLs created here are released with the decoded preview. */
export async function decodeImageElement(input:Blob|string,signal?:AbortSignal):Promise<LoadedImageElement>{
  if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
  const owned=typeof input!=="string",url=owned?URL.createObjectURL(input):input,source=new Image();let disposed=false;source.crossOrigin="anonymous";
  const dispose=()=>{if(disposed)return;disposed=true;source.removeAttribute("src");if(owned)URL.revokeObjectURL(url);};
  let rejectAbort:(reason:DOMException)=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const abort=()=>{dispose();rejectAbort(new DOMException("Cancelled","AbortError"));};
  signal?.addEventListener("abort",abort,{once:true});
  try{source.src=url;await Promise.race([source.decode(),interrupted]);if(signal?.aborted)throw new DOMException("Cancelled","AbortError");return{source,dispose};}
  catch(error){dispose();if(signal?.aborted)throw new DOMException("Cancelled","AbortError");throw error;}
  finally{signal?.removeEventListener("abort",abort);}
}
