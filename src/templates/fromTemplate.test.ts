import { describe, expect, it } from "vitest";
import type { PageMeta } from "../lib/types";
import { templateName } from "./templateNames";

const page = (title: string) => ({ title, createdAt: 0, updatedAt: 0 }) as PageMeta;

describe("template names", () => {
  it("drops the date placeholder", () => {
    expect(templateName(page("Weekly Update {{date}}"))).toBe("Weekly Update");
  });

  it("shows the English side of a bilingual name in the English interface", () => {
    const dash = String.fromCharCode(0x2014);
    expect(templateName(page(`Radial Mind Map ${dash} خريطة ذهنية متفرعة`))).toBe("Radial Mind Map");
    expect(templateName(page("My own map"))).toBe("My own map");
  });
});
