import type { Pixels } from "./pixels";
import type { PixelTask } from "./pixels.worker";
/** A cancel terminates computation, rather than waiting for a blocked worker to read a flag. */
export function runPixelTask(task: PixelTask, signal?: AbortSignal): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    const worker = new Worker(new URL("./pixels.worker.ts", import.meta.url), { type: "module" });
    const stop = () => { worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = () => { stop(); reject(new DOMException("Cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: Pixels; error?: string }>) => { stop(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result!); };
    worker.onerror = (e) => { stop(); reject(new Error(e.message)); };
    try{const buffers=[task.image.data.buffer,...(task.kind==="masked-effect"?[task.mask.buffer]:[])];worker.postMessage({ id: 1, task }, [...new Set(buffers)]);}catch(error){stop();reject(error);}
  });
}
