import { describe, expect, it } from "vitest";
import { strokeLod } from "./tileSampling";
import { StrokeSpatialIndex } from "./strokeSpatial";
import { DEFAULT_BRUSH, type Sample } from "./model";
const point = (x: number, y: number): Sample => ({ x, y, pressure: 1, time: 0, tiltX: 0, tiltY: 0 });
describe("bounded viewport LOD geometry", () => {
  it("selects independent powers of two without limiting the requested scale", () => {
    expect(strokeLod({ a: 0.7, b: 0, c: 0, d: 0.4, e: 0, f: 0 })).toEqual({ x: 0, y: 0 });
    expect(strokeLod({ a: 0.025, b: 0, c: 0, d: 0.025, e: 1e8, f: -1e8 })).toEqual({ x: 4, y: 4 });
    expect(strokeLod({ a: 1, b: 0, c: 0, d: 1e-8, e: 0, f: 0 })).toEqual({ x: 0, y: 25 });
    const angle = 0.7, a = Math.cos(angle), b = Math.sin(angle);
    expect(strokeLod({ a: a * 0.025, b: b * 0.025, c: -b, d: a, e: 0, f: 0 })).toEqual({ x: 4, y: 0 });
  });
  it("skips empty space beside a billion-coordinate diagonal without changing samples", () => {
    const samples = [point(-1e9, -1e9), point(1e9, 1e9)], before = structuredClone(samples), index = new StrokeSpatialIndex(samples, { ...DEFAULT_BRUSH, size: 2048 });
    expect(index.intersects({ x: 0, y: 1e8, w: 512, h: 512 })).toBe(false);
    expect(index.intersects({ x: 1024, y: 0, w: 1, h: 1 })).toBe(true);
    expect(index.intersects({ x: -512, y: -512, w: 512, h: 512 })).toBe(true); expect(samples).toEqual(before);
  });
  it("includes one-point scatter/tip overhang and keeps the hierarchy bounded", () => {
    const single = new StrokeSpatialIndex([point(0, 0)], { ...DEFAULT_BRUSH, kind: "texture", size: 100, angle: 45 });
    expect(single.intersects({ x: -72, y: 0, w: 1, h: 1 })).toBe(true); expect(single.intersects({ x: -100, y: 0, w: 1, h: 1 })).toBe(false);
    const index = new StrokeSpatialIndex(Array.from({ length: 65536 }, (_, i) => point(i, Math.sin(i))), DEFAULT_BRUSH);
    expect(index.bytes).toBeLessThan(1024 * 1024); expect(index.intersects({ x: 64000, y: 0, w: 10, h: 10 })).toBe(true);
  });
});
