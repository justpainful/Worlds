import "/src/dev/mockTauri";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "/src/styles/tokens.css";
import "/src/styles/base.css";
import "/src/glass/glass.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "/src/styles/ui.css";
import "/src/styles/resources.css";
import { api,fileUrl } from "/src/lib/api";
import { useStore } from "/src/state/store";
import { DrawingView } from "/src/drawing/DrawingView";
import { DEFAULT_BRUSH, newNode } from "/src/drawing/model";
import { drawingSession } from "/src/drawing/session";
import { edit, putNode } from "/src/drawing/operations";
import { decodeBrushTip } from "/src/drawing/imageHeaders";
import { readDrawingPreferences, saveDrawingPreferences } from "/src/drawing/preferences";
import fixtures from "/src/drawing/fixtures/image-headers.json";
import oriented from "/src/drawing/fixtures/image-orientation.json";
import {decodeDrawingImage} from "/src/drawing/imageIngest";
import {codecAppliesOrientation} from "/src/drawing/imageDisplay";
import probes from "/src/drawing/fixtures/image-orientation-probes.json";
import expectedOrientation from "/scripts/drawing-image-orientation-expected.json";
import {DrawingRenderer} from "/src/drawing/renderer";
import {newDrawing,applyChanges} from "/src/drawing/operations";
import {imagePixelArtwork,pixelArtworkChanges} from "/src/drawing/floatingPixels";
import animations from "/src/drawing/fixtures/animated-images.json";
import {decodeAnimatedFrame} from "/src/drawing/animatedImage";

if (!new URLSearchParams(location.search).has("mock")) throw Error("This harness requires the explicit mock backend");
const output = document.querySelector("#result")!, download = document.querySelector("#download") as HTMLAnchorElement;
const record: { images: unknown[]; owners: unknown[]; transforms: unknown[]; selections: unknown[];keys:unknown[];clipboard:unknown[];ingests:unknown[];imageOriginals:unknown[] } = { images: [], owners: [], transforms: [], selections: [],keys:[],clipboard:[],ingests:[],imageOriginals:[] };
const bytes = (f: typeof fixtures.images[number]) => Uint8Array.from(atob(f.base64), (v) => v.charCodeAt(0));
function publish() {
  output.textContent = JSON.stringify(record, null, 2); download.hidden = false;
  if (download.href.startsWith("blob:")) URL.revokeObjectURL(download.href);
  download.href = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
}
await useStore.getState().init();
const base = useStore.getState().profile!, ownerA = `qa-input-a-${crypto.randomUUID()}`, ownerB = `qa-input-b-${crypto.randomUUID()}`;
const page = await api.createPage({ title: "Synthetic input check", kind: "drawing" }); useStore.getState().patchPageLocal(page); useStore.getState().openPage(page.id);
const pane = useStore.getState().layout.activePaneId;
for (const [owner, size, color] of [[ownerA, 17, "#cc2211"], [ownerB, 43, "#2266cc"]] as const) saveDrawingPreferences(owner, { brushes: { brush: { ...DEFAULT_BRUSH, size, color } }, recent: [color], background: "#ffffff", autoShape: false, tipPageId: page.id });
let active = ownerA;
let strokeId: string | undefined;
const changeOwner = (owner: string) => { active = owner; useStore.getState().setProfile({ ...base, id: owner }); };
changeOwner(ownerA);
createRoot(document.querySelector("#editor")!).render(<StrictMode><DrawingView id={page.id} paneId={pane} /></StrictMode>);
document.querySelector<HTMLButtonElement>("#a")!.onclick = () => changeOwner(ownerA);
document.querySelector<HTMLButtonElement>("#b")!.onclick = () => changeOwner(ownerB);
document.querySelector<HTMLButtonElement>("#language")!.onclick = () => { active = base.id; useStore.getState().setProfile({ ...base, language: "ar" }); };
document.querySelector<HTMLButtonElement>("#stroke")!.onclick = async () => {
  // The mock storage author remains the bootstrap profile. Synthetic owners
  // above test UI preference lifetimes only, not authentication bypasses.
  changeOwner(base.id);
  const session = drawingSession(page.id); await session.flush(); const doc = session.snapshot().document!;
  const n = newNode("stroke", doc.scene.layerOrder[0], doc.scene.defaultFrameId, { x: 100, y: 100, w: 160, h: 40 });
  n.brush = { ...DEFAULT_BRUSH, color: "#cc2211", pressureSize: false }; n.seed = 1; n.samples = [{ x: 20, y: 20, pressure: 0.25, tiltX: 3, tiltY: -5, time: 0 }, { x: 140, y: 20, pressure: 1, tiltX: 10, tiltY: 15, time: 20 }];
  session.dispatch(edit(base.id, doc.revision, "Synthetic transform stroke", putNode(doc.scene, n))); await session.flush(); strokeId = n.id;
};
const fixtureIds:{text?:string;shape?:string}={};
document.querySelector<HTMLButtonElement>("#formatting")!.onclick=async()=>{
 changeOwner(base.id);const session=drawingSession(page.id);await session.flush();const doc=session.snapshot().document!,s=doc.scene,f=s.defaultFrameId,l=s.layerOrder[0],text=newNode("text",l,f,{x:60,y:70,w:300,h:220}),shape=newNode("shape",l,f,{x:500,y:80,w:260,h:220});text.text="شرح الرسم بالعربية\nHello Worlds 123";text.textStyle.color="#202023";shape.shape="ellipse";shape.paint.fill="#ed3b35";shape.paint.stroke="#202023";shape.paint.strokeWidth=4;fixtureIds.text=text.id;fixtureIds.shape=shape.id;
 session.dispatch(edit(base.id,doc.revision,"Formatting fixture",[...putNode(s,text),...putNode({...s,nodeOrder:[text.id]},shape)]));await session.flush();
};
document.querySelector<HTMLButtonElement>("#formatting-check")!.onclick=async()=>{
 const session=drawingSession(page.id);await session.flush();const s=session.snapshot().document!.scene,renderer=new DrawingRenderer();
 try{const f=s.frames[s.defaultFrameId],bmp=await renderer.exportFrame(s,f,1,true,"image/bmp",1,"#ffffff"),raw=new Uint8Array(await bmp.arrayBuffer());const bmpLink=document.querySelector<HTMLAnchorElement>("#bmp-output")!;if(bmpLink.href.startsWith("blob:"))URL.revokeObjectURL(bmpLink.href);bmpLink.href=URL.createObjectURL(bmp);bmpLink.hidden=false;record.ingests.push({name:"actual renderer BMP output",mime:bmp.type,bytes:raw.length,width:new DataView(raw.buffer).getInt32(18,true),height:new DataView(raw.buffer).getInt32(22,true),data:btoa(String.fromCharCode(...raw.subarray(0,54))),passed:bmp.type==="image/bmp"&&raw[0]===66&&raw[1]===77});
 const image=await createImageBitmap(bmp),c=document.createElement("canvas");c.width=image.width;c.height=image.height;const ctx=c.getContext("2d")!;ctx.drawImage(image,0,0);const pixel=Array.from(ctx.getImageData(510,90,1,1).data),actual=ctx.getImageData(0,0,c.width,c.height).data,png=await renderer.exportFrame(s,f,1,true,"image/png"),pngImage=await createImageBitmap(png);ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(pngImage,0,0);const expected=ctx.getImageData(0,0,c.width,c.height).data;let different=0,maxError=0;for(let i=0;i<actual.length;i++){const e=Math.abs(actual[i]-expected[i]);maxError=Math.max(maxError,e);if(e>1)different++;}pngImage.close();record.ingests.push({name:"BMP and PNG codec outputs preserve identical whole-frame pixels",different,maxError,passed:different===0});record.ingests.push({name:"browser independently decodes generated BMP",pixel,passed:image.width===f.w&&image.height===f.h});image.close();c.width=c.height=1;
 }catch(error){record.ingests.push({passed:false,error:String(error)});}finally{renderer.dispose();publish();}
};
document.querySelector<HTMLButtonElement>("#inspect")!.onclick = () => {
  const p = readDrawingPreferences(active, page.id), slider = document.querySelector<HTMLInputElement>(".drawing-options input[type=range]"), color = document.querySelector<HTMLInputElement>('input[aria-label="Paint color"]');
  record.owners.push({ owner: active === ownerA ? "A" : active === ownerB ? "B" : "Editor", savedSize: p.brushes.brush?.size, shownSize: Number(slider?.value), savedColor: p.brushes.brush?.color, shownColor: color?.value, otherOwnerSize: readDrawingPreferences(active === ownerA ? ownerB : ownerA, page.id).brushes.brush?.size }); publish();
  const sceneState=drawingSession(page.id).snapshot().document; if(sceneState){record.selections.push({revision:sceneState.revision,pending:drawingSession(page.id).snapshot().pending,operations:sceneState.operations,nodes:sceneState.scene.nodes,layers:sceneState.scene.layers,layerOrder:sceneState.scene.layerOrder,nodeOrder:sceneState.scene.nodeOrder,masks:sceneState.scene.masks,assets:sceneState.scene.assets,selectionStatus:document.querySelector(".drawing-pixel-selection-controls [role=status]")?.textContent,selectionError:document.querySelector(".drawing-pixel-selection-controls [role=alert]")?.textContent});publish();}
  if (strokeId) { const d = drawingSession(page.id).snapshot().document!, n = d.scene.nodes[strokeId]; record.transforms.push({ revision: d.revision, w: n.w, h: n.h, rotation: n.rotation, flipX: n.flipX, geometrySize: n.geometrySize, samples: n.samples }); publish(); }
};
document.querySelector<HTMLButtonElement>("#images")!.onclick = async () => {
  record.images = [];
  try {
    for (const f of fixtures.images) {
      const original = bytes(f), { image, header, bytes: retained } = await decodeBrushTip(new Blob([original], { type: f.mime }));
      record.images.push({ name: f.name, width: image.width, height: image.height, passed: image.width === f.width && image.height === f.height && retained.every((b, i) => b === original[i]) && header.mime === f.mime }); image.close();
    }
    const giant = bytes(fixtures.images[0]); new DataView(giant.buffer).setUint32(16, 100000);
    let refused = false; try { const loaded = await decodeBrushTip(new Blob([giant], { type: "image/png" })); loaded.image.close(); } catch (error) { refused = (error as { code?: string }).code === "dimensions"; }
    record.images.push({ name: "giant PNG header refused", passed: refused });
  } catch (error) { record.images.push({ passed: false, error: String(error) }); }
  publish();
};
output.textContent = "Ready. Owner A starts at 17px; Owner B starts at 43px. Edit A, switch B, then return to A and inspect each state.";

document.addEventListener("keydown",event=>{const entry={key:event.key,code:event.code,ctrl:event.ctrlKey,meta:event.metaKey,prevented:event.defaultPrevented,target:(event.target as HTMLElement).getAttribute?.("role")??(event.target as HTMLElement).tagName};record.keys.push(entry);queueMicrotask(()=>{entry.prevented=event.defaultPrevented;publish();});},true);
document.querySelector<HTMLButtonElement>("#clipboard-check")!.onclick=async()=>{
 try{for(const item of await navigator.clipboard.read())for(const type of item.types){if(type!=="image/png")continue;const blob=await item.getType(type),data=new Uint8Array(await blob.arrayBuffer()),view=new DataView(data.buffer),image=await createImageBitmap(blob);const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext("2d")!;ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;let nonzero=0,maxAlpha=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i])nonzero++;maxAlpha=Math.max(maxAlpha,pixels[i]);}record.clipboard.push({type,bytes:data.length,width:view.getUint32(16),height:view.getUint32(20),decodedWidth:image.width,decodedHeight:image.height,nonzero,maxAlpha});image.close();}}
 catch(error){record.clipboard.push({error:String(error)});}publish();
};

document.querySelector<HTMLButtonElement>("#clipboard-fail")!.onclick=()=>{const original=navigator.clipboard.write.bind(navigator.clipboard);Object.defineProperty(navigator.clipboard,"write",{configurable:true,value:async()=>{Object.defineProperty(navigator.clipboard,"write",{configurable:true,value:original});throw new DOMException("Injected clipboard refusal","NotAllowedError");}});};

const digest=async(data:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),b=>b.toString(16).padStart(2,"0")).join("");
document.querySelector<HTMLButtonElement>("#animation-pixels")!.onclick=async()=>{
 const button=document.querySelector<HTMLButtonElement>("#animation-pixels")!;button.disabled=true;
 const NativeWorker=window.Worker;let activeWorkers=0,peakWorkers=0,terminatedWorkers=0;
 window.Worker=class extends NativeWorker{private stopped=false;constructor(url:string|URL,options?:WorkerOptions){super(url,options);peakWorkers=Math.max(peakWorkers,++activeWorkers);}terminate(){if(!this.stopped){this.stopped=true;activeWorkers--;terminatedWorkers++;}super.terminate();}};
 try{for(const f of animations.images){for(let index=0;index<f.frameCount;index++){
  const raw=bytes(f),original=new Blob([raw],{type:f.mime}),decoded=await decodeDrawingImage(original,undefined,undefined,index),c=document.createElement("canvas");c.width=f.width;c.height=f.height;const ctx=c.getContext("2d")!,expected=Uint8Array.from(atob(f.frames[index]),v=>v.charCodeAt(0));let renderer:DrawingRenderer|undefined;
  const compare=()=>{const actual=ctx.getImageData(0,0,c.width,c.height).data;let maxError=0,different=0;for(let i=0;i<actual.length;i+=4){let error=Math.abs(actual[i+3]-expected[i+3]);for(let k=0;k<3;k++)error=Math.max(error,Math.abs(Math.round(actual[i+k]*actual[i+3]/255)-Math.round(expected[i+k]*expected[i+3]/255)));maxError=Math.max(maxError,error);if(error>2)different++;}return{maxError,different,passed:different===0};};
  try{ctx.drawImage(decoded.source,0,0);const preview=compare(),owned=await api.importBytes(page.id,`${f.name}.${f.mime.split('/')[1]}`,raw),s=newDrawing().scene,art=imagePixelArtwork(s.frames[s.defaultFrameId],f.width,f.height,f.mime,f.name,decoded.orientation);art.asset.attachmentId=owned.id;art.asset.frameIndex=index;const node={...art.node,x:0,y:0,frameId:null},saved=JSON.parse(JSON.stringify(applyChanges(s,pixelArtworkChanges(s,art,node))));renderer=new DrawingRenderer();await renderer.prepare(saved);renderer.render(c,saved,{x:0,y:0,w:f.width,h:f.height,scale:1},{background:false});const freshRenderer=compare();
   if(index===f.frameCount-1){await new Promise(resolve=>setTimeout(resolve,210));renderer.render(c,saved,{x:0,y:0,w:f.width,h:f.height,scale:1},{background:false});}
   const stable=compare();record.ingests.push({name:`${f.name} frame ${index}`,animation:decoded.animation,orientation:decoded.orientation,width:decoded.header.width,height:decoded.header.height,sha256:await digest(new Uint8Array(await decoded.original.arrayBuffer())),preview,freshRenderer,stable,activeWorkers,passed:preview.passed&&freshRenderer.passed&&stable.passed&&decoded.animation?.index===index&&decoded.animation.frameCount===f.frameCount&&decoded.original===original&&activeWorkers===0});publish();
  }finally{decoded.dispose();renderer?.dispose();c.width=c.height=1;}
 }}
 const raw=bytes(animations.images[0]),controller=new AbortController(),task=decodeAnimatedFrame({bytes:raw,mime:"image/webp",index:1,orientation:1},controller.signal);controller.abort();let canceled=false;try{await task;}catch(error){canceled=error instanceof DOMException&&error.name==="AbortError";}record.ingests.push({name:"actual animation worker abort releases resource",activeWorkers,peakWorkers,terminatedWorkers,passed:canceled&&activeWorkers===0});publish();
 }catch(error){record.ingests.push({passed:false,error:String(error),activeWorkers});publish();}finally{window.Worker=NativeWorker;button.disabled=false;}
};
document.querySelector<HTMLButtonElement>("#clipboard-seed")!.onclick=async()=>{
 try{const raw=bytes(fixtures.images[0]);await navigator.clipboard.write([new ClipboardItem({"image/png":new Blob([raw],{type:"image/png"})})]);record.clipboard.push({fixtureWritten:true,sha256:await digest(raw),width:fixtures.images[0].width,height:fixtures.images[0].height});}
 catch(error){record.clipboard.push({fixtureWritten:false,error:String(error)});}publish();
};
document.querySelector<HTMLButtonElement>("#orientation-pixels")!.onclick=async()=>{
 const button=document.querySelector<HTMLButtonElement>("#orientation-pixels")!;button.disabled=true;
 try{for(const f of probes.images){
  const golden=expectedOrientation.images.find(g=>g.mime===f.mime&&g.orientation===f.orientation)!,original=bytes(f),decoded=await decodeDrawingImage(new Blob([original],{type:f.mime})),c=document.createElement("canvas");c.width=f.width;c.height=f.height;const ctx=c.getContext("2d")!,expected=Uint8Array.from(atob(golden.rgba),v=>v.charCodeAt(0));
  const compare=()=>{const actual=ctx.getImageData(0,0,c.width,c.height).data;let maxError=0,different=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);maxError=Math.max(maxError,delta);if(delta>3)different++;}return{maxError,different,passed:different===0};};
  let renderer:DrawingRenderer|undefined;
  try{ctx.drawImage(decoded.source,0,0);const preview=compare();const owned=await api.importBytes(page.id,`orientation-${f.orientation}.${f.mime==='image/jpeg'?'jpg':f.mime.split('/')[1]}`,original),baseScene=newDrawing().scene,frame=baseScene.frames[baseScene.defaultFrameId],art=imagePixelArtwork(frame,f.width,f.height,f.mime,"Orientation fixture",f.orientation);art.asset.attachmentId=owned.id;const node={...art.node,x:0,y:0,frameId:null};const saved=JSON.parse(JSON.stringify(applyChanges(baseScene,pixelArtworkChanges(baseScene,art,node))));renderer=new DrawingRenderer();await renderer.prepare(saved);renderer.render(c,saved,{x:0,y:0,w:f.width,h:f.height,scale:1},{background:false});const freshRenderer=compare();record.ingests.push({name:`${f.mime} orientation ${f.orientation} RGBA`,preview,freshRenderer,passed:preview.passed&&freshRenderer.passed});publish();}
  finally{decoded.dispose();renderer?.dispose();c.width=c.height=1;}
 }}catch(error){record.ingests.push({passed:false,error:String(error)});publish();}finally{button.disabled=false;}
};
document.querySelector<HTMLButtonElement>("#drawing-images")!.onclick=async()=>{
 try{for(const f of[...fixtures.images,...oriented.images]){const original=bytes(f),file=new Blob([original],{type:f.mime}),decoded=await decodeDrawingImage(file);record.ingests.push({name:f.name,orientation:decoded.orientation,codecAppliedOrientation:await codecAppliesOrientation(f.mime,decoded.orientation),width:decoded.header.width,height:decoded.header.height,naturalWidth:decoded.source.naturalWidth,naturalHeight:decoded.source.naturalHeight,sha256:await digest(new Uint8Array(await decoded.original.arrayBuffer())),passed:decoded.header.width===f.width&&decoded.header.height===f.height&&decoded.source.naturalWidth===f.width&&decoded.source.naturalHeight===f.height&&decoded.original===file});decoded.dispose();publish();}}
 catch(error){record.ingests.push({passed:false,error:String(error)});publish();}
};
document.querySelector<HTMLButtonElement>("#originals")!.onclick=async()=>{
 const scene=drawingSession(page.id).snapshot().document!.scene;for(const asset of Object.values(scene.assets)){const response=await fetch(fileUrl(asset.attachmentId));if(!response.ok)throw Error("Original unavailable");const data=new Uint8Array(await response.arrayBuffer());record.imageOriginals.push({id:asset.id,attachmentId:asset.attachmentId,width:asset.width,height:asset.height,mime:asset.mime,orientation:asset.orientation,bytes:data.length,sha256:await digest(data)});}publish();
};
