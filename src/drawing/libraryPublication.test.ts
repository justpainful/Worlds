import { describe, it, expect } from "vitest";
import { newScene, validateScene, newNode } from "./model";
import { validateLibraryPublication, type PublishedLibraryMetadata } from "./libraryPublication";
import { captureLibraryScene, validateLibraryMetadata } from "./library";
const metadata = (): PublishedLibraryMetadata => ({
  schema: 1,
  itemId: "publication",
  version: 1,
  name: "ألوان مشتركة",
  kind: "palette",
  tags: ["ألوان"],
  sourceId: "source",
  payload: { colors: ["#0000ff80", "#ffffff"] },
  createdAt: 100,
});
describe("immutable library publication metadata", () => {
  it("validates bounded palette descriptors without making them ownership or workspace claims", () => {
    const s = newScene();
    s.libraryPublication = metadata();
    validateScene(s);
    for (const change of [{ owner: "attacker" }, { scope: "workspace" }, { workspaceId: "another" }])
      expect(() => validateLibraryPublication({ ...metadata(), ...change }, s)).toThrow("metadata");
    for (const value of [0, 501, 1.5]) expect(() => validateLibraryPublication({ ...metadata(), version: value }, s)).toThrow();
    expect(() => validateLibraryPublication({ ...metadata(), payload: { colors: ["https://example.invalid/color"] } }, s)).toThrow(
      "palette",
    );
  });
  it("does not carry a publication identity into an independent captured template", () => {
    const s = newScene();
    s.libraryPublication = metadata();
    const captured = captureLibraryScene(s, "template", [], s.defaultFrameId);
    expect(captured.libraryPublication).toBeUndefined();
    expect(s.libraryPublication).toEqual(metadata());
  });
  it("refuses style fields that could alter geometry or inject a different source attachment", () => {
    const s = newScene(),
      n = newNode("shape", s.layerOrder[0], s.defaultFrameId);
    n.shape = "rect";
    s.nodes[n.id] = n;
    s.nodeOrder.push(n.id);
    const bad = { paint: n.paint, textStyle: n.textStyle, assetId: "foreign", x: 999 },
      payload = { style: bad };
    expect(() => validateLibraryMetadata({ name: "Style", kind: "style", tags: [], payload }, s)).toThrow("style fields");
    expect(() => validateLibraryPublication({ ...metadata(), kind: "style", payload }, s)).toThrow("style fields");
  });
});
