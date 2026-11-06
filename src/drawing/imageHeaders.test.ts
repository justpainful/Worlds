import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBrushTip, imageHeader, ImageHeaderError, MAX_TIP_BYTES } from "./imageHeaders";
import fixtures from "./fixtures/image-headers.json";

const bytes = (name: string) => Uint8Array.from(atob(fixtures.images.find((i) => i.name === name)!.base64), (v) => v.charCodeAt(0));
afterEach(() => vi.unstubAllGlobals());
describe("brush-tip dimension preflight", () => {
  it("reads independently encoded PNG, baseline/progressive JPEG, all three WebP variants and BMP", () => {
    for (const f of fixtures.images) expect(imageHeader(bytes(f.name)), f.name).toEqual({ width: f.width, height: f.height, mime: f.mime });
  });
  it("rejects huge declared PNG dimensions before invoking the browser decoder", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    const data = bytes("png"); new DataView(data.buffer).setUint32(16, 100000);
    await expect(decodeBrushTip(new Blob([data], { type: "image/png" }))).rejects.toMatchObject({ code: "dimensions" });
    expect(decode).not.toHaveBeenCalled();
    await expect(decodeBrushTip(new Blob([new Uint8Array(MAX_TIP_BYTES + 1)]))).rejects.toMatchObject({ code: "size" });
    expect(decode).not.toHaveBeenCalled();
  });
  it("inspects the WebP bitstream as well as the extended canvas header", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    const data = bytes("webp-alpha"), text = new TextDecoder("latin1").decode(data), at = text.indexOf("VP8 ") + 8;
    expect(at).toBeGreaterThan(8); new DataView(data.buffer).setUint16(at + 6, 5000, true);
    await expect(decodeBrushTip(new Blob([data], { type: "image/webp" }))).rejects.toMatchObject({ code: "dimensions" });
    expect(decode).not.toHaveBeenCalled();
  });
  it("rejects truncated structures, zero dimensions and mismatched formats before decode", async () => {
    for (const data of [bytes("png").slice(0, 22), bytes("webp-lossless").slice(0, -1), bytes("bmp").slice(0, 20), new Uint8Array(8)]) expect(() => imageHeader(data)).toThrow(ImageHeaderError);
    const png = bytes("png"); new DataView(png.buffer).setUint32(20, 0); expect(() => imageHeader(png)).toThrow(ImageHeaderError);
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    await expect(decodeBrushTip(new Blob([bytes("png")], { type: "image/jpeg" }))).rejects.toMatchObject({ code: "format" }); expect(decode).not.toHaveBeenCalled();
  });
  it("does not decode animation and closes an oversized decoded bitmap", async () => {
    const data = bytes("webp-alpha"); data[20] |= 2;
    const close = vi.fn(), decode = vi.fn(async () => ({ width: 4096, height: 10, close })); vi.stubGlobal("createImageBitmap", decode);
    await expect(decodeBrushTip(new Blob([data], { type: "image/webp" }))).rejects.toMatchObject({ code: "animation" }); expect(decode).not.toHaveBeenCalled();
    await expect(decodeBrushTip(new Blob([bytes("png")], { type: "image/png" }))).rejects.toMatchObject({ code: "dimensions" }); expect(close).toHaveBeenCalledOnce();
  });
});
