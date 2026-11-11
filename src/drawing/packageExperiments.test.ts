import { describe, it, expect, vi } from "vitest";
import { newDrawing } from "./operations";
import { newScene } from "./model";
const native = vi.hoisted(() => ({
  drawingLoad: vi.fn(),
  drawingExperiments: vi.fn(),
  drawingVersionScene: vi.fn(),
  drawingVersionImport: vi.fn(),
  drawingPackageStage: vi.fn(),
  drawingPackageInstall: vi.fn(),
  drawingPackageAbort: vi.fn().mockResolvedValue(true),
  importBytes: vi.fn(),
}));
const policy = vi.hoisted(() => ({ checkDrawingExport: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/api", () => ({ api: native, fileUrl: (id: string) => id }));
vi.mock("./files", () => policy);
import { createDrawingPackage, readDrawingPackage, importDrawingBundlePackage, digest } from "./package";
async function pack(value: unknown) {
  return new Blob([
    "WORLDSDRAW1\n",
    await new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
  ]);
}
describe("editable experiment bundles", () => {
  it("preserves editable branches, original comparison bases and pinned aliases on fresh import", async () => {
    const main = newDrawing(),
      base = newScene(),
      branch = newDrawing(),
      snapshot = newScene();
    base.frames[base.defaultFrameId].background = "#ff0000";
    branch.scene.frames[branch.scene.defaultFrameId].background = "#0000ff";
    branch.scene.steps.s = {
      id: "s",
      title: "Pinned",
      body: "",
      frameId: branch.scene.defaultFrameId,
      camera: { x: 0, y: 0, w: 100, h: 100 },
      hiddenNodeIds: [],
      transition: "cut",
      duration: null,
      pinnedVersionId: "branch-pin",
    };
    branch.scene.stepOrder = ["s"];
    branch.experiment = {
      sourceId: "main",
      baseVersionId: "old-base",
      author: "alice",
      createdAt: 1,
      description: "Alternative",
      status: "review",
      versionAliases: { "branch-pin": "source-pin" },
    };
    native.drawingExperiments.mockResolvedValue([{ page: { id: "branch", title: "Blue" } }]);
    native.drawingLoad.mockImplementation(async (id: string) => (id === "branch" ? branch : main));
    native.drawingVersionScene.mockImplementation(async (_page: string, id: string) => (id === "old-base" ? base : snapshot));
    native.drawingPackageStage.mockResolvedValue({ page: { id: "new-main" }, token: "nonce" });
    native.drawingPackageInstall.mockResolvedValue({ page: { id: "new-main" }, experiments: [{ id: "new-branch" }] });
    const blob = await createDrawingPackage(main.scene, undefined, "main", undefined, { includeExperiments: true }),
      portable = await readDrawingPackage(blob);
    expect(portable.version).toBe(3);
    expect(portable.experiments).toHaveLength(1);
    expect(policy.checkDrawingExport).toHaveBeenLastCalledWith(expect.objectContaining({ sourcePageIds: ["branch"], kind: "projects" }));
    const imported = await importDrawingBundlePackage(blob, "Independent", undefined, { experiments: true });
    expect(imported.experiments[0].id).toBe("new-branch");
    const spec = native.drawingPackageInstall.mock.calls[0][3][0];
    expect(spec.scene.frames[branch.scene.defaultFrameId].background).toBe("#0000ff");
    expect(spec.base.frames[base.defaultFrameId].background).toBe("#ff0000");
    const key = spec.scene.steps.s.pinnedVersionId;
    expect(key).not.toBe("branch-pin");
    expect(Object.keys(spec.versionAliases)).toEqual([key]);
    expect(native.drawingVersionImport).toHaveBeenCalledTimes(2);
  });
  it("refuses independent project policy before fetching originals", async () => {
    const main = newDrawing(),
      branch = newDrawing();
    branch.experiment = { sourceId: "main", baseVersionId: "base", author: "alice", createdAt: 1, description: "", status: "draft" };
    native.drawingExperiments.mockResolvedValue([{ page: { id: "branch", title: "Protected" } }]);
    native.drawingLoad.mockResolvedValue(branch);
    native.drawingVersionScene.mockResolvedValue(newScene());
    policy.checkDrawingExport.mockRejectedValueOnce(Error("project policy denied"));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(createDrawingPackage(main.scene, undefined, "main", undefined, { includeExperiments: true })).rejects.toThrow(
        "policy denied",
      );
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("removes staged originals if cancellation occurs during raw original import", async () => {
    const scene = newScene(),
      raw = new Uint8Array([1, 2, 3]);
    scene.assets.a = { id: "a", attachmentId: "package:a", name: "a.png", mime: "image/png", width: 1, height: 1 };
    const blob = await pack({
        format: "worldsdraw",
        version: 1,
        scene,
        assets: [{ id: "a", name: "a.png", mime: "image/png", data: btoa(String.fromCharCode(...raw)), sha256: await digest(raw) }],
      }),
      controller = new AbortController();
    native.drawingPackageStage.mockResolvedValue({ page: { id: "cancel-stage" }, token: "cancel-token" });
    native.drawingPackageInstall.mockClear();
    native.drawingPackageAbort.mockClear();
    native.importBytes.mockImplementationOnce(async () => {
      controller.abort();
      return { id: "staged-original" };
    });
    await expect(importDrawingBundlePackage(blob, "Cancelled", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(native.drawingPackageInstall).not.toHaveBeenCalled();
    expect(native.drawingPackageAbort).toHaveBeenCalledWith("cancel-stage", "cancel-token");
  });
  it("rejects missing experiment bases and alias snapshots before staging", async () => {
    const scene = newScene(),
      experiment = { name: "Broken", description: "", status: "draft", sceneKey: "branch", baseKey: "base", versionAliases: {} };
    await expect(
      readDrawingPackage(
        await pack({
          format: "worldsdraw",
          version: 3,
          scene,
          assets: [],
          versions: { branch: { scene, label: "Branch" } },
          experiments: [experiment],
        }),
      ),
    ).rejects.toThrow("experiment dependency");
    await expect(
      readDrawingPackage(
        await pack({
          format: "worldsdraw",
          version: 3,
          scene,
          assets: [],
          versions: { branch: { scene, label: "Branch" }, base: { scene, label: "Base" } },
          experiments: [{ ...experiment, versionAliases: { missing: "base" } }],
        }),
      ),
    ).rejects.toThrow("experiment dependency");
  });
});
