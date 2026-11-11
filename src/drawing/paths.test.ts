import { expect, it } from "vitest";
import { movePathVertex, pathBounds, pathSegments, splitPath, svgPath, validPath } from "./paths";
import type { DrawingPath } from "./model";
import { appendOperation, edit, historyToggle, newDrawing, putNode } from "./operations";
import { newNode } from "./model";
const curve: DrawingPath = {
  closed: false,
  vertices: [
    { x: 0, y: 0, out: { x: 0, y: 100 } },
    { x: 100, y: 0, in: { x: 100, y: 100 } },
  ],
};
const point = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
it("adding a point exactly subdivides the original cubic without moving its curve", () => {
  const before = structuredClone(curve),
    after = splitPath(curve, 0),
    s = pathSegments(after);
  expect(s).toHaveLength(2);
  for (let i = 0; i <= 100; i++) {
    const t = i / 100,
      segment = s[t <= 0.5 ? 0 : 1],
      q = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
    for (const axis of ["x", "y"] as const)
      expect(point(segment.a[axis], segment.c1[axis], segment.c2[axis], segment.b[axis], q)).toBeCloseTo(
        point(curve.vertices[0][axis], curve.vertices[0].out![axis], curve.vertices[1].in![axis], curve.vertices[1][axis], t),
        9,
      );
  }
  expect(curve).toEqual(before);
});
it("moving an anchor carries its handles and source geometry survives transform/Undo", () => {
  const moved = movePathVertex(curve, 0, { x: 10, y: 20 });
  expect(moved.vertices[0].out).toEqual({ x: 10, y: 120 });
  expect(pathBounds(moved).h).toBe(120);
  let d = newDrawing();
  const n = newNode("shape", d.scene.layerOrder[0], d.scene.defaultFrameId);
  n.shape = "curve";
  n.path = curve;
  d = appendOperation(d, edit("a", 0, "Curve", putNode(d.scene, n)));
  d = appendOperation(d, edit("a", 1, "Move handle", [{ type: "patch", collection: "nodes", id: n.id, fields: { path: moved } }]));
  d = appendOperation(d, historyToggle(d, "a")!);
  expect(d.scene.nodes[n.id].path).toEqual(curve);
  expect(svgPath(curve)).toContain("C 0 100 100 100 100 0");
  expect(
    validPath({
      ...curve,
      vertices: [
        { x: NaN, y: 0 },
        { x: 1, y: 1 },
      ],
    }),
  ).toBe(false);
});
