import type {DrawingScene,Point} from './model';
import {DrawingRenderer} from './renderer';
import {exportPreparationScene} from './exportScope';
import {effectiveLayer} from './layers';
/** Samples a canonical document pixel, independently of zoom and editor overlays. */
export async function sampleDrawingColor(scene:DrawingScene,point:Point,frameId:string,layerId:string,merged:boolean,signal:AbortSignal):Promise<string>{
 const cancelled=()=>{if(signal.aborted)throw new DOMException('Cancelled','AbortError');};cancelled();
 if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!scene.frames[frameId]||!scene.layers[layerId])throw new Error('The color source is unavailable');
 if(!merged&&!effectiveLayer(scene,layerId).visible)return '#00000000';
 const region={x:Math.floor(point.x),y:Math.floor(point.y),w:1,h:1},layer=scene.layers[layerId];
 const sample=merged?scene:{...scene,layers:{...scene.layers,[layerId]:{...layer,opacity:1,blend:'source-over' as const}},layerOrder:[layerId],nodeOrder:scene.nodeOrder.filter(id=>scene.nodes[id].layerId===layerId)};
 const renderer=new DrawingRenderer(),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const abort=()=>renderer.dispose();signal.addEventListener('abort',abort,{once:true});
 try{await renderer.prepare(exportPreparationScene(sample,frameId,region,true));cancelled();renderer.render(canvas,sample,{...region,scale:1},{frameId,region,background:merged});const p=canvas.getContext('2d')!.getImageData(0,0,1,1).data;cancelled();return '#'+Array.from(p.slice(0,p[3]===255?3:4)).map(v=>v.toString(16).padStart(2,'0')).join('');}
 finally{signal.removeEventListener('abort',abort);renderer.dispose();canvas.width=canvas.height=1;}
}
