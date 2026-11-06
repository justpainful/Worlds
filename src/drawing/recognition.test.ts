import { describe, expect, it } from "vitest";
import { recognizeShape } from "./recognition";
import type { Point } from "./model";

function contour(corners: Point[]): Point[] {
  return corners.flatMap((a, i) => {
    const b = corners[(i + 1) % corners.length];
    return Array.from({ length: 25 }, (_, t) => ({ x: a.x + (b.x - a.x) * t / 24 + Math.sin(t * 2) * 1.2, y: a.y + (b.y - a.y) * t / 24 + Math.cos(t) * 1.2 }));
  });
}
describe("freehand shape correction", () => {
  it("turns an imperfect right triangle into an actual right angle", () => {
    const result = recognizeShape(contour([{ x: 20, y: 20 }, { x: 24, y: 200 }, { x: 250, y: 203 }]));
    expect(result?.shape).toBe("right-triangle");
    const [p, a, b] = result!.points!;
    expect((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)).toBeCloseTo(0, 6);
  });
  it("recognizes a rough rectangle and ellipse", () => {
    expect(recognizeShape(contour([{ x: 0, y: 0 }, { x: 200, y: 3 }, { x: 204, y: 100 }, { x: 2, y: 99 }]))?.shape).toBe("rect");
    const circle = Array.from({ length: 100 }, (_, i) => ({ x: 200 + Math.cos(i / 99 * Math.PI * 2) * 120, y: 200 + Math.sin(i / 99 * Math.PI * 2) * 70 }));
    expect(recognizeShape(circle)?.shape).toBe("ellipse");
  });
  it("leaves tiny strokes and open scribbles alone", () => {
    expect(recognizeShape(contour([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]))).toBeNull();
    expect(recognizeShape(Array.from({ length: 100 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 5) * 80 })))).toBeNull();
  });
});
