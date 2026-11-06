import { describe, expect, it } from "vitest";
import { iterateStrokeDabs, strokeDabs } from "./brush";
import { MAX_STROKE_WORK, StrokeInput, strokePaintWork } from "./brushWork";
import { DEFAULT_BRUSH, newNode, validateScene, type Brush, type Sample } from "./model";
import { appendOperation, edit, historyToggle, newDrawing, putNode } from "./operations";

const point = (x: number): Sample => ({ x, y: 0, pressure: 1, tiltX: 0, tiltY: 0, time: x });
const spray: Brush = { ...DEFAULT_BRUSH, kind: "spray", size: 2048, spacing: 0.01 };

describe("bounded brush rendering and input", () => {
  it("keeps a 2048-pixel spray deterministic when consumed incrementally", () => {
    const samples = [point(0), point(100)];
    const expected = strokeDabs(samples, spray, 42);
    let count = 0;
    for (const dab of iterateStrokeDabs(samples, spray, 42)) expect(dab).toEqual(expected[count++]);
    expect(count).toBeGreaterThan(683);
    expect(count).toBeLessThanOrEqual(strokePaintWork(samples, spray));
    const hard = { ...DEFAULT_BRUSH, size: 10, spacing: 0.2, pressureSize: false };
    expect(strokeDabs([point(0), point(4)], hard).map((p) => p.x)).toEqual([0, 2, 4, 4]);
  });

  it("refuses spray expansion before producing particles and also validates mask totals", () => {
    const hostile = [point(0), point(10000)];
    expect(strokePaintWork(hostile, spray)).toBeGreaterThan(MAX_STROKE_WORK);
    expect(() => iterateStrokeDabs(hostile, spray).next()).toThrow("paint limit");
    const d = newDrawing(), samples = [point(0), point(1000)];
    const stroke = { samples, brush: spray, reveal: true };
    d.scene.masks.mask = { id: "mask", name: "Mask", enabled: true, inverted: false, linked: true, x: 0, y: 0, strokes: [stroke] };
    expect(() => validateScene(d.scene)).not.toThrow();
    d.scene.masks.mask.strokes = Array.from({ length: 4 }, () => structuredClone(stroke));
    expect(() => validateScene(d.scene)).toThrow("mask exceeds");
    d.scene.masks.mask.strokes = [{ ...stroke, samples: hostile }];
    expect(() => validateScene(d.scene)).toThrow("paint limit");
  });

  it("retains the painted samples after reaching a limit and commits them as one undoable stroke", () => {
    const brush = { ...spray }, input = new StrokeInput(point(0), brush);
    expect(input.append(point(100))).toBe(true);
    brush.size = 1;
    expect(input.brush.size).toBe(2048);
    expect(input.append(point(10000))).toBe(false);
    expect(input.limited).toBe(true);
    expect(input.append(point(101))).toBe(false);
    expect(input.samples.map((p) => p.x)).toEqual([0, 100]);
    const d = newDrawing(), n = newNode("stroke", d.scene.layerOrder[0], d.scene.defaultFrameId, { x: 0, y: 0, w: 1200, h: 1200 });
    n.samples = input.samples; n.brush = input.brush; n.seed = 42;
    const added = appendOperation(d, edit("owner", 0, "Stroke", putNode(d.scene, n)));
    expect(added.scene.nodes[n.id].samples).toEqual(input.samples);
    expect(appendOperation(added, historyToggle(added, "owner")!).scene).toEqual(d.scene);
  });

  it("budgets crayon granules and oil bristles as well as spray particles", () => {
    const samples = [point(0), point(10000)];
    expect(strokePaintWork(samples, { ...DEFAULT_BRUSH, kind: "crayon", size: 100, spacing: 0.01 })).toBeGreaterThan(MAX_STROKE_WORK);
    expect(() => iterateStrokeDabs(samples, { ...DEFAULT_BRUSH, kind: "crayon", size: 100, spacing: 0.01 }).next()).toThrow("paint limit");
    expect(strokePaintWork([point(0)], { ...DEFAULT_BRUSH, kind: "oil" })).toBe(26);
  });
});
