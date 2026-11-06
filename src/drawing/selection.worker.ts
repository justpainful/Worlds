import { computeSelection, type SelectionRequest } from "./pixelSelection";
self.onmessage=async(event:MessageEvent<SelectionRequest>)=>{
  try {
    const result=computeSelection(event.data), box=result.imageBounds, bytes=new Uint8ClampedArray(box.w*box.h*4);
    if(result.bounds)for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){const at=(y*box.w+x)*4;bytes[at]=bytes[at+1]=bytes[at+2]=255;bytes[at+3]=result.mask[(box.y+y)*result.width+box.x+x];}
    const canvas=new OffscreenCanvas(box.w,box.h),ctx=canvas.getContext("2d");if(!ctx)throw new Error("The selection processor is unavailable");
    ctx.putImageData(new ImageData(bytes,box.w,box.h),0,0);const blob=await canvas.convertToBlob({type:"image/png"});
    self.postMessage({result,blob},{transfer:[result.mask.buffer]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
