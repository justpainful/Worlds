import type { Pixels } from "./pixels";

/** Cold-cache reduction only. Average aligned pairs in premultiplied RGBA8,
 * rounding ties upward. Hidden RGB under zero alpha never contributes pigment.
 * Each pass returns straight bytes for Canvas storage; originals stay intact. */
export function reducePigmentPairs(source: Pixels, axis: "x" | "y"): Pixels {
  const width = axis === "x" ? Math.ceil(source.width / 2) : source.width, height = axis === "y" ? Math.ceil(source.height / 2) : source.height;
  const data = new Uint8ClampedArray(width * height * 4), bytes = source.data;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = axis === "x" ? x * 2 : x, sy = axis === "y" ? y * 2 : y, i = (sy * source.width + sx) * 4;
    const j = axis === "x" ? sx + 1 < source.width ? i + 4 : -1 : sy + 1 < source.height ? i + source.width * 4 : -1;
    const a = bytes[i + 3], b = j < 0 ? 0 : bytes[j + 3], alpha = Math.floor((a + b + 1) / 2), out = (y * width + x) * 4;
    data[out + 3] = alpha;
    if (!alpha) continue;
    for (let c = 0; c < 3; c++) {
      const first = Math.round(bytes[i + c] * a / 255), second = j < 0 ? 0 : Math.round(bytes[j + c] * b / 255);
      data[out + c] = Math.round(Math.floor((first + second + 1) / 2) * 255 / alpha);
    }
  }
  return { width, height, data };
}
