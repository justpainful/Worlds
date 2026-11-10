import { useStore } from "../state/store";
import type { Rect } from "./model";
export interface DrawingLocation { frameId: string; camera: Rect }
export function isDrawingCamera(value:unknown):value is Rect {
  if(!value||typeof value!=='object')return false;
  const camera=value as Partial<Rect>;
  return [camera.x,camera.y,camera.w,camera.h].every(v=>typeof v==='number'&&Number.isFinite(v))&&typeof camera.w==='number'&&camera.w>0&&typeof camera.h==='number'&&camera.h>0;
}
const pending = new Map<string, DrawingLocation>();
const comments = new Map<string, string>();
export function openDrawingComment(pageId: string, threadId: string) { comments.set(pageId, threadId); useStore.getState().openPage(pageId, "current"); window.dispatchEvent(new CustomEvent("worlds:drawing-comment", { detail: { pageId } })); }
export function consumeDrawingComment(pageId: string) { const thread = comments.get(pageId); comments.delete(pageId); return thread; }
export function openDrawingLocation(pageId: string, frameId: string, camera: Rect) {
  if (!pageId || !frameId || !isDrawingCamera(camera)) return;
  pending.set(pageId, { frameId, camera: { ...camera } }); useStore.getState().openPage(pageId, "current");
  window.dispatchEvent(new CustomEvent("worlds:drawing-location", { detail: { pageId } }));
}
export function consumeDrawingLocation(pageId: string): DrawingLocation | undefined { const location = pending.get(pageId); pending.delete(pageId); return location; }
