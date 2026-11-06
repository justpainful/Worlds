import { expect, it } from "vitest";
import { DEFAULT_BRUSH, newNode } from "./model";
import { newDrawing } from "./operations";
import { localToWorld } from "./geometry";
import { gripPoint, gripTransform, selectionTransformFrame } from "./transformHandles";
import { objectTransformChanges, transformObjects, transformedScene } from "./objectTransforms";
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 7); expect(a.y).toBeCloseTo(b.y, 7); };
function fixture() {
  const s = newDrawing().scene, n = newNode("stroke", s.layerOrder[0], s.defaultFrameId, { x: 100, y: 150, w: 160, h: 40 });
  n.rotation = 37; n.flipX = true; n.brush = { ...DEFAULT_BRUSH, size: 100, kind: "texture", angle: 45 }; n.samples = [{ x: 0, y: 0, pressure: 0.5, tiltX: 2, tiltY: -3, time: 0 }]; s.nodes[n.id] = n; s.nodeOrder = [n.id]; return { s, n };
}
it("keeps the opposite ink grip fixed for rotated reflected legacy overhang", () => {
  const { s, n } = fixture(), frame = selectionTransformFrame(s, [n]), start = gripPoint(frame, "se", 1), fixed = gripPoint(frame, "nw", 1);
  const pointer = { x: start.x + frame.x.x * frame.w, y: start.y + frame.x.y * frame.w }, t = gripTransform(s, [n], frame, "se", start, pointer, { shift: false, alt: false }), [next] = transformObjects(s, [n], t);
  expect(next.w).toBeCloseTo(n.w * 2); expect(next.h).toBeCloseTo(n.h); expect(next.samples).toEqual(n.samples); expect(next.geometrySize).toEqual({ w: 160, h: 40 });
  close(gripPoint(selectionTransformFrame(transformedScene(s, [next]), [next]), "nw", 1), fixed);
});
it("scales about the ink center with Alt and locks ratio with Shift", () => {
  const { s, n } = fixture(), f = selectionTransformFrame(s, [n]), start = gripPoint(f, "e", 2), p = { x: start.x + f.x.x * f.w / 2, y: start.y + f.x.y * f.w / 2 };
  const [next] = transformObjects(s, [n], gripTransform(s, [n], f, "e", start, p, { shift: true, alt: true }));
  expect(next.w / n.w).toBeCloseTo(2); expect(next.h / n.h).toBeCloseTo(2); close(selectionTransformFrame(s, [next]).center, f.center);
});
it("uses a similarity transform for differently rotated objects without shear", () => {
  const { s, n } = fixture(), other = { ...n, id: "other", x: 400, rotation: -43 }, nodes = [n, other], f = selectionTransformFrame(s, nodes), a = gripPoint(f, "nw", 1), b = gripPoint(f, "se", 1), p = { x: a.x + (b.x - a.x) * 1.5, y: a.y + (b.y - a.y) * 1.5 };
  const t = gripTransform(s, nodes, f, "se", b, p, { shift: false, alt: false }), after = transformObjects(s, nodes, t);
  nodes.forEach((node, i) => { const old = localToWorld(node, { x: 10, y: 20 }), next = localToWorld(after[i], { x: 15, y: 30 }); close(next, { x: a.x + (old.x - a.x) * 1.5, y: a.y + (old.y - a.y) * 1.5 }); });
});
it("snaps rotation, retains a positive box across the opposite grip and makes an untouched gesture a no-op", () => {
  const { s, n } = fixture(), f = selectionTransformFrame(s, [n]), start = gripPoint(f, "rotate", 1), origin = { x: n.x + n.w / 2, y: n.y + n.h / 2 }, a = 23 * Math.PI / 180, dx = start.x - origin.x, dy = start.y - origin.y;
  const t = gripTransform(s, [n], f, "rotate", start, { x: origin.x + dx * Math.cos(a) - dy * Math.sin(a), y: origin.y + dx * Math.sin(a) + dy * Math.cos(a) }, { shift: true, alt: false }); expect(t.rotation).toBe(30);
  const se = gripPoint(f, "se", 1), nw = gripPoint(f, "nw", 1), shrunk = transformObjects(s, [n], gripTransform(s, [n], f, "se", se, { x: nw.x - 100, y: nw.y - 100 }, { shift: true, alt: false }))[0]; expect(shrunk.w).toBeGreaterThan(0); expect(shrunk.h).toBeGreaterThan(0);
  const same = transformObjects(s, [n], gripTransform(s, [n], f, "e", se, se, { shift: false, alt: false })); expect(objectTransformChanges(s, [n], same)).toEqual([]);
});
