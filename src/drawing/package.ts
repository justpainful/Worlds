import {validatePortableHistory,historyAttachmentIds,rewriteHistoryAttachments,historyVersionIds,historySourceScenes,portableScenesMatch,remapPortableHistory} from "./portableHistory";
import type {DrawingDocument} from "./model";
import {imageHeader} from './imageHeaders';
import { validateScene, type DrawingScene } from "./model";
import { validateLibraryMetadata, type LibraryMetadata } from "./library";
const HEADER = "WORLDSDRAW1\n";
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
interface PackageAsset { id: string; name: string; mime: string; sha256: string; data?: string; dataRef?: string; sceneAssetId?: string; versionId?: string;historyAttachmentId?:string }
interface PackageVersion { scene: DrawingScene; label: string }
export interface PackageExperiment{name:string;description:string;status:"draft"|"review"|"approved";sceneKey:string;baseKey:string;versionAliases:Record<string,string>}
export interface ImportedPackageExperiment{name:string;description:string;status:string;scene:DrawingScene;base:DrawingScene;versionAliases:Record<string,string>}
export interface DrawingPackage { format: "worldsdraw"; version: 1|2|3; scene: DrawingScene; assets: PackageAsset[]; versions?: Record<string, PackageVersion>; library?: LibraryMetadata;history?:DrawingDocument;experiments?:PackageExperiment[];preview?:{mime:"image/png";width:number;height:number;sha256:string;data:string} }
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 32768) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
  return btoa(chunks.join(""));
}
async function collect(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const reader = stream.getReader(), parts: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > MAX_PACKAGE_BYTES) throw new Error("This project package exceeds the memory limit"); parts.push(value);
    }
  } catch (e) { await reader.cancel(); throw e; }
  const result = new Uint8Array(length); let at = 0; for (const part of parts) { result.set(part, at); at += part.byteLength; } return result;
}
/** The portable file contains originals; a sanitized image export never uses this path. */
export interface DrawingPackageOptions{includePreview?:boolean;includeHistory?:boolean;includeExperiments?:boolean;onExperimentSources?:(scenes:DrawingScene[],pageIds:string[])=>void;onHistorySources?:(scenes:DrawingScene[])=>void}
export async function createDrawingPackage(scene: DrawingScene, signal?: AbortSignal, pageId?: string, library?: LibraryMetadata,options:DrawingPackageOptions={}): Promise<Blob> {
  const { api, fileUrl } = await import("../lib/api");
  validateScene(scene); const snapshot = structuredClone(scene), assets: PackageAsset[] = [], versions: Record<string, PackageVersion> = {}; let total = 0;
  const pinned = (s: DrawingScene) => Object.values(s.steps).flatMap((step) => step.pinnedVersionId ? [step.pinnedVersionId] : []);
  let history:DrawingDocument|undefined;
  if(options.includeHistory){if(!pageId)throw new Error("Export history from its source drawing");history=structuredClone(await api.drawingLoad(pageId));validatePortableHistory(history);if(!portableScenesMatch(history.scene,scene,id=>id))throw new Error("The drawing changed. Reopen export to include its history.");options.onHistorySources?.(historySourceScenes(history));}
  const experiments:PackageExperiment[]=[],experimentSources:DrawingScene[]=[],experimentPages:string[]=[];
  const pending:{id:string;page:string;key:string;prefix:string}[]=[...pinned(snapshot),...(history?historyVersionIds(history):[])].map(id=>({id,page:pageId!,key:id,prefix:''}));
  const addPins=(s:DrawingScene,owner:string,prefix:string)=>{for(const step of Object.values(s.steps))if(step.pinnedVersionId){const id=step.pinnedVersionId;step.pinnedVersionId=prefix+id;pending.push({id,page:owner,key:prefix+id,prefix});}};
  if(options.includeExperiments){if(!pageId)throw Error('Export experiments from their source drawing');const entries=await api.drawingExperiments(pageId);if(entries.length>24)throw Error('This package exceeds24 experiments');
   for(const[index,entry]of entries.entries()){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const document=await api.drawingLoad(entry.page.id),info=document.experiment;if(!info||info.sourceId!==pageId)throw Error('The experiment source changed');const base=structuredClone(await api.drawingVersionScene(pageId,info.baseVersionId)),branch=structuredClone(document.scene);validateScene(base);validateScene(branch);experimentSources.push(structuredClone(branch),structuredClone(base));experimentPages.push(entry.page.id);
    const prefix=`experiment:${index}:`,sceneKey=`experiment-scene:${index}`,baseKey=`experiment-base:${index}`,aliases:Record<string,string>={};
    const direct=new Set(pinned(branch));for(const[old,target]of Object.entries(info.versionAliases??{}))if(direct.has(old)){aliases[prefix+old]=target;pending.push({id:target,page:pageId,key:target,prefix:''});}
    addPins(branch,entry.page.id,prefix);addPins(base,pageId,'');versions[sceneKey]={scene:branch,label:entry.page.title};versions[baseKey]={scene:base,label:'Experiment comparison base'};experiments.push({name:entry.page.title,description:info.description,status:info.status,sceneKey,baseKey,versionAliases:aliases});
   }
  }
  while(pending.length){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const next=pending.pop()!;if(Object.hasOwn(versions,next.key))continue;if(['__proto__','constructor','prototype'].includes(next.key)||Object.keys(versions).length>=500)throw Error('Invalid or excessive presentation version dependencies');if(!next.page)throw Error('Export pinned presentations from their source drawing');const old=structuredClone(await api.drawingVersionScene(next.page,next.id));validateScene(old);if(experiments.length)experimentSources.push(structuredClone(old));addPins(old,next.page,next.prefix);versions[next.key]={scene:old,label:'Presentation snapshot'};}
  if(experiments.length){options.onExperimentSources?.(experimentSources,experimentPages);const{checkDrawingExport}=await import('./files');await checkDrawingExport({pageId:pageId!,kind:'projects',sourcePageIds:experimentPages,scenes:[{scene},...experimentSources.map(scene=>({scene}))]});}
  const contents = new Set<string>(), attachmentCache = new Map<string, { bytes: Uint8Array; sha256: string }>();
  const packScene = async (s: DrawingScene, versionId?: string) => {
    for (const asset of Object.values(s.assets)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      let original = attachmentCache.get(asset.attachmentId);
      if (!original) { const response = await fetch(fileUrl(asset.attachmentId), { signal }); if (!response.ok) throw new Error(`Could not read ${asset.name}`); const bytes = new Uint8Array(await response.arrayBuffer()); original = { bytes, sha256: await digest(bytes) }; attachmentCache.set(asset.attachmentId, original); }
      const { bytes, sha256 } = original, key = versionId ? `version:${versionId}:${asset.id}` : asset.id;
      const shared = contents.has(sha256);
      if (!shared) { total += bytes.length; if (total > MAX_PACKAGE_BYTES / 2) throw new Error("The project originals are too large for this export"); contents.add(sha256); }
      assets.push({ id: key, sceneAssetId: asset.id, versionId, name: asset.name, mime: asset.mime, sha256, ...(shared ? { dataRef: sha256 } : { data: base64(bytes) }) });
      asset.attachmentId = `package:${key}`;
    }
  };
  await packScene(snapshot); for (const [versionId, version] of Object.entries(versions)) await packScene(version.scene, versionId);
  if(history){const references=new Map<string,string>();for(const attachmentId of historyAttachmentIds(history)){
    if(signal?.aborted)throw new DOMException("Cancelled","AbortError");let original=attachmentCache.get(attachmentId);
    if(!original){const response=await fetch(fileUrl(attachmentId),{signal});if(!response.ok)throw new Error("A history original is unavailable");const bytes=new Uint8Array(await response.arrayBuffer());original={bytes,sha256:await digest(bytes)};attachmentCache.set(attachmentId,original);}
    const shared=contents.has(original.sha256);if(!shared){total+=original.bytes.length;if(total>MAX_PACKAGE_BYTES/2)throw new Error("The project originals are too large for this export");contents.add(original.sha256);}
    const metadata=[...Object.values(history.seed.assets),...Object.values(history.scene.assets),...history.operations.flatMap(op=>op.type==='edit'?op.changes.flatMap(c=>c.type==='put'&&c.collection==='assets'?[c.value as DrawingScene['assets'][string]]:[]):[])].find(a=>a.attachmentId===attachmentId);
    assets.push({id:`history:${attachmentId}`,historyAttachmentId:attachmentId,name:metadata?.name??'history-original.bin',mime:metadata?.mime??'application/octet-stream',sha256:original.sha256,...(shared?{dataRef:original.sha256}:{data:base64(original.bytes)})});references.set(attachmentId,`package:history:${attachmentId}`);
  }history=rewriteHistoryAttachments(history,references);validatePortableHistory(history);}
  let preview:DrawingPackage['preview'];if(options.includePreview){const{DrawingRenderer}=await import('./renderer'),renderer=new DrawingRenderer();const cancel=()=>renderer.dispose();signal?.addEventListener('abort',cancel,{once:true});try{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const frame=scene.frames[scene.defaultFrameId],blob=await renderer.exportFrame(scene,frame,Math.min(1,320/frame.w,180/frame.h),true),bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');preview={mime:'image/png',width:view.getUint32(16),height:view.getUint32(20),sha256:await digest(bytes),data:base64(bytes)};}finally{signal?.removeEventListener('abort',cancel);renderer.dispose();}}
  if (library) validateLibraryMetadata(library, snapshot);
  const payload: DrawingPackage = { format: "worldsdraw", version: experiments.length?3:history?2:1, scene: snapshot, assets, versions, library,history,preview,...(experiments.length?{experiments}:{} ) };
  const compressed = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = await collect(compressed, signal);
  return new Blob([HEADER, new Uint8Array(bytes)], { type: "application/x-worlds-drawing" });
}
export async function readDrawingPackage(blob: Blob, signal?: AbortSignal): Promise<DrawingPackage> {
  if (blob.size > MAX_PACKAGE_BYTES) throw new Error("The project package is too large");
  if (await blob.slice(0, HEADER.length).text() !== HEADER) throw new Error("This is not a Worlds drawing project");
  const stream = blob.slice(HEADER.length).stream().pipeThrough(new DecompressionStream("gzip"));
  const bytes = await collect(stream, signal);
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as DrawingPackage;
  if (value.format !== "worldsdraw" || ![1,2,3].includes(value.version) || !Array.isArray(value.assets)) throw new Error("Unsupported drawing package version");
  validateScene(value.scene);
  if (value.library) validateLibraryMetadata(value.library, value.scene);
  if(value.history){if(value.version<2)throw new Error("Unsupported portable history version");validatePortableHistory(value.history);}
  if(value.preview){const p=value.preview;if(p.mime!=="image/png"||!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>320||p.height>180||typeof p.data!=="string"||p.data.length>4*1024*1024||typeof p.sha256!=="string")throw new Error("Invalid project preview");const bytes=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);imageHeader(bytes,320,4*1024*1024,false);if(bytes.length<24||view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a||view.getUint32(16)!==p.width||view.getUint32(20)!==p.height||await digest(bytes)!==p.sha256)throw new Error("Damaged project preview");}
  if (value.versions && (typeof value.versions !== "object" || Array.isArray(value.versions) || Object.keys(value.versions).length > 500)) throw new Error("Invalid presentation versions");
  const scenes = new Map<string, DrawingScene>([["", value.scene]]);
  for (const [id, version] of Object.entries(value.versions ?? {})) { if (["__proto__", "constructor", "prototype"].includes(id) || !version || typeof version.label !== "string") throw new Error("Invalid presentation version"); validateScene(version.scene); scenes.set(id, version.scene); }
  if(value.experiments!==undefined){if(!Array.isArray(value.experiments)||value.experiments.length>24)throw Error('Invalid portable experiments');const keys=new Set<string>();for(const e of value.experiments){if(!e||typeof e.name!=='string'||!e.name.trim()||e.name.length>160||typeof e.description!=='string'||e.description.length>4000||!['draft','review','approved'].includes(e.status)||typeof e.sceneKey!=='string'||typeof e.baseKey!=='string'||e.sceneKey===e.baseKey||keys.has(e.sceneKey)||keys.has(e.baseKey)||!scenes.has(e.sceneKey)||!scenes.has(e.baseKey)||!e.versionAliases||typeof e.versionAliases!=='object'||Array.isArray(e.versionAliases)||Object.keys(e.versionAliases).length>500||Object.entries(e.versionAliases).some(([key,target])=>!scenes.has(key)||typeof target!=='string'||!scenes.has(target)))throw Error('Invalid portable experiment dependency');keys.add(e.sceneKey);keys.add(e.baseKey);}}
  for (const scene of scenes.values()) for (const step of Object.values(scene.steps)) if (step.pinnedVersionId && !scenes.has(step.pinnedVersionId)) throw new Error("The package is missing a pinned presentation version");
  const seen = new Set<string>(), entries = new Set<string>(), data = new Map<string, string>(), verified = new Set<string>();
  for (const asset of value.assets) {
    if (!asset || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256) || typeof asset.name !== "string" || typeof asset.mime !== "string" || (typeof asset.data === "string") === (typeof asset.dataRef === "string")) throw new Error("Invalid project asset directory");
    if (typeof asset.data === "string") {
      if (data.has(asset.sha256) && data.get(asset.sha256) !== asset.data) throw new Error(`The original ${asset.name} is damaged`);
      data.set(asset.sha256, asset.data);
    } else if (asset.dataRef !== asset.sha256) throw new Error("Invalid project asset reference");
  }
  const historyRefs=new Set(value.history?historyAttachmentIds(value.history):[]);
  for (const asset of value.assets) {
    if(asset.historyAttachmentId!==undefined){const key=asset.historyAttachmentId,entry=`history/${key}`,encoded=data.get(asset.sha256);if(typeof key!=="string"||!key||key.length>160||asset.versionId!==undefined||asset.sceneAssetId!==undefined||!historyRefs.has(`package:history:${key}`)||seen.has(asset.id)||entries.has(entry)||typeof encoded!=="string"||encoded.length>MAX_PACKAGE_BYTES)throw new Error("Invalid history original directory");seen.add(asset.id);entries.add(entry);if(!verified.has(asset.sha256)){if(await digest(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)))!==asset.sha256)throw new Error("Damaged history original");verified.add(asset.sha256);}continue;}
    const scene = scenes.get(asset?.versionId ?? ""), sceneAssetId = asset?.sceneAssetId ?? asset?.id, entry = `${asset?.versionId ?? ""}/${sceneAssetId}`, encoded = data.get(asset?.sha256);
    if (!asset || typeof asset.id !== "string" || seen.has(asset.id) || entries.has(entry) || !scene || !Object.hasOwn(scene.assets, sceneAssetId) || typeof encoded !== "string" || encoded.length > MAX_PACKAGE_BYTES || asset.dataRef && asset.dataRef !== asset.sha256) throw new Error("Invalid project asset directory");
    seen.add(asset.id); entries.add(entry);
    if (!verified.has(asset.sha256)) { const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)); if (await digest(bytes) !== asset.sha256) throw new Error(`The original ${asset.name} is damaged`); verified.add(asset.sha256); }
  }
  if (seen.size !== [...scenes.values()].reduce((sum, scene) => sum + Object.keys(scene.assets).length, 0)+historyRefs.size) throw new Error("The package is missing original assets");
  if(value.history){for(const id of historyVersionIds(value.history))if(!scenes.has(id))throw new Error("The package is missing a history version");const hashes=new Map(value.assets.map(a=>[a.historyAttachmentId?`package:history:${a.historyAttachmentId}`:`package:${a.id}`,a.sha256]));if(!portableScenesMatch(value.history.scene,value.scene,id=>hashes.get(id)??id))throw new Error("The history does not match the exported scene");}
  return value;
}
export async function importDrawingPackage(pageId: string, blob: Blob, signal?: AbortSignal): Promise<DrawingScene> {
  const { api } = await import("../lib/api");
  const pack = await readDrawingPackage(blob, signal), scene = structuredClone(pack.scene), versions = structuredClone(pack.versions ?? {});
  const needed=new Set<string>(),pending=Object.values(scene.steps).flatMap(step=>step.pinnedVersionId?[step.pinnedVersionId]:[]);while(pending.length){const id=pending.pop()!;if(needed.has(id))continue;needed.add(id);pending.push(...Object.values(versions[id].scene.steps).flatMap(step=>step.pinnedVersionId?[step.pinnedVersionId]:[]));}for(const id of Object.keys(versions))if(!needed.has(id))delete versions[id];const versionIds=new Map(Object.keys(versions).map(id=>[id,crypto.randomUUID()]));
  const data = new Map<string, string>(); for (const asset of pack.assets) if (typeof asset.data === "string") data.set(asset.sha256, asset.data);
  const imported = new Map<string, string>();
  for (const asset of pack.assets) {
    if(asset.historyAttachmentId!==undefined||asset.versionId&&!versions[asset.versionId])continue;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    let attachmentId = imported.get(asset.sha256);
    if (!attachmentId) { const bytes = Uint8Array.from(atob(data.get(asset.sha256)!), (c) => c.charCodeAt(0)); const attachment = await api.importBytes(pageId, asset.name, bytes); attachmentId = attachment.id; imported.set(asset.sha256, attachmentId); }
    const target = asset.versionId ? versions[asset.versionId].scene : scene;
    target.assets[asset.sceneAssetId ?? asset.id].attachmentId = attachmentId;
  }
  const remap = (s: DrawingScene) => { for (const step of Object.values(s.steps)) if (step.pinnedVersionId) step.pinnedVersionId = versionIds.get(step.pinnedVersionId)!; };
  delete scene.libraryPublication;remap(scene); for (const version of Object.values(versions)){delete version.scene.libraryPublication;remap(version.scene);}
  for (const [oldId, version] of Object.entries(versions)) { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); await api.drawingVersionImport(pageId, versionIds.get(oldId)!, version.label, version.scene); }
  return scene;
}
/** Editable experiment bundles always become fresh independent local drawings. */
export async function importDrawingBundlePackage(blob:Blob,name:string,signal?:AbortSignal,options:{history?:boolean;experiments?:boolean;onCommit?:()=>void}={}){
 const{api}=await import('../lib/api'),pack=await readDrawingPackage(blob,signal);if(options.history&&!pack.history)throw Error('This package does not contain an operation history');if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const stage=await api.drawingPackageStage(name.trim()||'Imported drawing'),data=new Map<string,string>(),owned=new Map<string,string>(),references=new Map<string,string>(),scene=structuredClone(pack.scene),versions=structuredClone(pack.versions??{}),selected=options.experiments?pack.experiments??[]:[],decorators=new Set((pack.experiments??[]).flatMap(e=>[e.sceneKey,e.baseKey]));let committed=false;
 try{
  const keep=new Set<string>(),pending=[...Object.values(scene.steps).flatMap(step=>step.pinnedVersionId?[step.pinnedVersionId]:[]),...(options.history&&pack.history?historyVersionIds(pack.history):[]),...selected.flatMap(e=>[e.sceneKey,e.baseKey,...Object.keys(e.versionAliases),...Object.values(e.versionAliases)])];while(pending.length){const id=pending.pop()!;if(keep.has(id))continue;keep.add(id);pending.push(...Object.values(versions[id].scene.steps).flatMap(step=>step.pinnedVersionId?[step.pinnedVersionId]:[]));}
  for(const asset of pack.assets)if(asset.data)data.set(asset.sha256,asset.data);
  for(const asset of pack.assets){if(asset.historyAttachmentId!==undefined&&!options.history||asset.versionId&&!keep.has(asset.versionId))continue;if(signal?.aborted)throw new DOMException('Cancelled','AbortError');let attachment=owned.get(asset.sha256);if(!attachment){attachment=(await api.importBytes(stage.page.id,asset.name,Uint8Array.from(atob(data.get(asset.sha256)!),c=>c.charCodeAt(0)))).id;owned.set(asset.sha256,attachment);}if(asset.historyAttachmentId)references.set(`package:history:${asset.historyAttachmentId}`,attachment);else(asset.versionId?versions[asset.versionId].scene:scene).assets[asset.sceneAssetId??asset.id].attachmentId=attachment;}
  const opIds=new Map((options.history?pack.history?.operations??[]:[]).map(op=>[op.id,crypto.randomUUID()])),versionIds=new Map([...keep].map(id=>[id,opIds.get(id)??crypto.randomUUID()]));const remap=(s:DrawingScene)=>{delete s.libraryPublication;for(const step of Object.values(s.steps))if(step.pinnedVersionId){const id=versionIds.get(step.pinnedVersionId);if(!id)throw Error('Missing imported snapshot');step.pinnedVersionId=id;}};remap(scene);for(const id of keep)remap(versions[id].scene);
  for(const id of keep){if(decorators.has(id))continue;if(signal?.aborted)throw new DOMException('Cancelled','AbortError');await api.drawingVersionImport(stage.page.id,versionIds.get(id)!,versions[id].label,versions[id].scene);}
  const document=options.history?remapPortableHistory(rewriteHistoryAttachments(pack.history!,references),versionIds,opIds):{revision:0,seed:scene,scene,operations:[]};
  const experiments:ImportedPackageExperiment[]=selected.map(e=>({name:e.name,description:e.description,status:e.status,scene:versions[e.sceneKey].scene,base:versions[e.baseKey].scene,versionAliases:Object.fromEntries(Object.entries(e.versionAliases).map(([key,value])=>[versionIds.get(key)!,versionIds.get(value)!]))}));
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');options.onCommit?.();const result=await api.drawingPackageInstall(stage.page.id,stage.token,document,experiments);committed=true;return result;
 }finally{if(!committed)await api.drawingPackageAbort(stage.page.id,stage.token).catch(()=>false);}
}
/** Historical journals always become a fresh independent local drawing. */
export async function importDrawingHistoryPackage(blob:Blob,name:string,signal?:AbortSignal){return(await importDrawingBundlePackage(blob,name,signal,{history:true})).page;}
