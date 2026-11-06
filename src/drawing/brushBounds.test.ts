import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, newNode } from "./model";
import { brushFootprint, localInkRect, strokeBounds } from "./brushBounds";
import { contains, inkCorners, localToWorld, worldToLocal } from "./geometry";
import { exportNodeVisible } from "./exportScope";
import { newDrawing } from "./operations";
import fixtures from "./fixtures/brush-bounds.json";
import { normalizeBrush } from "./brushConfig";
import type { Brush, Sample } from "./model";

describe("brush influence bounds", () => {
  it("matches the shared native analytic fixtures", () => {
    for (const f of fixtures) {
      const node = newNode("stroke", "layer", null, f.nodeSize ?? { w: 20, h: 20 });
      if (f.geometrySize) node.geometrySize = f.geometrySize;
      if (f.brush) node.brush = normalizeBrush(f.brush as Partial<Brush>);
      node.samples = f.samples.map((p) => ({ ...p, pressure: 1, time: 0, tiltX: 0, tiltY: 0 } as Sample));
      const box = localInkRect(node);
      [box.x, box.y, box.w, box.h].forEach((v, i) => expect(v, `${f.name} component ${i}`).toBeCloseTo(f.bounds[i], 8));
    }
  });
  it("includes spray particles, tiny granules and rotated square tips", () => {
    expect(brushFootprint({ ...DEFAULT_BRUSH, kind: "spray", size: 2048 }).x).toBeCloseTo(1024 + 2048 / 48);
    expect(brushFootprint({ ...DEFAULT_BRUSH, kind: "crayon", size: 1, pressureSize: false }).x).toBeCloseTo(0.8);
    expect(brushFootprint({ ...DEFAULT_BRUSH, kind: "texture", size: 100, angle: 45, roundness: 1 }).x).toBeCloseTo(50 * Math.SQRT2);
    const ellipse = brushFootprint({ ...DEFAULT_BRUSH, size: 100, angle: 90, roundness: 0.2 });
    expect(ellipse.x).toBeCloseTo(10); expect(ellipse.y).toBeCloseTo(50);
  });
  it("rebases new samples without changing their world positions", () => {
    const samples = [{ x: 20, y: -30 }, { x: 300, y: 80 }], before = structuredClone(samples), brush = { ...DEFAULT_BRUSH, kind: "texture" as const, size: 2048, angle: 45 };
    const box = strokeBounds(samples, brush), local = samples.map((p) => ({ x: p.x - box.x, y: p.y - box.y }));
    local.forEach((p, i) => { expect(p.x + box.x).toBeCloseTo(samples[i].x); expect(p.y + box.y).toBeCloseTo(samples[i].y); });
    expect(box.w).toBeGreaterThan(2048); expect(samples).toEqual(before);
  });
  it("finds legacy overhang and retains its original rotation/flip pivot and anchors", () => {
    const n = newNode("stroke", "layer", null, { x: 100, y: 100, w: 20, h: 20 }); n.brush = { ...DEFAULT_BRUSH, kind: "texture", size: 100, angle: 45 }; n.samples = [{ x: 0, y: 0, pressure: 1, tiltX: 0, tiltY: 0, time: 0 }]; n.rotation = 30; n.flipX = true;
    const before = structuredClone(n), box = localInkRect(n), p = localToWorld(n, { x: -65, y: 0 });
    expect(box.x).toBeLessThan(-70); expect(contains(n, p)).toBe(true);
    expect(worldToLocal(n, p).x).toBeCloseTo(-65); expect(inkCorners(n)).toHaveLength(4); expect(n).toEqual(before);
  });
  it("keeps a visible overhanging tip in image-export preparation", () => {
    const scene = newDrawing().scene, n = newNode("stroke", scene.layerOrder[0], scene.defaultFrameId, { x: 100, y: 100, w: 20, h: 20 });
    n.brush = { ...DEFAULT_BRUSH, kind: "texture", size: 100, angle: 45 }; n.samples = [{ x: 0, y: 0, pressure: 1, tiltX: 0, tiltY: 0, time: 0 }];
    expect(exportNodeVisible(scene, n, scene.defaultFrameId, { x: 30, y: 90, w: 10, h: 20 }, true)).toBe(true);
    expect(exportNodeVisible(scene, n, scene.defaultFrameId, { x: 5, y: 90, w: 5, h: 20 }, true)).toBe(false);
  });
});
