import { imageHeader } from "./imageHeaders";
import { validatePixelDimensions } from "./pixels";

/** Encode one aligned block at a time; only the final block may be padded. */
export async function encodeFlattenedSvg(png: Blob, check: () => void = () => {}): Promise<Blob> {
  check();
  const bytes = new Uint8Array(await png.arrayBuffer());
  check();
  const header = imageHeader(bytes, 1_000_000, 24 * 1024 * 1024);
  if (header.mime !== "image/png") throw new Error("Invalid PNG image");
  validatePixelDimensions(header.width, header.height);
  const parts: BlobPart[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${header.width}" height="${header.height}" viewBox="0 0 ${header.width} ${header.height}"><image width="${header.width}" height="${header.height}" href="data:image/png;base64,`];
  const blockSize = 3 * 16384;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    check();
    const block = bytes.subarray(offset, offset + blockSize);
    let binary = "";
    for (let i = 0; i < block.length; i += 16384) binary += String.fromCharCode(...block.subarray(i, i + 16384));
    parts.push(btoa(binary));
  }
  check();
  parts.push('"/></svg>');
  return new Blob(parts, { type: "image/svg+xml" });
}
