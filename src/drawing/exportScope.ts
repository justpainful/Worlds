import {effectiveLayer} from "./layers";
import { intersects, worldRenderBounds } from "./geometry";
import type { DrawingNode, DrawingScene, Rect } from "./model";
import {isRedaction,redactionShown,redactionBounds} from './redaction';
export function exportNodeVisible(scene:DrawingScene,node:DrawingNode,frameId:string,region:Rect,annotations:boolean){
  if(isRedaction(node))return redactionShown(scene,node)&&(node.frameId===null||node.frameId===frameId)&&intersects(redactionBounds(node),region);
  const layer=effectiveLayer(scene,node.layerId);
  if(!node.visible||node.opacity<=0||!layer.visible||node.frameId!==null&&node.frameId!==frameId||!annotations&&(node.anchor||node.annotationGroup))return false;
  if(node.anchor||node.endAnchor)return true;
  const box=worldRenderBounds(node);
  return intersects(box,region);
}
/** Preparing one frame must not load originals or live previews used only in
 * other frames, hidden layers, or omitted annotations. Anchor targets remain
 * in the scene used for rendering, so connector geometry is unchanged. */
export function exportPreparationScene(scene:DrawingScene,frameId:string,region:Rect,annotations:boolean):DrawingScene{
  const nodes=scene.nodeOrder.map((id)=>scene.nodes[id]).filter((node)=>exportNodeVisible(scene,node,frameId,region,annotations)),assets=new Set<string>(),masks=new Set<string>();
  for(const node of nodes){if(node.assetId)assets.add(node.assetId);if(node.brush?.tipAssetId)assets.add(node.brush.tipAssetId);if(node.maskId)masks.add(node.maskId);for(const effect of node.effects)if(effect.enabled&&effect.maskId)masks.add(effect.maskId);}
  for(const id of masks){const mask=scene.masks[id];if(!mask?.enabled)continue;if(mask.assetId)assets.add(mask.assetId);for(const stroke of mask.strokes)if(stroke.brush.tipAssetId)assets.add(stroke.brush.tipAssetId);}
  return {...scene,nodes:Object.fromEntries(nodes.map((n)=>[n.id,n])),nodeOrder:nodes.map((n)=>n.id),assets:Object.fromEntries([...assets].filter((id)=>scene.assets[id]).map((id)=>[id,scene.assets[id]]))};
}
