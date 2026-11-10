import {id,newNode,type Asset,type Change,type DrawingScene,type Frame,type Rect} from './model';import {effectiveLayer,layerShown,layerAncestors} from './layers';import {drawingJson} from './wire';import {intersects,worldRenderBounds} from './geometry';import {isRedaction,redactionShown,redactionBounds} from './redaction';
export interface MergePlan{frames:Frame[];roots:string[];outputLayer:string;sourceKey:string;pixels:number;world?:Rect;worldNodeIds?:string[]}
export interface MergedFrame{frameId:string;asset:Asset;blob:Blob;world?:boolean}
export function mergeSourceKey(scene:DrawingScene){return drawingJson(scene);}
function mergeVisibleNodes(scene:DrawingScene){return scene.nodeOrder.map(id=>scene.nodes[id]).filter(n=>isRedaction(n)?redactionShown(scene,n):n.visible&&n.opacity>0&&effectiveLayer(scene,n.layerId).visible);}
function stepGroups(scene:DrawingScene,frames:Frame[],worldNodeIds:string[]){
 const visible=mergeVisibleNodes(scene),world=new Set(worldNodeIds),groups=new Map<string,string[]>();
 for(const frame of frames)groups.set(frame.id,visible.filter(n=>n.frameId===frame.id||n.frameId===null&&!world.has(n.id)&&(n.anchor||n.endAnchor||intersects(isRedaction(n)?redactionBounds(n):worldRenderBounds(n),frame))).map(n=>n.id));
 if(worldNodeIds.length)groups.set('',worldNodeIds);
 return groups;
}
export function visibleMergePlan(scene:DrawingScene):MergePlan{
 const sourceKey=mergeSourceKey(scene);if(new TextEncoder().encode(sourceKey).length>8*1024*1024)throw Error('merge-scene-limit');const visible=mergeVisibleNodes(scene);if(!visible.length)throw Error('merge-empty');
 if(visible.some(n=>n.locked||effectiveLayer(scene,n.layerId).locked))throw Error('merge-locked');
 // Position may be fractional: both the export viewport and its resulting
 // image retain the frame origin. Dimensions remain integral so the PNG is
 // never stretched to fit the document rectangle after the merge.
 const frames=scene.frameOrder.map(id=>scene.frames[id]);if(frames.some(f=>![f.x,f.y].every(Number.isFinite)||![f.w,f.h].every(Number.isSafeInteger)))throw Error('merge-frame-layout');
 // Baking a partly transparent background over the still-existing frame would
 // composite it twice. Accept only explicitly opaque or fully clear colors.
 if(frames.some(f=>!(/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(f.background)||/^#(?:[\da-f]{3}[0f]|[\da-f]{6}(?:00|ff))$/i.test(f.background)||f.background.toLowerCase()==='transparent')))throw Error('merge-frame-background');
 for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++){
   const lower=frames[i],upper=frames[j];if(!intersects(lower,upper))continue;
   // Opaque backgrounds and no lower/world ink in the intersection make the
   // frame-order raster compositing equivalent to the original scene.
   if(!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(lower.background)||!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(upper.background))throw Error('merge-overlap');
   const x=Math.max(lower.x,upper.x),y=Math.max(lower.y,upper.y),right=Math.min(lower.x+lower.w,upper.x+upper.w),bottom=Math.min(lower.y+lower.h,upper.y+upper.h),overlap={x,y,w:right-x,h:bottom-y};
   for(const node of visible.filter(n=>n.frameId===lower.id||n.frameId===null)){
     if(node.anchor||node.endAnchor||node.kind!=='image'&&node.kind!=='raster'&&node.effects.some(e=>e.enabled&&e.kind==='blur'))throw Error('merge-overlap');
     if(intersects(isRedaction(node)?redactionBounds(node):worldRenderBounds(node),overlap))throw Error('merge-overlap');
   }
 }
 // Unclipped frames are safe only when every visible member's ink and filter
 // bleed stays inside the raster output; otherwise flattening drops content.
 for(const frame of frames.filter(f=>!f.clip))for(const node of visible.filter(n=>n.frameId===frame.id)){
   if(node.anchor||node.endAnchor||node.kind!=='image'&&node.kind!=='raster'&&node.effects.some(e=>e.enabled&&e.kind==='blur'))throw Error('merge-frame-layout');
   const b=isRedaction(node)?redactionBounds(node):worldRenderBounds(node);
   if(b.x<frame.x||b.y<frame.y||b.x+b.w>frame.x+frame.w||b.y+b.h>frame.y+frame.h)throw Error('merge-frame-layout');
 }
 // A world element can be flattened into a frame only if its entire visible
 // extent is inside exactly one frame. Otherwise pixels outside the output
 // rectangles would be lost. Anchored arrows can extend beyond their node box.
 const outside:{id:string;bounds:Rect}[]=[];
 for(const node of visible.filter(n=>n.frameId===null)){
   if(node.anchor||node.endAnchor||node.kind!=='image'&&node.kind!=='raster'&&node.effects.some(e=>e.enabled&&e.kind==='blur'))throw Error('merge-world');
   const b=isRedaction(node)?redactionBounds(node):worldRenderBounds(node);
   if(frames.filter(f=>b.x>=f.x&&b.y>=f.y&&b.x+b.w<=f.x+f.w&&b.y+b.h<=f.y+f.h).length===1)continue;
   // Leave an antialiasing margin so the world PNG cannot bleed into a frame.
   const margin={x:b.x-2,y:b.y-2,w:b.w+4,h:b.h+4};
   if(frames.some(f=>intersects(f,margin)))throw Error('merge-world');
   outside.push({id:node.id,bounds:b});
 }
 let world:Rect|undefined;
 if(outside.length){const left=Math.floor(Math.min(...outside.map(o=>o.bounds.x)))-2,top=Math.floor(Math.min(...outside.map(o=>o.bounds.y)))-2,right=Math.ceil(Math.max(...outside.map(o=>o.bounds.x+o.bounds.w)))+2,bottom=Math.ceil(Math.max(...outside.map(o=>o.bounds.y+o.bounds.h)))+2;world={x:left,y:top,w:right-left,h:bottom-top};if(![world.x,world.y,world.w,world.h].every(Number.isSafeInteger)||world.w<1||world.h<1)throw Error('merge-memory');}
 // One raster can represent a step only when it hides all or none of the
 // visible contributors to that raster. Pinned steps use their own snapshot.
 const groups=stepGroups(scene,frames,outside.map(o=>o.id));
 for(const id of scene.stepOrder){const step=scene.steps[id];if(step.pinnedVersionId)continue;const hidden=new Set(step.hiddenNodeIds);for(const [group,contributors] of groups){const count=contributors.filter(key=>hidden.has(key)).length;if(count&&count!==contributors.length)throw Error('merge-steps');if(count&&group){const frame=frames.find(f=>f.id===group)!;if(frames.some(other=>other.id!==group&&intersects(frame,other)))throw Error('merge-steps');}}}
 let pixels=0;for(const frame of [...frames,...(world?[world]:[])]){const count=frame.w*frame.h,depth=Math.max(0,...scene.layerOrder.filter(id=>layerShown(scene,id)).map(id=>effectiveLayer(scene,id).depth));pixels+=count;if(pixels>64*1024*1024||count*4*(depth+3)>192*1024*1024)throw Error('merge-memory');}
 const roots=scene.layerOrder.filter(id=>!scene.layers[id].parentId&&scene.layers[id].visible),candidates=roots.filter(id=>!scene.layers[id].locked&&!scene.layers[id].alphaLocked&&!scene.nodeOrder.some(key=>{const n=scene.nodes[key];return n.visible&&layerShown(scene,n.layerId)&&layerAncestors(scene,n.layerId).at(-1)?.id===id&&(n.locked||effectiveLayer(scene,n.layerId).locked);})),outputLayer=candidates.find(id=>scene.layers[id].opacity===1&&(scene.layers[id].blend==='source-over'||scene.layers[id].blend==='normal'))??candidates[0];if(!outputLayer)throw Error('merge-locked');return{frames:structuredClone(frames),roots,outputLayer,sourceKey,pixels,world,worldNodeIds:outside.map(o=>o.id)};
}
export async function renderVisibleMerge(pageId:string,scene:DrawingScene,signal:AbortSignal,onProgress?:(done:number,total:number)=>void,previewImages?:ReadonlyMap<string,HTMLImageElement>,authorize=true):Promise<{plan:MergePlan;frames:MergedFrame[]}>{
 const {DrawingRenderer}=await import('./renderer'),{checkDrawingExport}=await import('./files');const plan=visibleMergePlan(scene),check=()=>{if(signal.aborted)throw new DOMException('Cancelled','AbortError');};check();if(authorize)await checkDrawingExport({pageId,kind:'images',scenes:[...plan.frames.map(frame=>({scene,frameId:frame.id,annotations:true})),...(plan.world?[{scene,region:plan.world,annotations:true}]:[])]});check();const frames:MergedFrame[]=[];let bytes=0;const total=plan.frames.length+(plan.world?1:0);
 for(const frame of plan.frames){const renderer=new DrawingRenderer({previewImages}),abort=()=>renderer.dispose();signal.addEventListener('abort',abort,{once:true});try{check();const blob=await renderer.exportFrame(scene,frame,1,true);check();bytes+=blob.size;if(bytes>128*1024*1024)throw Error('merge-memory');frames.push({frameId:frame.id,blob,asset:{id:id(),attachmentId:id(),name:`Merged ${frame.name}`,mime:'image/png',width:frame.w,height:frame.h}});onProgress?.(frames.length,total);}finally{signal.removeEventListener('abort',abort);renderer.dispose();}}
 if(plan.world){const region=plan.world,ids=new Set(plan.worldNodeIds),isolated={...scene,nodes:Object.fromEntries(scene.nodeOrder.filter(key=>ids.has(key)).map(key=>[key,scene.nodes[key]])),nodeOrder:scene.nodeOrder.filter(key=>ids.has(key))},renderer=new DrawingRenderer({previewImages}),abort=()=>renderer.dispose();signal.addEventListener('abort',abort,{once:true});const canvas=document.createElement('canvas');canvas.width=region.w;canvas.height=region.h;try{check();const {exportPreparationScene}=await import('./exportScope'),{encodeExportCanvas}=await import('./exportEncode');await renderer.prepare(exportPreparationScene(isolated,'',region,true));check();renderer.render(canvas,isolated,{...region,scale:1},{background:false});const blob=await encodeExportCanvas(canvas,'image/png',.92,signal);check();bytes+=blob.size;if(bytes>128*1024*1024)throw Error('merge-memory');frames.push({frameId:'',world:true,blob,asset:{id:id(),attachmentId:id(),name:'Merged world content',mime:'image/png',width:region.w,height:region.h}});onProgress?.(frames.length,total);}finally{canvas.width=canvas.height=1;signal.removeEventListener('abort',abort);renderer.dispose();}}
 return{plan,frames};
}
/** Must be committed with requiresBase under a root fenced lease. */
export function mergedLayerChanges(scene:DrawingScene,plan:MergePlan,frames:MergedFrame[],name='Merged visible content'):{changes:Change[];layerId:string}{
 if(mergeSourceKey(scene)!==plan.sourceKey)throw Error('merge-stale');visibleMergePlan(scene);if(frames.length!==plan.frames.length+(plan.world?1:0)||new Set(frames.map(f=>f.world?'world':`frame:${f.frameId}`)).size!==frames.length||frames.some(f=>(f.world?!plan.world:!plan.frames.some(p=>p.id===f.frameId))||!f.asset.attachmentId))throw Error('merge-missing');
 const layer={...scene.layers[plan.outputLayer],name,opacity:1,blend:'source-over' as const,visible:true},changes:Change[]=[],mergedNodes=new Map<string,string>(),redactionCopies=new Map<string,string>();
 for(const root of plan.roots)if(root!==layer.id)changes.push({type:'patch',collection:'layers',id:root,fields:{visible:false}});changes.push({type:'patch',collection:'layers',id:layer.id,fields:{name:layer.name,opacity:1,blend:'source-over',visible:true}});for(const node of Object.values(scene.nodes))if(node.visible&&layerShown(scene,node.layerId)&&layerAncestors(scene,node.layerId).at(-1)?.id===layer.id)changes.push({type:'patch',collection:'nodes',id:node.id,fields:{visible:false}});const nodes=[];
 for(const result of frames){const frame=result.world?plan.world!:scene.frames[result.frameId],node=newNode('image',layer.id,result.world?null:result.frameId,frame);node.assetId=result.asset.id;node.name=result.world?'Merged world content':`Merged ${scene.frames[result.frameId].name}`;mergedNodes.set(result.world?'':result.frameId,node.id);nodes.push(node);changes.push({type:'put',collection:'assets',id:result.asset.id,value:result.asset},{type:'put',collection:'nodes',id:node.id,value:node});}
 for(const original of scene.nodeOrder.map(id=>scene.nodes[id]).filter(n=>isRedaction(n)&&redactionShown(scene,n))){const clone={...structuredClone(original),id:id(),layerId:layer.id,visible:true,locked:false};redactionCopies.set(original.id,clone.id);nodes.push(clone);changes.push({type:'put',collection:'nodes',id:clone.id,value:clone});}
 const groups=stepGroups(scene,plan.frames,plan.worldNodeIds??[]);
 for(const id of scene.stepOrder){const step=scene.steps[id];if(step.pinnedVersionId)continue;const hidden=new Set(step.hiddenNodeIds),added:string[]=[];for(const [key,contributors] of groups)if(contributors.length&&contributors.every(key=>hidden.has(key))){const merged=mergedNodes.get(key);if(merged)added.push(merged);}for(const [original,copy] of redactionCopies)if(hidden.has(original))added.push(copy);if(added.length)changes.push({type:'patch',collection:'steps',id,fields:{hiddenNodeIds:[...new Set([...step.hiddenNodeIds,...added])]}});}
 changes.push({type:'order',list:'nodeOrder',ids:[...nodes.map(n=>n.id),...scene.nodeOrder]});if(changes.length>10000)throw Error('merge-scene-limit');return{changes,layerId:layer.id};
}
