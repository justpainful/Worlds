import { afterEach, describe, it, expect, vi } from "vitest";
import { decodeDrawingImage, drawingImageName, MAX_IMAGE_BYTES, readDrawingClipboard } from "./imageIngest";
import fixtures from "./fixtures/image-headers.json";
import oriented from "./fixtures/image-orientation.json";
import { imageOrientation } from "./imageOrientation";
const bytes = (name: string) => Uint8Array.from(atob(fixtures.images.find((f) => f.name === name)!.base64), (c) => c.charCodeAt(0));
afterEach(() => vi.unstubAllGlobals());
describe("drawing image preflight and original lifetime", () => {
  it("refuses excessive area before decode even when both sides are individually valid", async () => {
    const input = bytes("png"),
      view = new DataView(input.buffer);
    view.setUint32(16, 10000);
    view.setUint32(20, 10000);
    const decode = vi.fn();
    await expect(decodeDrawingImage(new Blob([input], { type: "image/png" }), undefined, { decode })).rejects.toMatchObject({
      code: "dimensions",
    });
    expect(decode).not.toHaveBeenCalled();
  });
  it("checks byte limit before reading the encoded file and refuses malformed animation/mismatched MIME", async () => {
    const arrayBuffer = vi.fn(),
      decode = vi.fn();
    await expect(
      decodeDrawingImage({ size: MAX_IMAGE_BYTES + 1, arrayBuffer } as unknown as Blob, undefined, { decode }),
    ).rejects.toMatchObject({ code: "size" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    await expect(decodeDrawingImage(new Blob([bytes("png")], { type: "image/jpeg" }), undefined, { decode })).rejects.toMatchObject({
      code: "format",
    });
    const webp = bytes("webp-alpha");
    webp[20] |= 2;
    await expect(decodeDrawingImage(new Blob([webp], { type: "image/webp" }), undefined, { decode })).rejects.toMatchObject({
      code: "format",
    });
    expect(decode).not.toHaveBeenCalled();
  });
  it("retains independently encoded originals and normalizes safe filenames without changing bytes", async () => {
    for (const f of fixtures.images) {
      const file = new Blob([bytes(f.name)], { type: f.mime }),
        source = { naturalWidth: f.width, naturalHeight: f.height } as HTMLImageElement,
        dispose = vi.fn(),
        decoded = await decodeDrawingImage(file, undefined, { decode: async () => ({ source, dispose }) });
      expect(decoded.original).toBe(file);
      expect(decoded.header).toEqual({ width: f.width, height: f.height, mime: f.mime });
      expect(dispose).not.toHaveBeenCalled();
      expect(new Uint8Array(await decoded.original.arrayBuffer())).toEqual(bytes(f.name));
    }
    expect(drawingImageName({ name: "C:\\folder\\..\\photo.JPEG" } as unknown as Blob, "image/jpeg")).toBe("photo.jpg");
  });
  it("disposes mismatched decodes and late results after cancellation", async () => {
    const file = new Blob([bytes("png")], { type: "image/png" }),
      dispose = vi.fn();
    await expect(
      decodeDrawingImage(file, undefined, {
        decode: async () => ({ source: { naturalWidth: 1, naturalHeight: 1 } as HTMLImageElement, dispose }),
      }),
    ).rejects.toMatchObject({ code: "dimensions" });
    expect(dispose).toHaveBeenCalledOnce();
    const controller = new AbortController(),
      f = fixtures.images.find((f) => f.name === "png")!;
    await expect(
      decodeDrawingImage(file, controller.signal, {
        decode: async () => {
          controller.abort();
          return { source: { naturalWidth: f.width, naturalHeight: f.height } as HTMLImageElement, dispose };
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(dispose).toHaveBeenCalledTimes(2);
  });
  it("uses EXIF-oriented display dimensions while retaining all ten encoded originals", async () => {
    for (const f of oriented.images) {
      const data = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
        file = new Blob([data], { type: f.mime });
      expect(imageOrientation(data, f.mime)).toBe(f.orientation);
      const result = await decodeDrawingImage(file, undefined, {
        orientationSupport: async () => true,
        decode: async () => ({ source: { naturalWidth: f.width, naturalHeight: f.height } as HTMLImageElement, dispose: vi.fn() }),
      });
      expect(result.header).toEqual({ width: f.width, height: f.height, mime: f.mime });
      expect(new Uint8Array(await result.original.arrayBuffer())).toEqual(data);
    }
  });
  it("reads bounded little-endian TIFF orientation and ignores malformed optional metadata", () => {
    const b = new Uint8Array(40);
    b.set([
      255, 216, 255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
      255, 217,
    ]);
    expect(imageOrientation(b, "image/jpeg")).toBe(6);
    const invalid = b.slice();
    invalid[30] = 9;
    expect(imageOrientation(invalid, "image/jpeg")).toBe(1);
    invalid[16] = 255;
    expect(imageOrientation(invalid, "image/jpeg")).toBe(1);
    expect(imageOrientation(b.slice(0, 24), "image/jpeg")).toBe(1);
  });
  it("prefers PNG clipboard data and stops before getType when a read is cancelled", async () => {
    const png = new Blob([bytes("png")], { type: "image/png" }),
      getType = vi.fn(async () => png),
      read = async () => [{ types: ["text/html", "image/jpeg", "image/png"], getType }];
    expect(await readDrawingClipboard(undefined, read)).toBe(png);
    expect(getType).toHaveBeenCalledWith("image/png");
    const controller = new AbortController();
    getType.mockClear();
    await expect(
      readDrawingClipboard(controller.signal, async () => {
        controller.abort();
        return read();
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getType).not.toHaveBeenCalled();
    await expect(readDrawingClipboard(undefined, async () => [])).rejects.toThrow("no supported image");
  });
});
