import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "./zip";

describe("zip", () => {
  it("writes entries in order and reads them back", () => {
    const bytes = writeZip([
      { path: "mimetype", data: "application/epub+zip" },
      { path: "META-INF/container.xml", data: "<container/>" },
      { path: "OEBPS/ch1.xhtml", data: "<p>مرحبا</p>" },
      { path: "files/a.bin", data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    // The first local header names "mimetype", as EPUB readers require.
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe("mimetype");
    const files = readZip(bytes);
    expect(new TextDecoder().decode(files.get("mimetype"))).toBe("application/epub+zip");
    expect(new TextDecoder().decode(files.get("OEBPS/ch1.xhtml"))).toBe("<p>مرحبا</p>");
    expect([...(files.get("files/a.bin") ?? [])]).toEqual([0, 1, 2, 255]);
  });
});
