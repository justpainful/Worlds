import { describe, expect, it } from "vitest";
import { shownName } from "./names";

describe("shown frame and layer names", () => {
  it("shows the default names in Arabic", () => {
    expect(shownName("Frame 1", true)).toBe("إطار 1");
    expect(shownName("Layer 12", true)).toBe("طبقة 12");
  });

  it("keeps names the person typed, and everything in English", () => {
    expect(shownName("الخلية النباتية", true)).toBe("الخلية النباتية");
    expect(shownName("Frame one", true)).toBe("Frame one");
    expect(shownName("Frame 1", false)).toBe("Frame 1");
  });
});
