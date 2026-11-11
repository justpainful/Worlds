import { describe, it, expect } from "vitest";
import { newDrawing, edit, putNode, appendOperation, historyToggle } from "./operations";
import { newLayer, newNode, validateScene } from "./model";
import { computeSelection } from "./pixelSelection";
import {
  checkPixelSource,
  extractSelectedPixels,
  floatingPixelArtwork,
  imagePixelArtwork,
  pixelArtworkChanges,
  pixelSourcePlan,
  projectedPixelScene,
  selectionCropAlpha,
} from "./floatingPixels";
function fixture() {
  let d = newDrawing(),
    s = d.scene;
  const l = s.layerOrder[0],
    f = s.frames[s.defaultFrameId],
    n = newNode("shape", l, f.id, { x: 4, y: 4, w: 20, h: 20 });
  n.shape = "rect";
  n.maskId = `mask-${n.id}`;
  d = appendOperation(
    d,
    edit("a", 0, "seed", [
      {
        type: "put",
        collection: "masks",
        id: n.maskId,
        value: {
          id: n.maskId,
          name: "Existing source mask",
          enabled: true,
          inverted: false,
          linked: true,
          x: 0,
          y: 0,
          w: 20,
          h: 20,
          base: 1,
          strokes: [],
        },
      },
      ...putNode(s, n),
    ]),
  );
  s = d.scene;
  const selection = {
    ...computeSelection({
      width: 1280,
      height: 720,
      mode: "replace",
      operation: {
        kind: "shape",
        shape: "rect",
        points: [
          { x: 8, y: 8 },
          { x: 16, y: 16 },
        ],
      },
    }),
    frame: f,
  };
  return { d, s, l, n, selection };
}
describe("floating selected pixels", () => {
  it("places an external image at original resolution without a source selection, erase or unrelated layer settings", () => {
    let { d, s, l } = fixture();
    d = appendOperation(
      d,
      edit("a", d.revision, "Source appearance", [
        { type: "patch", collection: "layers", id: l, fields: { opacity: 0.3, blend: "multiply" } },
      ]),
    );
    s = d.scene;
    const frame = s.frames[s.defaultFrameId],
      art = imagePixelArtwork(frame, 4096, 32, "image/png", "Original.png"),
      after = appendOperation(d, edit("a", d.revision, "Paste image", pixelArtworkChanges(s, art, art.node)));
    expect(art.node).toMatchObject({ kind: "image", x: (1280 - 4096) / 2, y: (720 - 32) / 2, w: 4096, h: 32 });
    expect(art.erasers).toEqual([]);
    expect(art.layer).toMatchObject({ opacity: 1, blend: "source-over" });
    expect(after.scene.assets[art.asset.id]).toMatchObject({ width: 4096, height: 32 });
    expect(appendOperation(after, historyToggle(after, "a")!).scene).toEqual(s);
  });
  it("multiplies alpha independently, preserves RGB and source arrays, and clears hidden RGB", () => {
    const image = { width: 4, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 120, 220, 128, 99, 88, 77, 0, 11, 22, 33, 255]) },
      before = image.data.slice(),
      alpha = new Uint8ClampedArray([255, 128, 255, 0]);
    expect(Array.from(extractSelectedPixels(image, alpha)!.data)).toEqual([255, 0, 0, 255, 0, 120, 220, 64, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(image.data).toEqual(before);
    expect(Array.from(alpha)).toEqual([255, 128, 255, 0]);
    expect(extractSelectedPixels(image, new Uint8ClampedArray(4))).toBeNull();
  });
  it("crops exact full alpha with the transparent interpolation halo", () => {
    const { selection } = fixture(),
      alpha = selectionCropAlpha(selection);
    expect(selection.imageBounds).toEqual({ x: 7, y: 7, w: 10, h: 10 });
    expect(alpha.length).toBe(100);
    expect(alpha.filter((v) => v === 255).length).toBe(64);
    expect(Array.from(alpha.slice(0, 10))).toEqual(Array(10).fill(0));
    expect(() => selectionCropAlpha({ ...selection, imageBounds: { x: -1, y: 0, w: 1, h: 1 } })).toThrow();
  });
  it("keeps unrelated-layer edits and rejects sampled edits, newly visible layers and lock changes", () => {
    const { s, l, n, selection } = fixture(),
      plan = pixelSourcePlan(s, selection, l, "current", true),
      other = newLayer("Other"),
      foreign = newNode("shape", other.id, s.defaultFrameId, { x: 8, y: 8, w: 8, h: 8 });
    const next = {
      ...s,
      layers: { ...s.layers, [other.id]: other },
      layerOrder: [...s.layerOrder, other.id],
      nodes: { ...s.nodes, [foreign.id]: foreign },
      nodeOrder: [...s.nodeOrder, foreign.id],
    };
    expect(() => checkPixelSource(next, selection, plan, true)).not.toThrow();
    expect(() => checkPixelSource({ ...s, nodes: { ...s.nodes, [n.id]: { ...n, opacity: 0.5 } } }, selection, plan, true)).toThrow("stale");
    expect(() =>
      checkPixelSource({ ...s, layers: { ...s.layers, [l]: { ...s.layers[l], alphaLocked: true } } }, selection, plan, true),
    ).toThrow("locked");
    expect(() => checkPixelSource(next, selection, pixelSourcePlan(s, selection, l, "visible", true), true)).toThrow("stale");
  });
  it("refuses destructive locked pixels but permits copy, and excludes hidden layers", () => {
    const { s, l, n, selection } = fixture(),
      locked = { ...s, nodes: { ...s.nodes, [n.id]: { ...n, locked: true } } };
    expect(() => pixelSourcePlan(locked, selection, l, "current", true)).toThrow("locked");
    expect(pixelSourcePlan(locked, selection, l, "current").nodes).toEqual([n.id]);
    expect(() =>
      pixelSourcePlan({ ...s, layers: { ...s.layers, [l]: { ...s.layers[l], visible: false } } }, selection, l, "visible"),
    ).toThrow("empty");
  });
  it("preserves every original and existing mask; one Undo removes raster erase, new layer and assets", () => {
    const { d, s, l, n, selection } = fixture(),
      plan = pixelSourcePlan(s, selection, l, "current", true),
      art = floatingPixelArtwork(s, plan, "move");
    art.node.x += 100;
    const changes = pixelArtworkChanges(s, art, art.node),
      after = appendOperation(d, edit("a", d.revision, "move pixels", changes));
    validateScene(after.scene);
    expect(after.scene.nodes[n.id]).toEqual(s.nodes[n.id]);
    expect(after.scene.nodes[art.erasers[0].id].erase).toBe(true);
    expect(after.scene.layers[art.layer.id].opacity).toBe(s.layers[l].opacity);
    expect(after.scene.layerOrder).toEqual([l, art.layer.id]);
    expect(appendOperation(after, historyToggle(after, "a")!).scene).toEqual(s);
    expect(projectedPixelScene(s, art, art.node)).toEqual(after.scene);
  });
  it("deletes only selected pixels without adding a destination layer, and duplicates without erase", () => {
    const { d, s, l, selection } = fixture(),
      plan = pixelSourcePlan(s, selection, l, "visible", true),
      art = floatingPixelArtwork(s, plan, "delete"),
      after = appendOperation(d, edit("a", d.revision, "delete", pixelArtworkChanges(s, art, null)));
    validateScene(after.scene);
    expect(after.scene.layerOrder).toEqual(s.layerOrder);
    expect(Object.keys(after.scene.assets)).toEqual([art.eraseAsset.id]);
    expect(floatingPixelArtwork(s, plan, "duplicate").erasers).toEqual([]);
    expect(() => extractSelectedPixels({ width: 0, height: 1, data: new Uint8ClampedArray() }, new Uint8ClampedArray())).toThrow();
  });
});
