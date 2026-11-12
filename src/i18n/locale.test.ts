import { describe, expect, it } from "vitest";
import { foldArabic, foldWithMap, joinList } from "./locale";

describe("Arabic text helpers", () => {
  it("folds letters people type interchangeably", () => {
    expect(foldArabic("صورة")).toBe(foldArabic("صوره"));
    expect(foldArabic("إدراج")).toBe(foldArabic("ادراج"));
    expect(foldArabic("مستوى")).toBe(foldArabic("مستوي"));
    expect(foldArabic("عُنْوَان")).toBe("عنوان");
    expect(foldArabic("Image")).toBe("Image");
    // Arabic digits find Western ones.
    expect(foldArabic("اختبار ٢٤/١١")).toBe(foldArabic("اختبار 24/11"));
  });

  it("joins lists with a Latin comma until Arabic dates are on", () => {
    expect(joinList(["Mon", "Wed"])).toBe("Mon, Wed");
  });
});

describe("folding with positions", () => {
  it("maps each folded letter back to the original text", () => {
    const text = "صورةٌ Big";
    const { folded, at } = foldWithMap(text);
    expect(folded).toBe("صوره big");
    // The tanween after ة is skipped, so the space maps to index 5.
    expect(at).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9]);
    const i = folded.indexOf("صوره");
    expect(text.slice(at[i], at[i + 4])).toBe("صورةٌ");
  });
});
