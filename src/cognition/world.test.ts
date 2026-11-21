import { describe, expect, it } from "vitest";
import { blob, buildWorld, seeded, type WorldPage } from "./world";

const NOW = Date.UTC(2026, 10, 21);
const page = (id: string, parentId: string | null, extra: Partial<WorldPage> = {}): WorldPage => ({ id, title: id, parentId, kind: "page", size: 100, touched: NOW, ...extra });

describe("world", () => {
  const pages = [page("bio", null), page("cells", "bio"), page("plants", "bio"), page("math", null), page("fractions", "math", { touched: NOW - 60 * 86_400_000 }), page("solo", null)];

  it("makes one island per top-level page with its pages as houses", () => {
    const w = buildWorld({ pages, links: [], sparks: [], questions: {}, mastery: {}, stars: 0, now: NOW });
    expect(w.islands.map((i) => i.id).sort()).toEqual(["bio", "math", "solo"]);
    expect(w.islands.find((i) => i.id === "bio")!.houses).toHaveLength(3);
  });

  it("keeps islands apart", () => {
    const w = buildWorld({ pages, links: [], sparks: [], questions: {}, mastery: {}, stars: 0, now: NOW });
    for (const a of w.islands) for (const b of w.islands) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r);
  });

  it("joins islands with bridges, marks sparks, fog, towers and overgrowth", () => {
    const w = buildWorld({
      pages,
      links: [["cells", "fractions"], ["plants", "fractions"], ["cells", "plants"]],
      sparks: [["solo", "bio"]],
      questions: { cells: 2 },
      mastery: { plants: 0.8, cells: 0.2 },
      stars: 5,
      now: NOW,
    });
    expect(w.bridges).toHaveLength(2);
    expect(w.bridges.find((b) => b.spark)).toBeTruthy();
    expect(w.bridges.find((b) => !b.spark)!.weight).toBe(2);
    expect(w.islands.find((i) => i.id === "bio")!.fog).toBe(2);
    const houses = w.islands.flatMap((i) => i.houses);
    expect(houses.find((h) => h.id === "plants")!.tower).toBe(true);
    expect(houses.find((h) => h.id === "cells")!.tower).toBe(false);
    expect(houses.find((h) => h.id === "fractions")!.overgrown).toBe(true);
    expect(w.stars).toHaveLength(5);
  });

  it("draws the same world for the same data", () => {
    const a = buildWorld({ pages, links: [], sparks: [], questions: {}, mastery: {}, stars: 3, now: NOW });
    const b = buildWorld({ pages, links: [], sparks: [], questions: {}, mastery: {}, stars: 3, now: NOW });
    expect(a).toEqual(b);
    expect(blob(0, 0, 10, seeded("x"))).toBe(blob(0, 0, 10, seeded("x")));
  });
});
