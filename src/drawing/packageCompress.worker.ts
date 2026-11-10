self.onmessage = async (event: MessageEvent<{ stream: ReadableStream<Uint8Array<ArrayBuffer>>; limit: number }>) => {
  const { stream, limit } = event.data;
  if (typeof CompressionStream === "undefined") { self.postMessage({ unsupported: true }); return; }
  try {
    const compressed = stream.pipeThrough(new CompressionStream("gzip"));
    const reader = compressed.getReader(), parts: BlobPart[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw new Error("This project package exceeds the memory limit");
        parts.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    self.postMessage({ blob: new Blob(parts, { type: "application/gzip" }) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
