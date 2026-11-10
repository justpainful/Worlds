import {id,type Asset,type Change,type DrawingNode,type DrawingScene,type Mask,type Rect} from './model';
import {bounds,worldRenderBounds} from './geometry';
import {sourceInkRect,strokeBounds} from './brushBounds';
import {identity,inverse,nodeMatrix,transformPoint} from './affine';
import {effectiveLayer} from './layers';
import {imageCropSourceKey} from './imageCrop';
export function nodeMask(scene:DrawingScene,n:DrawingNode,effectId?:string){const key=effectId?n.effects.find(e=>e.id===effectId)?.maskId:n.maskId;return key?scene.masks[key]:undefined;}
export function maskDomain(scene:DrawingScene,n:DrawingNode,linked:boolean,existing?:Mask):{linked:boolean;rect:Rect;width:number;height:number}{
 const geometry=n.geometrySize??{w:n.w,h:n.h},asset=scene.assets[n.assetId??''],image=['image','raster'].includes(n.kind),sourceWidth=image?n.crop?.w??asset?.width??geometry.w:geometry.w,sourceHeight=image?n.crop?.h??asset?.height??geometry.h:geometry.h,density=image?Math.max(sourceWidth/Math.max(n.w,.000001),sourceHeight/Math.max(n.h,.000001)):1;
 // Strokes and paths can extend well beyond their nominal geometry, including
 // negative local coordinates. The linked mask must cover their actual ink.
 const ink=image?{x:0,y:0,w:geometry.w,h:geometry.h}:sourceInkRect(n),scale=Math.max(.000001,Math.min(n.w/geometry.w,n.h/geometry.h)),blur=image?0:n.effects.reduce((sum,e)=>sum+(e.enabled&&e.kind==='blur'?Math.max(0,e.amount)*3/scale:0),0),pad=(image||n.kind==='stroke'?0:Math.max(0,n.paint.strokeWidth)/2)+blur,local={x:ink.x-pad,y:ink.y-pad,w:ink.w+pad*2,h:ink.h+pad*2};let rect=linked?local:worldRenderBounds(n);
 if(existing){const fallbackW=existing.linked?geometry.w:n.w,fallbackH=existing.linked?geometry.h:n.h,parts:Rect[]=[{x:existing.x,y:existing.y,w:existing.w??fallbackW,h:existing.h??fallbackH},...existing.strokes.filter(s=>s.samples.length).map(s=>strokeBounds(s.samples,s.brush))],matrix=existing.linked===linked?identity():existing.linked?nodeMatrix(identity(),n):inverse(nodeMatrix(identity(),n)),points=parts.flatMap(r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}].map(p=>transformPoint(matrix,p)));rect=bounds([{x:rect.x,y:rect.y},{x:rect.x+rect.w,y:rect.y+rect.h},...points]);}
 const width=Math.max(1,Math.ceil(linked?rect.w*(image?sourceWidth/geometry.w:1):rect.w*density)),height=Math.max(1,Math.ceil(linked?rect.h*(image?sourceHeight/geometry.h:1):rect.h*density));
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
