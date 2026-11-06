import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, type Sample } from "./model";
import { straightStrokeSamples,uniformStrokeRadii } from "./uniformStroke";

const point = (x: number, pressure = 1): Sample => ({ x, y: 0, pressure, time: x, tiltX: 0, tiltY: 0 });
describe("uniform pen geometry", () => {
  it("straight-line highlighting retains all original pressure/time samples while projecting its ink between endpoints",()=>{const source=[point(0,0.2),{...point(50,0.6),y:40},point(100,1)],before=structuredClone(source),line=straightStrokeSamples(source,true);expect(line.map(p=>p.y)).toEqual([0,0,0]);expect(line[1].x).toBe(50);expect(line.map(p=>p.pressure)).toEqual([0.2,0.6,1]);expect(source).toEqual(before);expect(straightStrokeSamples(source,false)).toBe(source);});
  it("maps the stored pressure curve to sample widths without changing source samples", () => {
    const samples = [point(0, 0.2), point(50, 0.5), point(100, 1)], before = structuredClone(samples);
    const brush = { ...DEFAULT_BRUSH, size: 100, pressureCurve: 2 };
    const radii = uniformStrokeRadii(samples, brush);
    expect(radii[0]).toBeCloseTo(2); expect(radii[1]).toBeCloseTo(12.5); expect(radii[2]).toBe(50);
    expect([...uniformStrokeRadii(samples, { ...brush, pressureSize: false })]).toEqual([50, 50, 50]);
    expect(samples).toEqual(before);
  });
  it("uses traveled distance for taper and keeps stationary or tiny-pressure marks finite", () => {
    const brush = { ...DEFAULT_BRUSH, size: 100, pressureSize: false, taperStart: 0.2, taperEnd: 0.2 };
    expect([...uniformStrokeRadii([point(0), point(10), point(90), point(100)], brush)]).toEqual([1.5, 25, 25, 1.5]);
    expect([...uniformStrokeRadii([point(0), point(0)], brush)]).toEqual([50, 50]);
    expect([...uniformStrokeRadii([point(0, 0)], { ...brush, pressureSize: true, pressureCurve: 4 })]).toEqual([0.1]);
  });
  it("refuses excessive input before constructing path geometry", () => {
    expect(() => uniformStrokeRadii(Array.from({ length: 65537 }, () => point(0)), DEFAULT_BRUSH)).toThrow("paint limit");
  });
});
