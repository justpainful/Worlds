import {id,type Asset,type Change,type DrawingNode,type DrawingScene,type Mask,type Rect} from './model';
import {worldInkBounds} from './geometry';
import {effectiveLayer} from './layers';
import {imageCropSourceKey} from './imageCrop';
export function nodeMask(scene:DrawingScene,n:DrawingNode,effectId?:string){const key=effectId?n.effects.find(e=>e.id===effectId)?.maskId:n.maskId;return key?scene.masks[key]:undefined;}
export function maskDomain(scene:DrawingScene,n:DrawingNode,linked:boolean):{linked:boolean;rect:Rect;width:number;height:number}{
 const geometry=n.geometrySize??{w:n.w,h:n.h},asset=scene.assets[n.assetId??''],image=['image','raster'].includes(n.kind),sourceWidth=image?n.crop?.w??asset?.width??geometry.w:geometry.w,sourceHeight=image?n.crop?.h??asset?.height??geometry.h:geometry.h,rect=linked?{x:0,y:0,w:geometry.w,h:geometry.h}:worldInkBounds(n),density=image?Math.max(sourceWidth/Math.max(n.w,.000001),sourceHeight/Math.max(n.h,.000001)):1;
 const width=Math.max(1,Math.ceil(linked?sourceWidth:rect.w*density)),height=Math.max(1,Math.ceil(linked?sourceHeight:rect.h*density));
 if(!Number.isFinite(width)||!Number.isFinite(height)||width*height>16*1024*1024)throw Error('mask-size');return{linked,rect,width,height};
}
export function maskDraft(scene:DrawingScene,n:DrawingNode,mask:Mask,asset:Asset,effectId?:string):DrawingScene{
 const node=effectId?{...n,effects:n.effects.map(e=>e.id===effectId?{...e,maskId:mask.id}:e)}:{...n,maskId:mask.id};return{...scene,nodes:{...scene.nodes,[n.id]:node},masks:{...scene.masks,[mask.id]:mask},assets:{...scene.assets,[asset.id]:asset}};
}
export function maskEditChanges(scene:DrawingScene,nodeId:string,effectId:string|undefined,sourceKey:string,mask:Mask,asset:Asset):Change[]{
 const n=scene.nodes[nodeId];if(!n||effectId&&!n.effects.some(e=>e.id===effectId))throw Error('mask-missing');if(imageCropSourceKey(scene,nodeId)!==sourceKey)throw Error('mask-stale');if(n.locked||effectiveLayer(scene,n.layerId).locked)throw Error('mask-locked');
 const ownAsset={...asset,id:id()},ownMask={...mask,id:id(),assetId:ownAsset.id},fields=effectId?{effects:n.effects.map(e=>e.id===effectId?{...e,maskId:ownMask.id}:e)}:{maskId:ownMask.id};
 return[{type:'put',collection:'assets',id:ownAsset.id,value:ownAsset},{type:'put',collection:'masks',id:ownMask.id,value:ownMask},{type:'patch',collection:'nodes',id:nodeId,fields}];
}
/** Unnamed shared-mask editing must not alter another element or adjustment. */
export function maskPropertyChanges(scene:DrawingScene,nodeId:string,effectId:string|undefined,sourceKey:string,patch:Partial<Pick<Mask,'enabled'|'inverted'>>):Change[]{
 const n=scene.nodes[nodeId];if(!n)throw Error('mask-missing');if(imageCropSourceKey(scene,nodeId)!==sourceKey)throw Error('mask-stale');if(n.locked||effectiveLayer(scene,n.layerId).locked)throw Error('mask-locked');
 if(!Object.keys(patch).length||Object.entries(patch).some(([key,value])=>!['enabled','inverted'].includes(key)||typeof value!=='boolean'))throw Error('mask-invalid');
 const mask=nodeMask(scene,n,effectId);if(!mask)throw Error('mask-missing');const count=Object.values(scene.nodes).reduce((sum,node)=>sum+(node.maskId===mask.id?1:0)+node.effects.filter(e=>e.maskId===mask.id).length,0);
 if(count<=1)return[{type:'patch',collection:'masks',id:mask.id,fields:patch}];
 const clone={...structuredClone(mask),...patch,id:id()},fields=effectId?{effects:n.effects.map(e=>e.id===effectId?{...e,maskId:clone.id}:e)}:{maskId:clone.id};return[{type:'put',collection:'masks',id:clone.id,value:clone},{type:'patch',collection:'nodes',id:nodeId,fields}];
}
