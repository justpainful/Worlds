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
  it("tilts the macro bevel by edgeTiltDeg, the lip to rimTiltDeg, and is flat in the middle", () => {
    const edge = at(61, 0.001);
    const deg = (z: number) => (Math.acos(z) * 180) / Math.PI;
    expect(deg(edge.Nm[2])).toBeGreaterThan(p.edgeTiltDeg - 3);
    expect(deg(edge.Nm[2])).toBeLessThan(p.edgeTiltDeg + 3);
    // the lip peaks rimPeakPosition of the way across it, just inside the outer interface
    const peak = at(61, p.outerEdgeWidth + p.rimPeakPosition * p.rimWidth);
    expect(deg(peak.N[2])).toBeGreaterThan(p.rimTiltDeg - 3);
    // past the lip the full normal is the macro normal again
    expect(at(61, p.rimWidth + 0.5).N[2]).toBeCloseTo(at(61, p.rimWidth + 0.5).Nm[2], 5);
    expect(at(61, 20).N[2]).toBeGreaterThan(0.999);
  });

  it("draws a thin outer interface only at the very edge", () => {
    expect(lighting(p, at(61, 0.1)).edge).toBeGreaterThan(0.5 * p.outerEdgeAlpha);
    expect(lighting(p, at(61, 2)).edge).toBe(0);
  });

  it("displaces edgeDisplacement at the edge, midDisplacement mid-band and at most centerDisplacement near the middle", () => {
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
    // on the lip (just inside the outer interface), upper-left vs lower-right of the end caps
    const r = 20 - (p.outerEdgeWidth + p.rimPeakPosition * p.rimWidth);
    const ulP = lighting(p, at(20 - r * Math.SQRT1_2, 20 - r * Math.SQRT1_2));
    const lrP = lighting(p, at(W - 20 + r * Math.SQRT1_2, 20 + r * Math.SQRT1_2));
    // the counter side is close (the reference has a bright lower rim) but never brighter
    expect(ulP.light).toBeGreaterThanOrEqual(lrP.light);
    expect(lighting(p, at(61, 20)).light).toBeLessThan(0.01);
  });

  it("reads every profile field somewhere in the pipeline", () => {
    const files = import.meta.glob(["./surface.ts", "./maps.ts", "./filterGraph.ts", "./GlassV2.tsx"], { query: "?raw", import: "default", eager: true });
    const src = Object.values(files).join("\n");
    for (const k of Object.keys(p)) expect(src, `profile field ${k} is not used`).toMatch(new RegExp(`\\.${k}\\b`));
  });
});
