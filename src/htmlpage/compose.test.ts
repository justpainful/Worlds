import { describe, expect, it } from "vitest";
import { composeHtmlPage, starterHtml } from "./compose";

describe("HTML page documents", () => {
  it("wraps a fragment with the base first and the app's language", () => {
    const doc = composeHtmlPage("<p>مرحبا</p>", null, "ar");
    expect(doc.startsWith('<!doctype html><html lang="ar" dir="rtl"><head>')).toBe(true);
    expect(doc.indexOf("data-worlds-base")).toBeLessThan(doc.indexOf("<p>مرحبا</p>"));
    expect(doc).toContain("window.worlds");
  });

  it("puts the base before the page's own head and keeps its language", () => {
    const doc = composeHtmlPage('<html lang="en"><head><title>T</title></head><body></body></html>', { n: 1 }, "ar");
    expect(doc).toContain('<html lang="en">');
    expect(doc.indexOf("data-worlds-base")).toBeLessThan(doc.indexOf("<title>"));
    expect(doc).toContain('"state":{"n":1}');
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });

  it("never lets saved state close the boot script", () => {
    const doc = composeHtmlPage("<p>x</p>", "</script><script>alert(1)</script>", "en");
    expect(doc).not.toContain("</script><script>alert(1)");
  });

  it("starts a new page in the person's language with the building blocks", () => {
    expect(starterHtml("ar")).toContain("w-stat");
    expect(starterHtml("ar")).toContain("أسبوعي");
    expect(starterHtml("en")).toContain("worlds.save");
  });
});
