import { save } from "../lib/dialog";
import { api, isTauri } from "../lib/api";
import { syncConfig } from "../sync/config";
import type { DrawingExportContext } from "./exportPolicy";
import { validatePixelDimensions } from "./pixels";
export async function checkDrawingExport(context: DrawingExportContext) {
  const needed = await api.drawingExportRequirements(context), token = needed ? await syncConfig().getToken() : null;
  await api.drawingExportCheck(context,token); return token;
}
export async function saveDrawingBlob(blob: Blob, name: string, context: DrawingExportContext, signal?: AbortSignal, onCommit?: () => void): Promise<boolean> {
  const check = () => { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); };
  check();
  if (isTauri && !(window as unknown as { __WORLDS_MOCK__?: boolean }).__WORLDS_MOCK__) {
    // The IPC envelope rejects larger files; check before materializing a full
    // ArrayBuffer and avoid opening a save dialog for an impossible export.
    if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error("The export exceeds its size limit");
    const ext = name.split(".").pop()!;
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    check();
    if (!path) return false;
    const needed=await api.drawingExportRequirements(context),token=needed?await syncConfig().getToken():null;
    check();
    await api.drawingExportBlob(path,blob,context,token,signal,onCommit); return true;
  }
  await checkDrawingExport(context);
  check(); onCommit?.();
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); return true;
}
export async function copyDrawingImage(blob: Blob, context: DrawingExportContext): Promise<void> {
  if (blob.type!=="image/png"||!navigator.clipboard?.write||typeof ClipboardItem==="undefined") throw new Error("PNG clipboard copying is unavailable in this window");
  await checkDrawingExport(context); await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
}
export async function pixelsToPng(width: number, height: number, data: Uint8ClampedArray): Promise<Blob> {
  if (data.length !== validatePixelDimensions(width, height) * 4) throw new Error("Invalid image dimensions");
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
  try {
    if (!ctx) throw new Error("The image processor is unavailable");
    const view = data.buffer instanceof ArrayBuffer ? new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) : new Uint8ClampedArray(data);
    ctx.putImageData(new ImageData(view, width, height), 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally { canvas.width = canvas.height = 1; }
}
