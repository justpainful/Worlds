/**
 * The three date helpers quick add needs from src/planning/model.ts, for the
 * site bundle only: model.ts also loads every sector pack, which the front
 * page does not need. Same code as there (keep them in step).
 */
export type Priority = 0 | 1 | 2 | 3;
const pad = (n: number) => String(n).padStart(2, "0");
const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISODate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
export function today(now: Date = new Date()): string {
  return toISODate(now);
}
export function weekday(s: string): number {
  return parseISODate(s).getDay();
}
