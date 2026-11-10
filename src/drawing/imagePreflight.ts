import { imageHeader, ImageHeaderError, type ImageHeader, type ImageHeaderCode } from "./imageHeaders";
import { imageOrientation } from "./imageOrientation";
import { readBlobBytes } from "./readBlob";

/** Inspect encoded image data off the UI thread and terminate on cancellation. */
export function preflightDrawingImage(bytes: Uint8Array<ArrayBuffer>, maxSide: number, maxBytes: number, signal?: AbortSignal, source?: Blob): Promise<{ bytes: Uint8Array<ArrayBuffer>; header: ImageHeader; orientation: number }> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const fallback = async () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const data = bytes.byteLength ? bytes : source ? await readBlobBytes(source, signal) : bytes;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const header = imageHeader(data, maxSide, maxBytes, true);
    return { bytes: data, header, orientation: imageOrientation(data, header.mime) };
  };
  if (typeof Worker === "undefined") return fallback();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./imagePreflight.worker.ts", import.meta.url), { type: "module" }); }
    catch { void fallback().then(resolve, reject); return; }
    const stop = () => { worker.terminate(); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { stop(); reject(new DOMException("Cancelled", "AbortError")); };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array<ArrayBuffer>; header?: ImageHeader; orientation?: number; error?: string; code?: ImageHeaderCode }>) => {
      stop();
      if (event.data.error) reject(event.data.code ? new ImageHeaderError(event.data.code) : new Error(event.data.error));
      else if (event.data.bytes && event.data.header && event.data.orientation !== undefined) resolve({ bytes: event.data.bytes, header: event.data.header, orientation: event.data.orientation });
      else reject(new Error("Could not inspect the image"));
    };
    worker.onerror = () => { stop(); void fallback().then(resolve, reject); };
    try { worker.postMessage({ bytes, maxSide, maxBytes }, [bytes.buffer]); }
    catch { stop(); void fallback().then(resolve, reject); }
  });
}
