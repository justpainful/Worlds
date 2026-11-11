import { imageHeader, type ImageHeader } from "./imageHeaders";
import { validateAnimation } from "./animatedImageLimits";
export interface AnimatedFrameRequest {
  bytes: Uint8Array;
  mime: string;
  index: number;
  orientation: number;
}
export interface AnimatedFrameResult {
  blob: Blob;
  frameCount: number;
  index: number;
  width: number;
  height: number;
}
/** A disposable decoder worker owns its VideoFrames and terminates immediately
 * on cancellation. Only the selected full composited frame returns as PNG. */
export function decodeAnimatedFrame(
  request: AnimatedFrameRequest,
  signal?: AbortSignal,
  options: { takeOwnership?: boolean; validatedHeader?: ImageHeader } = {},
): Promise<AnimatedFrameResult> {
  const header = options.validatedHeader ?? imageHeader(request.bytes, 1_000_000, 256 * 1024 * 1024, true);
  validateAnimation(header, request.index);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    if (typeof Worker === "undefined") {
      reject(new Error("Static animation frames are unavailable in this window"));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./animatedImage.worker.ts", import.meta.url), { type: "module" });
    } catch {
      reject(new Error("Static animation frames are unavailable in this window"));
      return;
    }
    const stop = () => {
        worker.terminate();
        signal?.removeEventListener("abort", abort);
      },
      abort = () => {
        stop();
        reject(new DOMException("Cancelled", "AbortError"));
      };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<AnimatedFrameResult & { error?: string }>) => {
      stop();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data);
    };
    worker.onerror = (event) => {
      stop();
      reject(new Error(event.message || "Static animation frames are unavailable in this window"));
    };
    try {
      const input = request.bytes,
        canTransfer =
          options.takeOwnership &&
          input.buffer instanceof ArrayBuffer &&
          input.byteOffset === 0 &&
          input.byteLength === input.buffer.byteLength,
        bytes = canTransfer ? input : input.slice();
      worker.postMessage({ ...request, bytes }, [bytes.buffer as ArrayBuffer]);
    } catch (error) {
      stop();
      reject(error);
    }
  });
}
