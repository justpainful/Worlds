import { describe, expect, it } from "vitest";
import { newDrawing, appendOperation, edit, putNode } from "./operations";
import { newNode } from "./model";
import { duplicateFrame, moveFrame } from "./workflows";
describe("frame ownership and linked element copying", () => {
  it("duplicates contained elements and remaps internal anchors without touching the original", () => {
    let doc = newDrawing(); const s = doc.scene, f = s.defaultFrameId;
    const image = newNode("shape", s.layerOrder[0], f, { x: 100, y: 100 }), arrow = newNode("shape", s.layerOrder[0], f);
    image.libraryItemId = "library"; image.libraryVersion = 1; image.libraryInstanceId = "instance"; image.librarySourceNodeId = "source-node";
    arrow.shape = "arrow"; arrow.anchor = { nodeId: image.id, u: 0.5, v: 0.5, fallback: { x: 200, y: 150 } };
    doc = appendOperation(doc, edit("a", 0, "Image", putNode(doc.scene, image)));
    doc = appendOperation(doc, edit("a", 1, "Arrow", putNode(doc.scene, arrow)));
    const duplicated = duplicateFrame(doc.scene, f);
    doc = appendOperation(doc, edit("a", 2, "Duplicate frame", duplicated.changes));
    const copies = Object.values(doc.scene.nodes).filter((n) => n.frameId === duplicated.frame.id);
    expect(copies).toHaveLength(2);
    expect(copies.every((n) => !n.libraryInstanceId && !n.libraryItemId)).toBe(true);
    expect(copies.find((n) => n.shape === "arrow")!.anchor!.nodeId).toBe(copies.find((n) => n.id !== copies.find((n) => n.shape === "arrow")!.id)!.id);
    expect(doc.scene.nodes[image.id].x).toBe(100);
  });
  it("moves frame contents while preserving their local geometry", () => {
    let doc = newDrawing(); const s = doc.scene, node = newNode("shape", s.layerOrder[0], s.defaultFrameId, { x: 50, y: 60 });
    doc = appendOperation(doc, edit("a", 0, "Shape", putNode(s, node)));
    doc = appendOperation(doc, edit("a", 1, "Move frame", moveFrame(doc.scene, s.defaultFrameId, { x: 300, y: 200 })));
    expect(doc.scene.nodes[node.id]).toMatchObject({ x: 350, y: 260, w: node.w, h: node.h });
  });
});
