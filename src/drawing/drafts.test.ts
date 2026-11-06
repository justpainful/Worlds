import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, newNode } from "./model";
import { newDrawing } from "./operations";
import { draftNode, drawingDraft, DrawingDraftBuffer, movingDrawingDraft, transformingDrawingDraft, validDrawingDraft } from "./drafts";
describe("ephemeral artwork previews", () => {
  it("retains bounded selection alpha without creating a scene mask or asset",()=>{
    const scene=newDrawing().scene,n=newNode("stroke",scene.layerOrder[0],scene.defaultFrameId);n.brush={...DEFAULT_BRUSH};n.seed=1;n.samples=[{x:10,y:10,pressure:1,tiltX:0,tiltY:0,time:0}];
    const selection={x:20,y:30,w:100,h:50,width:2,height:1,alpha:[255,128]},draft=drawingDraft(n,1,selection)!,buffer=new DrawingDraftBuffer();buffer.update([{clientId:1,presence:{draft}}],0);
    expect(buffer.project(scene,0).selections.get(n.id)).toEqual(selection);expect(Object.keys(scene.masks)).toHaveLength(0);expect(Object.keys(scene.assets)).toHaveLength(0);
    expect(validDrawingDraft({...draft,selection:{...selection,alpha:[255,-1]}})).toBe(false);expect(validDrawingDraft({...draft,selection:{...selection,width:65}})).toBe(false);expect(validDrawingDraft({...draft,selection:{...selection,w:NaN}})).toBe(false);
  });
  it("samples the entire gesture with stable identity/seed while retaining every original pressure sample", () => {
    const scene = newDrawing().scene, node = newNode("stroke", scene.layerOrder[0], scene.defaultFrameId, { w: 2000, h: 100 }); node.brush = { ...DEFAULT_BRUSH, color: "#0088ff" }; node.seed = 987;
    node.samples = Array.from({ length: 1600 }, (_, i) => ({ x: i, y: 20, pressure: (i % 100) / 100, tiltX: 0, tiltY: 0, time: i }));
    node.alphaLock = true; const original = structuredClone(node), draft = drawingDraft(node, 1)!;
    expect(draft.samples).toHaveLength(128); expect(draft.samples![0]).toEqual(node.samples[0]); expect(draft.samples!.at(-1)).toEqual(node.samples.at(-1));
    expect(draftNode(draft, scene)).toMatchObject({ id: node.id, seed: 987, alphaLock: true, brush: { color: "#0088ff" } }); expect(node).toEqual(original);
    expect(drawingDraft({ ...node, kind: "reference", sourceId: "private-resource" }, 2)).toBeNull();
    expect(validDrawingDraft({ ...draft, samples: [...draft.samples!, ...draft.samples!] })).toBe(false);
  });
  it("expires lost previews without resurrecting the same sequence, never changes the scene, and suppresses committed duplicates", () => {
    const scene = newDrawing().scene, node = newNode("shape", scene.layerOrder[0], scene.defaultFrameId); node.shape = "triangle";
    const draft = drawingDraft(node, 1)!, buffer = new DrawingDraftBuffer(), peers = [{ clientId: 1, presence: { draft } }]; buffer.update(peers, 0);
    expect(buffer.project(scene, 100).nodes).toHaveLength(1); expect(scene.nodeOrder).toHaveLength(0);
    buffer.update(peers, 4000); expect(buffer.project(scene, 4000).nodes).toHaveLength(0);
    buffer.update([{ clientId: 1, presence: { draft: { ...draft, sequence: 2 } } }], 4100); expect(buffer.project(scene, 4100).nodes).toHaveLength(1);
    scene.nodes[node.id] = node; scene.nodeOrder.push(node.id); expect(buffer.project(scene, 4200).nodes).toHaveLength(0);
    const move = movingDrawingDraft(scene, [node.id], { x: 40, y: 25 }, 3)!; buffer.update([{ clientId: 1, presence: { draft: move } }], 4300);
    expect(buffer.project(scene, 4300).scene.nodes[node.id].x).toBe(node.x + 40); expect(scene.nodes[node.id].x).toBe(node.x);
    buffer.update([], 4400); expect(buffer.project(scene, 4400).scene).toBe(scene);
  });
  it("projects bounded original-preserving transform previews and rejects malformed or partial selections", () => {
    const scene = newDrawing().scene, node = newNode("shape", scene.layerOrder[0], scene.defaultFrameId, { x: 10, y: 20, w: 100, h: 50 }); scene.nodes[node.id] = node; scene.nodeOrder = [node.id];
    const original = structuredClone(scene), transform = { centerX: 60, centerY: 45, scale: 2, rotation: 30, flipX: false, flipY: false }, draft = transformingDrawingDraft(scene, [node.id], transform, 1)!, buffer = new DrawingDraftBuffer();
    buffer.update([{ clientId: 1, presence: { draft } }], 0); const next = buffer.project(scene, 100).scene.nodes[node.id];
    expect(next).toMatchObject({ w: 200, h: 100, rotation: 30, geometrySize: { w: 100, h: 50 } }); expect(scene).toEqual(original); expect(draftNode(draft, scene)).toBeNull();
    expect(validDrawingDraft({ ...draft, transform: { ...transform, scale: NaN } })).toBe(false);
    expect(validDrawingDraft({ ...draft, nodeIds: [node.id, "other"], transform: { ...transform, width: 30 } })).toBe(false);
    expect(validDrawingDraft({ ...draft, nodeIds: [node.id, node.id] })).toBe(false);
    expect(transformingDrawingDraft(scene, Array.from({ length: 101 }, () => node.id), transform, 2)).toBeNull();
    buffer.update([{ clientId: 1, presence: { draft: { ...draft, nodeIds: [node.id, "missing"], sequence: 2 } } }], 200); expect(buffer.project(scene, 200).scene).toBe(scene);
    buffer.update([{ clientId: 1, presence: { draft } }], 300); expect(buffer.project(scene, 3400).scene).toBe(scene);
  });
});
