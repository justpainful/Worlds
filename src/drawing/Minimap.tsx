import {useEffect,useRef} from "react";
import type {DrawingScene} from "./model";
import {bounds,worldInkBounds} from "./geometry";
import {DrawingRenderer,type Viewport} from "./renderer";
export function DrawingMinimap({scene,view,onView,arabic}:{scene:DrawingScene;view:Viewport;onView:(view:Viewport)=>void;arabic:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),drag=useRef(false),renderer=useRef<DrawingRenderer|null>(null),all=[...Object.values(scene.frames),...Object.values(scene.nodes).filter(n=>n.visible).map(worldInkBounds)],box=bounds(all.flatMap(b=>[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y+b.h}]),30),scale=Math.min(192/box.w,128/box.h);
 useEffect(()=>{const r=new DrawingRenderer();renderer.current=r;return()=>{r.dispose();renderer.current=null;};},[]);
 useEffect(()=>{let active=true;const r=renderer.current!;void r.prepare(scene).then(()=>{if(active&&canvas.current)r.render(canvas.current,scene,{...box,scale});},()=>{});return()=>{active=false;};},[scene,box.x,box.y,box.w,box.h,scale]);
 const center=(e:React.PointerEvent)=>{const r=e.currentTarget.getBoundingClientRect(),x=box.x+(e.clientX-r.left)/r.width*192/scale,y=box.y+(e.clientY-r.top)/r.height*128/scale;onView({...view,x:x-view.w/2,y:y-view.h/2});};
 return <div className="drawing-minimap" role="application" aria-label={arabic?"الخريطة المصغرة":"Drawing minimap"} tabIndex={0} onPointerDown={e=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);drag.current=true;center(e);}} onPointerMove={e=>{e.stopPropagation();if(drag.current)center(e);}} onPointerUp={e=>{e.stopPropagation();drag.current=false;}} onPointerCancel={()=>{drag.current=false;}} onWheel={e=>e.stopPropagation()} onKeyDown={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();e.stopPropagation();onView({...view,x:view.x+(e.key==="ArrowLeft"?-view.w/10:e.key==="ArrowRight"?view.w/10:0),y:view.y+(e.key==="ArrowUp"?-view.h/10:e.key==="ArrowDown"?view.h/10:0)});}}}>
 <canvas ref={canvas} width={192} height={128}/><svg viewBox="0 0 192 128" aria-hidden="true"><rect x={(view.x-box.x)*scale} y={(view.y-box.y)*scale} width={view.w*scale} height={view.h*scale} fill="#007aff20" stroke="#007aff" strokeWidth={1.5}/></svg></div>;
}
