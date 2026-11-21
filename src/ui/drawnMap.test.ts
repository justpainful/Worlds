import { describe, expect, it } from "vitest";
import { setIconStyle } from "./drawnMap";

describe("icon style", () => {
  it("keeps the original design when nothing is chosen", () => {
    // Tests run without a DOM: a root element with a dataset is all the style needs.
    const root = { dataset: {} as Record<string, string> };
    (globalThis as { document?: unknown }).document = { documentElement: root };
    try {
      setIconStyle("teal");
      expect(root.dataset.style).toBe("drawn");
      expect(root.dataset.drawnSet).toBe("teal");
      setIconStyle(undefined);
      expect(root.dataset.style).toBe("lines");
      setIconStyle("symbolic");
      expect(root.dataset.style).toBe("symbolic");
      setIconStyle("something else");
      expect(root.dataset.style).toBe("lines");
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});
