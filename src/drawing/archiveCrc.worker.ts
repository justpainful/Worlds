import { blobCrc32 } from "./archiveCrc";

self.onmessage = async (event: MessageEvent<{ blob: Blob }>) => {
  try { self.postMessage({ crc: await blobCrc32(event.data.blob) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
