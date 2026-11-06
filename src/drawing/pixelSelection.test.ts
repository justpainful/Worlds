import { describe, expect, it } from "vitest";
import { computeSelection, selectionRaster, validAlphaMaskPreview } from "./pixelSelection";
import { featherMask, polygonMask, validatePixelDimensions } from "./pixels";
import { growMask } from "./morphology";

describe("transient full-resolution pixel selection",()=>{
  it("clips an ellipse without changing its original center or radii",()=>{
    const mask=polygonMask(7,6,[{x:-6,y:-4},{x:6,y:4}],true);
    for(let y=0;y<6;y++)for(let x=0;x<7;x++)expect(mask[y*7+x]).toBe(((x+0.5)/6)**2+((y+0.5)/4)**2<=1?255:0);
  });
  it("matches independent ray intersections for concave, crossing, clipped and fractional paths",()=>{
    const paths=[[{x:-3,y:1.5},{x:11,y:2.5},{x:5,y:9},{x:4,y:3},{x:0,y:9}],[{x:1,y:1},{x:9,y:9},{x:1,y:9},{x:9,y:1}]];
    for(const points of paths){const mask=polygonMask(12,10,points);for(let y=0;y<10;y++)for(let x=0;x<12;x++){const crossings=points.filter((a,i)=>{const b=points[(i+1)%points.length];return(a.y>y+0.5)!==(b.y>y+0.5)&&x+0.5<(b.x-a.x)*(y+0.5-a.y)/(b.y-a.y)+a.x;}).length;expect(mask[y*12+x]).toBe(crossings%2?255:0);}}
  });
  it("retains holes, disconnected additions and empty active selections without changing prior bytes",()=>{
    const shape=(a:number,b:number)=>({kind:"shape" as const,shape:"rect" as const,points:[{x:a,y:a},{x:b,y:b}]}),base={width:12,height:12,mode:"replace" as const};
    const first=computeSelection({...base,operation:shape(1,6)}),before=first.mask.slice(),hole=computeSelection({...base,previous:first.mask,mode:"subtract",operation:shape(2,5)});
    expect(hole.pixels).toBe(16);expect(hole.mask[3*12+3]).toBe(0);expect(first.mask).toEqual(before);
    const added=computeSelection({...base,previous:hole.mask,mode:"add",operation:shape(8,10)});expect(added.pixels).toBe(20);expect(added.bounds).toEqual({x:1,y:1,w:9,h:9});
    const empty=computeSelection({...base,previous:first.mask,mode:"subtract",operation:shape(1,6)});expect(empty.pixels).toBe(0);expect(empty.bounds).toBeNull();expect(empty.mask).toHaveLength(144);expect(empty.preview.alpha).toEqual([0]);
    expect(computeSelection({...base,previous:empty.mask,operation:{kind:"invert"}}).pixels).toBe(144);
    expect(computeSelection({...base,previous:first.mask,mode:"intersect",operation:shape(4,8)}).pixels).toBe(4);
  });
  it("computes alpha-aware magic regions and explicit edge operations",()=>{
    const image={width:3,height:1,data:new Uint8ClampedArray([255,0,0,0,0,0,0,255,0,255,0,0])};
    const global=computeSelection({width:3,height:1,mode:"replace",operation:{kind:"magic",image,point:{x:0,y:0},tolerance:0,contiguous:false}});expect([...global.mask]).toEqual([255,0,255]);
    const mask=new Uint8ClampedArray(49);mask[24]=255;
    const grown=computeSelection({width:7,height:7,previous:mask,mode:"replace",operation:{kind:"edges",grow:1,feather:0}});expect(grown.pixels).toBe(9);
    const shrunk=computeSelection({width:7,height:7,previous:grown.mask,mode:"replace",operation:{kind:"edges",grow:-1,feather:0}});expect(shrunk.mask).toEqual(mask);
    const soft=computeSelection({width:7,height:7,previous:grown.mask,mode:"replace",operation:{kind:"edges",grow:0,feather:1}});expect(soft.mask[16]).toBeGreaterThan(0);expect(soft.mask[16]).toBeLessThan(255);expect(grown.mask[16]).toBe(255);
  });
  it("bounds only peer preview resolution and keeps every authoritative alpha value",()=>{
    const mask=new Uint8ClampedArray(512*256);for(let y=32;y<224;y++)for(let x=64;x<448;x++)mask[y*512+x]=(x+y)%256;
    const before=mask.slice(),result=selectionRaster(512,256,mask);expect(result.preview.alpha.length).toBeLessThanOrEqual(4096);expect(result.preview.width).toBe(64);expect(result.mask).toEqual(before);expect(validAlphaMaskPreview(result.preview)).toBe(true);
    expect(validAlphaMaskPreview({...result.preview,width:65})).toBe(false);expect(validAlphaMaskPreview({...result.preview,alpha:[NaN]})).toBe(false);
  });
  it("rejects dimensions and nonfinite settings before unsafe allocation",()=>{
    for(const [w,h]of [[0,1],[-2,-2],[1.5,2],[Infinity,2],[1e9,1e9],[NaN,2]])expect(()=>validatePixelDimensions(w,h)).toThrow();
    expect(()=>polygonMask(10,10,[{x:0,y:0},{x:NaN,y:3}])).toThrow();
    expect(()=>growMask(new Uint8ClampedArray(2),2,2,0)).toThrow();expect(()=>featherMask(new Uint8ClampedArray(4),2,2,NaN)).toThrow();
  });
});
