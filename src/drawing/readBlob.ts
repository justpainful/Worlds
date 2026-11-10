/** Read a bounded blob with real cancellation where FileReader is available. */
export function readBlobBytes(blob: Blob, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  if (signal?.aborted) return Promise.reject(cancelled());
  if (typeof FileReader === "undefined") return blob.arrayBuffer().then(buffer => {
    if (signal?.aborted) throw cancelled();
    return new Uint8Array(buffer);
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      signal?.removeEventListener("abort", cancel);
      reader.onload = null; reader.onerror = null; reader.onabort = null;
    };
    const cancel = () => { if (reader.readyState === FileReader.LOADING) reader.abort(); else { cleanup(); reject(cancelled()); } };
    reader.onload = () => {
      const result = reader.result;
      cleanup();
      if (signal?.aborted) reject(cancelled());
      else if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else reject(new Error("Could not read the file"));
    };
    reader.onerror = () => { const error = reader.error; cleanup(); reject(error ?? new Error("Could not read the file")); };
    reader.onabort = () => { cleanup(); reject(cancelled()); };
    signal?.addEventListener("abort", cancel, { once: true });
    try { reader.readAsArrayBuffer(blob); }
    catch (error) { cleanup(); reject(error); }
  });
}
