import type {DrawingScene,DrawingNode,Rect} from './model';
import {layerTree} from './layers';
import {worldInkBounds} from './geometry';
export const PREFIX_PIXEL_LIMIT=64*1024*1024,PREFIX_KEY_LIMIT=2*1024*1024;
export function draftDeviceBounds(scene:DrawingScene,view:Rect&{scale:number},width:number,height:number,options:PrefixOptions):Rect|null{
 const drafts=[...(options.draft?[options.draft]:[]),...options.drafts??[]].filter(n=>!scene.nodes[n.id]);if(!drafts.length||drafts.some(n=>n.kind!=='stroke'||!n.samples?.length||n.anchor||n.endAnchor||n.effects.some(e=>e.enabled)))return null;
 let x=width,y=height,right=0,bottom=0;for(const node of drafts){const box=worldInkBounds(node);x=Math.min(x,Math.max(0,Math.floor((box.x-view.x)*view.scale)-4));y=Math.min(y,Math.max(0,Math.floor((box.y-view.y)*view.scale)-4));right=Math.max(right,Math.min(width,Math.ceil((box.x+box.w-view.x)*view.scale)+4));bottom=Math.max(bottom,Math.min(height,Math.ceil((box.y+box.h-view.y)*view.scale)+4));}
 return{x:Math.min(width,x),y:Math.min(height,y),w:Math.max(0,right-x),h:Math.max(0,bottom-y)};
}
export function unionDeviceBounds(a:Rect,b:Rect):Rect{if(a.w<=0||a.h<=0)return b;if(b.w<=0||b.h<=0)return a;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};}
interface PrefixOptions{frameId?:string;region?:Rect;layerId?:string;activeLayerId?:string;hiddenNodeIds?:string[];annotations?:boolean;background?:boolean;draft?:DrawingNode;drafts?:DrawingNode[]}
/** A cached prefix is already composited against the real frame background.
 * Never cache the dirty root: erase/alpha-lock/group opacity need its original
 * isolated pixels, and every root above it must blend against the new result. */
export function viewportPrefixPlan(scene:DrawingScene,view:Rect&{scale:number},width:number,height:number,options:PrefixOptions,epoch:number,immutableContent?:string){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||options.layerId||width*height*4>PREFIX_PIXEL_LIMIT||scene.nodeOrder.length>4096)return null;
 const drafts=[...(options.draft?[options.draft]:[]),...options.drafts??[]].filter(n=>!scene.nodes[n.id]);if(!drafts.length&&!options.activeLayerId)return null;
 const tree=layerTree(scene),roots=tree.get(null)??[],rootOf=new Map<string,string>();
 const pending=roots.map(root=>({id:root,root,depth:0}));while(pending.length){const next=pending.pop()!;if(next.depth>64)return null;if(rootOf.has(next.id))continue;rootOf.set(next.id,next.root);for(const id of tree.get(next.id)??[])pending.push({id,root:next.root,depth:next.depth+1});}
 let prefixCount=roots.length;
 if(!drafts.length){const root=rootOf.get(options.activeLayerId!),index=root?roots.indexOf(root):-1;if(index<0)return null;prefixCount=index;}
 for(const draft of drafts){if(draft.redaction)continue;const root=rootOf.get(draft.layerId),index=root?roots.indexOf(root):-1;if(index>=0)prefixCount=Math.min(prefixCount,index);}
 if(!prefixCount)return null;
 let points=0,text=0;
 for(const id of scene.nodeOrder){const node=scene.nodes[id];if(node.kind==='reference')return null;
  points+=(node.samples?.length??0)+(node.points?.length??0)+(node.path?.vertices.length??0);text+=node.text?.length??0;
  if(points>32768||text>262144)return null;
 }
 for(const mask of Object.values(scene.masks)){for(const stroke of mask.strokes)points+=stroke.samples.length;if(points>32768)return null;}
 // Full semantic JSON avoids hash collisions and catches in-place mutations in
 // tests as well as normal immutable document updates and remote projections.
 const key=JSON.stringify([epoch,width,height,view,options.frameId,options.region,options.hiddenNodeIds,options.annotations,options.background,prefixCount])+"|"+(immutableContent??JSON.stringify(scene));
 if(key.length*2>PREFIX_KEY_LIMIT)return null;
 return{key,prefixCount,roots,epoch,keyBytes:key.length*2};
}
