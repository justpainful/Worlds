import { expect, it } from "vitest";
import { identity, inverse, nodeMatrix, rotate, scale, transformPoint, translate } from "./affine";
import { newNode } from "./model";

it("cancels large world offsets before submitting a device-space transform", () => {
  const n = newNode("stroke", "l", null, { x: 1e8, y: -2e8, w: 40.96, h: 20.48 }); n.geometrySize = { w: 4096, h: 2048 };
  const m = nodeMatrix({ a: 0.65, b: 0, c: 0, d: 0.65, e: -(1e8 - 400) * 0.65, f: -(-2e8 - 200) * 0.65 }, n);
  expect(m.a).toBeCloseTo(0.0065, 14); expect(m.e).toBeCloseTo(260, 6); expect(m.f).toBeCloseTo(130, 6);
  expect(transformPoint(m, { x: 500, y: 500 })).toEqual({ x: m.e + 3.25, y: m.f + 3.25 });
});
it("inverts reflected anisotropic rotation without losing the source point", () => {
  const m = translate(scale(rotate(translate(identity(), 300, -150), 0.7), -0.01, 2), -256, 128), p = { x: 1100, y: -23 };
  const back = transformPoint(inverse(m), transformPoint(m, p));
  expect(back.x).toBeCloseTo(p.x, 8); expect(back.y).toBeCloseTo(p.y, 8);
});
it("accepts native-style matrices whose coefficients are inherited accessors", () => {
  const matrix = Object.create({ a: 2, b: 0, c: 0, d: 3, e: -10, f: 5 });
  expect(translate(matrix, 4, 6)).toEqual({ a: 2, b: 0, c: 0, d: 3, e: -2, f: 23 });
  expect(scale(matrix, 0.5, -1)).toEqual({ a: 1, b: 0, c: -0, d: -3, e: -10, f: 5 });
});
