import { useStore } from "../state/store";
import type { Rect } from "./model";
export interface DrawingLocation { frameId: string; camera: Rect }
const pending = new Map<string, DrawingLocation>();
const comments = new Map<string, string>();
export function openDrawingComment(pageId: string, threadId: string) { comments.set(pageId, threadId); useStore.getState().openPage(pageId, "current"); window.dispatchEvent(new CustomEvent("worlds:drawing-comment", { detail: { pageId } })); }
export function consumeDrawingComment(pageId: string) { const thread = comments.get(pageId); comments.delete(pageId); return thread; }
export function openDrawingLocation(pageId: string, frameId: string, camera: Rect) {
  if (![camera.x, camera.y, camera.w, camera.h].every(Number.isFinite) || camera.w <= 0 || camera.h <= 0) return;
  pending.set(pageId, { frameId, camera }); useStore.getState().openPage(pageId, "current");
  window.dispatchEvent(new CustomEvent("worlds:drawing-location", { detail: { pageId } }));
}
export function consumeDrawingLocation(pageId: string): DrawingLocation | undefined { const location = pending.get(pageId); pending.delete(pageId); return location; }
