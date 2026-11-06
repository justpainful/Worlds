import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Frame } from "./model";
import { PixelSelectionController } from "./selectionController";
export function usePixelSelection(frame:Frame|null){
  const ref=useRef<PixelSelectionController|null>(null);const controller=ref.current??=new PixelSelectionController();
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot);
  useEffect(()=>{controller.configure(frame);return()=>controller.close();},[controller,frame?.id,frame?.x,frame?.y,frame?.w,frame?.h]);
  return{...state,controller};
}
