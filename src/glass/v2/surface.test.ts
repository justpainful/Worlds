import { describe, expect, it } from "vitest";
import { regularToolbarV2 as p } from "./profile";
import { displacement, fresnel, frostWeight, lighting, makeSdf, surfaceAt, surfaceSpec } from "./surface";

// A Mail-sized capsule: 122 x 40, radius 20.
const W = 122;
const H = 40;
const sdf = makeSdf([{ x: 0, y: 0, w: W, h: H, r: 20 }]);
const spec = surfaceSpec(p, W, H);
const at = (x: number, y: number) => surfaceAt(sdf, spec, x, y);
const mag = (x: number, y: number) => Math.hypot(...displacement(spec, at(x, y), 1));

describe("V2 surface: one height field drives everything", () => {
  it("tilts the normal by edgeTiltDeg at the edge and is flat in the middle", () => {
    const edge = at(61, 0.001);
    const tilt = (Math.acos(edge.N[2]) * 180) / Math.PI;
    expect(tilt).toBeGreaterThan(p.edgeTiltDeg - 3);
    expect(tilt).toBeLessThan(p.edgeTiltDeg + 3);
    expect(at(61, 20).N[2]).toBeGreaterThan(0.999);
  });

  it("displaces 3.4px at the edge, about 1.35px mid-band and about 0.2px near the middle", () => {
    expect(mag(61, 0.001)).toBeCloseTo(p.edgeDisplacement, 1);
    expect(mag(61, p.lensWidth / 2)).toBeCloseTo(p.midDisplacement, 1);
    // the dome alone, at the edge of the flat field
    expect(mag(61 + 30, 20)).toBeLessThanOrEqual(p.centerDisplacement + 0.05);
  });

  it("samples inward with sign +1 and outward with -1", () => {
    const top = at(61, 1);
    expect(displacement(spec, top, 1)[1]).toBeGreaterThan(0); // toward the middle (down)
    expect(displacement(spec, top, -1)[1]).toBeLessThan(0);
  });

  it("uses Schlick Fresnel: F0 head-on, rising to the edge", () => {
    expect(fresnel(p, [0, 0, 1])).toBeCloseTo(p.fresnelF0, 5);
    expect(fresnel(p, at(61, 0.001).N)).toBeGreaterThan(fresnel(p, at(61, 4).N));
  });

  it("keeps the frost branch out of the optical edge", () => {
    expect(frostWeight(p, 0)).toBe(0);
    expect(frostWeight(p, 1)).toBeCloseTo(p.frostMix / (p.frostMix + p.transmissionMix), 5);
  });

  it("lights the edge facing the key (upper left) more than the opposite edge, and leaves the middle clear", () => {
    // 1px inside the outline, on the upper-left and lower-right of the end caps
    const ul = lighting(p, at(20 - 19 * Math.SQRT1_2, 20 - 19 * Math.SQRT1_2)).light;
    const lr = lighting(p, at(W - 20 + 19 * Math.SQRT1_2, 20 + 19 * Math.SQRT1_2)).light;
    expect(ul).toBeGreaterThan(lr * 3);
    expect(lighting(p, at(61, 20)).light).toBeLessThan(0.01);
  });

  it("reads every profile field somewhere in the pipeline", () => {
    const files = import.meta.glob(["./surface.ts", "./maps.ts", "./filterGraph.ts", "./GlassV2.tsx"], { query: "?raw", import: "default", eager: true });
    const src = Object.values(files).join("\n");
    for (const k of Object.keys(p)) expect(src, `profile field ${k} is not used`).toMatch(new RegExp(`\\.${k}\\b`));
  });
});
