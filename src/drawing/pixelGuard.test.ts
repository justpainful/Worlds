import { describe, it, expect } from "vitest";
import { appendOperation, edit, historyToggle, newDrawing, putNode } from "./operations";
import { newLayer, newNode } from "./model";
import { pixelGuard, checkPixelGuard } from "./pixelGuard";
import { canonicalOperation, drawingLeaseTargets, drawingPreconditions, validateDrawingDocument } from "./canonical";
describe("durable sampled-pixel read guards", () => {
  it("rejects new source strokes after offline capture, even with ordinary append preconditions", () => {
    const d = newDrawing(),
      l = d.scene.layerOrder[0],
      n = newNode("shape", l, d.scene.defaultFrameId);
    n.shape = "rect";
    const op = edit("a", 0, "Delete sampled pixels", []);
    op.pixelGuard = pixelGuard(d.scene, d.scene.defaultFrameId, l, "current");
    const remote = appendOperation(d, edit("b", 0, "New source stroke", putNode(d.scene, n)));
    expect(() => canonicalOperation(remote, op, "a", drawingPreconditions(d.scene, op))).toThrow("sampled pixel source changed");
    expect(drawingLeaseTargets(d, op)).toEqual([`layer:${l}`]);
  });
  it("accepts unrelated-layer additions and keeps them through author Undo", () => {
    const d = newDrawing(),
      l = d.scene.layerOrder[0],
      other = newLayer("Other"),
      next = appendOperation(
        d,
        edit("b", 0, "Other layer", [
          { type: "put", collection: "layers", id: other.id, value: other },
          { type: "order", list: "layerOrder", ids: [l, other.id] },
        ]),
      );
    const n = newNode("shape", l, d.scene.defaultFrameId);
    n.shape = "rect";
    const op = edit("a", 1, "Guarded pixels", putNode(next.scene, n));
    op.pixelGuard = pixelGuard(next.scene, next.scene.defaultFrameId, l, "current");
    const foreign = newNode("shape", other.id, d.scene.defaultFrameId);
    foreign.shape = "ellipse";
    const remote = appendOperation(next, edit("b", 1, "Independent", putNode(next.scene, foreign))),
      merged = appendOperation(remote, canonicalOperation(remote, op, "a", drawingPreconditions(next.scene, op)));
    validateDrawingDocument(merged);
    expect(merged.scene.nodes[foreign.id]).toEqual(foreign);
    expect(appendOperation(merged, historyToggle(merged, "a")!).scene).toEqual(remote.scene);
  });
  it("detects source layer visibility and rejects malformed guards", () => {
    const d = newDrawing(),
      s = d.scene,
      l = s.layerOrder[0],
      guard = pixelGuard(s, s.defaultFrameId, l, "visible");
    expect(() => checkPixelGuard({ ...s, layers: { ...s.layers, [l]: { ...s.layers[l], visible: false } } }, guard)).toThrow("conflict");
    expect(() => checkPixelGuard(s, { ...guard, source: "nope" as "current" })).toThrow("Invalid");
    expect(() => checkPixelGuard(s, { ...guard, expected: null! })).toThrow("Invalid");
  });
  it("includes original mask and attachment dependencies in the durable read precondition", () => {
    const s = newDrawing().scene,
      l = s.layerOrder[0],
      n = newNode("shape", l, s.defaultFrameId);
    n.shape = "rect";
    n.maskId = "mask";
    s.nodes[n.id] = n;
    s.nodeOrder = [n.id];
    s.assets.asset = { id: "asset", attachmentId: "original", name: "Original alpha", mime: "image/png", width: 1, height: 1 };
    s.masks.mask = {
      id: "mask",
      name: "Original mask",
      assetId: "asset",
      enabled: true,
      inverted: false,
      linked: true,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      base: 0,
      strokes: [],
    };
    const guard = pixelGuard(s, s.defaultFrameId, l, "current");
    expect(() => checkPixelGuard({ ...s, assets: { asset: { ...s.assets.asset, attachmentId: "replacement" } } }, guard)).toThrow(
      "conflict",
    );
    expect(() => checkPixelGuard({ ...s, masks: { mask: { ...s.masks.mask, enabled: false } } }, guard)).toThrow("conflict");
    expect(s.assets.asset.attachmentId).toBe("original");
    expect(s.masks.mask.enabled).toBe(true);
  });
});
