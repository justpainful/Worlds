/**
 * Conditions, figures and alerts of a pack, worked out from its items' fields.
 * Pure: the same rules drive Home, the pack's views and the tests, with
 * today's date passed in so nothing depends on the clock by accident.
 */
import type { PageMeta } from "../lib/types";
import type { AlertDef, Condition, KindDef, PackDef, StatDef } from "./definition";
import { storedKind } from "./definition";
import type { ItemData } from "./fields";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dayOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysIso(iso: string, n: number): string {
  const d = dayOf(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

export function todayIso(now = new Date()): string {
  return isoOf(now);
}

/** Saturday starts the week, as in Saudi Arabia. */
function weekStart(iso: string): string {
  const d = dayOf(iso);
  return addDaysIso(iso, -((d.getDay() + 1) % 7));
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Whether one item's data passes a condition. */
export function matches(c: Condition, data: ItemData, today: string): boolean {
  const v = data[c.field];
  if (c.empty !== undefined && isEmpty(v) !== c.empty) return false;
  // A checkbox that was never ticked counts as false.
  const value = v === undefined && (c.in?.includes(false) || c.notIn?.includes(false)) ? false : v;
  if (c.in && !c.in.includes(value)) return false;
  if (c.notIn && c.notIn.includes(value)) return false;
  if (c.overdue !== undefined || c.within !== undefined || c.period) {
    if (typeof v !== "string" || !ISO.test(v)) return false;
    if (c.overdue !== undefined && v < today !== c.overdue) return false;
    if (c.within !== undefined && (v < today || v > addDaysIso(today, c.within))) return false;
    if (c.period === "month" && v.slice(0, 7) !== today.slice(0, 7)) return false;
    if (c.period === "week") {
      const start = weekStart(today);
      if (v < start || v > addDaysIso(start, 6)) return false;
    }
  }
  if (c.atMost !== undefined) {
    const limit = typeof c.atMost === "number" ? c.atMost : data[c.atMost];
    if (typeof v !== "number" || typeof limit !== "number" || v > limit) return false;
  }
  return true;
}

export function matchesAll(where: Condition[] | undefined, data: ItemData, today: string): boolean {
  return !where || where.every((c) => matches(c, data, today));
}

const dataOf = (p: PageMeta): ItemData => (p.data && typeof p.data === "object" && !Array.isArray(p.data) ? (p.data as ItemData) : {});
const live = (p: PageMeta) => !p.deletedAt && !p.archived;

/** Live items of a pack kind, by the kind's id inside the pack. */
export function packItems(pages: Record<string, PageMeta>, pack: PackDef, kindId: string): PageMeta[] {
  const kind = pack.kinds.find((k) => k.id === kindId);
  if (!kind) return [];
  const stored = storedKind(pack, kind);
  return Object.values(pages).filter((p) => p.kind === stored && live(p));
}

/** Items of a kind that pass every condition. */
export function filterItems(items: PageMeta[], where: Condition[] | undefined, today: string): PageMeta[] {
  if (!where?.length) return items;
  let list = items.filter((p) => matchesAll(where, dataOf(p), today));
  // Clashes compare items with each other, so they are worked out across the list.
  for (const c of where) {
    if (!c.clashesOn) continue;
    const fields = [c.field, ...c.clashesOn];
    const keyOf = (p: PageMeta) => {
      const d = dataOf(p);
      return fields.some((f) => isEmpty(d[f])) ? null : JSON.stringify(fields.map((f) => d[f]));
    };
    const seen = new Map<string, number>();
    for (const p of items) {
      const k = keyOf(p);
      if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    list = list.filter((p) => {
      const k = keyOf(p);
      return !!k && (seen.get(k) ?? 0) > 1;
    });
  }
  return list;
}

/** A field added up across items; non-numbers count as nothing. */
export function sumField(items: PageMeta[], field: string): number {
  let total = 0;
  for (const p of items) {
    const v = dataOf(p)[field];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return Math.round(total * 100) / 100;
}

/** The mean of a field over items that have a number in it; null when none do. */
export function averageField(items: PageMeta[], field: string): number | null {
  let total = 0;
  let n = 0;
  for (const p of items) {
    const v = dataOf(p)[field];
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      n++;
    }
  }
  return n ? Math.round((total / n) * 10) / 10 : null;
}

export function statValue(pages: Record<string, PageMeta>, pack: PackDef, stat: StatDef, today: string): number | null {
  const items = filterItems(packItems(pages, pack, stat.kind), stat.where, today);
  if (stat.agg === "sum" && stat.field) return sumField(items, stat.field);
  if (stat.agg === "average" && stat.field) return averageField(items, stat.field);
  return items.length;
}

export function alertItems(pages: Record<string, PageMeta>, pack: PackDef, alert: AlertDef, today: string): PageMeta[] {
  return filterItems(packItems(pages, pack, alert.kind), alert.where, today);
}

/** Dated items of the pack from today on, soonest first, skipping done ones. */
export function upcoming(pages: Record<string, PageMeta>, pack: PackDef, today: string, days = 14): { page: PageMeta; kind: KindDef; date: string }[] {
  const out: { page: PageMeta; kind: KindDef; date: string }[] = [];
  const last = addDaysIso(today, days);
  for (const kind of pack.kinds) {
    if (!kind.dateField) continue;
    for (const p of packItems(pages, pack, kind.id)) {
      const d = dataOf(p);
      const date = d[kind.dateField];
      if (typeof date !== "string" || !ISO.test(date) || date < today || date > last) continue;
      if (kind.doneField && d[kind.doneField] === true) continue;
      out.push({ page: p, kind, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
