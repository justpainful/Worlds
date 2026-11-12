import { describe, expect, it } from "vitest";
import { foldArabic, joinList } from "./locale";

describe("Arabic text helpers", () => {
  it("folds letters people type interchangeably", () => {
    expect(foldArabic("صورة")).toBe(foldArabic("صوره"));
    expect(foldArabic("إدراج")).toBe(foldArabic("ادراج"));
    expect(foldArabic("مستوى")).toBe(foldArabic("مستوي"));
    expect(foldArabic("عُنْوَان")).toBe("عنوان");
    expect(foldArabic("Image")).toBe("Image");
  });

  it("joins lists with a Latin comma until Arabic dates are on", () => {
    expect(joinList(["Mon", "Wed"])).toBe("Mon, Wed");
  });
});
