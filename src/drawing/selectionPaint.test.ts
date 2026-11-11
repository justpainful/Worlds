import { expect, it } from "vitest";
import { DEFAULT_BRUSH, newNode, type Asset, type Mask } from "./model";
import { appendOperation, edit, historyToggle, newDrawing, putNode } from "./operations";
import { computeSelection } from "./pixelSelection";
import { maskNewPaint, selectionImageRect } from "./selectionPaint";
import type { PixelSelection } from "./selectionController";
import { objectTransformOrigin, transformObjects } from "./objectTransforms";
it("stores original-local mask coordinates and undoes paint/mask/asset in one operation", () => {
  const doc = newDrawing(),
    frame = { ...doc.scene.frames[doc.scene.defaultFrameId], x: 300, y: 200 },
    raster = computeSelection({
      width: 20,
      height: 20,
      mode: "replace",
      operation: {
        kind: "shape",
        shape: "rect",
        points: [
          { x: 3, y: 4 },
          { x: 13, y: 15 },
        ],
      },
    }),
    selection = { ...raster, frame } as PixelSelection;
  const node = newNode("stroke", doc.scene.layerOrder[0], frame.id, { x: 290, y: 190, w: 50, h: 50 });
  node.brush = { ...DEFAULT_BRUSH };
  node.samples = [{ x: 15, y: 20, pressure: 0.4, tiltX: 2, tiltY: -3, time: 1 }];
  const asset: Asset = { id: "selection-asset", attachmentId: "owned-png", name: "Selection", mime: "image/png", width: 12, height: 13 },
    masked = maskNewPaint(node, selection, asset),
    mask = (masked.change as { value: Mask }).value;
  expect(selectionImageRect(selection)).toEqual({ x: 302, y: 203, w: 12, h: 13 });
  expect(mask).toMatchObject({ linked: true, x: 12, y: 13, w: 12, h: 13, base: 0, assetId: asset.id });
  expect(masked.node.samples).toEqual(node.samples);
  const painted = appendOperation(
      doc,
      edit("owner", 0, "Paint", [
        { type: "put", collection: "assets", id: asset.id, value: asset },
        masked.change,
        ...putNode(doc.scene, masked.node),
      ]),
    ),
    origin = objectTransformOrigin(painted.scene, [masked.node]),
    [scaled] = transformObjects(painted.scene, [masked.node], {
      centerX: origin.x,
      centerY: origin.y,
      scale: 2,
      rotation: 30,
      flipX: false,
      flipY: false,
    });
  expect(scaled.maskId).toBe(mask.id);
  expect(scaled.geometrySize).toEqual({ w: 50, h: 50 });
  expect(painted.scene.masks[mask.id]).toEqual(mask);
  const undo = appendOperation(painted, historyToggle(painted, "owner", false)!);
  expect(undo.scene.nodes).toEqual({});
  expect(undo.scene.masks).toEqual({});
  expect(undo.scene.assets).toEqual({});
  const restored = appendOperation(undo, historyToggle(undo, "owner", true)!);
  expect(restored.scene.nodes[node.id].samples).toEqual(node.samples);
  expect(restored.scene.masks[mask.id]).toEqual(mask);
});
