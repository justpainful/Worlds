import {describe,expect,it,vi,afterEach} from "vitest";
import fixtures from "./fixtures/animated-images.json";
import {imageHeader,decodeBrushTip} from "./imageHeaders";
import {validateAnimation,MAX_ANIMATION_PIXELS} from "./animatedImageLimits";
import {decodeAnimatedFrame} from "./animatedImage";
import {imageOrientation} from "./imageOrientation";
const bytes=(index:number)=>Uint8Array.from(atob(fixtures.images[index].base64),c=>c.charCodeAt(0));
afterEach(()=>vi.unstubAllGlobals());
describe("animated originals and static-frame preflight",()=>{
  it("reads real APNG, GIF and WebP frame counts, posters and orientation without invoking a decoder",()=>{
    for(const[f,index]of fixtures.images.map((f,i)=>[f,i]as const)){const data=bytes(index),header=imageHeader(data,1_000_000,256*1024*1024,true),orientation=imageOrientation(data,f.mime);expect(header).toMatchObject({mime:f.mime,frameCount:f.frameCount,width:orientation>=5?f.height:f.width,height:orientation>=5?f.width:f.height});validateAnimation(header,f.frameCount-1);expect(()=>imageHeader(data)).toThrow("animation");}
  });
  it("still refuses animated brush tips before browser decoding",async()=>{
    const bitmap=vi.fn();vi.stubGlobal("createImageBitmap",bitmap);await expect(decodeBrushTip(new Blob([bytes(0)],{type:"image/webp"}))).rejects.toMatchObject({code:"animation"});expect(bitmap).not.toHaveBeenCalled();
  });
  it("bounds frame count, accumulated pixels and indices before worker allocation",()=>{
    const base={width:32,height:24,mime:"image/png",frameCount:3};expect(()=>validateAnimation(base,-1)).toThrow("frame");expect(()=>validateAnimation(base,3)).toThrow("frame");expect(()=>validateAnimation({...base,frameCount:1001})).toThrow("animation");expect(()=>validateAnimation({...base,width:16384,height:16384,frameCount:2})).toThrow();expect(()=>validateAnimation({...base,width:8192,height:4096,frameCount:9})).toThrow("animation");expect(MAX_ANIMATION_PIXELS).toBe(256*1024*1024);
  });
  it("refuses truncated GIF subblocks and invalid frame extents without decoding",()=>{
    const gif=bytes(2);expect(()=>imageHeader(gif.slice(0,-2),1_000_000,256*1024*1024,true)).toThrow("truncated");const png=bytes(1),view=new DataView(png.buffer);let found=false;for(let p=8;p<png.length;){const length=view.getUint32(p),kind=String.fromCharCode(...png.subarray(p+4,p+8));if(kind==="fcTL"){view.setUint32(p+20,100000);found=true;break;}p+=length+12;}expect(found).toBe(true);expect(()=>imageHeader(png,1_000_000,256*1024*1024,true)).toThrow("dimensions");
  });
  it("cancellation terminates the actual owned worker abstraction without changing source bytes",async()=>{
    const workers:{terminate:ReturnType<typeof vi.fn>;postMessage:ReturnType<typeof vi.fn>}[]=[];
    vi.stubGlobal("Worker",class{terminate=vi.fn();postMessage=vi.fn();constructor(){workers.push(this);}});
    const controller=new AbortController(),source=bytes(0),before=source.slice(),task=decodeAnimatedFrame({bytes:source,mime:"image/webp",index:1,orientation:1},controller.signal);controller.abort();await expect(task).rejects.toMatchObject({name:"AbortError"});expect(workers).toHaveLength(1);expect(workers[0].terminate).toHaveBeenCalledOnce();expect(source).toEqual(before);
    await expect(decodeAnimatedFrame({bytes:source,mime:"image/webp",index:0,orientation:1},controller.signal)).rejects.toMatchObject({name:"AbortError"});expect(workers).toHaveLength(1);
  });
});
