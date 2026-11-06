import { extractSelectedPixels } from "./floatingPixels";
import type { Pixels } from "./pixels";
self.onmessage=async(event:MessageEvent<{image:Pixels;alpha:Uint8ClampedArray}>)=>{
  try{
    const result=extractSelectedPixels(event.data.image,event.data.alpha);
    if(!result){self.postMessage({empty:true});return;}
    const c=new OffscreenCanvas(result.width,result.height),ctx=c.getContext("2d");if(!ctx)throw new Error("The pixel processor is unavailable");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(result.data),result.width,result.height),0,0);
    self.postMessage({blob:await c.convertToBlob({type:"image/png"})});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
