/** Separable sliding max/min. Radius cost stays linear in pixel count. */
import { validatePixelDimensions } from "./pixels";
export function growMask(input: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (input.length !== validatePixelDimensions(width, height) || !Number.isFinite(radius)) throw new Error("Invalid selection dimensions");
  const r = Math.min(128, Math.abs(Math.round(radius))); if (!r) return input.slice();
  const dilate = radius > 0;
  const pass = (source: Uint8ClampedArray, horizontal: boolean) => {
    const result = new Uint8ClampedArray(source.length), length = horizontal ? width : height, lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      const positions = new Int32Array(length + r * 2), values = new Uint8ClampedArray(length + r * 2); let head = 0, tail = 0;
      const index = (at: number) => horizontal ? line * width + at : at * width + line;
      for (let at = -r; at < length + r; at++) {
        const value = at < 0 || at >= length ? 0 : source[index(at)];
        while (tail > head && (dilate ? values[tail - 1] <= value : values[tail - 1] >= value)) tail--;
        positions[tail] = at; values[tail++] = value;
        while (tail > head && positions[head] < at - r * 2) head++;
        const target = at - r; if (target >= 0 && target < length) result[index(target)] = values[head];
      }
    }
    return result;
  };
  return pass(pass(input, true), false);
}
