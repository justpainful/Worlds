import type {Point} from './model';
export interface MaskRaster{width:number;height:number;alpha:Uint8ClampedArray}
export type MaskRasterTask={kind:'paint';mask:MaskRaster;points:Point[];size:number;hardness:number;opacity:number;value:number}|{kind:'fill';mask:MaskRaster;point:Point;tolerance:number;value:number;contiguous:boolean}|{kind:'gradient';mask:MaskRaster;from:Point;to:Point;start:number;end:number;mode?:'linear'|'radial'}|{kind:'invert';mask:MaskRaster}|{kind:'solid';mask:MaskRaster;value:number};
export function validateMaskRaster(mask:MaskRaster){if(!Number.isSafeInteger(mask.width)||!Number.isSafeInteger(mask.height)||mask.width<1||mask.height<1||mask.width*mask.height>16*1024*1024||mask.alpha.length!==mask.width*mask.height)throw Error('Mask dimensions exceed the working memory limit');}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function editMaskRaster(task:MaskRasterTask):MaskRaster{
 validateMaskRaster(task.mask);const{width,height}=task.mask,alpha=task.mask.alpha.slice(),result={width,height,alpha},size=alpha.length;
 if(task.kind==='invert'){for(let i=0;i<size;i++)alpha[i]=255-alpha[i];return result;}
 if(task.kind==='solid'){if(!Number.isFinite(task.value))throw Error('Invalid mask value');alpha.fill(clamp(task.value!,0,255));return result;}
 if(task.kind==='gradient'){
  if(![task.from.x,task.from.y,task.to.x,task.to.y,task.start,task.end].every(Number.isFinite)||task.mode!==undefined&&!['linear','radial'].includes(task.mode))throw Error('Invalid mask gradient');const dx=task.to.x-task.from.x,dy=task.to.y-task.from.y,length=dx*dx+dy*dy;if(length<.000001)return result;const radius=Math.sqrt(length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const px=x+.5-task.from.x,py=y+.5-task.from.y,t=clamp(task.mode==='radial'?Math.hypot(px,py)/radius:(px*dx+py*dy)/length,0,1);alpha[y*width+x]=clamp(task.start+(task.end-task.start)*t,0,255);}return result;
 }
 if(task.kind==='fill'){
  if(![task.point.x,task.point.y,task.tolerance,task.value].every(Number.isFinite))throw Error('Invalid mask fill');const x=Math.floor(task.point.x),y=Math.floor(task.point.y);if(x<0||y<0||x>=width||y>=height)throw Error('Mask fill starts outside the mask');const seed=y*width+x,target=alpha[seed],tolerance=clamp(task.tolerance,0,255),value=clamp(task.value,0,255);
  if(!task.contiguous){for(let i=0;i<size;i++)if(Math.abs(alpha[i]-target)<=tolerance)alpha[i]=value;return result;}
  const seen=new Uint8Array(size),stack=new Uint32Array(size);let count=1;stack[0]=seed;seen[seed]=1;
  const push=(next:number)=>{if(!seen[next]){seen[next]=1;stack[count++]=next;}};while(count){const at=stack[--count];if(Math.abs(task.mask.alpha[at]-target)>tolerance)continue;alpha[at]=value;const x=at%width;if(x)push(at-1);if(x+1<width)push(at+1);if(at>=width)push(at-width);if(at+width<size)push(at+width);}return result;
 }
 if(!task.points.length||task.points.length>8192||![task.size,task.hardness,task.opacity,task.value].every(Number.isFinite)||task.size<1||task.size>2048||task.points.some(p=>![p.x,p.y].every(Number.isFinite)||p.x< -2048||p.y< -2048||p.x>width+2048||p.y>height+2048))throw Error('Invalid mask brush stroke');
 const radius=task.size/2,step=Math.max(.5,radius/4),hardness=clamp(task.hardness,0,1),opacity=clamp(task.opacity,0,1),value=clamp(task.value,0,255),coverage=new Uint8ClampedArray(size);let work=0,dabs=0;
 const dab=(cx:number,cy:number)=>{const x0=Math.min(width,Math.max(0,Math.floor(cx-radius))),x1=Math.max(0,Math.min(width,Math.ceil(cx+radius))),y0=Math.min(height,Math.max(0,Math.floor(cy-radius))),y1=Math.max(0,Math.min(height,Math.ceil(cy+radius)));if(++dabs>1000000)throw Error("The mask stroke exceeds the work limit");work+=Math.max(1,(x1-x0)*(y1-y0));if(work>128*1024*1024)throw Error('The mask stroke exceeds the work limit');for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const distance=Math.hypot(x+.5-cx,y+.5-cy)/radius,edge=hardness>=1?Number(distance<=1):clamp((1-distance)/Math.max(.0001,1-hardness),0,1),at=y*width+x;coverage[at]=Math.max(coverage[at],Math.round(edge*opacity*255));}};
 dab(task.points[0].x,task.points[0].y);for(let i=1;i<task.points.length;i++){const a=task.points[i-1],b=task.points[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step));for(let j=1;j<=count;j++)dab(a.x+(b.x-a.x)*j/count,a.y+(b.y-a.y)*j/count);}
 for(let i=0;i<size;i++)if(coverage[i])alpha[i]=alpha[i]+(value-alpha[i])*coverage[i]/255;return result;
}
