import {useEffect,useMemo,useRef} from "react";
import type {DrawingScene} from "./model";
import {bounds,worldRenderBounds} from "./geometry";
import {effectiveLayer} from "./layers";
import {isRedaction,redactionShown,redactionBounds} from "./redaction";
import type {DrawingNode,Rect} from "./model";
import {DrawingRenderer,type Viewport} from "./renderer";
function visibleBounds(scene:DrawingScene,node:DrawingNode):Rect|null{
 if(isRedaction(node)?!redactionShown(scene,node):!node.visible||node.opacity<=0||!effectiveLayer(scene,node.layerId).visible)return null;
 const b=isRedaction(node)?redactionBounds(node):worldRenderBounds(node),frame=node.frameId?scene.frames[node.frameId]:undefined;
 if(!frame?.clip)return b;
 const x=Math.max(b.x,frame.x),y=Math.max(b.y,frame.y),right=Math.min(b.x+b.w,frame.x+frame.w),bottom=Math.min(b.y+b.h,frame.y+frame.h);
 return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;
}
export function DrawingMinimap({scene,view,onView,arabic}:{scene:DrawingScene;view:Viewport;onView:(view:Viewport)=>void;arabic:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),drag=useRef<number|null>(null),renderer=useRef<DrawingRenderer|null>(null);
 const {box,scale,preparation}=useMemo(()=>{
  const visible=Object.values(scene.nodes).map(node=>({node,bounds:visibleBounds(scene,node)})).filter((entry):entry is {node:DrawingNode;bounds:Rect}=>!!entry.bounds);
  const all=[...Object.values(scene.frames),...visible.map(entry=>entry.bounds)],box=bounds(all.flatMap(b=>[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y+b.h}]),30),scale=Math.min(192/box.w,128/box.h);
  // Anchored connectors may cross into a clipped frame even when their own
  // bounds do not. Keep their dependencies ready conservatively.
  const visibleIds=new Set(visible.map(({node})=>node.id)),prepared=Object.values(scene.nodes).filter(node=>visibleIds.has(node.id)||!!(node.anchor||node.endAnchor)&&node.visible&&node.opacity>0&&effectiveLayer(scene,node.layerId).visible);
  const assets=new Set<string>(),masks=new Set<string>();
  for(const node of prepared){if(node.assetId)assets.add(node.assetId);if(node.brush?.tipAssetId)assets.add(node.brush.tipAssetId);if(node.maskId)masks.add(node.maskId);for(const effect of node.effects)if(effect.enabled&&effect.maskId)masks.add(effect.maskId);}
  for(const id of masks){const mask=scene.masks[id];if(!mask?.enabled)continue;if(mask.assetId)assets.add(mask.assetId);for(const stroke of mask.strokes)if(stroke.brush.tipAssetId)assets.add(stroke.brush.tipAssetId);}
  const nodes=Object.fromEntries(prepared.map(node=>[node.id,node])),preparation={...scene,nodes,nodeOrder:scene.nodeOrder.filter(id=>!!nodes[id]),assets:Object.fromEntries([...assets].filter(id=>scene.assets[id]).map(id=>[id,scene.assets[id]]))};
  return {box,scale,preparation};
 },[scene]);
 useEffect(()=>{const r=new DrawingRenderer();renderer.current=r;return()=>{r.dispose();renderer.current=null;};},[]);
 useEffect(()=>{let active=true;const r=renderer.current!;void r.prepare(preparation).then(()=>{if(active&&canvas.current)r.render(canvas.current,scene,{...box,scale});},()=>{});return()=>{active=false;};},[scene,preparation,box.x,box.y,box.w,box.h,scale]);
 const center=(e:React.PointerEvent)=>{const r=e.currentTarget.getBoundingClientRect(),x=box.x+(e.clientX-r.left)/r.width*192/scale,y=box.y+(e.clientY-r.top)/r.height*128/scale;onView({...view,x:x-view.w/2,y:y-view.h/2});};
 return <div className="drawing-minimap" role="application" aria-label={arabic?"الخريطة المصغرة، استخدم الأسهم لتحريك العرض":"Drawing minimap, use arrow keys to move the view"} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" tabIndex={0} onPointerDown={e=>{e.stopPropagation();if(e.button!==0||drag.current!==null)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current=e.pointerId;center(e);}} onPointerMove={e=>{e.stopPropagation();if(drag.current===e.pointerId)center(e);}} onPointerUp={e=>{e.stopPropagation();if(drag.current===e.pointerId){drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}} onPointerCancel={e=>{e.stopPropagation();if(drag.current===e.pointerId)drag.current=null;}} onLostPointerCapture={e=>{e.stopPropagation();if(drag.current===e.pointerId)drag.current=null;}} onWheel={e=>e.stopPropagation()} onKeyDown={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();e.stopPropagation();onView({...view,x:view.x+(e.key==="ArrowLeft"?-view.w/10:e.key==="ArrowRight"?view.w/10:0),y:view.y+(e.key==="ArrowUp"?-view.h/10:e.key==="ArrowDown"?view.h/10:0)});}}}>
 <canvas ref={canvas} width={192} height={128}/><svg viewBox="0 0 192 128" aria-hidden="true"><rect x={(view.x-box.x)*scale} y={(view.y-box.y)*scale} width={view.w*scale} height={view.h*scale} fill="#007aff20" stroke="#007aff" strokeWidth={1.5}/></svg></div>;
}
