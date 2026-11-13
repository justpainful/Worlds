import { describe, expect, it } from "vitest";
import dictionary from "./ar.json";
import { loadDictionary, translate } from "./ui";

describe("translation speed", () => {
  it("translates a screenful of texts within one frame", () => {
    loadDictionary(dictionary as Record<string, string>);
    const keys = Object.keys(dictionary).filter((k) => !k.startsWith("§")).slice(0, 300);
    // A busy screen: known labels, counted phrases and text the dictionary does not know.
    const texts = [
      ...keys,
      ...Array.from({ length: 100 }, (_, i) => `${i + 1} pages`),
      ...Array.from({ length: 100 }, (_, i) => `Something nobody translated ${i}`),
    ];
    for (const t of texts) translate(t);
    const t0 = performance.now();
    for (const t of texts) translate(t);
    const ms = performance.now() - t0;
    console.log(`${texts.length} texts in ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });
});
