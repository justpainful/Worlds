import { expect, it } from "vitest";
import { growMask } from "./morphology";
import { trimTransparent } from "./pixels";
it("grows and shrinks a fill boundary without changing unrelated pixels", () => {
  const mask = new Uint8ClampedArray(49); mask[3 * 7 + 3] = 255;
  const expanded = growMask(mask, 7, 7, 1);
  expect([...expanded].filter(Boolean)).toHaveLength(9);
  const contracted = growMask(expanded, 7, 7, -1);
  expect([...contracted].filter(Boolean)).toHaveLength(1);
  expect(contracted[3 * 7 + 3]).toBe(255);
});
it("trims transparent fill output to its actual changed area", () => {
  const data = new Uint8ClampedArray(4 * 5 * 4); data[(2 * 4 + 1) * 4 + 3] = 255;
  expect(trimTransparent({ width: 4, height: 5, data })).toMatchObject({ x: 1, y: 2, width: 1, height: 1 });
  expect(trimTransparent({ width: 1, height: 1, data: new Uint8ClampedArray(4) })).toBeNull();
});
