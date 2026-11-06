import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, newNode, validateScene } from "./model";
import { appendOperation, edit, historyToggle, newDrawing, putNode } from "./operations";
import { anchorPoint, localToWorld, worldToLocal } from "./geometry";
import { strokeDabs } from "./brush";

describe("drawing document invariants", () => {
  it("round trips a scene while keeping source data editable", () => {
    const d = newDrawing(), n = newNode("text", d.scene.layerOrder[0], d.scene.defaultFrameId);
    n.text = "شرح الصورة بالعربية 123 English";
    const result = appendOperation(d, edit("owner", 0, "Text", putNode(d.scene, n)));
    const reopened = JSON.parse(JSON.stringify(result));
    validateScene(reopened.scene);
    expect(reopened.scene.nodes[n.id].text).toEqual(n.text);
  });
  it("rejects stale writes and mutated operation identifiers", () => {
    const d = newDrawing(), node = newNode("shape", d.scene.layerOrder[0], d.scene.defaultFrameId);
    const op = edit("a", 0, "Shape", putNode(d.scene, node));
    const next = appendOperation(d, op);
    expect(appendOperation(next, op)).toBe(next);
    expect(() => appendOperation(next, { ...op, label: "Changed" })).toThrow("reused");
    expect(() => appendOperation(next, edit("b", 0, "Stale", []))).toThrow("conflict");
  });
  it("undoes only the author's field change without reverting another author's property", () => {
    let d = newDrawing();
    const lid = d.scene.layerOrder[0];
    d = appendOperation(d, edit("a", d.revision, "Rename", [{ type: "patch", collection: "layers", id: lid, fields: { name: "Ink" } }]));
    d = appendOperation(d, edit("b", d.revision, "Opacity", [{ type: "patch", collection: "layers", id: lid, fields: { opacity: 0.4 } }]));
    d = appendOperation(d, historyToggle(d, "a")!);
    expect(d.scene.layers[lid].name).toBe("Layer 1");
    expect(d.scene.layers[lid].opacity).toBe(0.4);
    const redo = historyToggle(d, "a", true)!;
    d = appendOperation(d, redo);
    expect(d.scene.layers[lid].name).toBe("Ink");
  });
  it("refuses undo that would leave another person's element dangling", () => {
    let d = newDrawing();
    const node = newNode("shape", d.scene.layerOrder[0], d.scene.defaultFrameId);
    d = appendOperation(d, edit("a", 0, "Shape", putNode(d.scene, node)));
    d = appendOperation(d, edit("b", 1, "Move", [{ type: "patch", collection: "nodes", id: node.id, fields: { x: 200 } }]));
    expect(() => appendOperation(d, historyToggle(d, "a")!)).toThrow("removed");
    expect(d.scene.nodes[node.id].x).toBe(200);
  });
  it("rejects impossible frame dimensions, invalid ownership and prototype injection", () => {
    const d = newDrawing(), s = structuredClone(d.scene);
    s.frames[s.defaultFrameId].w = 100000;
    expect(() => validateScene(s)).toThrow("limit");
    const n = newNode("image", "missing", s.defaultFrameId);
    expect(() => appendOperation(d, edit("a", 0, "Invalid", putNode(d.scene, n)))).toThrow("dependency");
    expect(() => appendOperation(d, edit("a", 0, "Unsafe", [{ type: "patch", collection: "layers", id: d.scene.layerOrder[0], fields: JSON.parse('{"__proto__":{}}') }]))).toThrow("fields");
  });
});

describe("brush and annotation geometry", () => {
  it("replays spray deterministically and covers a fast long segment", () => {
    const samples = [{ x: 0, y: 0, pressure: 1, tiltX: 0, tiltY: 0, time: 0 }, { x: 1000, y: 0, pressure: 1, tiltX: 0, tiltY: 0, time: 20 }];
    const brush = { ...DEFAULT_BRUSH, kind: "spray" as const };
    expect(strokeDabs(samples, brush, 42)).toEqual(strokeDabs(samples, brush, 42));
    expect(strokeDabs(samples, DEFAULT_BRUSH).length).toBeGreaterThan(500);
  });
  it("anchors follow rotation and flip and keep a fallback after deletion", () => {
    const d = newDrawing(), n = newNode("image", d.scene.layerOrder[0], d.scene.defaultFrameId, { x: 200, y: 100, w: 300, h: 100 });
    n.rotation = 90; n.flipX = true; d.scene.nodes[n.id] = n;
    const a = { nodeId: n.id, u: 0.2, v: 0.8, fallback: { x: 9, y: 10 } };
    const p = anchorPoint(d.scene, a);
    const local = worldToLocal(n, p.point);
    expect(local.x).toBeCloseTo(60); expect(local.y).toBeCloseTo(80);
    expect(localToWorld(n, local)).toEqual(p.point);
    delete d.scene.nodes[n.id];
    expect(anchorPoint(d.scene, a)).toEqual({ point: a.fallback, missing: true });
  });
});
