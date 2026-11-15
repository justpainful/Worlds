import { describe, expect, it, vi } from "vitest";

vi.mock("../i18n/ui", () => ({ tr: (s: string) => s, uiLanguage: () => "en" }));

import type { PageMeta } from "../lib/types";
import { DIGEST_DAY_KEY, DIGEST_KEY, digestText, dueDigests, runDigests } from "./digest";
import { FREELANCE } from "./definitions/freelance";
import { PACKS_KEY } from "./registry";

const TODAY = "2026-11-13";
const page = (id: string, kind: string, data: Record<string, unknown>) => ({ id, kind, title: id, data }) as unknown as PageMeta;
const pages: Record<string, PageMeta> = {
  a: page("a", "freelance.invoice", { status: "sent", due: "2026-11-01", total: 100 }),
  b: page("b", "freelance.invoice", { status: "late", due: "2026-11-02", total: 100 }),
  c: page("c", "freelance.hours", { billed: false, hours: 2 }),
};

describe("daily pack summary", () => {
  it("lists only alerts that have items", () => {
    expect(digestText(pages, FREELANCE, TODAY)).toBe("Freelance: Late invoices (2) · Hours not billed (1)");
    expect(digestText({}, FREELANCE, TODAY)).toBe("");
  });

  it("is made only for packs that are on, switched on, and not yet done today", () => {
    const base = { [PACKS_KEY]: ["freelance"], [DIGEST_KEY]: ["freelance"] };
    expect(dueDigests(pages, base, TODAY).map((d) => d.pack.id)).toEqual(["freelance"]);
    expect(dueDigests(pages, { ...base, [DIGEST_DAY_KEY]: { freelance: TODAY } }, TODAY)).toEqual([]);
    expect(dueDigests(pages, { [PACKS_KEY]: ["freelance"] }, TODAY)).toEqual([]);
    expect(dueDigests(pages, { [DIGEST_KEY]: ["freelance"] }, TODAY)).toEqual([]);
  });

  it("records the day only after the Inbox item was made", async () => {
    const settings = { [PACKS_KEY]: ["freelance"], [DIGEST_KEY]: ["freelance"] };
    let saved: Record<string, string> | null = null;
    expect(await runDigests(pages, settings, async () => null, (d) => (saved = d), TODAY)).toBe(0);
    expect(saved).toBeNull();
    const made: string[] = [];
    expect(await runDigests(pages, settings, async (t) => made.push(t), (d) => (saved = d), TODAY)).toBe(1);
    expect(made).toHaveLength(1);
    expect(saved).toEqual({ freelance: TODAY });
  });
});
