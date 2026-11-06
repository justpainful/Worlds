import { describe,expect,it } from "vitest";
import { newDrawing } from "./operations";
import { newFrame,newNode } from "./model";
import { exportPreparationScene } from "./exportScope";
describe("frame export source scope",()=>{
  it("loads only visible frame originals, keeps connector targets for rendering and retains the original scene",()=>{
    const scene=newDrawing().scene,frame=scene.frames[scene.defaultFrameId],second=newFrame("Other",{x:2000});scene.frames[second.id]=second;scene.frameOrder.push(second.id);
    for(const[id,frameId,x,visible]of [["current",frame.id,10,true],["other",second.id,2020,true],["hidden",frame.id,20,false],["outside",frame.id,4000,true]]as const){const node=newNode("image",scene.layerOrder[0],frameId,{x,y:20,w:100,h:100});node.id=id;node.visible=visible;node.assetId=id;scene.nodes[id]=node;scene.nodeOrder.push(id);scene.assets[id]={id,attachmentId:id,name:id,mime:"image/png",width:100,height:100};}
    const before=structuredClone(scene),scope=exportPreparationScene(scene,frame.id,frame,true);expect(scope.nodeOrder).toEqual(["current"]);expect(Object.keys(scope.assets)).toEqual(["current"]);expect(scene).toEqual(before);
    const arrow=newNode("shape",scene.layerOrder[0],frame.id);arrow.anchor={nodeId:"other",u:0.5,v:0.5,fallback:{x:0,y:0}};scene.nodes[arrow.id]=arrow;scene.nodeOrder.push(arrow.id);
    expect(exportPreparationScene(scene,frame.id,frame,false).nodeOrder).not.toContain(arrow.id);expect(scene.nodes.other).toBeDefined();
  });
});
