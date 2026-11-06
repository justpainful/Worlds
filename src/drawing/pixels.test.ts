import { describe, expect, it } from "vitest";
import { applyPixelEffect, combineMask, featherMask, floodMask, paintMask, polygonMask } from "./pixels";
describe("pixel selection and fill", () => {
  it("respects connectivity and a selection while matching invisible pixels", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0]);
    const image = { width: 3, height: 1, data };
    expect([...floodMask(image, 0, 0, 0)]).toEqual([255, 0, 0]);
    expect([...floodMask(image, 0, 0, 0, false)]).toEqual([255, 0, 255]);
    expect([...floodMask(image, 0, 0, 0, false, new Uint8ClampedArray([255, 255, 0]))]).toEqual([255, 0, 0]);
  });
  it("fills a bounded room without crossing its opaque outline", () => {
    const width = 9, data = new Uint8ClampedArray(width * width * 4);
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) if (x === 1 || x === 7 || y === 1 || y === 7) data[(y * width + x) * 4 + 3] = 255;
    const mask = floodMask({ width, height: width, data }, 4, 4, 0);
    expect([...mask].filter(Boolean)).toHaveLength(25);
    expect(mask[0]).toBe(0); expect(mask[4 * width + 4]).toBe(255);
  });
  it("supports polygon selection, subtraction, feathering and alpha-colored fill", () => {
    const mask = polygonMask(10, 10, [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }]);
    expect([...mask].filter(Boolean)).toHaveLength(36);
    expect(combineMask(mask, mask, "subtract").some(Boolean)).toBe(false);
    expect(featherMask(mask, 10, 10, 1)[2 * 10 + 2]).toBeGreaterThan(0);
    expect(featherMask(mask, 10, 10, 1)[2 * 10 + 2]).toBeLessThan(255);
    expect([...paintMask(new Uint8ClampedArray([128]), [255, 100, 0, 128])]).toEqual([255, 100, 0, 64]);
  });
  it("keeps source pixels and transparency during nondestructive effects", () => {
    const image = { width: 1, height: 1, data: new Uint8ClampedArray([100, 120, 140, 64]) };
    expect([...applyPixelEffect(image, { kind: "invert", amount: 1 }).data]).toEqual([155, 135, 115, 64]);
    expect([...image.data]).toEqual([100, 120, 140, 64]);
  });
});
