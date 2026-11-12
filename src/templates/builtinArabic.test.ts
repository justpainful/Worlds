import { describe, expect, it } from "vitest";
import { ARABIC_TEMPLATES, arabicTemplate, fillDate } from "./builtinArabic";

describe("Arabic built-in templates", () => {
  it("covers every general template the backend seeds, by its exact title", () => {
    const files = import.meta.glob("../../src-tauri/src/templates.rs", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const rust = Object.values(files)[0];
    const seeded = [...rust.matchAll(/title: "([^"\u2014]+)",/g)].map((m) => m[1]);
    for (const t of ARABIC_TEMPLATES) expect(seeded).toContain(t.en);
  });

  it("applies only to a template that was not renamed or edited", () => {
    const seeded = { title: "Meeting Notes", createdAt: 1_000, updatedAt: 1_800 };
    expect(arabicTemplate(seeded)?.title).toBe("ملاحظات اجتماع");
    expect(arabicTemplate({ ...seeded, updatedAt: 90_000 })).toBeNull();
    expect(arabicTemplate({ ...seeded, title: "Team sync" })).toBeNull();
  });

  it("fills the date the way the backend does", () => {
    expect(fillDate("تحديث أسبوعي {{date}}", new Date(2026, 10, 12))).toBe("تحديث أسبوعي 2026-11-12");
  });

  it("writes Arabic content without long dashes", () => {
    for (const t of ARABIC_TEMPLATES.filter((x) => x.markdown)) {
      expect(t.markdown).toMatch(/[\u0600-\u06FF]/);
      expect(t.markdown).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
