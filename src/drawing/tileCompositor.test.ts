import { describe, expect, it } from "vitest";
import { tileVertices } from "./tileCompositor";

describe("GPU tile geometry", () => {
  it("clips huge coordinates before float conversion while retaining interior UV samples", () => {
    const v = tileVertices({ x: 0, y: 0, w: 512, h: 512 }, { a: 1e12, b: 0, c: 0, d: 1e12, e: -2e14, f: -2e14 }, 4096, 2048, 1, 514);
    expect(v.length).toBeGreaterThan(0);
    for (let i = 0; i < v.length; i += 4) { expect(v[i]).toBeGreaterThanOrEqual(0); expect(v[i]).toBeLessThanOrEqual(4096); expect(v[i + 1]).toBeGreaterThanOrEqual(0); expect(v[i + 1]).toBeLessThanOrEqual(2048); expect(v[i + 2]).toBeGreaterThan(0); expect(v[i + 2]).toBeLessThan(1); }
  });
  it("keeps the same shared device edge for adjacent reflected/rotated tiles", () => {
    const m = { a: -0.7, b: 0.2, c: 0.1, d: 0.4, e: 800, f: 100 };
    const a = tileVertices({ x: 0, y: 0, w: 512, h: 512 }, m, 1024, 1024, 1, 514), b = tileVertices({ x: 512, y: 0, w: 512, h: 512 }, m, 1024, 1024, 1, 514);
    const points = (v: Float32Array) => { const p: string[] = []; for (let i = 0; i < v.length; i += 4) p.push(`${v[i]},${v[i + 1]}`); return new Set(p); };
    expect([...points(a)].filter((p) => points(b).has(p))).toHaveLength(2);
  });
});
