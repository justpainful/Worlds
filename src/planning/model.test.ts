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

  it("understands every example the Arabic hints show", () => {
    expect(parseQuickAdd("إرسال الفاتورة الجمعة 10 ص !!", NOW)).toMatchObject({ title: "إرسال الفاتورة", due: "2026-11-13", time: "10:00", priority: 2 });
    expect(parseQuickAdd("إنهاء مشروع التخرج بعد 3 أسابيع", NOW)).toMatchObject({ title: "إنهاء مشروع التخرج", due: "2026-12-02" });
    expect(parseQuickAdd("طباعة العقد نسختين بكرة", NOW)).toMatchObject({ title: "طباعة العقد نسختين", due: "2026-11-12" });
    expect(parseQuickAdd("تقرير المختبر الأحد", NOW)).toMatchObject({ title: "تقرير المختبر", due: "2026-11-15" });
    expect(parseQuickAdd("اختبار منتصف الفصل 24/11 8 ص", NOW)).toMatchObject({ title: "اختبار منتصف الفصل", due: "2026-11-24", time: "08:00" });
    expect(parseQuickAdd("الآلة الحاسبة غدًا", NOW)).toMatchObject({ title: "الآلة الحاسبة", due: "2026-11-12" });
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

describe("quick add on the day itself", () => {
  // Thursday 12 November 2026, 09:00 local.
  const THU = new Date(2026, 10, 12, 9, 0);

  it("reads today's weekday as today while its time is still ahead", () => {
    expect(parseQuickAdd("اجتماع الفريق الخميس الساعة 5 مساءً", THU)).toMatchObject({ title: "اجتماع الفريق", due: "2026-11-12", time: "17:00" });
    expect(parseQuickAdd("Standup thursday 8am", THU)).toMatchObject({ due: "2026-11-19", time: "08:00" });
    expect(parseQuickAdd("Gym thursday", THU)).toMatchObject({ title: "Gym", due: "2026-11-19" });
    expect(parseQuickAdd("Review next thursday", THU)).toMatchObject({ title: "Review", due: "2026-11-19" });
    expect(parseQuickAdd("اجتماع يوم الاثنين القادم", THU)).toMatchObject({ title: "اجتماع", due: "2026-11-16" });
    expect(parseQuickAdd("رحلة الخميس الجاي", THU)).toMatchObject({ title: "رحلة", due: "2026-11-19" });
  });

  it("understands Arabic digits, tanween and spoken day counts", () => {
    expect(parseQuickAdd("مذاكرة بكرة 8 صباحاً", THU)).toMatchObject({ title: "مذاكرة", due: "2026-11-13", time: "08:00" });
    expect(parseQuickAdd("اتصال بأحمد غداً ٥ م", THU)).toMatchObject({ title: "اتصال بأحمد", due: "2026-11-13", time: "17:00" });
    expect(parseQuickAdd("اتصال غدا الساعة ٥:٣٠ مساء", THU)).toMatchObject({ title: "اتصال", time: "17:30" });
    expect(parseQuickAdd("اختبار الرياضيات بعد يومين الساعة 10", THU)).toMatchObject({ title: "اختبار الرياضيات", due: "2026-11-14", time: "10:00" });
    expect(parseQuickAdd("مشروع بعد أسبوعين", THU)).toMatchObject({ title: "مشروع", due: "2026-11-26" });
    expect(parseQuickAdd("مراجعة بعد بكرة", THU)).toMatchObject({ title: "مراجعة", due: "2026-11-14" });
    expect(parseQuickAdd("غداء 1 ظهرا", THU)).toMatchObject({ title: "غداء", time: "13:00" });
    expect(parseQuickAdd("مذاكرة الليلة 9", THU)).toMatchObject({ title: "مذاكرة", due: "2026-11-12", time: "21:00" });
  });

  it("reads month names in both languages", () => {
    expect(parseQuickAdd("رحلة 15 نوفمبر", THU)).toMatchObject({ title: "رحلة", due: "2026-11-15" });
    expect(parseQuickAdd("طباعة نسختين 2 ورق 3 مارس", THU)).toMatchObject({ title: "طباعة نسختين 2 ورق", due: "2027-03-03" });
    expect(parseQuickAdd("Trip Nov 20", THU)).toMatchObject({ title: "Trip", due: "2026-11-20" });
    expect(parseQuickAdd("Exam 2 Jan 2027", THU)).toMatchObject({ title: "Exam", due: "2027-01-02" });
  });

  it("keeps ordinary numbers and phrases in the title", () => {
    expect(parseQuickAdd("Buy 3 apples", THU)).toEqual({ title: "Buy 3 apples", due: null, time: null, priority: 0 });
    expect(parseQuickAdd("الواجب ٣", THU)).toEqual({ title: "الواجب ٣", due: null, time: null, priority: 0 });
  });
});
