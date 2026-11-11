import type { MaskRaster, MaskRasterTask } from "./maskRaster";
function run<T>(task: MaskRasterTask | { kind: "encode"; mask: MaskRaster; invert?: boolean }, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./maskRaster.worker.ts", import.meta.url), { type: "module" }),
      stop = () => {
        worker.terminate();
        signal?.removeEventListener("abort", abort);
      },
      abort = () => {
        stop();
        reject(new DOMException("Cancelled", "AbortError"));
      };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) => {
      stop();
      e.data.error ? reject(Error(e.data.error)) : resolve((task.kind === "encode" ? e.data.blob : e.data.mask) as T);
    };
    worker.onerror = (e) => {
      stop();
      reject(Error(e.message));
    };
    try {
      worker.postMessage({ task }, [task.mask.alpha.buffer]);
    } catch (error) {
      stop();
      reject(error);
    }
  });
}
export const runMaskRasterTask = (task: MaskRasterTask, signal?: AbortSignal) => run<MaskRaster>(task, signal);
export const encodeMaskRaster = (mask: MaskRaster, signal?: AbortSignal, invert = false) =>
  run<Blob>({ kind: "encode", mask, invert }, signal);
