import { expect,it,vi } from "vitest";
import { newFrame } from "./model";
import { computeSelection, type SelectionRequest } from "./pixelSelection";
import { PixelSelectionController, type SelectionImage, type SelectionIO } from "./selectionController";
const shape=(x:number)=>({kind:"shape" as const,shape:"rect" as const,points:[{x,y:1},{x:x+2,y:3}]});
const blob=new Blob(["test"],{type:"image/png"});
const resource=()=>({source:{} as HTMLImageElement,url:"blob:synthetic",dispose:vi.fn()});
const compute=async(request:SelectionRequest)=>({result:computeSelection(request),blob});
it("serializes additions against the preceding result while retaining previous bytes",async()=>{
  const images:SelectionImage[]=[],io:SelectionIO={compute,image:async()=>{const r=resource();images.push(r);return r;}},c=new PixelSelectionController(io);c.configure(newFrame("f",{w:10,h:6}));
  const a=c.run(shape(1)),b=c.run(shape(6),"add");await Promise.all([a,b]);expect(c.snapshot().selection?.pixels).toBe(8);expect(c.snapshot().selection?.mask[1*10+1]).toBe(255);expect(c.snapshot().selection?.mask[1*10+6]).toBe(255);expect(c.snapshot().busy).toBe(false);expect(images[0].dispose).toHaveBeenCalledOnce();c.close();expect(images[1].dispose).toHaveBeenCalledOnce();
});
it("discards a late replaced result even when a worker ignores cancellation",async()=>{
  let resolve!:()=>void;const gate=new Promise<void>(r=>resolve=r),signals:AbortSignal[]=[];let calls=0;
  const io:SelectionIO={compute:async(req,signal)=>{signals.push(signal);if(++calls===1)await gate;return compute(req);},image:async()=>resource()},c=new PixelSelectionController(io);c.configure(newFrame("f",{w:10,h:6}));
  const old=c.run(shape(1));await Promise.resolve();const latest=c.run(shape(6));await latest;expect(signals[0].aborted).toBe(true);resolve();await old;expect(c.snapshot().selection?.bounds?.x).toBe(6);expect(c.snapshot().selection?.pixels).toBe(4);c.close();
});
it("keeps a selection image alive for a stroke snapshot after the selection is cleared",async()=>{
  const image=resource(),c=new PixelSelectionController({compute,image:async()=>image});c.configure(newFrame("f",{w:10,h:6}));await c.run(shape(1));const selection=c.snapshot().selection!,release=selection.retain();c.clear();expect(c.snapshot().selection).toBeNull();expect(image.dispose).not.toHaveBeenCalled();expect(selection.mask[11]).toBe(255);release();release();expect(image.dispose).toHaveBeenCalledOnce();
});
it("refuses a late decoded preview from another frame and closes its resource",async()=>{
  const image=resource();let resolve!:(image:SelectionImage)=>void;const pending=new Promise<SelectionImage>(r=>resolve=r),c=new PixelSelectionController({compute,image:()=>pending}),frame=newFrame("f",{w:10,h:6});c.configure(frame);
  const running=c.run(shape(1));await Promise.resolve();await Promise.resolve();c.configure({...frame,x:20});resolve(image);await running;expect(c.snapshot().selection).toBeNull();expect(image.dispose).toHaveBeenCalledOnce();
});
it("distinguishes empty active selection and validates before worker allocation",async()=>{
  const run=vi.fn(compute),c=new PixelSelectionController({compute:run,image:async()=>resource()}),frame=newFrame("f",{w:10,h:6});c.configure(frame);await c.run(shape(20));expect(c.snapshot().selection?.pixels).toBe(0);expect(c.snapshot().selection).not.toBeNull();
  c.configure({...frame,w:1e9,h:1e9});await c.run({kind:"all"});expect(run).toHaveBeenCalledOnce();expect(c.snapshot().error).toBeTruthy();expect(c.snapshot().busy).toBe(false);c.close();
});
