import { save } from "@tauri-apps/plugin-dialog";
import { api, isTauri } from "../lib/api";
import { syncConfig } from "../sync/config";
import type { DrawingExportContext } from "./exportPolicy";
export async function checkDrawingExport(context: DrawingExportContext) {
  const needed = await api.drawingExportRequirements(context), token = needed ? await syncConfig().getToken() : null;
  await api.drawingExportCheck(context,token); return token;
}
export async function saveDrawingBlob(blob: Blob, name: string, context: DrawingExportContext): Promise<boolean> {
  if (isTauri && !(window as unknown as { __WORLDS_MOCK__?: boolean }).__WORLDS_MOCK__) {
    const ext = name.split(".").pop()!;
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    const needed=await api.drawingExportRequirements(context),token=needed?await syncConfig().getToken():null;
    await api.drawingExport(path, new Uint8Array(await blob.arrayBuffer()),context,token); return true;
  }
  await checkDrawingExport(context);
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); return true;
}
export async function copyDrawingImage(blob: Blob, context: DrawingExportContext): Promise<void> {
  if (blob.type!=="image/png"||!navigator.clipboard?.write||typeof ClipboardItem==="undefined") throw new Error("PNG clipboard copying is unavailable in this window");
  await checkDrawingExport(context); await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
}
export async function pixelsToPng(width: number, height: number, data: Uint8ClampedArray): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The image processor is unavailable");
  const pixels = new ImageData(new Uint8ClampedArray(data), width, height);
  ctx.putImageData(pixels, 0, 0); return canvas.convertToBlob({ type: "image/png" });
}
