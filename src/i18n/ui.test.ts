import { afterAll, describe, expect, it } from "vitest";
import dictionary from "./ar.json";
import { loadDictionary, resolveUiLanguage, translate } from "./ui";

describe("Arabic interface dictionary", () => {
  afterAll(() => loadDictionary(dictionary as Record<string, string>));

  it("chooses Arabic only when asked or when the system is Arabic", () => {
    expect(resolveUiLanguage("ar")).toBe("ar");
    expect(resolveUiLanguage("en")).toBe("en");
  });

  it("translates exact text and ignores surrounding white space", () => {
    loadDictionary({ Save: "حفظ", "Move to Trash": "نقل إلى سلة المهملات" });
    expect(translate("Save")).toBe("حفظ");
    expect(translate("  Move   to Trash \n")).toBe("نقل إلى سلة المهملات");
    expect(translate("Unknown words")).toBeNull();
    expect(translate("123")).toBeNull();
  });

  it("fills patterns and translates their parts when it can", () => {
    loadDictionary({ "§{0} pages": "{0} صفحات", "§Moved {0} to {1}": "نُقل {0} إلى {1}", Trash: "سلة المهملات", "§Untitled {0}": "{0} بلا عنوان", drawing: "رسم" });
    expect(translate("12 pages")).toBe("12 صفحات");
    expect(translate("Moved Notes to Trash")).toBe("نُقل Notes إلى سلة المهملات");
    expect(translate("Untitled drawing")).toBe("رسم بلا عنوان");
  });

  it("drops English plural endings and still matches the singular", () => {
    loadDictionary({ "§{0} page{1}": "{0} صفحة{1}" });
    expect(translate("3 pages")).toBe("3 صفحة");
    expect(translate("1 page")).toBe("1 صفحة");
    expect(translate("pages")).toBeNull();
    // A count pattern must not swallow a whole sentence.
    expect(translate("Plan my week from my pages")).toBeNull();
  });

  it("prefers the most specific pattern", () => {
    loadDictionary({ "§{0} items": "{0} عناصر", "§{0} items selected": "تم تحديد {0} عناصر" });
    expect(translate("3 items selected")).toBe("تم تحديد 3 عناصر");
  });

  it("keeps placeholders in every pattern of the real dictionary", () => {
    for (const [en, ar] of Object.entries(dictionary as Record<string, string>)) {
      if (!en.startsWith("§")) continue;
      const want = (en.match(/\{\d\}/g) ?? []).sort().join();
      expect((ar.match(/\{\d\}/g) ?? []).sort().join(), en).toBe(want);
    }
  });

  it("has no dashes the interface rules forbid", () => {
    for (const ar of Object.values(dictionary as Record<string, string>)) expect(ar).not.toMatch(/[–—]/);
  });
});
