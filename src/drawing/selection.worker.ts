import { computeSelection, type SelectionRequest } from "./pixelSelection";
self.onmessage=async(event:MessageEvent<SelectionRequest>)=>{
  let canvas:OffscreenCanvas|undefined;
  try {
    const result=computeSelection(event.data), box=result.imageBounds;
    canvas=new OffscreenCanvas(box.w,box.h);const ctx=canvas.getContext("2d");if(!ctx)throw new Error("The selection processor is unavailable");
    // Render bounded strips instead of allocating a second full-size RGBA image.
    if(result.bounds){const tileWidth=Math.min(box.w,8192),rows=Math.max(1,Math.min(128,Math.floor(4*1024*1024/(tileWidth*4))));for(let top=0;top<box.h;top+=rows){
      const height=Math.min(rows,box.h-top);for(let left=0;left<box.w;left+=tileWidth){const width=Math.min(tileWidth,box.w-left),bytes=new Uint8ClampedArray(width*height*4);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;bytes[at]=bytes[at+1]=bytes[at+2]=255;bytes[at+3]=result.mask[(box.y+top+y)*result.width+box.x+left+x];}
        ctx.putImageData(new ImageData(bytes,width,height),left,top);
      }
    }}
    const blob=await canvas.convertToBlob({type:"image/png"});
    self.postMessage({result,blob},{transfer:[result.mask.buffer]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
  finally{if(canvas)canvas.width=canvas.height=1;}
};
