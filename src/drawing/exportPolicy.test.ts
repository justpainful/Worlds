import { describe,expect,it } from "vitest";
import { canDrawingExport,DEFAULT_EXPORT_RULES,drawingExportEnvelope,validExportPolicy } from "./exportPolicy";
import { newDrawing } from "./operations";
describe("export permissions and byte context",()=>{
  it("validates exact policy classes and keeps each role independent",()=>{
    const policy={revision:1,rules:{...DEFAULT_EXPORT_RULES,images:"comment" as const,projects:"full" as const}};
    expect(validExportPolicy(policy)).toBe(true);expect(validExportPolicy({...policy,rules:{...policy.rules,other:"full"}})).toBe(false);
    expect(canDrawingExport(policy,"view","images")).toBe(false);expect(canDrawingExport(policy,"comment","images")).toBe(true);expect(canDrawingExport(policy,"edit","projects")).toBe(false);expect(canDrawingExport(policy,"full","projects")).toBe(true);expect(canDrawingExport(policy,"none","comments")).toBe(false);
  });
  it("keeps the frozen context separate from exact file bytes without mutating either",()=>{
    const context={pageId:"drawing",kind:"images" as const,scenes:[{scene:newDrawing().scene}]},before=structuredClone(context),bytes=new Uint8Array([1,2,3,4]);
    const packet=drawingExportEnvelope(bytes,context,"transient-test-token"),length=new DataView(packet.buffer).getUint32(0,true),decoded=JSON.parse(new TextDecoder().decode(packet.slice(4,4+length)));
    expect(decoded.context).toEqual(context);expect(packet.slice(4+length)).toEqual(bytes);expect(context).toEqual(before);expect(bytes).toEqual(new Uint8Array([1,2,3,4]));
  });
});
