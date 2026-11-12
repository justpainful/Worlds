import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARABIC_TEMPLATES, arabicTemplate, fillDate } from "./builtinArabic";

describe("Arabic built-in templates", () => {
  it("covers every general template the backend seeds, by its exact title", () => {
    const rust = fs.readFileSync(path.resolve(__dirname, "../../src-tauri/src/templates.rs"), "utf8");
    const seeded = [...rust.matchAll(/title: "([^"—]+)",/g)].map((m) => m[1]);
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

  it("writes Arabic content with the same structure as the English", () => {
    for (const t of ARABIC_TEMPLATES.filter((x) => x.markdown)) {
      expect(t.markdown).toMatch(/[؀-ۿ]/);
      expect(t.markdown).not.toMatch(/[–—]/);
    }
  });
});
