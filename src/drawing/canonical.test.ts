import { describe, expect, it } from "vitest";
import { appendOperation, edit, newDrawing, putNode } from "./operations";
import { newNode } from "./model";
import {
  canonicalOperation,
  drawingLeaseCovers,
  drawingLeaseOverlaps,
  drawingLeaseTargets,
  drawingPreconditions,
  importedDrawing,
  validateDrawingDocument,
} from "./canonical";
describe("authoritative drawing operations", () => {
  it("refuses source-dependent rebasing even when changed properties were absent at preview", () => {
    const initial = newDrawing(),
      layer = initial.scene.layerOrder[0],
      merge = edit("alice", 0, "Merge captured source", []);
    merge.requiresBase = true;
    expect(canonicalOperation(initial, merge, "alice")).toEqual(merge);
    const current = appendOperation(
      initial,
      edit("bob", 0, "Add optional property", [{ type: "patch", collection: "layers", id: layer, fields: { alphaLocked: true } }]),
    );
    expect(() => canonicalOperation(current, merge, "alice", drawingPreconditions(initial.scene, merge))).toThrow("source was captured");
    expect(current.revision).toBe(1);
  });
  it("reserves the whole document for restoration and refuses even an independent edit after its preview", () => {
    const initial = newDrawing(),
      layer = initial.scene.layerOrder[0];
    const restore = edit("alice", 0, "Restore", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Restored" } }]);
    restore.versionRestore = { versionId: crypto.randomUUID(), backupId: restore.id, expectedRevision: 0 };
    expect(drawingLeaseTargets(initial, restore)).toContain("drawing:root");
    expect(canonicalOperation(initial, restore, "alice")).toEqual(restore);
    const current = appendOperation(
      initial,
      edit("bob", 0, "Independent opacity", [{ type: "patch", collection: "layers", id: layer, fields: { opacity: 0.4 } }]),
    );
    expect(() => canonicalOperation(current, restore, "alice", drawingPreconditions(initial.scene, restore))).toThrow(
      "after the version restore preview",
    );
  });
  it("merges offline changes to independent fields and retains a same-field conflict", () => {
    const initial = newDrawing(),
      layer = initial.scene.layerOrder[0];
    const name = edit("alice", 0, "Name", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Ink" } }]);
    const opacity = edit("bob", 0, "Opacity", [{ type: "patch", collection: "layers", id: layer, fields: { opacity: 0.4 } }]);
    const current = appendOperation(initial, opacity),
      before = drawingPreconditions(initial.scene, name);
    const merged = appendOperation(current, canonicalOperation(current, name, "alice", before));
    expect(merged.scene.layers[layer]).toMatchObject({ name: "Ink", opacity: 0.4 });
    const competing = edit("bob", 0, "Competing name", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Other ink" } }]);
    expect(() => canonicalOperation(appendOperation(initial, competing), name, "alice", before)).toThrow("property used");
    expect(name.base).toBe(0);
    expect(before).toEqual(drawingPreconditions(initial.scene, name));
  });
  it("protects parent layers and frames while leaving unrelated nodes independent", () => {
    let doc = newDrawing();
    const frame = doc.scene.defaultFrameId,
      layer = doc.scene.layerOrder[0];
    const a = newNode("shape", layer, frame),
      b = newNode("shape", layer, frame);
    a.shape = b.shape = "rect";
    doc = appendOperation(
      doc,
      edit("alice", 0, "Shapes", [
        ...putNode(doc.scene, a).filter((c) => c.type !== "order"),
        ...putNode(doc.scene, b).filter((c) => c.type !== "order"),
        { type: "order", list: "nodeOrder", ids: [a.id, b.id] },
      ]),
    );
    expect(drawingLeaseCovers(doc.scene, `layer:${layer}`, `node:${a.id}`)).toBe(true);
    expect(drawingLeaseCovers(doc.scene, `frame:${frame}`, `node:${b.id}`)).toBe(true);
    expect(drawingLeaseCovers(doc.scene, "drawing:root", "order:nodeOrder")).toBe(true);
    expect(drawingLeaseOverlaps(doc.scene, `layer:${layer}`, `frame:${frame}`)).toBe(true);
    expect(drawingLeaseOverlaps(doc.scene, `node:${a.id}`, `node:${b.id}`)).toBe(false);
    expect(drawingLeaseCovers(doc.scene, `frame:${frame}`, "order:nodeOrder")).toBe(false);
  });
  it("rebases independent concurrent additions without deleting another author's stacking", () => {
    const initial = newDrawing(),
      a = newNode("shape", initial.scene.layerOrder[0], initial.scene.defaultFrameId),
      b = newNode("shape", initial.scene.layerOrder[0], initial.scene.defaultFrameId);
    a.shape = b.shape = "rect";
    const first = edit("alice", 0, "Alice shape", putNode(initial.scene, a)),
      second = edit("bob", 0, "Bob shape", putNode(initial.scene, b));
    const current = appendOperation(initial, first),
      canonical = canonicalOperation(current, second, "bob"),
      result = appendOperation(current, canonical);
    expect(result.scene.nodeOrder).toEqual([a.id, b.id]);
    expect(canonical.base).toBe(1);
    expect(second.base).toBe(0);
    expect(drawingLeaseTargets(current, canonical)).toEqual([]);
    const staleMove = edit("alice", 1, "Move", [{ type: "patch", collection: "nodes", id: a.id, fields: { x: 80 } }]);
    expect(() => canonicalOperation(result, staleMove, "alice")).toThrow("existing drawing element changed");
  });
  it("requires a node lease for a property change and an order lease for reordering existing elements", () => {
    let doc = newDrawing();
    const a = newNode("shape", doc.scene.layerOrder[0], doc.scene.defaultFrameId),
      b = newNode("shape", doc.scene.layerOrder[0], doc.scene.defaultFrameId);
    a.shape = b.shape = "rect";
    doc = appendOperation(doc, edit("alice", 0, "A", putNode(doc.scene, a)));
    doc = appendOperation(doc, edit("bob", 1, "B", putNode(doc.scene, b)));
    expect(
      drawingLeaseTargets(doc, edit("alice", 2, "Move", [{ type: "patch", collection: "nodes", id: a.id, fields: { x: 10 } }])),
    ).toEqual([`node:${a.id}`]);
    const reorder = edit("alice", 2, "Reorder", [{ type: "order", list: "nodeOrder", ids: [b.id, a.id] }]);
    expect(drawingLeaseTargets(doc, reorder)).toEqual(["order:nodeOrder"]);
    doc = appendOperation(doc, reorder);
    expect(
      drawingLeaseTargets(doc, {
        id: "undo",
        actor: "alice",
        at: 1,
        base: 3,
        label: "Undo",
        type: "toggle",
        target: reorder.id,
        enabled: false,
      }),
    ).toEqual(["order:nodeOrder"]);
  });
  it("preserves imported history without attributing another person's imported edits to a verified account", () => {
    let doc = newDrawing();
    doc = appendOperation(
      doc,
      edit("local-profile", 0, "Name", [{ type: "patch", collection: "layers", id: doc.scene.layerOrder[0], fields: { name: "قلم" } }]),
    );
    doc = appendOperation(
      doc,
      edit("someone-else", 1, "Opacity", [{ type: "patch", collection: "layers", id: doc.scene.layerOrder[0], fields: { opacity: 0.5 } }]),
    );
    const imported = importedDrawing(doc, "local-profile", "alice");
    expect(imported.operations.map((o) => o.actor)).toEqual(["alice", "imported:someone-else"]);
    validateDrawingDocument(imported);
    const damaged = structuredClone(imported);
    damaged.scene.layers[damaged.scene.layerOrder[0]].opacity = 1;
    expect(() => validateDrawingDocument(damaged)).toThrow("does not match");
  });
});
