/** Encode an already-rendered canvas away from the UI thread when supported.
 * Terminating the disposable worker cancels encoding when the dialog closes. */
export async function encodeExportCanvas(canvas: HTMLCanvasElement, format: string, quality: number, signal: AbortSignal): Promise<Blob> {
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  if (signal.aborted) throw cancelled();
  const encodeNative = (): Promise<Blob> => {
    if (signal.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const abort = () => reject(cancelled());
      signal.addEventListener("abort", abort, { once: true });
      try {
        canvas.toBlob(blob => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) return;
          blob?.type === format ? resolve(blob) : reject(new Error("This image export format is unavailable"));
        }, format, quality);
      } catch (error) { signal.removeEventListener("abort", abort); reject(error); }
    });
  };
  // A bitmap plus the worker surface temporarily duplicate the rendered pixels.
  // Keep exceptionally large exports on the browser's native encoder to bound
  // the additional allocations rather than risking an out-of-memory failure.
  if (canvas.width * canvas.height > 16 * 1024 * 1024 || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    return encodeNative();
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(canvas); }
  catch { return encodeNative(); }
  if (signal.aborted) { bitmap.close(); throw cancelled(); }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./exportEncode.worker.ts", import.meta.url), { type: "module" }); }
    catch { bitmap.close(); void encodeNative().then(resolve, reject); return; }
    const stop = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { stop(); reject(cancelled()); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      stop();
      if (!event.data.error && event.data.blob?.type === format) resolve(event.data.blob);
      else void encodeNative().then(resolve, reject);
    };
    worker.onerror = () => { stop(); void encodeNative().then(resolve, reject); };
    try { worker.postMessage({ bitmap, format, quality }, [bitmap]); }
    catch { bitmap.close(); stop(); void encodeNative().then(resolve, reject); }
  });
}
