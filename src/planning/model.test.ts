import { describe, expect, it } from "vitest";
import { addMonths, eventOn, nextRepeat, occurrences, startOfWeek, tasksFor, type DataKind } from "./model";
import { parseQuickAdd } from "./quickAdd";
import { hiddenKindsFor, syncPackSettings } from "../packs/registry";
import type { PageMeta } from "../lib/types";

// Wednesday 11 November 2026, 10:00 local.
const NOW = new Date(2026, 10, 11, 10, 0);

let seq = 0;
function row(kind: DataKind | "page", data: unknown, extra: Partial<PageMeta> = {}): PageMeta {
  seq++;
  return {
    id: `p${seq}`, title: `${kind} ${seq}`, icon: null, cover: null, parentId: null, sortKey: seq, ownerId: null,
    kind: kind as PageMeta["kind"], templateCategory: null, pinned: false, pinOrder: null, favorite: false, archived: false,
    deletedAt: null, preview: "", createdAt: seq, updatedAt: seq, openedAt: null, data, ...extra,
  };
}
const map = (...rows: PageMeta[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("quick add", () => {
  it("takes dates, times and priority out of the title", () => {
    expect(parseQuickAdd("Call the bank tomorrow 4pm !!", NOW)).toEqual({ title: "Call the bank", due: "2026-11-12", time: "16:00", priority: 2 });
    expect(parseQuickAdd("Pay rent today", NOW)).toMatchObject({ title: "Pay rent", due: "2026-11-11", time: null });
    expect(parseQuickAdd("Standup at 9:30", NOW)).toMatchObject({ title: "Standup", due: "2026-11-12", time: "09:30" });
    expect(parseQuickAdd("Review deck sunday", NOW)).toMatchObject({ title: "Review deck", due: "2026-11-15" });
    expect(parseQuickAdd("Renew passport in 3 days !1", NOW)).toMatchObject({ title: "Renew passport", due: "2026-11-14", priority: 1 });
    expect(parseQuickAdd("Invoice 5/12", NOW)).toMatchObject({ title: "Invoice", due: "2026-12-05" });
  });

  it("understands Arabic", () => {
    expect(parseQuickAdd("أراجع العرض بكرة", NOW)).toMatchObject({ title: "أراجع العرض", due: "2026-11-12" });
    expect(parseQuickAdd("اجتماع الفريق الخميس الساعة 5 مساء", NOW)).toMatchObject({ title: "اجتماع الفريق", due: "2026-11-12", time: "17:00" });
    expect(parseQuickAdd("حل الواجب اليوم", NOW)).toMatchObject({ title: "حل الواجب", due: "2026-11-11" });
  });

  it("leaves ordinary words alone", () => {
    expect(parseQuickAdd("Read Monday Morning by Alex", NOW).title).toBe("Read Morning by Alex");
    expect(parseQuickAdd("Buy 3 apples", NOW)).toEqual({ title: "Buy 3 apples", due: null, time: null, priority: 0 });
  });
});

describe("dates and repeats", () => {
  it("adds months without overflowing short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(nextRepeat("2026-11-11", { every: 2, unit: "week" })).toBe("2026-11-25");
  });
  it("starts weeks on the chosen day", () => {
    expect(startOfWeek("2026-11-11", 0)).toBe("2026-11-08");
    expect(startOfWeek("2026-11-11", 6)).toBe("2026-11-07");
  });
  it("repeats weekly events until their end, skipping cancelled days", () => {
    const d = { date: "2026-09-06", weekly: [0, 2], until: "2026-12-31", skip: ["2026-11-15"] };
    expect(eventOn(d, "2026-11-10")).toBe(true);
    expect(eventOn(d, "2026-11-15")).toBe(false);
    expect(eventOn(d, "2026-11-11")).toBe(false);
    expect(eventOn(d, "2027-01-03")).toBe(false);
  });
});

describe("lists and calendar", () => {
  const overdue = row("task", { due: "2026-11-09" });
  const todayTask = row("task", { due: "2026-11-11", priority: 3 });
  const later = row("task", { due: "2026-11-20" });
  const someday = row("task", { someday: true });
  const done = row("task", { due: "2026-11-10", done: true, doneAt: 5 });
  const pages = map(overdue, todayTask, later, someday, done);

  it("sorts tasks into smart lists", () => {
    expect(tasksFor(pages, "today", "2026-11-11").map((p) => p.id)).toEqual([overdue.id, todayTask.id]);
    expect(tasksFor(pages, "upcoming", "2026-11-11").map((p) => p.id)).toEqual([later.id]);
    expect(tasksFor(pages, "someday", "2026-11-11").map((p) => p.id)).toEqual([someday.id]);
    expect(tasksFor(pages, "done", "2026-11-11").map((p) => p.id)).toEqual([done.id]);
  });

  it("keeps Study pack items out while the pack is off", () => {
    const subject = row("subject", { color: "green" });
    const exam = row("exam", { date: "2026-11-12" }, { parentId: subject.id });
    const cls = row("event", { date: "2026-09-06", start: "08:00", weekly: [4] }, { parentId: subject.id });
    const all = map(subject, exam, cls, todayTask);

    syncPackSettings({});
    expect(hiddenKindsFor({}).has("exam")).toBe(true);
    let occ = occurrences(all, "2026-11-11", "2026-11-12");
    expect(occ.map((o) => o.kind)).toEqual(["task", "event"]);
    // The class still shows (events are for everyone) but has no subject colour while Study is off.
    expect(occ[1].color).toBeNull();

    syncPackSettings({ "packs.enabled": ["study"] });
    occ = occurrences(all, "2026-11-11", "2026-11-12");
    expect(occ.map((o) => o.kind).sort()).toEqual(["event", "exam", "task"]);
    expect(occ.find((o) => o.kind === "event")?.color).toBe("green");
    syncPackSettings({});
  });
});
