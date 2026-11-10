import { imageHeader, ImageHeaderError } from "./imageHeaders";
import { imageOrientation } from "./imageOrientation";

self.onmessage = (event: MessageEvent<{ bytes: Uint8Array<ArrayBuffer>; maxSide: number; maxBytes: number }>) => {
  const { bytes, maxSide, maxBytes } = event.data;
  try {
    const header = imageHeader(bytes, maxSide, maxBytes, true);
    const orientation = imageOrientation(bytes, header.mime);
    (self as unknown as { postMessage(value: unknown, transfer: Transferable[]): void }).postMessage({ bytes, header, orientation }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error), code: error instanceof ImageHeaderError ? error.code : undefined });
  }
};
