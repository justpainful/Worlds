import { describe, it, expect } from "vitest";
import { newDrawing, edit, appendOperation, putNode, historyToggle } from "./operations";
import { newNode } from "./model";
import { historyAttachmentIds, rewriteHistoryAttachments, remapPortableHistory, validatePortableHistory } from "./portableHistory";
describe("portable canonical history", () => {
  it("keeps removed originals, remaps them and preserves author Undo independently", () => {
    let doc = newDrawing();
    const n = newNode("image", doc.scene.layerOrder[0], doc.scene.defaultFrameId);
    n.assetId = "a";
    doc = appendOperation(
      doc,
      edit("alice", 0, "Import original", [
        {
          type: "put",
          collection: "assets",
          id: "a",
          value: { id: "a", attachmentId: "original", name: "source.png", mime: "image/png", width: 1, height: 1 },
        },
        ...putNode(doc.scene, n),
      ]),
    );
    const other = newNode("shape", doc.scene.layerOrder[0], doc.scene.defaultFrameId);
    other.shape = "rect";
    doc = appendOperation(doc, edit("bob", 1, "Independent drawing", putNode(doc.scene, other)));
    doc = appendOperation(
      doc,
      edit("alice", 2, "Remove image", [
        { type: "remove", collection: "nodes", id: n.id },
        { type: "order", list: "nodeOrder", ids: [other.id] },
        { type: "remove", collection: "assets", id: "a" },
      ]),
    );
    expect(historyAttachmentIds(doc)).toEqual(["original"]);
    const owned = remapPortableHistory(rewriteHistoryAttachments(doc, new Map([["original", "owned"]])), new Map());
    validatePortableHistory(owned);
    expect(owned.operations.every((op, i) => op.id !== doc.operations[i].id && op.actor === doc.operations[i].actor)).toBe(true);
    const restored = appendOperation(owned, historyToggle(owned, "alice")!);
    expect(restored.scene.assets.a.attachmentId).toBe("owned");
    expect(restored.scene.nodes[n.id].assetId).toBe("a");
    expect(restored.scene.nodes[other.id]).toEqual(other);
    expect(doc.scene.assets).toEqual({});
  });
  it("refuses forged final scenes and excessive history before import", () => {
    const doc = newDrawing(),
      n = newNode("shape", doc.scene.layerOrder[0], doc.scene.defaultFrameId);
    n.shape = "ellipse";
    const valid = appendOperation(doc, edit("alice", 0, "Ellipse", putNode(doc.scene, n))),
      bad = structuredClone(valid);
    bad.scene.nodes[n.id].x = 999;
    expect(() => validatePortableHistory(bad)).toThrow();
    expect(() => validatePortableHistory({ ...doc, operations: Array(501).fill(valid.operations[0]), revision: 501 })).toThrow("500");
  });
  it("remaps restore/toggle references to independent operation and version IDs", () => {
    let doc = newDrawing();
    const n = newNode("shape", doc.scene.layerOrder[0], doc.scene.defaultFrameId);
    n.shape = "rect";
    const op = edit("alice", 0, "Restore", putNode(doc.scene, n));
    op.versionRestore = { versionId: "old-version", backupId: op.id, expectedRevision: 0 };
    doc = appendOperation(doc, op);
    doc = appendOperation(doc, historyToggle(doc, "alice")!);
    const ids = new Map(doc.operations.map((op, i) => [op.id, `new-op-${i}`])),
      copy = remapPortableHistory(doc, new Map([["old-version", "new-version"]]), ids);
    expect(copy.operations[0]).toMatchObject({ id: "new-op-0", versionRestore: { versionId: "new-version", backupId: "new-op-0" } });
    expect(copy.operations[1]).toMatchObject({ id: "new-op-1", target: "new-op-0" });
    validatePortableHistory(copy);
  });
});
