import { describe, expect, it } from "vitest";
import { setDesign, setIconStyle } from "./drawnMap";

describe("design and icons", () => {
  it("keeps the original design and icons unless chosen, and keeps them apart", () => {
    // Tests run without a DOM: a root element with a dataset is all they need.
    const root = { dataset: {} as Record<string, string> };
    (globalThis as { document?: unknown }).document = { documentElement: root };
    try {
      setDesign(undefined);
      setIconStyle(undefined);
      expect(root.dataset.style).toBe("original");
      expect(root.dataset.icons).toBe("lines");
      setIconStyle("teal");
      expect(root.dataset.style).toBe("original");
      expect(root.dataset.drawnSet).toBe("teal");
      setDesign("drawn");
      setIconStyle("symbolic");
      expect(root.dataset.style).toBe("drawn");
      expect(root.dataset.icons).toBe("symbolic");
      expect(root.dataset.drawnSet).toBe("");
      setIconStyle("something else");
      expect(root.dataset.icons).toBe("lines");
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});
