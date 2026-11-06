import { expect, it } from "vitest";
import { reducePigmentPairs } from "./pigmentMip";

it("averages pigment and alpha rather than transparent hidden RGB", () => {
  const source = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]) };
  expect(Array.from(reducePigmentPairs(source, "x").data)).toEqual([255, 0, 0, 128]);
  const mixed = { ...source, data: new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 255, 64]) };
  expect(Array.from(reducePigmentPairs(mixed, "x").data)).toEqual([170, 0, 85, 96]);
});
it("uses aligned axis pairs and transparent padding without mutating originals", () => {
  const source = { width: 3, height: 2, data: new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 0,0,0,0, 0,0,0,0, 0,0,0,0]) }, before = source.data.slice();
  const x = reducePigmentPairs(source, "x"), y = reducePigmentPairs(source, "y");
  expect([x.width,x.height]).toEqual([2,2]); expect(Array.from(x.data.slice(0,8))).toEqual([128,128,0,255, 0,0,255,128]);
  expect([y.width,y.height]).toEqual([3,1]); expect(Array.from(y.data)).toEqual([255,0,0,128, 0,255,0,128, 0,0,255,128]); expect(source.data).toEqual(before);
});
