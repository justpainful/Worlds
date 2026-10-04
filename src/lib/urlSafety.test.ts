import { describe, expect, it } from "vitest";
import { isRunnable, isSafeUrl, normalizeUrl } from "./urlSafety";

describe("isSafeUrl", () => {
  it("allows web, mail and Discord links", () => {
    for (const u of ["https://example.com", "http://a.b/c?d", "mailto:me@example.com", "discord://discord.com/channels/1/2"]) {
      expect(isSafeUrl(u)).toBe(true);
    }
  });
  it("refuses links that could run or read local things", () => {
    for (const u of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-settings:", "C:\\evil.exe", "vbscript:x", "data:text/html,hi", ""]) {
      expect(isSafeUrl(u)).toBe(false);
    }
  });
  it("turns a bare domain into https", () => {
    expect(normalizeUrl(" example.com/x ")).toBe("https://example.com/x");
    expect(normalizeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
  });
});

describe("isRunnable", () => {
  it("flags programs and scripts", () => {
    for (const f of ["setup.exe", "run.BAT", "x.ps1", "a.lnk", "b.vbs", "c.msi", "d.scr", "e.hta"]) expect(isRunnable(f)).toBe(true);
  });
  it("lets documents and media open", () => {
    for (const f of ["notes.pdf", "photo.JPG", "clip.mp4", "sheet.xlsx", "exe.txt"]) expect(isRunnable(f)).toBe(false);
  });
});
