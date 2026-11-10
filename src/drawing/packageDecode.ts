import { decodePackageBase64 } from "./packageBase64Decode";

export function decodePackageAsset(encoded: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  const fallback = () => Promise.resolve().then(() => decodePackageBase64(encoded, () => { if (signal?.aborted) throw cancelled(); }));
  if (signal?.aborted) return Promise.reject(cancelled());
  if (typeof Worker === "undefined") return fallback();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./packageDecode.worker.ts", import.meta.url), { type: "module" }); }
    catch { void fallback().then(resolve, reject); return; }
    const stop = () => { worker.terminate(); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { stop(); reject(cancelled()); };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array<ArrayBuffer>; error?: string }>) => {
      stop();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.bytes) resolve(event.data.bytes);
      else reject(new Error("Could not decode the project original"));
    };
    worker.onerror = () => { stop(); void fallback().then(resolve, reject); };
    try { worker.postMessage({ encoded }); } catch { stop(); void fallback().then(resolve, reject); }
  });
}
