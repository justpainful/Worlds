import { DrawingRenderer } from "./renderer";
import { exportPreparationScene } from "./exportScope";
import { checkDrawingExport } from "./files";
import { extractPixelPng } from "./floatingTasks";
import { pixelSourcePlan,selectionCropAlpha,PixelEditError,type PixelSampleSource,type PixelSourcePlan } from "./floatingPixels";
import { validatePixelDimensions } from "./pixels";
import type { DrawingScene } from "./model";
import type { PixelSelection } from "./selectionController";
import type { DrawingExportContext } from "./exportPolicy";
const abort=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException("Cancelled","AbortError");};
export function pixelCaptureScene(scene:DrawingScene,plan:PixelSourcePlan):DrawingScene{
  const layers={...scene.layers};
  // Current-layer pigment is copied before its layer opacity/blending. The
  // destination layer retains that appearance instead of applying it twice.
  if(plan.source==="current")layers[plan.layerId]={...layers[plan.layerId],opacity:1,blend:"source-over"};
  return{...scene,layers,layerOrder:plan.layers,nodeOrder:plan.nodes};
}
export function pixelExportContext(pageId:string,scene:DrawingScene,plan:PixelSourcePlan):DrawingExportContext{
  const chosen=new Set(plan.layers),layers=Object.fromEntries(Object.entries(scene.layers).map(([id,l])=>[id,{...l,visible:l.visible&&chosen.has(id)}]));
  return{pageId,kind:"images",scenes:[{scene:{...scene,layers},frameId:plan.frame.id,region:plan.region,annotations:true}]};
}
export async function captureSelectedPixels(pageId:string,scene:DrawingScene,selection:PixelSelection,layerId:string,source:PixelSampleSource,signal:AbortSignal,authorize=true):Promise<{blob:Blob;plan:PixelSourcePlan}>{
  const plan=pixelSourcePlan(scene,selection,layerId,source),sample=pixelCaptureScene(scene,plan),r=new DrawingRenderer(),c=document.createElement("canvas");
  try{
    validatePixelDimensions(plan.region.w,plan.region.h);abort(signal);
    if(authorize)await checkDrawingExport(pixelExportContext(pageId,scene,plan));abort(signal);
    await r.prepare(exportPreparationScene(sample,plan.frame.id,plan.region,true));abort(signal);
    c.width=plan.region.w;c.height=plan.region.h;r.render(c,sample,{...plan.region,scale:1},{frameId:plan.frame.id,region:plan.region,background:false});
    const pixels=c.getContext("2d")!.getImageData(0,0,c.width,c.height);abort(signal);
    const blob=await extractPixelPng({width:c.width,height:c.height,data:pixels.data},selectionCropAlpha(selection),signal);abort(signal);
    if(!blob)throw new PixelEditError("empty");return{blob,plan};
  }finally{r.dispose();c.width=c.height=1;}
}
