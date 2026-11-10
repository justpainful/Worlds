const CRC = Array.from({ length: 256 }, (_, value) => {
  let n = value; for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0;
});

export function updateCrc32(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}

/** Read in bounded chunks so archives do not materialize every file in memory. */
export async function blobCrc32(blob: Blob, check: () => void = () => {}): Promise<number> {
  let crc = 0xffffffff;
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    check();
    const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
    check();
    crc = updateCrc32(crc, bytes);
  }
  check();
  return (crc ^ 0xffffffff) >>> 0;
}
