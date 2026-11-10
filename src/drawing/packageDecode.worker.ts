import { decodePackageBase64 } from "./packageBase64Decode";

self.onmessage = (event: MessageEvent<{ encoded: string }>) => {
  try {
    const bytes = decodePackageBase64(event.data.encoded);
    (self as unknown as { postMessage(value: unknown, transfer: Transferable[]): void }).postMessage({ bytes }, [bytes.buffer]);
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
