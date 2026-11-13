import { describe, expect, it, vi } from "vitest";

vi.mock("../i18n/ui", () => ({ uiLanguage: () => "en" }));

import type { PageMeta } from "../lib/types";
import { FREELANCE } from "./definitions/freelance";
import { SHOP } from "./definitions/shop";
import { applyComputed, inSentence, nextSequence } from "./fields";
import { addDaysIso, alertItems, averageField, filterItems, matches, statValue, upcoming } from "./rules";
import { inLanguage, sampleData } from "./samples";

const TODAY = "2026-11-13"; // a Friday

function item(kind: string, data: Record<string, unknown>, id = Math.random().toString(36).slice(2)): PageMeta {
  return { id, kind, title: id, data } as unknown as PageMeta;
}

describe("pack rules", () => {
  it("tests values, dates and limits", () => {
    expect(matches({ field: "s", in: ["a"] }, { s: "a" }, TODAY)).toBe(true);
    expect(matches({ field: "s", notIn: ["a"] }, { s: "a" }, TODAY)).toBe(false);
    expect(matches({ field: "done", in: [false] }, {}, TODAY)).toBe(true);
    expect(matches({ field: "d", overdue: true }, { d: "2026-11-12" }, TODAY)).toBe(true);
    expect(matches({ field: "d", overdue: true }, { d: TODAY }, TODAY)).toBe(false);
    expect(matches({ field: "d", within: 0 }, { d: TODAY }, TODAY)).toBe(true);
    expect(matches({ field: "d", within: 3 }, { d: "2026-11-17" }, TODAY)).toBe(false);
    expect(matches({ field: "d", period: "month" }, { d: "2026-11-01" }, TODAY)).toBe(true);
    // The week runs Saturday to Friday.
    expect(matches({ field: "d", period: "week" }, { d: "2026-11-07" }, TODAY)).toBe(true);
    expect(matches({ field: "d", period: "week" }, { d: "2026-11-06" }, TODAY)).toBe(false);
    expect(matches({ field: "stock", atMost: "reorderAt" }, { stock: 3, reorderAt: 5 }, TODAY)).toBe(true);
    expect(matches({ field: "stock", atMost: "reorderAt" }, { stock: 9, reorderAt: 5 }, TODAY)).toBe(false);
    expect(matches({ field: "x", empty: true }, { x: "" }, TODAY)).toBe(true);
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("adds up what is owed and finds late invoices", () => {
    const pages: Record<string, PageMeta> = {};
    for (const p of [
      item("freelance.invoice", { total: 1150, status: "sent", due: "2026-11-01" }),
      item("freelance.invoice", { total: 2300, status: "late", due: "2026-11-20" }),
      item("freelance.invoice", { total: 500, status: "paid", due: "2026-10-01" }),
    ])
      pages[p.id] = p;
    const owed = FREELANCE.stats!.find((s) => s.label === "Owed to you")!;
    expect(statValue(pages, FREELANCE, owed, TODAY)).toBe(3450);
    const late = FREELANCE.alerts!.find((a) => a.label === "Late invoices")!;
    expect(alertItems(pages, FREELANCE, late, TODAY)).toHaveLength(1);
  });

  it("finds low stock and averages, and lists what is coming up", () => {
    const pages: Record<string, PageMeta> = {};
    for (const p of [
      item("shop.product", { stock: 2, reorderAt: 5 }),
      item("shop.product", { stock: 20, reorderAt: 5 }),
      item("shop.order", { date: "2026-11-15", status: "new" }),
      item("shop.order", { date: "2026-12-30", status: "new" }),
    ])
      pages[p.id] = p;
    expect(alertItems(pages, SHOP, SHOP.alerts![0], TODAY)).toHaveLength(1);
    expect(upcoming(pages, SHOP, TODAY).map((u) => u.date)).toEqual(["2026-11-15"]);
    expect(averageField([item("x", { n: 4 }), item("x", { n: 7 }), item("x", {})], "n")).toBe(5.5);
    expect(averageField([], "n")).toBeNull();
  });

  it("works out VAT and the total, and keeps a typed value until its source changes", () => {
    const invoice = FREELANCE.kinds.find((k) => k.id === "invoice")!;
    const made = applyComputed(invoice, { subtotal: 1000 });
    expect(made).toMatchObject({ vat: 150, total: 1150 });
    const typed = applyComputed(invoice, { ...made, total: 1200 }, ["total"]);
    expect(typed.total).toBe(1200);
    expect(applyComputed(invoice, { ...typed, subtotal: 2000 }, ["subtotal"])).toMatchObject({ vat: 300, total: 2300 });
  });

  it("finds double bookings", () => {
    const items = [
      item("salon.booking", { staff: "a", date: "2026-11-14", time: "10:00" }),
      item("salon.booking", { staff: "a", date: "2026-11-14", time: "10:00" }),
      item("salon.booking", { staff: "a", date: "2026-11-14", time: "11:00" }),
      item("salon.booking", { staff: "b", date: "2026-11-14", time: "10:00" }),
      item("salon.booking", { date: "2026-11-14", time: "10:00" }),
    ];
    expect(filterItems(items, [{ field: "staff", clashesOn: ["date", "time"] }], TODAY)).toHaveLength(2);
  });

  it("keeps abbreviations when a label goes inside a sentence", () => {
    expect(inSentence("Invoice")).toBe("invoice");
    expect(inSentence("API note")).toBe("API note");
    expect(inSentence("CV versions")).toBe("CV versions");
  });

  it("numbers a register from the highest number used", () => {
    expect(nextSequence("OUT-", ["OUT-0006", "OUT-0002", "IN-0009", null])).toBe("OUT-0007");
    expect(nextSequence("INV-", [])).toBe("INV-0001");
  });

  it("turns samples into data in one language, with links and dates from today", () => {
    const ids = new Map([["c1", "page-1"]]);
    const sample = FREELANCE.samples!.find((s) => s.kind === "quote")!;
    const data = sampleData(FREELANCE, sample, ids, TODAY, "ar");
    expect(data.validUntil).toBe("2026-11-15");
    expect(data.sent).toBe("2026-11-10");
    expect(inLanguage({ en: "Lead", ar: "محتمل" }, "ar")).toBe("محتمل");
    const client = FREELANCE.samples!.find((s) => s.ref === "c1")!;
    expect(sampleData(FREELANCE, client, ids, TODAY, "ar").company).toBe("استوديو نخلة");
  });
});
