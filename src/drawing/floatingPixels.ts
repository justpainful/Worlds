import {effectiveLayer,layerAncestors,layerShown} from "./layers";
import { drawingJson } from "./wire";
import { exportNodeVisible } from "./exportScope";
import { id, newLayer, newNode, type Asset, type Change, type DrawingNode, type DrawingScene, type Frame, type Layer, type Rect } from "./model";
import {intersects,worldInkBounds} from "./geometry";
import { validatePixels, validatePixelDimensions, type Pixels } from "./pixels";
import type { SelectionRaster } from "./pixelSelection";

export type PixelSampleSource = "current" | "visible";
export type PixelAction = "move" | "duplicate" | "copy" | "cut" | "delete";
export type PixelEditAction=PixelAction|"paste"|"import";
export class PixelEditError extends Error {
  constructor(readonly code:"empty"|"locked"|"stale"|"invalid"|"redaction"){super(`Pixel edit: ${code}`);}
}
export interface PixelSourcePlan { frame:Frame; region:Rect; layers:string[]; nodes:string[]; fingerprint:string; source:PixelSampleSource; layerId:string }
export function pixelSourcePlan(scene:DrawingScene,selection:SelectionRaster&{frame:Frame},layerId:string,source:PixelSampleSource,destructive=false):PixelSourcePlan{
  const frame=scene.frames[selection.frame.id];
  if(!frame||["x","y","w","h"].some(key=>frame[key as "x"]!==selection.frame[key as "x"]))throw new PixelEditError("stale");
  validatePixelDimensions(selection.width,selection.height);
  if(!selection.pixels||!selection.bounds)throw new PixelEditError("empty");
  const b=selection.imageBounds,region={x:frame.x+b.x,y:frame.y+b.y,w:b.w,h:b.h};
  const redactions=scene.nodeOrder.map(id=>scene.nodes[id]).filter(n=>n.redaction&&n.visible&&layerShown(scene,n.layerId)&&(n.frameId===frame.id||n.frameId===null)&&intersects(worldInkBounds(n),region));
  if(redactions.length&&(destructive||source==="current"))throw new PixelEditError("redaction");
  const coverLayers=new Set(redactions.map(n=>n.layerId));
  const layers=scene.layerOrder.filter(key=>(source==="visible"||key===layerId)&&(effectiveLayer(scene,key).visible||coverLayers.has(key)));
  const chosen=new Set(layers),nodes=scene.nodeOrder.filter(key=>chosen.has(scene.nodes[key].layerId)&&exportNodeVisible(scene,scene.nodes[key],frame.id,region,true));
  if(!nodes.length)throw new PixelEditError("empty");
  if(destructive&&(layers.some(key=>effectiveLayer(scene,key).locked||effectiveLayer(scene,key).alphaLocked)||nodes.some(key=>scene.nodes[key].locked)))throw new PixelEditError("locked");
  const assets=new Set<string>(),masks=new Set<string>(),targets=new Set<string>();
  for(const key of nodes){const node=scene.nodes[key];if(node.assetId)assets.add(node.assetId);if(node.brush?.tipAssetId)assets.add(node.brush.tipAssetId);if(node.maskId)masks.add(node.maskId);for(const e of node.effects)if(e.enabled&&e.maskId)masks.add(e.maskId);for(const a of[node.anchor,node.endAnchor])if(a?.nodeId)targets.add(a.nodeId);}
  for(const key of masks){const m=scene.masks[key];if(m?.assetId)assets.add(m.assetId);for(const s of m?.strokes??[])if(s.brush.tipAssetId)assets.add(s.brush.tipAssetId);}
  const fingerprint=drawingJson({frame,layers:layers.map(key=>scene.layers[key]),ancestors:layers.flatMap(key=>layerAncestors(scene,key).slice(1)),nodes:nodes.map(key=>scene.nodes[key]),targets:[...targets].sort().map(key=>scene.nodes[key]??null),masks:[...masks].sort().map(key=>scene.masks[key]),assets:[...assets].sort().map(key=>scene.assets[key])});
  return{frame:structuredClone(frame),region,layers,nodes,fingerprint,source,layerId};
}
export function checkPixelSource(scene:DrawingScene,selection:SelectionRaster&{frame:Frame},plan:PixelSourcePlan,destructive:boolean){
  const current=pixelSourcePlan(scene,selection,plan.layerId,plan.source,destructive);
  if(current.fingerprint!==plan.fingerprint)throw new PixelEditError("stale");
}
/** Crop and apply authoritative alpha without changing source RGBA buffers. The
 * returned PNG domain retains the selection's interpolation neighbors. */
export function extractSelectedPixels(image:Pixels,alpha:Uint8ClampedArray):(Pixels & {data:Uint8ClampedArray<ArrayBuffer>})|null{
  validatePixels(image);if(alpha.length!==image.width*image.height)throw new PixelEditError("invalid");
  const data=new Uint8ClampedArray(image.data.length);let painted=false;
  for(let i=0;i<alpha.length;i++){
    const a=Math.round(image.data[i*4+3]*alpha[i]/255);data[i*4+3]=a;
    if(a){painted=true;data[i*4]=image.data[i*4];data[i*4+1]=image.data[i*4+1];data[i*4+2]=image.data[i*4+2];}
  }
  return painted?{width:image.width,height:image.height,data}:null;
}
export function selectionCropAlpha(selection:SelectionRaster):Uint8ClampedArray{
  if(selection.mask.length!==validatePixelDimensions(selection.width,selection.height))throw new PixelEditError("invalid");
  const b=selection.imageBounds;validatePixelDimensions(b.w,b.h);
  if(!Number.isSafeInteger(b.x)||!Number.isSafeInteger(b.y)||b.x<0||b.y<0||b.x+b.w>selection.width||b.y+b.h>selection.height)throw new PixelEditError("invalid");
  const alpha=new Uint8ClampedArray(b.w*b.h);
  for(let y=0;y<b.h;y++)alpha.set(selection.mask.subarray((b.y+y)*selection.width+b.x,(b.y+y)*selection.width+b.x+b.w),y*b.w);
  return alpha;
}
export interface FloatingPixelArtwork { asset:Asset; node:DrawingNode; eraseAsset:Asset; erasers:DrawingNode[]; layer:Layer; afterLayer:string|null }
/** External images have a placement, with no sampled-source plan or erase. */
export function imagePixelArtwork(frame:Frame,width:number,height:number,mime:string,name:string,orientation=1):FloatingPixelArtwork{
  validatePixelDimensions(width,height);
  if(!Number.isInteger(orientation)||orientation<1||orientation>8)throw new PixelEditError("invalid");
  const asset:Asset={id:id(),attachmentId:id(),name,mime,width,height},layer=newLayer(name),node=newNode("image",layer.id,frame.id,{x:frame.x+(frame.w-width)/2,y:frame.y+(frame.h-height)/2,w:width,h:height});
  node.name=name;node.assetId=asset.id;
  if(orientation!==1)asset.orientation=orientation;
  return{asset,node,layer,afterLayer:null,eraseAsset:{...asset,id:id(),attachmentId:id()},erasers:[]};
}
/** Immutable source nodes/masks remain untouched. Erase nodes remove existing
 * layer pigment, while future nodes above them remain editable and paintable. */
export function floatingPixelArtwork(scene:DrawingScene,plan:PixelSourcePlan,action:PixelAction):FloatingPixelArtwork{
  const asset:Asset={id:id(),attachmentId:id(),name:"Selected pixels",mime:"image/png",width:plan.region.w,height:plan.region.h};
  const eraseAsset:Asset={...asset,id:id(),attachmentId:id(),name:"Pixel selection erase"};
  const layer=newLayer("Selected pixels"),sourceLayer=scene.layers[plan.layerId];
  if(plan.source==="current"){if(!sourceLayer)throw new PixelEditError("stale");layer.opacity=sourceLayer.opacity;layer.blend=sourceLayer.blend;layer.parentId=sourceLayer.parentId;}
  const node=newNode("raster",layer.id,plan.frame.id,plan.region);node.name="Selected pixels";node.assetId=asset.id;
  const erasers=action==="move"||action==="cut"||action==="delete"?plan.layers.map(layer=>{const n=newNode("raster",layer,plan.frame.id,plan.region);n.name="Pixel selection erase";n.assetId=eraseAsset.id;n.erase=true;return n;}):[];
  return{asset,node,eraseAsset,erasers,layer,afterLayer:plan.source==="current"?plan.layerId:null};
}
const pixelLayerOrder=(scene:DrawingScene,art:FloatingPixelArtwork)=>{const order=[...scene.layerOrder];order.splice(art.afterLayer?order.indexOf(art.afterLayer)+1:order.length,0,art.layer.id);return order;};
export function pixelArtworkChanges(scene:DrawingScene,art:FloatingPixelArtwork,node:DrawingNode|null):Change[]{
  const nodes=[...art.erasers,...(node?[node]:[])],assets=[...(art.erasers.length?[art.eraseAsset]:[]),...(node?[art.asset]:[])];
  if(!nodes.length)return[];
  if(nodes.some(n=>scene.nodes[n.id])||assets.some(a=>scene.assets[a.id]))throw new PixelEditError("stale");
  return[...(node?[{type:"put",collection:"layers",id:art.layer.id,value:art.layer}as Change,{type:"order",list:"layerOrder",ids:pixelLayerOrder(scene,art)}as Change]:[]),...assets.map((a):Change=>({type:"put",collection:"assets",id:a.id,value:a})),...nodes.map((n):Change=>({type:"put",collection:"nodes",id:n.id,value:n})),{type:"order",list:"nodeOrder",ids:[...scene.nodeOrder,...nodes.map(n=>n.id)]}];
}
export function projectedPixelScene(scene:DrawingScene,art:FloatingPixelArtwork,node:DrawingNode|null):DrawingScene{
  return{...scene,layers:{...scene.layers,...(node?{[art.layer.id]:art.layer}:{})},layerOrder:node?pixelLayerOrder(scene,art):scene.layerOrder,assets:{...scene.assets,[art.asset.id]:art.asset,[art.eraseAsset.id]:art.eraseAsset},nodes:{...scene.nodes,...Object.fromEntries(art.erasers.map(n=>[n.id,n])),...(node?{[node.id]:node}:{})},nodeOrder:[...scene.nodeOrder,...art.erasers.map(n=>n.id),...(node?[node.id]:[])]};
}
export const samePixelTransform=(a:DrawingNode,b:DrawingNode)=>["x","y","w","h","rotation","flipX","flipY"].every(key=>a[key as "x"]===b[key as "x"]);
