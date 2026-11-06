import { describe, expect, it } from "vitest";
import { captureLibraryScene, detachLibraryInstance, insertLibraryScene, validateLibraryMetadata, type LibraryPublication } from "./library";
import { DEFAULT_BRUSH, newNode, newScene, validateScene } from "./model";
const publication = (scene: ReturnType<typeof newScene>, kind: LibraryPublication["item"]["kind"] = "elements", version = 1): LibraryPublication => ({ item: { page: { id: "library" }, kind, version } as LibraryPublication["item"], version, scene, payload: {} });
describe("independent reusable drawing material", () => {
  it("captures only selected originals, including effect masks and brush tips, and detaches external anchors", () => {
    const scene = newScene(), frame = scene.defaultFrameId, layer = scene.layerOrder[0];
    const outside = newNode("shape", layer, frame, { x: 500, y: 300 }); outside.shape = "rect";
    const inside = newNode("shape", layer, frame); inside.shape = "arrow"; inside.anchor = { nodeId: outside.id, u: 0.5, v: 0.5, fallback: { x: 0, y: 0 } }; inside.effects = [{ id: "fx", kind: "blur", amount: 1, enabled: true, maskId: "effect-mask" }];
    scene.nodes[inside.id] = inside; scene.nodes[outside.id] = outside; scene.nodeOrder = [inside.id, outside.id];
    for (const key of ["mask-original", "unused"]) scene.assets[key] = { id: key, attachmentId: key, name: key, mime: "image/png", width: 1, height: 1 };
    scene.masks["effect-mask"] = { id: "effect-mask", name: "Mask", enabled: true, inverted: false, linked: false, x: 10, y: 10, strokes: [], assetId: "mask-original" };
    const saved = captureLibraryScene(scene, "elements", [inside.id], frame);
    expect(saved.nodeOrder).toEqual([inside.id]); expect(Object.keys(saved.assets)).toEqual(["mask-original"]);
    expect(saved.nodes[inside.id].anchor).toMatchObject({ nodeId: null, fallback: { x: 600, y: 360 } });
    expect(scene.nodes[inside.id].anchor?.nodeId).toBe(outside.id);
  });
  it("remaps originals, masks, groups and internal anchors and replaces only the chosen linked instance", () => {
    const source = newScene(), target = newScene(), f = source.defaultFrameId, l = source.layerOrder[0];
    const shape = newNode("shape", l, f); shape.shape = "rect"; shape.groupId = "group";
    const arrow = newNode("shape", l, f, { x: 220, y: 20 }); arrow.shape = "arrow"; arrow.groupId = "group"; arrow.anchor = { nodeId: shape.id, u: 1, v: 0.5, fallback: { x: 200, y: 60 } }; arrow.effects = [{ id: "fx", kind: "blur", enabled: true, amount: 1, maskId: "m" }];
    source.assets.a = { id: "a", attachmentId: "owned", name: "mask", mime: "image/png", width: 1, height: 1 };
    source.masks.m = { id: "m", name: "Mask", enabled: true, inverted: false, linked: false, x: 0, y: 0, strokes: [], assetId: "a" };
    source.nodes[shape.id] = shape; source.nodes[arrow.id] = arrow; source.nodeOrder = [shape.id, arrow.id];
    const first = insertLibraryScene(target, publication(source), { x: 40, y: 40 }, target.defaultFrameId, true);
    const second = insertLibraryScene(first.scene, publication(source), { x: 500, y: 40 }, target.defaultFrameId, true);
    const [firstShape, firstArrow] = first.selected.map((key) => first.scene.nodes[key]);
    expect(firstArrow.anchor?.nodeId).toBe(firstShape.id); expect(firstShape.groupId).toBe(firstArrow.groupId); expect(firstShape.groupId).not.toBe("group");
    expect(first.scene.masks[firstArrow.effects[0].maskId!].assetId).not.toBe("a");
    const updated = structuredClone(source); updated.nodes[shape.id].paint.fill = "#ff0000";
    const adopted = insertLibraryScene(second.scene, publication(updated, "elements", 2), { x: 0, y: 0 }, target.defaultFrameId, true, firstShape.libraryInstanceId);
    expect(adopted.scene.nodes[firstShape.id].paint.fill).toBe("#ff0000");
    expect(adopted.scene.nodes[second.selected[0]].paint.fill).toBe("transparent");
    expect(adopted.scene.nodeOrder).toHaveLength(4); expect(adopted.scene.nodes[firstArrow.id].anchor?.nodeId).toBe(firstShape.id);
    const detached = detachLibraryInstance(adopted.scene, firstShape.libraryInstanceId!);
    expect(detached.nodes[firstShape.id].libraryItemId).toBeUndefined(); expect(detached.nodes[second.selected[0]].libraryItemId).toBe("library"); validateScene(detached);
  });
  it("updates a linked frame in place without multiplying its frames or layers", () => {
    const source = newScene(), target = newScene(), node = newNode("shape", source.layerOrder[0], source.defaultFrameId); node.shape = "rect"; source.nodes[node.id] = node; source.nodeOrder = [node.id];
    source.steps.s = { id: "s", title: "Step", body: "", frameId: source.defaultFrameId, camera: { x: 0, y: 0, w: 1280, h: 720 }, hiddenNodeIds: [node.id], transition: "cut", duration: null }; source.stepOrder = ["s"];
    const inserted = insertLibraryScene(target, publication(source, "frame"), { x: 1500, y: 0 }, target.defaultFrameId, true), frameId = inserted.scene.nodes[inserted.selected[0]].frameId!, instance = inserted.scene.nodes[inserted.selected[0]].libraryInstanceId!;
    const changed = structuredClone(source); changed.frames[source.defaultFrameId].w = 900;
    const updated = insertLibraryScene(inserted.scene, publication(changed, "frame", 2), { x: 0, y: 0 }, target.defaultFrameId, true, instance);
    expect(updated.scene.frames[frameId].w).toBe(900); expect(updated.scene.frames[frameId].x).toBe(1500);
    expect(updated.scene.frameOrder).toHaveLength(2); expect(updated.scene.layerOrder).toHaveLength(2);
    expect(updated.scene.stepOrder).toHaveLength(1);
    const recaptured = captureLibraryScene(updated.scene, "frame", updated.selected, frameId), again = insertLibraryScene(updated.scene, publication(recaptured, "frame", 3), { x: 0, y: 0 }, target.defaultFrameId, true, instance);
    expect(again.scene.frameOrder).toHaveLength(2); expect(again.scene.layerOrder).toHaveLength(2); expect(again.scene.stepOrder).toHaveLength(1);
  });
  it("retains original element and layer identities when republishing an inserted copy", () => {
    const source = newScene(), target = newScene(), node = newNode("shape", source.layerOrder[0], source.defaultFrameId); node.shape = "rect"; source.nodes[node.id] = node; source.nodeOrder = [node.id];
    const first = insertLibraryScene(target, publication(source), { x: 40, y: 40 }, target.defaultFrameId, true), instance = first.scene.nodes[first.selected[0]].libraryInstanceId!;
    const republished = captureLibraryScene(first.scene, "elements", first.selected, target.defaultFrameId);
    expect(republished.nodeOrder).toEqual([node.id]); expect(republished.layerOrder).toEqual(source.layerOrder);
    const updated = insertLibraryScene(first.scene, publication(republished, "elements", 2), { x: 0, y: 0 }, target.defaultFrameId, true, instance);
    expect(updated.scene.layerOrder).toHaveLength(2); expect(updated.selected).toEqual(first.selected); expect(updated.scene.nodes[first.selected[0]].libraryVersion).toBe(2);
  });
  it("rejects invalid brush settings and malformed imported palettes", () => {
    const scene = newScene(); validateLibraryMetadata({ name: "قلم", kind: "brush", tags: [], payload: { brush: DEFAULT_BRUSH } }, scene);
    expect(() => validateLibraryMetadata({ name: "Bad", kind: "brush", tags: [], payload: { brush: { ...DEFAULT_BRUSH, size: Infinity } } }, scene)).toThrow();
    expect(() => validateLibraryMetadata({ name: "Bad", kind: "palette", tags: [], payload: { colors: ["url(private)"] } }, scene)).toThrow("palette");
  });
});
