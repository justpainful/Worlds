import {newScene,newLayer,newNode,DEFAULT_BRUSH,type Asset} from './model';
/** Stable mixed-scene workload. No personal content or network assets. */
export function drawingBenchmarkFixture(image?:Asset){
 const scene=newScene(),frame=scene.frames[scene.defaultFrameId];Object.assign(frame,{id:'benchmark-frame',name:'4K mixed scene',w:3840,h:2160});scene.frames={[frame.id]:frame};scene.defaultFrameId=frame.id;scene.frameOrder=[frame.id];scene.layers={};scene.layerOrder=[];
 if(image)scene.assets[image.id]=image;
 const colors=['#2266cc','#e9a942','#5d9868','#bd6053','#684d92'];
 for(let l=0;l<30;l++){const layer=newLayer(`Benchmark layer ${String(l+1).padStart(2,'0')}`);layer.id=`benchmark-layer-${l}`;layer.opacity=l%3===0?.8:1;layer.blend=l%7===0?'multiply':'source-over';scene.layers[layer.id]=layer;scene.layerOrder.push(layer.id);
  for(let j=0;j<20;j++){const kind=j===0?'stroke':j<=5&&image?'image':j<=12?'shape':'text',n=newNode(kind,layer.id,frame.id,{x:30+(l*97+j*173)%3500,y:30+(l*61+j*97)%1900,w:140,h:90});n.id=`benchmark-node-${l}-${j}`;n.name=`${kind} ${l+1}.${j+1}`;n.rotation=j%5===0?15:0;
   if(kind==='stroke'){n.brush={...DEFAULT_BRUSH,color:colors[l%colors.length],size:24,pressureSize:true};n.samples=Array.from({length:48},(_,i)=>({x:10+i*2.5,y:45+Math.sin(i/7)*24,pressure:.3+.7*i/47,tiltX:0,tiltY:0,time:i*4}));n.seed=l+1;}
   else if(kind==='image'){n.assetId=image!.id;if(j===1&&l<4){const mid=`benchmark-mask-${l}`;n.maskId=mid;scene.masks[mid]={id:mid,name:'Benchmark alpha mask',enabled:true,inverted:false,linked:true,x:0,y:0,w:n.w,h:n.h,base:1,strokes:[]};}}
   else if(kind==='shape'){n.shape=j%2?'roundrect':'ellipse';n.paint.fill=colors[(l+j)%colors.length];n.paint.stroke='#202023';n.paint.strokeWidth=2;}
   else{n.text=j%2?'شرح الرسم 123':'Worlds drawing 123';n.textStyle.size=18;n.textStyle.color=colors[l%colors.length];}
   scene.nodes[n.id]=n;scene.nodeOrder.push(n.id);
  }
 }
 return scene;
}
