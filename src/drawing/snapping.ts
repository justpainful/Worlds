import type {DrawingNode,DrawingScene,Frame,Point} from "./model";
import {worldInkBounds} from "./geometry";
function closest(values:number[],targets:number[],limit:number){let best=0,distance=limit;for(const value of values)for(const target of targets){const delta=target-value;if(Math.abs(delta)<distance){best=delta;distance=Math.abs(delta);}}return best;}
export function snapPoint(frame:Frame,point:Point,scale:number,disable=false):Point{
 if(disable||!frame.grid?.snap)return point;const size=frame.grid.size,limit=6/scale,x=[frame.x+Math.round((point.x-frame.x)/size)*size,...(frame.guides??[]).filter(g=>g.axis==="x").map(g=>frame.x+g.at)],y=[frame.y+Math.round((point.y-frame.y)/size)*size,...(frame.guides??[]).filter(g=>g.axis==="y").map(g=>frame.y+g.at)];return{x:point.x+closest([point.x],x,limit),y:point.y+closest([point.y],y,limit)};
}
export function snapMove(scene:DrawingScene,frame:Frame,nodes:DrawingNode[],delta:Point,scale:number,disable=false):Point{
 if(disable||!frame.grid?.snap||!nodes.length)return delta;const selected=new Set(nodes.map(n=>n.id)),boxes=nodes.map(n=>worldInkBounds(n)),x=boxes.flatMap(b=>[b.x+delta.x,b.x+b.w/2+delta.x,b.x+b.w+delta.x]),y=boxes.flatMap(b=>[b.y+delta.y,b.y+b.h/2+delta.y,b.y+b.h+delta.y]),targets=scene.nodeOrder.map(id=>scene.nodes[id]).filter(n=>!selected.has(n.id)&&n.visible&&scene.layers[n.layerId]?.visible&&n.frameId===frame.id).map(worldInkBounds);
 const tx=[frame.x,frame.x+frame.w/2,frame.x+frame.w,...(frame.guides??[]).filter(g=>g.axis==="x").map(g=>frame.x+g.at),...x.map(v=>frame.x+Math.round((v-frame.x)/frame.grid!.size)*frame.grid!.size),...targets.flatMap(b=>[b.x,b.x+b.w/2,b.x+b.w])],ty=[frame.y,frame.y+frame.h/2,frame.y+frame.h,...(frame.guides??[]).filter(g=>g.axis==="y").map(g=>frame.y+g.at),...y.map(v=>frame.y+Math.round((v-frame.y)/frame.grid!.size)*frame.grid!.size),...targets.flatMap(b=>[b.y,b.y+b.h/2,b.y+b.h])];return{x:delta.x+closest(x,tx,6/scale),y:delta.y+closest(y,ty,6/scale)};
}
