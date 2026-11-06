/** Stored ZIP archive with UTF-8 filenames and CRC32, readable by standard ZIP tools. */
const CRC = Array.from({ length: 256 }, (_, value) => {
  let n = value; for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0;
});
export function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export async function createZip(entries: { name: string; blob: Blob }[], signal?: AbortSignal): Promise<Blob> {
  if (entries.length > 65535) throw new Error("Too many files in the archive");
  const parts: BlobPart[] = [], directory: Uint8Array[] = [], names = new Set<string>(); let offset = 0;
  for (const entry of entries) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (!entry.name || /(^[\/\\]|(^|[\/\\])\.\.([\/\\]|$)|[\u0000-\u001f:])/.test(entry.name) || names.has(entry.name)) throw new Error("Invalid archive filename");
    names.add(entry.name);
    const bytes = new Uint8Array(await entry.blob.arrayBuffer()), name = new TextEncoder().encode(entry.name), crc = crc32(bytes);
    if (name.length > 65535 || offset + bytes.length > 512 * 1024 * 1024) throw new Error("The archive exceeds the memory limit");
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
    parts.push(local, bytes); directory.push(central); offset += local.length + bytes.length;
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory.map((part) => new Uint8Array(part)), end], { type: "application/zip" });
}
