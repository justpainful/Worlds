import type {DrawingNode,DrawingPath,PathVertex,Point} from "./model";
export function pathFromNode(n:DrawingNode):DrawingPath{
 if(n.path)return structuredClone(n.path);if(n.points?.length)return{vertices:structuredClone(n.points),closed:!["line","polyline","curve","arrow","double-arrow"].includes(n.shape??"")};
 const w=n.geometrySize?.w??n.w,h=n.geometrySize?.h??n.h;
 if(n.shape==="curve")return{closed:false,vertices:[{x:0,y:h,out:{x:w/3,y:0}},{x:w,y:0,in:{x:w*2/3,y:h}}]};
 if(n.shape==="line"||n.shape==="polyline")return{closed:false,vertices:[{x:0,y:0},{x:w,y:h}]};
 if(n.shape==="ellipse"||n.shape==="number"){const k=0.5522847498307936,rx=w/2,ry=h/2;return{closed:true,vertices:[{x:rx,y:0,in:{x:rx-rx*k,y:0},out:{x:rx+rx*k,y:0}},{x:w,y:ry,in:{x:w,y:ry-ry*k},out:{x:w,y:ry+ry*k}},{x:rx,y:h,in:{x:rx+rx*k,y:h},out:{x:rx-rx*k,y:h}},{x:0,y:ry,in:{x:0,y:ry+ry*k},out:{x:0,y:ry-ry*k}}]};}
 if(n.shape==="triangle")return{closed:true,vertices:[{x:w/2,y:0},{x:w,y:h},{x:0,y:h}]};
 if(n.shape==="right-triangle")return{closed:true,vertices:[{x:0,y:0},{x:0,y:h},{x:w,y:h}]};
 if(n.shape==="roundrect"){const r=Math.min(n.paint.radius,w/2,h/2),k=0.5522847498307936*r;return{closed:true,vertices:[{x:r,y:0,in:{x:r-k,y:0}},{x:w-r,y:0,out:{x:w-r+k,y:0}},{x:w,y:r,in:{x:w,y:r-k}},{x:w,y:h-r,out:{x:w,y:h-r+k}},{x:w-r,y:h,in:{x:w-r+k,y:h}},{x:r,y:h,out:{x:r-k,y:h}},{x:0,y:h-r,in:{x:0,y:h-r+k}},{x:0,y:r,out:{x:0,y:r-k}}]};}
 if(n.shape==="polygon"||n.shape==="star"){const sides=n.shape==="star"?10:6;return{closed:true,vertices:Array.from({length:sides},(_,i)=>{const a=i*2*Math.PI/sides-Math.PI/2,r=n.shape==="star"&&i%2?0.42:1;return{x:w/2+Math.cos(a)*w/2*r,y:h/2+Math.sin(a)*h/2*r};})};}
 return{closed:true,vertices:[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}]};
}
export function pathSegments(path:DrawingPath){return path.vertices.slice(0,path.closed?undefined:-1).map((a,index)=>{const b=path.vertices[(index+1)%path.vertices.length];return{a,b,c1:a.out??a,c2:b.in??b,curve:!!(a.out||b.in)};});}
export function svgPath(path:DrawingPath){if(!path.vertices.length)return"";const a=path.vertices[0];return`M ${a.x} ${a.y} `+pathSegments(path).map(s=>s.curve?`C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.b.x} ${s.b.y}`:`L ${s.b.x} ${s.b.y}`).join(" ")+(path.closed?" Z":"");}
const middle=(a:Point,b:Point):Point=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
/** Exact de Casteljau subdivision retains the curve when adding a vertex. */
export function splitPath(path:DrawingPath,index:number):DrawingPath{
 const result=structuredClone(path),v=result.vertices,a=v[index];if(!a)throw Error("Missing path vertex");const next=(index+1)%v.length,b=v[next];
 if(!path.closed&&index===v.length-1){v.push({x:a.x+40,y:a.y});return result;}
 if(!a.out&&!b.in){v.splice(index+1,0,middle(a,b));return result;}
 const q0=middle(a,a.out??a),q1=middle(a.out??a,b.in??b),q2=middle(b.in??b,b),r0=middle(q0,q1),r1=middle(q1,q2),center=middle(r0,r1);a.out=q0;b.in=q2;v.splice(index+1,0,{...center,in:r0,out:r1});return result;
}
export function movePathVertex(path:DrawingPath,index:number,point:Point,handle?:"in"|"out"):DrawingPath{
 const result=structuredClone(path),v=result.vertices[index];if(!v||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error("Invalid path point");if(handle)v[handle]=point;else{const dx=point.x-v.x,dy=point.y-v.y;for(const key of["in","out"]as const)if(v[key])v[key]={x:v[key]!.x+dx,y:v[key]!.y+dy};v.x=point.x;v.y=point.y;}return result;
}
export function smoothPathVertex(path:DrawingPath,index:number):DrawingPath{
 const result=structuredClone(path),v=result.vertices[index],before=result.vertices[(index+result.vertices.length-1)%result.vertices.length],after=result.vertices[(index+1)%result.vertices.length];const dx=(after.x-before.x)/6,dy=(after.y-before.y)/6;v.in={x:v.x-dx,y:v.y-dy};v.out={x:v.x+dx,y:v.y+dy};return result;
}
export function pathBounds(path:DrawingPath){const points=path.vertices.flatMap(v=>[v,...(v.in?[v.in]:[]),...(v.out?[v.out]:[])]),xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);return{x,y,w:Math.max(1,Math.max(...xs)-x),h:Math.max(1,Math.max(...ys)-y)};}
export function validPath(path:DrawingPath){return !!path&&typeof path==="object"&&typeof path.closed==="boolean"&&Array.isArray(path.vertices)&&path.vertices.length>=2&&path.vertices.length<=4096&&path.vertices.every((p:PathVertex)=>p&&typeof p==="object"&&[p,p.in,p.out].filter(Boolean).every(p=>Number.isFinite(p!.x)&&Number.isFinite(p!.y)&&Math.abs(p!.x)<=1e9&&Math.abs(p!.y)<=1e9));}
