import { describe, expect, it } from "vitest";
import { dateLine, foldArabic, foldWithMap, hijriDate, hijriSpan, joinList } from "./locale";

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

describe("Hijri months for the Arabic calendar", () => {
  it("names the Umm al-Qura month a week falls in, or both when it crosses one", () => {
    expect(hijriSpan(new Date(2026, 10, 12), new Date(2026, 10, 18))).toBe("جمادى الآخرة 1448 هـ");
    expect(hijriDate(new Date(2026, 10, 12))).toBe("2 جمادى الآخرة");
    expect(hijriSpan(new Date(2026, 10, 8), new Date(2026, 10, 14))).toBe("جمادى الأولى وجمادى الآخرة 1448 هـ");
  });
});

describe("the Home date line", () => {
  it("gives the weekday and date, without a Hijri date in English", () => {
    const line = dateLine(new Date(2026, 10, 12));
    expect(line).toMatch(/12/);
    expect(line).not.toMatch(/هـ/);
  });
});
