import { describe, expect, it } from "vitest";
import { mergeDrawingWire } from "./transport";
import { appendOperation, edit, newDrawing } from "./operations";
import type { DrawingWireState } from "./wire";
function checkpoint(): DrawingWireState { return { generation: crypto.randomUUID(), revision: 0, dependencyRevision: 0, document: newDrawing(), attachments: {}, versions: {} }; }
describe("drawing wire checkpoint validation", () => {
  it("accepts an incremental journal and an identical repeated operation", () => {
    const before = checkpoint(), layer = before.document!.scene.layerOrder[0], op = edit("alice", 0, "Name", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Ink" } }]);
    const incoming = { ...before, document: undefined, operations: [op], revision: 1 };
    const next = mergeDrawingWire(before, incoming);
    expect(next.document!.scene.layers[layer].name).toBe("Ink");
    expect(mergeDrawingWire(next, incoming).document).toEqual(next.document);
    expect(() => mergeDrawingWire(next, { ...incoming, operations: [{ ...op, label: "Reused operation" }] })).toThrow("history changed");
  });
  it("refuses rewritten full history, generation changes, and missing incremental operations", () => {
    const before = checkpoint(), layer = before.document!.scene.layerOrder[0], op = edit("alice", 0, "Name", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Ink" } }]);
    const first = { ...before, document: appendOperation(before.document!, op), revision: 1 };
    const changed = { ...first, document: appendOperation(before.document!, { ...op, label: "Other history" }) };
    expect(() => mergeDrawingWire(first, changed)).toThrow("history changed");
    expect(() => mergeDrawingWire(before, { ...before, generation: crypto.randomUUID() })).toThrow("changed generation");
    expect(() => mergeDrawingWire(before, { ...before, document: undefined, operations: [], revision: 1 })).toThrow("missing operations");
  });
  it("refuses removed, changed, and unversioned original directories", () => {
    const before = checkpoint(), original = { sha256: "a".repeat(64), size: 4, mime: "image/png", fileName: "original.png" };
    const first = { ...before, dependencyRevision: 1, attachments: { original } };
    expect(() => mergeDrawingWire(first, { ...first, dependencyRevision: 2, attachments: {} })).toThrow("disappeared");
    expect(() => mergeDrawingWire(first, { ...first, dependencyRevision: 2, attachments: { original: { ...original, sha256: "b".repeat(64) } } })).toThrow("dependency changed");
    expect(() => mergeDrawingWire(before, { ...before, attachments: { original } })).toThrow("without a new revision");
    expect(mergeDrawingWire(before, first).attachments.original).toEqual(original);
  });
});
