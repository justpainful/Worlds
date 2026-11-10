self.onmessage = (event: MessageEvent<{ bytes: Uint8Array<ArrayBuffer> }>) => {
  try {
    const { bytes } = event.data, parts: string[] = [], blockSize = 3 * 16384;
    for (let offset = 0; offset < bytes.length; offset += blockSize) {
      const block = bytes.subarray(offset, offset + blockSize);
      let binary = "";
      for (let i = 0; i < block.length; i += 16384) binary += String.fromCharCode(...block.subarray(i, i + 16384));
      parts.push(btoa(binary));
    }
    self.postMessage({ data: parts.join("") });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
