import { describe, expect, it } from "vitest";
import { findArabicMistakes } from "./arabicRules";

const fixes = (text: string) => findArabicMistakes(text).map((m) => `${m.word}>${m.fix}`);

describe("Arabic spelling", () => {
  it("finds hamza, alif maqsura and taa marbuta mistakes", () => {
    expect(fixes("انا اذهب الى المدرسه فى الصباح")).toEqual(["انا>أنا", "الى>إلى", "المدرسه>المدرسة", "فى>في"]);
  });

  it("fixes joined phrases first", () => {
    expect(fixes("نلتقي غدا انشاء الله")).toEqual(["انشاء الله>إن شاء الله"]);
  });

  it("keeps prefixes on fixed words", () => {
    expect(fixes("وبالطريقه نفسها")).toEqual(["وبالطريقه>وبالطريقة"]);
  });

  it("leaves correct text and other languages alone", () => {
    expect(fixes("أنا أذهب إلى المدرسة في الصباح")).toEqual([]);
    expect(fixes("This is English text")).toEqual([]);
  });

  it("does not read a short word as a prefix plus a fix", () => {
    expect(fixes("واو")).toEqual([]);
  });
});
