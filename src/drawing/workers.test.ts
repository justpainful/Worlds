import { describe, expect, it, vi, afterEach } from "vitest";
import { updateCrc32, blobCrc32 } from "./archiveCrc";
import { encodeFlattenedSvg } from "./svgEncode";
import { decodePackageBase64 } from "./packageBase64Decode";
import { decodePackageAsset } from "./packageDecode";
import { readBlobBytes } from "./readBlob";
import { preflightDrawingImage } from "./imagePreflight";
import { encodeExportCanvas } from "./exportEncode";
import { viewportReferences } from "./viewportReferences";
import { newScene, newNode, newLayer } from "./model";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Web Worker offloading & utility operations (R03.08, R16.06)", () => {
  describe("archiveCrc", () => {
    it("computes standard CRC32 accurately across chunks", async () => {
      const data = new TextEncoder().encode("Hello Worlds Drawing Engine!");
      let crc = 0xffffffff;
      crc = updateCrc32(crc, data);
      const direct = (crc ^ 0xffffffff) >>> 0;

      const blob = new Blob([data]);
      const blobCrc = await blobCrc32(blob);
      expect(blobCrc).toBe(direct);
      expect(blobCrc).toBeGreaterThan(0);
    });

    it("respects cancellation check during chunked processing", async () => {
      const largeData = new Uint8Array(2 * 1024 * 1024); // 2MB
      const blob = new Blob([largeData]);
      let checks = 0;
      await expect(
        blobCrc32(blob, () => {
          checks++;
          if (checks > 1) throw new Error("Cancelled by check");
        })
      ).rejects.toThrow("Cancelled by check");
    });
  });

  describe("svgEncode", () => {
    it("encodes flattened PNG into SVG wrapper with base64 chunks", async () => {
      // Create minimal valid 1x1 PNG bytes
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, // IHDR length
        0x49, 0x48, 0x44, 0x52, // "IHDR"
        0x00, 0x00, 0x00, 0x01, // width: 1
        0x00, 0x00, 0x00, 0x01, // height: 1
        0x08, 0x06, 0x00, 0x00, 0x00, // 8-bit RGBA
        0x1f, 0x15, 0xc4, 0x89, // CRC
        0x00, 0x00, 0x00, 0x00, // IEND length
        0x49, 0x45, 0x4e, 0x44, // "IEND"
        0xae, 0x42, 0x60, 0x82  // CRC
      ]);
      const blob = new Blob([pngBytes], { type: "image/png" });
      const svgBlob = await encodeFlattenedSvg(blob);
      expect(svgBlob.type).toBe("image/svg+xml");
      const text = await svgBlob.text();
      expect(text).toContain("<svg xmlns=\"http://www.w3.org/2000/svg\"");
      expect(text).toContain("width=\"1\" height=\"1\"");
      expect(text).toContain("href=\"data:image/png;base64,");
    });

    it("rejects non-PNG blobs", async () => {
      const nonPng = new Blob([new TextEncoder().encode("Not a PNG")], { type: "image/jpeg" });
      await expect(encodeFlattenedSvg(nonPng)).rejects.toThrow();
    });
  });

  describe("packageBase64Decode & packageDecode", () => {
    it("decodes valid base64 accurately in aligned chunks", () => {
      const original = new TextEncoder().encode("Arbitrary payload data to test base64 chunking");
      const encoded = btoa(String.fromCharCode(...original));
      const decoded = decodePackageBase64(encoded);
      expect(decoded).toEqual(original);
    });

    it("throws on invalid base64 structure", () => {
      expect(() => decodePackageBase64("Not Valid Base64!@#")).toThrow();
    });

    it("decodes package asset with cancellation support", async () => {
      const original = new TextEncoder().encode("Package asset test");
      const encoded = btoa(String.fromCharCode(...original));
      
      const controller = new AbortController();
      controller.abort();
      await expect(decodePackageAsset(encoded, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });

      const decoded = await decodePackageAsset(encoded);
      expect(decoded).toEqual(original);
    });

    it("uses Worker and terminates on cancellation", async () => {
      const workers: { terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[] = [];
      vi.stubGlobal("Worker", class {
        terminate = vi.fn();
        postMessage = vi.fn();
        constructor() { workers.push(this); }
      });

      const controller = new AbortController();
      const promise = decodePackageAsset("ABCD", controller.signal);
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(workers[0].terminate).toHaveBeenCalled();
    });
  });

  describe("readBlobBytes", () => {
    it("reads bytes from a blob cleanly", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const blob = new Blob([data]);
      const result = await readBlobBytes(blob);
      expect(result).toEqual(data);
    });

    it("aborts when signal is already aborted", async () => {
      const blob = new Blob([new Uint8Array([1, 2])]);
      const controller = new AbortController();
      controller.abort();
      await expect(readBlobBytes(blob, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    });
  });

  describe("imagePreflight", () => {
    it("inspects valid PNG image bytes and returns header and orientation", async () => {
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x0a, // 10
        0x00, 0x00, 0x00, 0x14, // 20
        0x08, 0x06, 0x00, 0x00, 0x00,
        0x35, 0xd1, 0x5d, 0x98,
        0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82
      ]);

      const result = await preflightDrawingImage(pngBytes, 1000, 100000);
      expect(result.header.mime).toBe("image/png");
      expect(result.header.width).toBe(10);
      expect(result.header.height).toBe(20);
      expect(result.orientation).toBe(1);
    });

    it("terminates worker and rejects on cancellation", async () => {
      const workers: { terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[] = [];
      vi.stubGlobal("Worker", class {
        terminate = vi.fn();
        postMessage = vi.fn();
        constructor() { workers.push(this); }
      });

      const controller = new AbortController();
      const dummyBytes = new Uint8Array(16);
      const promise = preflightDrawingImage(dummyBytes, 1000, 10000, controller.signal);
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(workers[0].terminate).toHaveBeenCalled();
    });
  });

  describe("exportEncode", () => {
    it("aborts when signal is already cancelled", async () => {
      const canvas = { width: 100, height: 100, toBlob: vi.fn() } as unknown as HTMLCanvasElement;
      const controller = new AbortController();
      controller.abort();
      await expect(encodeExportCanvas(canvas, "image/png", 1, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("falls back to canvas.toBlob when Worker or OffscreenCanvas is undefined", async () => {
      const canvas = {
        width: 10,
        height: 10,
        toBlob: (callback: (blob: Blob | null) => void, mime?: string) => {
          callback(new Blob(["mock-image-data"], { type: mime || "image/png" }));
        },
      } as unknown as HTMLCanvasElement;
      const controller = new AbortController();
      const blob = await encodeExportCanvas(canvas, "image/png", 0.9, controller.signal);
      expect(blob.type).toBe("image/png");
    });
  });

  describe("viewportReferences (LOD & Viewport filtering)", () => {
    it("filters out reference nodes outside visible region", () => {
      const scene = newScene();
      const layer = newLayer("Layer 1");
      scene.layers[layer.id] = layer;
      scene.layerOrder = [layer.id];

      // Node inside viewport
      const nodeIn = newNode("reference", layer.id, null, { x: 50, y: 50, w: 100, h: 100 });
      nodeIn.sourceId = "src-1";
      nodeIn.sourceMode = "live";
      nodeIn.visible = true;
      nodeIn.opacity = 1;
      scene.nodes[nodeIn.id] = nodeIn;

      // Node far outside viewport
      const nodeOut = newNode("reference", layer.id, null, { x: 5000, y: 5000, w: 100, h: 100 });
      nodeOut.sourceId = "src-2";
      nodeOut.sourceMode = "live";
      nodeOut.visible = true;
      nodeOut.opacity = 1;
      scene.nodes[nodeOut.id] = nodeOut;

      scene.nodeOrder = [nodeIn.id, nodeOut.id];

      const visibleScene = viewportReferences(scene, { x: 0, y: 0, w: 500, h: 500 });
      expect(visibleScene.nodeOrder).toContain(nodeIn.id);
      expect(visibleScene.nodeOrder).not.toContain(nodeOut.id);
    });

    it("returns unmodified scene if viewport is invalid", () => {
      const scene = newScene();
      const res = viewportReferences(scene, { x: NaN, y: 0, w: 100, h: 100 });
      expect(res).toBe(scene);
    });
  });
});
