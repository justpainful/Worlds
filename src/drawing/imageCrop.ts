import {id,type Change,type DrawingNode,type DrawingScene,type Rect} from './model';
import {localToWorld} from './geometry';
import {effectiveLayer,layerAncestors} from './layers';
import {drawingJson} from './wire';
export type CropMode='trim'|'fit';
export type CropGrip='move'|'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
export function imageCropSourceKey(scene:DrawingScene,nodeId:string):string{
 const n=scene.nodes[nodeId];if(!n)return 'missing';const maskIds=[n.maskId,...n.effects.map(e=>e.maskId)].filter((v):v is string=>!!v);
 const masks=maskIds.map(id=>scene.masks[id]),assets=[n.assetId,...masks.flatMap(m=>m?[m.assetId,...m.strokes.map(s=>s.brush.tipAssetId)]:[])].filter((v):v is string=>!!v).map(id=>scene.assets[id]);
 return drawingJson({node:n,assets,masks,ancestors:layerAncestors(scene,n.layerId)});
}
export function validImageCrop(crop:Rect,width:number,height:number){return [crop.x,crop.y,crop.w,crop.h,width,height].every(Number.isFinite)&&width>0&&height>0&&crop.x>=0&&crop.y>=0&&crop.w>=1&&crop.h>=1&&crop.x+crop.w<=width+1e-7&&crop.y+crop.h<=height+1e-7;}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function dragImageCrop(start:Rect,grip:CropGrip,dx:number,dy:number,width:number,height:number):Rect{
 if(![dx,dy].every(Number.isFinite))return start;
 if(grip==='move')return{...start,x:clamp(start.x+dx,0,width-start.w),y:clamp(start.y+dy,0,height-start.h)};
 let x=start.x,y=start.y,right=x+start.w,bottom=y+start.h;
 if(grip.includes('w'))x=clamp(x+dx,0,right-1);if(grip.includes('e'))right=clamp(right+dx,x+1,width);
 if(grip.includes('n'))y=clamp(y+dy,0,bottom-1);if(grip.includes('s'))bottom=clamp(bottom+dy,y+1,height);
 return{x,y,w:right-x,h:bottom-y};
}
/** Trim changes the display box at the same source-pixel density, including
 * rotation/reflection. Fit changes source sampling while retaining the box. */
export function imageCropChanges(scene:DrawingScene,before:DrawingNode,crop:Rect,mode:CropMode,sourceKey?:string):{node:DrawingNode;changes:Change[]}{
 const current=scene.nodes[before.id],asset=scene.assets[before.assetId??''];
 if(!current||!asset||!['image','raster'].includes(before.kind)||before.erase)throw Error('crop-source');
 if(sourceKey&&imageCropSourceKey(scene,before.id)!==sourceKey)throw Error('crop-stale');
 if([before.maskId,...before.effects.map(effect=>effect.maskId)].some(maskId=>maskId&&!scene.masks[maskId]))throw Error('crop-mask-missing');
 const state=effectiveLayer(scene,current.layerId);if(current.locked||state.locked||state.positionLocked&&mode==='trim')throw Error('crop-locked');
 if(!validImageCrop(crop,asset.width,asset.height))throw Error('crop-bounds');
 const old=before.crop??{x:0,y:0,w:asset.width,h:asset.height},next={...structuredClone(current),crop:{...crop}},changes:Change[]=[];
 if(drawingJson(old)===drawingJson(crop))return{node:next,changes:[]};
 if(mode==='trim'){
  const center=localToWorld(before,{x:before.w*(crop.x+crop.w/2-old.x)/old.w,y:before.h*(crop.y+crop.h/2-old.y)/old.h});
  next.w=before.w*crop.w/old.w;next.h=before.h*crop.h/old.h;next.x=center.x-next.w/2;next.y=center.y-next.h/2;
  const geometry=before.geometrySize??{w:before.w,h:before.h},offset={x:geometry.w*(crop.x-old.x)/old.w,y:geometry.h*(crop.y-old.y)/old.h};
  next.geometrySize={w:geometry.w*crop.w/old.w,h:geometry.h*crop.h/old.h};
  const remap=new Map<string,string>();for(const maskId of [before.maskId,...before.effects.map(e=>e.maskId)].filter((v):v is string=>!!v)){if(remap.has(maskId))continue;const mask=scene.masks[maskId];if(mask?.linked){const clone=structuredClone(mask);clone.id=id();clone.x-=offset.x;clone.y-=offset.y;clone.w??=geometry.w;clone.h??=geometry.h;for(const stroke of clone.strokes)stroke.samples=stroke.samples.map(s=>({...s,x:s.x-offset.x,y:s.y-offset.y}));remap.set(maskId,clone.id);changes.push({type:'put',collection:'masks',id:clone.id,value:clone});}}if(before.maskId&&remap.has(before.maskId))next.maskId=remap.get(before.maskId);next.effects=before.effects.map(e=>e.maskId&&remap.has(e.maskId)?{...e,maskId:remap.get(e.maskId)}:e);
 }
 if(![next.x,next.y,next.w,next.h].every(Number.isFinite)||next.w<.000001||next.h<.000001||next.w>1e9||next.h>1e9)throw Error('crop-bounds');
 const fields:Record<string,unknown>={crop:next.crop};if(mode==='trim')Object.assign(fields,{x:next.x,y:next.y,w:next.w,h:next.h,geometrySize:next.geometrySize,...(next.maskId!==current.maskId?{maskId:next.maskId}:{}),...(drawingJson(next.effects)!==drawingJson(current.effects)?{effects:next.effects}:{})});changes.push({type:'patch',collection:'nodes',id:next.id,fields});return{node:next,changes};
}
export function cropPreviewScene(scene:DrawingScene,node:DrawingNode,changes:Change[]):DrawingScene{
 const masks={...scene.masks};for(const change of changes)if(change.type==='put'&&change.collection==='masks')masks[change.id]=change.value as DrawingScene['masks'][string];
 return{...scene,masks,nodes:{...scene.nodes,[node.id]:node}};
}
