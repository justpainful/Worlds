import { describe, expect, it, vi } from "vitest";
import { newScene, newNode } from "./model";
import { newDrawing, edit, appendOperation, putNode, historyToggle } from "./operations";
const native = vi.hoisted(() => ({
  importBytes: vi.fn(),
  drawingVersionImport: vi.fn(),
  drawingVersionScene: vi.fn(),
  drawingLoad: vi.fn(),
  createPage: vi.fn(),
  drawingHistoryImport: vi.fn(),
  drawingPackageStage: vi.fn(),
  drawingPackageAbort: vi.fn(),
  drawingPackageInstall: vi.fn(),
}));
vi.mock("../lib/api", () => ({ api: native, fileUrl: (id: string) => `https://originals.test/${id}` }));
import { createDrawingPackage, digest, importDrawingPackage, readDrawingPackage, importDrawingHistoryPackage } from "./package";
import animations from "./fixtures/animated-images.json";
import images from "./fixtures/image-headers.json";
async function pack(value: unknown) {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Blob(["WORLDSDRAW1\n", await new Response(stream).arrayBuffer()]);
}
describe("portable drawing integrity", () => {
  it("packages a removed original in optional history and restores it after independent import/Undo", async () => {
    const f = images.images.find((f) => f.name === "png")!,
      bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    let doc = newDrawing();
    const n = newNode("image", doc.scene.layerOrder[0], doc.scene.defaultFrameId);
    n.assetId = "original-asset";
    doc = appendOperation(
      doc,
      edit("alice", 0, "Add image", [
        {
          type: "put",
          collection: "assets",
          id: n.assetId,
          value: {
            id: n.assetId,
            attachmentId: "original-file",
            name: "original.png",
            mime: "image/png",
            width: f.width,
            height: f.height,
          },
        },
        ...putNode(doc.scene, n),
      ]),
    );
    doc = appendOperation(
      doc,
      edit("alice", 1, "Remove image", [
        { type: "remove", collection: "nodes", id: n.id },
        { type: "order", list: "nodeOrder", ids: [] },
        { type: "remove", collection: "assets", id: n.assetId },
      ]),
    );
    if (doc.operations[0].type === "edit") doc.operations[0].requiresBase = true;
    native.drawingLoad.mockResolvedValue(doc);
    native.createPage.mockResolvedValue({ id: "fresh-history", title: "History" });
    native.drawingPackageStage.mockResolvedValue({ page: { id: "fresh-history", title: "History" }, token: "stage" });
    native.drawingPackageInstall.mockResolvedValue({ page: { id: "fresh-history", title: "History" }, experiments: [] });
    native.drawingPackageAbort.mockResolvedValue(true);
    native.importBytes.mockClear();
    native.importBytes.mockResolvedValue({ id: "owned-history-file" });
    native.drawingHistoryImport.mockClear();
    native.drawingHistoryImport.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    );
    try {
      const sources: unknown[] = [];
      const blob = await createDrawingPackage(doc.scene, undefined, "source", undefined, {
          includeHistory: true,
          onHistorySources: (s) => sources.push(...s),
        }),
        decoded = await readDrawingPackage(blob);
      expect(decoded.version).toBe(2);
      expect(decoded.history?.operations).toHaveLength(2);
      expect(decoded.assets).toHaveLength(1);
      expect(decoded.assets[0].historyAttachmentId).toBe("original-file");
      expect(sources).toHaveLength(3);
      expect((await importDrawingHistoryPackage(blob, "History")).id).toBe("fresh-history");
      const owned = native.drawingPackageInstall.mock.calls.at(-1)![2],
        restored = appendOperation(owned, historyToggle(owned, "alice")!);
      expect(owned.operations[0].requiresBase).toBe(true);
      expect(restored.scene.assets[n.assetId].attachmentId).toBe("owned-history-file");
      expect(restored.scene.nodes[n.id].assetId).toBe(n.assetId);
      expect(native.importBytes.mock.calls[0][2]).toEqual(bytes);
      expect(doc.scene.assets).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("validates embedded preview dimensions and integrity before display", async () => {
    const f = images.images.find((f) => f.name === "png")!,
      bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
      preview = { mime: "image/png", width: f.width, height: f.height, data: f.base64, sha256: await digest(bytes) },
      value = { format: "worldsdraw", version: 1, scene: newScene(), assets: [], preview };
    expect((await readDrawingPackage(await pack(value))).preview?.width).toBe(f.width);
    await expect(readDrawingPackage(await pack({ ...value, preview: { ...preview, sha256: "0".repeat(64) } }))).rejects.toThrow("preview");
    await expect(readDrawingPackage(await pack({ ...value, preview: { ...preview, width: 100000 } }))).rejects.toThrow("preview");
  });
  it("retains the chosen static animation frame, orientation and exact original through package export/import", async () => {
    const f = animations.images.find((f) => f.name === "animated-webp-oriented")!,
      raw = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
      scene = newScene();
    scene.assets.a = {
      id: "a",
      attachmentId: "animated",
      name: "animated.webp",
      mime: f.mime,
      width: f.width,
      height: f.height,
      orientation: 6,
      frameIndex: 2,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(raw)),
    );
    native.importBytes.mockClear();
    native.importBytes.mockResolvedValue({ id: "owned-animation" });
    try {
      const file = await createDrawingPackage(scene),
        pack = await readDrawingPackage(file);
      expect(pack.scene.assets.a).toMatchObject({ orientation: 6, frameIndex: 2, width: 24, height: 32 });
      expect(pack.assets[0].data).toBe(f.base64);
      const imported = await importDrawingPackage("destination", file);
      expect(imported.assets.a).toMatchObject({ attachmentId: "owned-animation", orientation: 6, frameIndex: 2 });
      expect(native.importBytes.mock.calls[0][2]).toEqual(raw);
      expect(scene.assets.a.attachmentId).toBe("animated");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("roundtrips an editable scene and rejects a foreign file", async () => {
    const scene = newScene();
    const file = await pack({ format: "worldsdraw", version: 1, scene, assets: [] });
    expect((await readDrawingPackage(file)).scene).toEqual(scene);
    await expect(readDrawingPackage(new Blob(["unrelated file"]))).rejects.toThrow("not a Worlds");
  });
  it("keeps library palette settings and rejects invalid portable library metadata", async () => {
    const scene = newScene(),
      library = { name: "ألوان", kind: "palette", tags: ["رسم"], payload: { colors: ["#ff0000", "#00ff00"] } };
    const decoded = await readDrawingPackage(await pack({ format: "worldsdraw", version: 1, scene, assets: [], library }));
    expect(decoded.library).toEqual(library);
    await expect(
      readDrawingPackage(
        await pack({ format: "worldsdraw", version: 1, scene, assets: [], library: { ...library, payload: { colors: ["private url"] } } }),
      ),
    ).rejects.toThrow("palette");
  });
  it("checks original bytes before importing them", async () => {
    const scene = newScene();
    scene.assets["a"] = { id: "a", attachmentId: "package:a", name: "original.png", mime: "image/png", width: 1, height: 1 };
    const bytes = new Uint8Array([1, 2, 3]);
    const asset = {
      id: "a",
      name: "original.png",
      mime: "image/png",
      data: btoa(String.fromCharCode(...bytes)),
      sha256: await digest(bytes),
    };
    expect((await readDrawingPackage(await pack({ format: "worldsdraw", version: 1, scene, assets: [asset] }))).assets).toHaveLength(1);
    asset.data = btoa("damaged");
    await expect(readDrawingPackage(await pack({ format: "worldsdraw", version: 1, scene, assets: [asset] }))).rejects.toThrow("damaged");
  });
  it("packs transitive pinned snapshots, deduplicates originals, and imports independent version IDs", async () => {
    const scene = newScene(),
      first = newScene(),
      second = newScene();
    const step = (s: typeof scene, pin: string) => {
      s.steps.s = {
        id: "s",
        title: "عرض",
        body: "",
        frameId: s.defaultFrameId,
        camera: { x: 0, y: 0, w: 1280, h: 720 },
        hiddenNodeIds: [],
        transition: "cut",
        duration: null,
        pinnedVersionId: pin,
      };
      s.stepOrder = ["s"];
    };
    step(scene, "first");
    step(first, "second");
    for (const s of [scene, first, second])
      s.assets.a = { id: "a", attachmentId: "original", name: "image.png", mime: "image/png", width: 1, height: 1 };
    native.drawingVersionScene.mockImplementation(async (_page, version) => structuredClone(version === "first" ? first : second));
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetcher);
    try {
      const file = await createDrawingPackage(scene, undefined, "source");
      const portable = await readDrawingPackage(file);
      expect(Object.keys(portable.versions ?? {})).toEqual(["first", "second"]);
      expect(portable.assets.filter((a) => typeof a.data === "string")).toHaveLength(1);
      expect(portable.assets.filter((a) => a.dataRef)).toHaveLength(2);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(scene.assets.a.attachmentId).toBe("original");
      native.importBytes.mockResolvedValue({ id: "new-original" });
      native.drawingVersionImport.mockResolvedValue({});
      const imported = await importDrawingPackage("target", file);
      expect(native.importBytes).toHaveBeenCalledTimes(1);
      expect(native.drawingVersionImport).toHaveBeenCalledTimes(2);
      const saved = native.drawingVersionImport.mock.calls;
      expect(imported.steps.s.pinnedVersionId).toBe(saved[0][1]);
      expect(saved[0][3].steps.s.pinnedVersionId).toBe(saved[1][1]);
      expect(saved[0][1]).not.toBe("first");
      expect(saved[1][1]).not.toBe("second");
      expect(imported.assets.a.attachmentId).toBe("new-original");
      expect(saved[1][3].assets.a.attachmentId).toBe("new-original");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects missing pinned dependencies and ambiguous or conflicting asset content", async () => {
    const scene = newScene();
    scene.steps.s = {
      id: "s",
      title: "",
      body: "",
      frameId: scene.defaultFrameId,
      camera: { x: 0, y: 0, w: 1, h: 1 },
      hiddenNodeIds: [],
      transition: "cut",
      duration: null,
      pinnedVersionId: "absent",
    };
    scene.stepOrder = ["s"];
    await expect(readDrawingPackage(await pack({ format: "worldsdraw", version: 1, scene, assets: [] }))).rejects.toThrow(
      "missing a pinned",
    );
    delete scene.steps.s;
    scene.stepOrder = [];
    for (const id of ["a", "b"]) scene.assets[id] = { id, attachmentId: `package:${id}`, name: id, mime: "image/png", width: 1, height: 1 };
    const hash = await digest(new Uint8Array([1]));
    const a = { id: "a", name: "a", mime: "image/png", sha256: hash, data: btoa("\u0001") },
      b = { ...a, id: "b", data: btoa("damaged") };
    await expect(readDrawingPackage(await pack({ format: "worldsdraw", version: 1, scene, assets: [a, b] }))).rejects.toThrow("damaged");
    await expect(
      readDrawingPackage(
        await pack({
          format: "worldsdraw",
          version: 1,
          scene,
          assets: [
            { ...a, dataRef: hash },
            { ...b, data: a.data },
          ],
        }),
      ),
    ).rejects.toThrow("Invalid project asset");
  });
});
