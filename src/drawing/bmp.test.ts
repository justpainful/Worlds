import { expect, it } from "vitest";
import { encodeBmp } from "./bmp";
import { imageHeader } from "./imageHeaders";
it("encodes independent bottom-up BGR rows including padding for a3pixel width", () => {
  const rows = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]),
    result = encodeBmp({ width: 3, height: 2, data: rows });
  expect(imageHeader(result)).toEqual({ width: 3, height: 2, mime: "image/bmp" });
  expect(result.length).toBe(78);
  expect([...result.slice(54)]).toEqual([3, 2, 1, 6, 5, 4, 9, 8, 7, 0, 0, 0, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0]);
  expect(rows[0]).toBe(255);
});
