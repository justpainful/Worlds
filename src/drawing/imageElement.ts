export interface LoadedImageElement {source:HTMLImageElement;dispose:()=>void}
/** One owned decode, cancellable before publication. External URLs are never
 * revoked; blob URLs created here are released with the decoded preview. */
export async function decodeImageElement(input:Blob|string,signal?:AbortSignal):Promise<LoadedImageElement>{
  if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
  const owned=typeof input!=="string",url=owned?URL.createObjectURL(input):input,source=new Image();let disposed=false;source.crossOrigin="anonymous";
  const dispose=()=>{if(disposed)return;disposed=true;source.removeAttribute("src");if(owned)URL.revokeObjectURL(url);};
  signal?.addEventListener("abort",dispose,{once:true});source.src=url;
  try{await source.decode();if(signal?.aborted)throw new DOMException("Cancelled","AbortError");return{source,dispose};}
  catch(error){dispose();if(signal?.aborted)throw new DOMException("Cancelled","AbortError");throw error;}
  finally{signal?.removeEventListener("abort",dispose);}
}
