import { describe, expect, it } from "vitest";
import { newNode, newScene } from "./model";
import { experimentDifferences, mergeExperiment } from "./experiments";
function fixture() {
  const scene = newScene(), node = newNode("shape", scene.layerOrder[0], scene.defaultFrameId); node.shape = "rect";
  scene.nodes[node.id] = node; scene.nodeOrder = [node.id]; return { scene, id: node.id };
}
describe("three-way experiment adoption", () => {
  it("combines independent property edits and preserves current-only work", () => {
    const { scene, id } = fixture(), mine = structuredClone(scene), theirs = structuredClone(scene);
    mine.nodes[id].x = 100; theirs.nodes[id].paint.stroke = "#ff0000";
    const differences = experimentDifferences(scene, mine, theirs);
    expect(differences.every((d) => !d.conflict)).toBe(true);
    const merged = mergeExperiment(mine, theirs, differences, {});
    expect(merged.nodes[id].x).toBe(100); expect(merged.nodes[id].paint.stroke).toBe("#ff0000");
  });
  it("requires a real conflict choice and can preserve both alternatives", () => {
    const { scene, id } = fixture(), mine = structuredClone(scene), theirs = structuredClone(scene);
    mine.nodes[id].x = 100; theirs.nodes[id].x = 200;
    const differences = experimentDifferences(scene, mine, theirs);
    expect(differences).toHaveLength(1); expect(differences[0].conflict).toBe(true);
    expect(() => mergeExperiment(mine, theirs, differences, {})).toThrow("Resolve");
    const both = mergeExperiment(mine, theirs, differences, { [differences[0].key]: "duplicate" });
    expect(both.nodeOrder).toHaveLength(2); expect(both.nodes[id].x).toBe(100);
    expect(Object.values(both.nodes).find((n) => n.id !== id)!.x).toBe(220);
  });
  it("does not report copied attachment identities as content differences", () => {
    const { scene } = fixture(); scene.assets.a = { id: "a", attachmentId: "original", name: "image.png", mime: "image/png", width: 10, height: 10 };
    const theirs = structuredClone(scene); theirs.assets.a.attachmentId = "independent-copy";
    expect(experimentDifferences(scene, scene, theirs)).toEqual([]);
  });
  it("compares and adopts stacking order rather than silently ignoring it", () => {
    const { scene } = fixture(), node = newNode("shape", scene.layerOrder[0], scene.defaultFrameId);
    scene.nodes[node.id] = node; scene.nodeOrder.push(node.id);
    const branch = structuredClone(scene); branch.nodeOrder.reverse();
    const differences = experimentDifferences(scene, scene, branch);
    expect(differences).toHaveLength(1); expect(differences[0].id).toBe("nodeOrder");
    expect(mergeExperiment(scene, branch, differences, {}).nodeOrder).toEqual(branch.nodeOrder);
  });
});
