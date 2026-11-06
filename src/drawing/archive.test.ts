import { expect, it } from "vitest";
import { createZip, crc32 } from "./archive";
it("uses standard CRC32 and emits a UTF-8 multi-file ZIP", async () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  const archive = await createZip([{ name: "001-شرح.txt", blob: new Blob(["مرحبا"]) }, { name: "002.txt", blob: new Blob(["second step"]) }]);
  const bytes = await archive.arrayBuffer(), view = new DataView(bytes);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint16(bytes.byteLength - 22 + 10, true)).toBe(2);
  await expect(createZip([{ name: "../escape.txt", blob: new Blob([]) }])).rejects.toThrow("filename");
});
