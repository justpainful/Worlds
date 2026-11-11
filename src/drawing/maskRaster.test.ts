import { describe, it, expect } from "vitest";
import { editMaskRaster } from "./maskRaster";
import { applyMaskedEffect } from "./maskedEffects";
import { applyPixelEffect } from "./pixels";
import { maskEditChanges, maskPropertyChanges } from "./maskEdit";
import { imageCropSourceKey } from "./imageCrop";
import { newScene, newNode } from "./model";
import { applyChanges } from "./operations";
describe("grayscale mask operations", () => {
  it("distinguishes connected/global fills and preserves the previous mask", () => {
    const mask = { width: 4, height: 1, alpha: new Uint8ClampedArray([0, 100, 0, 255]) },
      before = mask.alpha.slice(),
      task = { kind: "fill" as const, mask, point: { x: 0, y: 0 }, tolerance: 0, value: 255 };
    expect([...editMaskRaster({ ...task, contiguous: true }).alpha]).toEqual([255, 100, 0, 255]);
    expect([...editMaskRaster({ ...task, contiguous: false }).alpha]).toEqual([255, 100, 255, 255]);
    expect(mask.alpha).toEqual(before);
  });
  it("computes source-pixel linear gradients and uniform per-stroke brush opacity", () => {
    const mask = { width: 4, height: 1, alpha: new Uint8ClampedArray(4) },
      gradient = editMaskRaster({ kind: "gradient", mask, from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, start: 0, end: 255 });
    expect([...gradient.alpha]).toEqual([32, 96, 159, 223]);
    const paint = editMaskRaster({
      kind: "paint",
      mask,
      points: [
        { x: 1.5, y: 0.5 },
        { x: 1.5, y: 0.5 },
      ],
      size: 1,
      opacity: 0.5,
      hardness: 1,
      value: 255,
    });
    expect(paint.alpha[1]).toBe(128);
    expect([...editMaskRaster({ kind: "invert", mask: gradient }).alpha]).toEqual([223, 159, 96, 32]);
  });
  it("rejects excessive dimensions/stroke input before computation", () => {
    expect(() => editMaskRaster({ kind: "solid", mask: { width: 5000, height: 5000, alpha: new Uint8ClampedArray(1) }, value: 0 })).toThrow(
      "memory",
    );
    expect(() =>
      editMaskRaster({
        kind: "paint",
        mask: { width: 1, height: 1, alpha: new Uint8ClampedArray(1) },
        points: [{ x: Infinity, y: 0 }],
        size: 10,
        opacity: 1,
        hardness: 1,
        value: 0,
      }),
    ).toThrow("Invalid");
  });
});
describe("masked image effects", () => {
  it("uses exact gray coverage without mutating source and ignores hidden RGB", () => {
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 255, 0]) },
      original = image.data.slice(),
      out = applyMaskedEffect(image, { kind: "invert", amount: 1 }, new Uint8ClampedArray([128, 128]));
    expect([...out.data]).toEqual([127, 128, 128, 128, 0, 0, 0, 0]);
    expect(image.data).toEqual(original);
  });
  it("pixelation averages premultiplied pigment rather than invisible RGB", () => {
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]) };
    expect([...applyPixelEffect(image, { kind: "pixelate", amount: 2 }).data]).toEqual([255, 0, 0, 128, 255, 0, 0, 128]);
  });
  it("owns independent assets/masks and rejects stale original dependencies", () => {
    const s = newScene(),
      n = newNode("shape", s.layerOrder[0], s.defaultFrameId);
    n.shape = "rect";
    s.nodes[n.id] = n;
    s.nodeOrder.push(n.id);
    const key = imageCropSourceKey(s, n.id),
      mask = {
        id: "draft",
        name: "Mask",
        assetId: "draft",
        enabled: true,
        inverted: false,
        linked: true,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        base: 0,
        strokes: [],
      },
      asset = { id: "draft", attachmentId: "owned-PNG", name: "mask.png", mime: "image/png", width: 100, height: 100 },
      changes = maskEditChanges(s, n.id, undefined, key, mask, asset);
    expect(changes).toHaveLength(3);
    expect(changes[0].type === "put" && (changes[0].value as typeof asset).id).not.toBe("draft");
    expect(s.masks).toEqual({});
    s.nodes[n.id].opacity = 0.5;
    expect(() => maskEditChanges(s, n.id, undefined, key, mask, asset)).toThrow("mask-stale");
  });
  it("forks a shared node mask before toggling only the selected element", () => {
    const s = newScene(),
      a = newNode("shape", s.layerOrder[0], s.defaultFrameId),
      b = { ...structuredClone(a), id: "other" };
    a.shape = b.shape = "rect";
    a.maskId = b.maskId = "shared";
    s.nodes = { [a.id]: a, [b.id]: b };
    s.nodeOrder = [a.id, b.id];
    s.masks.shared = {
      id: "shared",
      name: "Shared alpha",
      enabled: true,
      inverted: false,
      linked: true,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      base: 1,
      strokes: [],
    };
    const original = structuredClone(s),
      next = applyChanges(s, maskPropertyChanges(s, a.id, undefined, imageCropSourceKey(s, a.id), { enabled: false }));
    expect(next.nodes[a.id].maskId).not.toBe("shared");
    expect(next.masks[next.nodes[a.id].maskId!].enabled).toBe(false);
    expect(next.nodes[b.id].maskId).toBe("shared");
    expect(next.masks.shared.enabled).toBe(true);
    expect(s).toEqual(original);
  });
  it("forks shared effect masks without rebinding another effect or node mask", () => {
    const s = newScene(),
      a = newNode("image", s.layerOrder[0], s.defaultFrameId),
      b = { ...structuredClone(a), id: "other" };
    a.maskId = "shared";
    a.effects = [
      { id: "first", kind: "invert", amount: 1, enabled: true, maskId: "shared" },
      { id: "second", kind: "grayscale", amount: 1, enabled: true, maskId: "shared" },
    ];
    b.effects = [{ id: "foreign", kind: "invert", amount: 1, enabled: true, maskId: "shared" }];
    s.nodes = { [a.id]: a, [b.id]: b };
    s.nodeOrder = [a.id, b.id];
    s.masks.shared = {
      id: "shared",
      name: "Shared alpha",
      enabled: true,
      inverted: false,
      linked: true,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      base: 1,
      strokes: [],
    };
    const next = applyChanges(s, maskPropertyChanges(s, a.id, "first", imageCropSourceKey(s, a.id), { inverted: true })),
      maskId = next.nodes[a.id].effects[0].maskId!;
    expect(maskId).not.toBe("shared");
    expect(next.masks[maskId].inverted).toBe(true);
    expect(next.nodes[a.id].effects[1].maskId).toBe("shared");
    expect(next.nodes[a.id].maskId).toBe("shared");
    expect(next.nodes[b.id].effects[0].maskId).toBe("shared");
    expect(next.masks.shared.inverted).toBe(false);
  });
});
