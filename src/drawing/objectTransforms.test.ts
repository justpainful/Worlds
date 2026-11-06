import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, newNode, validateScene } from "./model";
import { anchorPoint, localToWorld, worldToLocal } from "./geometry";
import { appendOperation, edit, historyToggle, newDrawing, putNode } from "./operations";
import { ObjectTransformError, objectTransformChanges, objectTransformOrigin, transformObjects, transformedScene, translateObjects } from "./objectTransforms";

function fixture() {
  const doc = newDrawing(), s = doc.scene, n = newNode("stroke", s.layerOrder[0], s.defaultFrameId, { x: 100, y: 150, w: 5020, h: 100 });
  n.brush = { ...DEFAULT_BRUSH, size: 12 }; n.rotation = 27; n.flipY = true; n.samples = [{ x: 10, y: 20, pressure: 0.25, tiltX: 5, tiltY: -9, time: 0 }, { x: 5000, y: 60, pressure: 0.8, tiltX: 20, tiltY: 6, time: 30 }];
  return { doc, node: n, scene: appendOperation(doc, edit("owner", 0, "Stroke", putNode(s, n))).scene };
}
describe("original-preserving object transforms", () => {
  it("uses final document dimensions instead of an arbitrary per-gesture scale cap", () => {
    const { scene, node } = fixture(), origin = objectTransformOrigin(scene, [node]), base = { centerX: origin.x, centerY: origin.y, rotation: 0, flipX: false, flipY: false };
    expect(transformObjects(scene, [node], { ...base, scale: 0.0001 })[0].w).toBeCloseTo(0.502);
    expect(transformObjects(scene, [node], { ...base, scale: 10000 })[0].w).toBe(50200000);
    for (const scale of [0,-1,Infinity,NaN]) expect(() => transformObjects(scene, [node], { ...base, scale })).toThrow(ObjectTransformError);
    expect(() => transformObjects(scene, [node], { ...base, scale: 1e9 })).toThrow(ObjectTransformError);
  });
  it("maps source points through rotation, reflection and resize without rewriting pressure samples", () => {
    const { scene, node } = fixture(), before = structuredClone(node), origin = objectTransformOrigin(scene, [node]);
    const [next] = transformObjects(scene, [node], { centerX: origin.x + 70, centerY: origin.y - 40, scale: 0.2, rotation: 33, flipX: true, flipY: false });
    for (const p of node.samples!) {
      const old = localToWorld(node, p), dx = -(old.x - origin.x) * 0.2, dy = (old.y - origin.y) * 0.2, a = 33 * Math.PI / 180;
      const actual = localToWorld(next, { x: p.x * 0.2, y: p.y * 0.2 });
      expect(actual.x).toBeCloseTo(origin.x + 70 + dx * Math.cos(a) - dy * Math.sin(a), 8); expect(actual.y).toBeCloseTo(origin.y - 40 + dx * Math.sin(a) + dy * Math.cos(a), 8);
    }
    expect(next.geometrySize).toEqual({ w: 5020, h: 100 }); expect(next.samples).toEqual(before.samples); expect(node).toEqual(before);
    validateScene(transformedScene(scene, [next]));
    const [again] = transformObjects(transformedScene(scene, [next]), [next], { centerX: 0, centerY: 0, scale: 0.1, rotation: 0, flipX: false, flipY: true });
    expect(again.geometrySize).toEqual(next.geometrySize); expect(again.samples).toEqual(before.samples); validateScene(transformedScene(scene, [again]));
  });
  it("transforms a rotated multi-object selection with exact world-space reflection", () => {
    const { scene, node } = fixture(), other = newNode("image", node.layerId, node.frameId, { x: -40, y: 200, w: 60, h: 80 }); other.rotation = -42; other.flipX = true;
    const objects = [node, other], o = objectTransformOrigin(scene, objects), a = -17 * Math.PI / 180;
    const after = transformObjects(scene, objects, { centerX: 320, centerY: -80, scale: 1.3, rotation: -17, flipX: false, flipY: true });
    objects.forEach((n, i) => {
      const old = localToWorld(n, { x: n.w * 0.3, y: n.h * 0.7 }), x = (old.x - o.x) * 1.3, y = -(old.y - o.y) * 1.3, q = localToWorld(after[i], { x: after[i].w * 0.3, y: after[i].h * 0.7 });
      expect(q.x).toBeCloseTo(320 + x * Math.cos(a) - y * Math.sin(a), 8); expect(q.y).toBeCloseTo(-80 + x * Math.sin(a) + y * Math.cos(a), 8);
    });
  });
  it("preserves originals and makes one undo restore geometry without undoing another author's color", () => {
    const { doc, node, scene } = fixture(), o = objectTransformOrigin(scene, [node]), base = appendOperation(doc, edit("owner", 0, "Stroke", putNode(doc.scene, node)));
    const next = transformObjects(scene, [node], { centerX: o.x, centerY: o.y, scale: 0.01, rotation: 0, flipX: false, flipY: false });
    const transform = edit("owner", 1, "Transform", objectTransformChanges(scene, [node], next));
    let changed = appendOperation(base, transform); validateScene(changed.scene); expect(changed.scene.nodes[node.id].samples).toEqual(node.samples);
    changed = appendOperation(changed, edit("other", 2, "Color", [{ type: "patch", collection: "nodes", id: node.id, fields: { paint: { ...node.paint, stroke: "#ff0000" } } }]));
    const undone = appendOperation(changed, historyToggle(changed, "owner", false)!);
    expect(undone.scene.nodes[node.id].w).toBe(node.w); expect(undone.scene.nodes[node.id].geometrySize).toBeUndefined(); expect(undone.scene.nodes[node.id].paint.stroke).toBe("#ff0000");
  });
  it("refuses stale geometry and new locks while retaining independent style changes", () => {
    const { scene, node } = fixture(), after = translateObjects(scene, [node], { x: 10, y: 20 });
    const current = structuredClone(scene); current.nodes[node.id].paint.stroke = "#ff0000";
    const changes = objectTransformChanges(current, [node], after); expect(changes[0].type === "patch" && changes[0].fields.paint).toBeUndefined();
    current.nodes[node.id].w += 1; expect(() => objectTransformChanges(current, [node], after)).toThrow(ObjectTransformError);
    current.nodes[node.id].w = node.w; current.layers[node.layerId].positionLocked = true; expect(() => objectTransformChanges(current, [node], after)).toThrow(ObjectTransformError);
    current.layers[node.layerId].positionLocked = false; current.nodes[node.id].brush!.color = "#0088ff";
    expect(objectTransformChanges(current, [node], after)[0].type).toBe("patch");
    current.nodes[node.id].brush!.size += 1; expect(() => objectTransformChanges(current, [node], after)).toThrow(ObjectTransformError);
    current.nodes[node.id].brush!.size = node.brush!.size; current.nodes[node.id].samples![0].pressure = 0.9;
    expect(() => objectTransformChanges(current, [node], after)).toThrow(ObjectTransformError);
  });
  it("moves free arrow ends and keeps external pins, then carries UV anchors with selected targets", () => {
    const { scene, node } = fixture(), arrow = newNode("shape", node.layerId, node.frameId, { x: 0, y: 0, w: 200, h: 100 }); arrow.shape = "arrow";
    arrow.anchor = { nodeId: node.id, u: 0.3, v: 0.5, fallback: { x: 0, y: 0 } }; arrow.endAnchor = { nodeId: null, u: 0, v: 0, fallback: { x: 400, y: 200 } };
    scene.nodes[arrow.id] = arrow; scene.nodeOrder.push(arrow.id);
    const [alone] = translateObjects(scene, [arrow], { x: 20, y: 30 });
    expect(anchorPoint(scene, alone.anchor!).point).toEqual(anchorPoint(scene, arrow.anchor).point); expect(alone.endAnchor?.fallback).toEqual({ x: 420, y: 230 });
    const after = translateObjects(scene, [node, arrow], { x: 20, y: 30 }), changed = transformedScene(scene, after), anchored = anchorPoint(changed, after[1].anchor!).point, old = anchorPoint(scene, arrow.anchor).point;
    expect(anchored.x).toBeCloseTo(old.x + 20); expect(anchored.y).toBeCloseTo(old.y + 30); expect(after[1].anchor?.u).toBe(0.3);
    const single = transformObjects(scene, [arrow], { centerX: 100, centerY: 50, scale: 1, rotation: 0, flipX: false, flipY: false, width: 400, height: 50 })[0];
    const end = worldToLocal(single, single.endAnchor!.fallback); expect(end.x).toBeCloseTo(800); expect(end.y).toBeCloseTo(100);
  });
});
