import { id, type Asset, type Change, type DrawingNode, type Mask, type Rect } from "./model";
import type { PixelSelection } from "./selectionController";
import type { AlphaMaskPreview } from "./pixelSelection";
export const selectionImageRect=(selection:PixelSelection):Rect=>{const b=selection.imageBounds;return{x:selection.frame.x+b.x,y:selection.frame.y+b.y,w:b.w,h:b.h};};
export const selectionPresenceMask=(selection:PixelSelection):AlphaMaskPreview=>({...selection.preview,x:selection.frame.x+selection.preview.x,y:selection.frame.y+selection.preview.y});
/** New paint is in untransformed document axes. Linked local mask coordinates
 * make later original-preserving transforms carry the clipped pigment. */
export function maskNewPaint(node:DrawingNode,selection:PixelSelection,asset:Asset):{node:DrawingNode;change:Change}{
  if(node.rotation||node.flipX||node.flipY||node.geometrySize)throw new Error("Selection masks require the new paint's original axes");
  const r=selectionImageRect(selection),mask:Mask={id:id(),name:"Selection",enabled:true,inverted:false,linked:true,x:r.x-node.x,y:r.y-node.y,w:r.w,h:r.h,base:0,strokes:[],assetId:asset.id};
  return{node:{...node,maskId:mask.id},change:{type:"put",collection:"masks",id:mask.id,value:mask}};
}
