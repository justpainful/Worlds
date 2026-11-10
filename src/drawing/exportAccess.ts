import { api } from "../lib/api";
import { syncConfig } from "../sync/config";
import { validExportPolicy, type DrawingExportContext, type DrawingExportPolicyUpdate } from "./exportPolicy";
import type { DrawingScene } from "./model";
import { useEffect, useState } from "react";
import type { DrawingExportPolicyInfo } from "./exportPolicy";
export function useDrawingExportPolicy(pageId: string | null) {
  const [info,setInfo]=useState<DrawingExportPolicyInfo|null>(null),[error,setError]=useState(""),[request,setRequest]=useState(0);
  useEffect(()=>{
    setInfo(null);setError("");if(!pageId)return;const page=pageId;
    let active=true,checking=false;
    const load=async()=>{if(checking)return;checking=true;try{const next=await readDrawingExportPolicy(page);if(active){setInfo(next);setError("");}}catch(e){if(active)setError(e instanceof Error?e.message:String(e));}finally{checking=false;}};
    void load();const timer=setInterval(()=>void load(),5000),changed=(event:Event)=>{if((event as CustomEvent).detail?.pageId===pageId)void load();};window.addEventListener("worlds:drawing-policy",changed);
    return()=>{active=false;clearInterval(timer);window.removeEventListener("worlds:drawing-policy",changed);};
  },[pageId,request]);
  return {info,error,refresh:()=>setRequest((n)=>n+1)};
}
export async function readDrawingExportPolicy(pageId: string, update?: DrawingExportPolicyUpdate) {
  const cached=await api.drawingExportPolicyCached(pageId),token=cached.shared?await syncConfig().getToken():null;
  const result=cached.shared||update?await api.drawingExportPolicy(pageId,token,update):cached;
  if(!validExportPolicy(result.policy)||!["none","view","comment","edit","full"].includes(result.level))throw new Error("Invalid drawing export permissions");return result;
}
export async function drawingProjectExportContext(pageId: string, scene: DrawingScene, signal?: AbortSignal): Promise<DrawingExportContext> {
  const check=()=>{if(signal?.aborted)throw new DOMException("Cancelled","AbortError");};check();
  const scenes=[{scene:structuredClone(scene)}],seen=new Set<string>(),pending=Object.values(scene.steps).flatMap((s)=>s.pinnedVersionId?[s.pinnedVersionId]:[]);
  while(pending.length){check();const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);if(seen.size>500)throw new Error("Too many pinned export versions");const snapshot=await api.drawingVersionScene(pageId,id);check();scenes.push({scene:snapshot});pending.push(...Object.values(snapshot.steps).flatMap((s)=>s.pinnedVersionId?[s.pinnedVersionId]:[]));}
  return {pageId,kind:"projects",scenes};
}
