import type { Pixels } from "./pixels";
export function encodeBmpTask(image: Pixels, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./bmp.worker.ts", import.meta.url), { type: "module" }),
      stop = () => {
        worker.terminate();
        signal.removeEventListener("abort", abort);
      },
      abort = () => {
        stop();
        reject(new DOMException("Cancelled", "AbortError"));
      };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result: Uint8Array<ArrayBuffer>; error?: string }>) => {
      stop();
      event.data.error ? reject(new Error(event.data.error)) : resolve(new Blob([event.data.result], { type: "image/bmp" }));
    };
    worker.onerror = (event) => {
      stop();
      reject(new Error(event.message));
    };
    try {
      worker.postMessage(image, [image.data.buffer]);
    } catch (error) {
      stop();
      reject(error);
    }
  });
}
