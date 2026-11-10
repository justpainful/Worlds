/**
 * Planning model: tasks, events and captures for everyone, plus the Study
 * pack's dated kinds. Every item is a row in the pages table; its fields live
 * in `metadata.<kind>` and ride on the row as `PageMeta.data`, so these
 * selectors work from the page map without opening anything.
 *
 * Dates are local calendar days as "YYYY-MM-DD" and times as "HH:MM", never
 * instants: a class at 08:00 on Sunday is at 08:00 on Sunday wherever the
 * laptop is.
 */
import type { PageMeta } from "../lib/types";
import { isKindHidden } from "../packs/registry";
import type { PropColor } from "../pages/properties";

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

export type Priority = 0 | 1 | 2 | 3;

export interface Step {
  id: string;
  text: string;
  done: boolean;
}

export interface Repeat {
  every: number;
  unit: "day" | "week" | "month";
}

export interface TaskData {
  due?: string | null;
  time?: string | null;
  priority?: Priority;
  done?: boolean;
  doneAt?: number | null;
  someday?: boolean;
  repeat?: Repeat | null;
  steps?: Step[];
  notes?: string;
}

export interface EventData {
  date?: string | null;
  start?: string | null;
  end?: string | null;
  allDay?: boolean;
  location?: string;
  notes?: string;
  /** Days of the week it repeats on (0 = Sunday). Absent for a one-off. */
  weekly?: number[] | null;
  /** Last day a repeating event happens (inclusive). */
  until?: string | null;
  /** Days a repeating event does not happen (holidays, a cancelled class). */
  skip?: string[];
}

export interface SubjectBook {
  id: string;
  title: string;
  kind: "textbook" | "solutions" | "notes";
  totalPages: number;
  currentPage: number;
  filePageId?: string | null;
}

export interface SubjectLink {
  id: string;
  title: string;
  url: string;
}

export interface SubjectData {
  teacher?: string;
  room?: string;
  code?: string;
  color?: PropColor;
  term?: string;
  archived?: boolean;
  books?: SubjectBook[];
  links?: SubjectLink[];
}

export interface LessonData {
  unit?: string;
  number?: number | null;
  taughtOn?: string | null;
}

export interface AssignmentData {
  due?: string | null;
  time?: string | null;
  assigned?: string | null;
  teacher?: string;
  points?: number | null;
  earned?: number | null;
  instructions?: string;
  submitted?: boolean;
  submittedAt?: number | null;
}

export interface ExamData {
  date?: string | null;
  time?: string | null;
  scope?: string;
  maxScore?: number | null;
  score?: number | null;
  location?: string;
}

export interface RequirementData {
  due?: string | null;
  action?: string;
  ready?: boolean;
  print?: boolean;
  copies?: number;
  colorMode?: "bw" | "color";
  doubleSided?: boolean;
  pagesRange?: string;
}

export interface GoalData {
  detail?: string;
  target?: string | null;
  steps?: Step[];
  /** Manual progress 0..1, used when there are no steps. */
  progress?: number;
}

export interface DataByKind {
  task: TaskData;
  event: EventData;
  inbox: Record<string, never>;
  goal: GoalData;
  subject: SubjectData;
  lesson: LessonData;
  assignment: AssignmentData;
  exam: ExamData;
  requirement: RequirementData;
}

export type DataKind = keyof DataByKind;

export const DATA_KINDS: DataKind[] = ["task", "event", "inbox", "goal", "subject", "lesson", "assignment", "exam", "requirement"];

export function isDataKind(kind: string): kind is DataKind {
  return (DATA_KINDS as string[]).includes(kind);
}

/** The kind-specific data of a row, typed by its kind. */
export function dataOf<K extends DataKind>(p: PageMeta | undefined | null, _kind?: K): DataByKind[K] {
  const d = p?.data;
  return (d && typeof d === "object" ? d : {}) as DataByKind[K];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseISODate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // Jan 31 + 1 month is the last day of February, not March 3.
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
}

export function today(now: Date = new Date()): string {
  return toISODate(now);
}

export function weekday(s: string): number {
  return parseISODate(s).getDay();
}

/** The first day of the week containing `s`, for a week starting on `weekStart` (0 = Sunday). */
export function startOfWeek(s: string, weekStart = 0): string {
  const back = (weekday(s) - weekStart + 7) % 7;
  return addDays(s, -back);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** "Today", "Tomorrow", "Yesterday", a weekday within the week, or a short date. */
export function relDay(s: string, now: Date = new Date()): string {
  const diff = daysBetween(today(now), s);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = parseISODate(s);
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const d = new Date(2000, 0, 1, h || 0, m || 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function nextRepeat(due: string, r: Repeat): string {
  const n = Math.max(1, Math.round(r.every || 1));
  if (r.unit === "month") return addMonths(due, n);
  return addDays(due, r.unit === "week" ? 7 * n : n);
}

export function describeRepeat(r: Repeat | null | undefined): string {
  if (!r) return "";
  const n = Math.max(1, Math.round(r.every || 1));
  if (n === 1) return r.unit === "day" ? "Daily" : r.unit === "week" ? "Weekly" : "Monthly";
  return `Every ${n} ${r.unit}s`;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const live = (p: PageMeta) => !p.deletedAt && !p.archived && !isKindHidden(p.kind);

export function liveOfKind(pages: Record<string, PageMeta>, kind: DataKind): PageMeta[] {
  return Object.values(pages).filter((p) => p.kind === kind && live(p));
}

export function isTaskDone(p: PageMeta): boolean {
  return !!dataOf(p, "task").done;
}

/** Overdue or due today, not done. */
export function isDueNow(d: TaskData, now: string): boolean {
  return !d.done && !d.someday && isISODate(d.due) && d.due <= now;
}

export function taskSort(a: PageMeta, b: PageMeta): number {
  const da = dataOf(a, "task"), db = dataOf(b, "task");
  const dueA = da.due ?? "9999-99-99", dueB = db.due ?? "9999-99-99";
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  const ta = da.time ?? "99:99", tb = db.time ?? "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  const pa = da.priority ?? 0, pb = db.priority ?? 0;
  if (pa !== pb) return pb - pa;
  return a.createdAt - b.createdAt;
}

export type TaskList = "today" | "upcoming" | "all" | "someday" | "done" | "goals" | "print";

export function tasksFor(pages: Record<string, PageMeta>, list: TaskList, now: string = today()): PageMeta[] {
  const all = liveOfKind(pages, "task");
  const pick = (f: (d: TaskData) => boolean) => all.filter((p) => f(dataOf(p, "task")));
  switch (list) {
    case "today":
      return pick((d) => isDueNow(d, now)).sort(taskSort);
    case "upcoming":
      return pick((d) => !d.done && !d.someday && isISODate(d.due) && d.due > now).sort(taskSort);
    case "someday":
      return pick((d) => !d.done && !!d.someday).sort((a, b) => a.createdAt - b.createdAt);
    case "done":
      return pick((d) => !!d.done).sort((a, b) => (dataOf(b, "task").doneAt ?? 0) - (dataOf(a, "task").doneAt ?? 0));
    case "all":
    default:
      return pick((d) => !d.done && !d.someday).sort(taskSort);
  }
}

export function stepProgress(steps: Step[] | undefined): { done: number; total: number } {
  const list = steps ?? [];
  return { done: list.filter((s) => s.done).length, total: list.length };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface Occurrence {
  /** Unique per occurrence: page id plus the day for repeating events. */
  key: string;
  page: PageMeta;
  kind: DataKind;
  date: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  done: boolean;
  /** A subject's colour when the item belongs to one. */
  color: PropColor | null;
}

/** Whether a (possibly repeating) event happens on `day`. */
export function eventOn(d: EventData, day: string): boolean {
  if (!isISODate(d.date)) return false;
  if (d.weekly && d.weekly.length) {
    if (day < d.date) return false;
    if (isISODate(d.until) && day > d.until) return false;
    if (d.skip?.includes(day)) return false;
    return d.weekly.includes(weekday(day));
  }
  return d.date === day;
}

/** The subject a row belongs to (its nearest subject ancestor), if the Study pack is on. */
export function subjectOf(pages: Record<string, PageMeta>, p: PageMeta | undefined): PageMeta | null {
  let cur = p?.parentId ? pages[p.parentId] : undefined;
  for (let i = 0; cur && i < 16; i++) {
    if (cur.kind === "subject") return isKindHidden("subject") || cur.deletedAt ? null : cur;
    cur = cur.parentId ? pages[cur.parentId] : undefined;
  }
  return null;
}

/** Everything dated between `from` and `to` (inclusive), in day and time order. */
export function occurrences(pages: Record<string, PageMeta>, from: string, to: string, opts: { includeDone?: boolean } = {}): Occurrence[] {
  const out: Occurrence[] = [];
  const colorOf = (p: PageMeta) => {
    if (p.kind === "subject") return dataOf(p, "subject").color ?? null;
    const s = subjectOf(pages, p);
    return s ? (dataOf(s, "subject").color ?? null) : null;
  };
  const push = (p: PageMeta, kind: DataKind, date: string, start: string | null, end: string | null, allDay: boolean, done: boolean) => {
    if (date < from || date > to) return;
    if (done && !opts.includeDone) return;
    out.push({ key: `${p.id}:${date}`, page: p, kind, date, start, end, allDay, done, color: colorOf(p) });
  };
  for (const p of Object.values(pages)) {
    if (!live(p)) continue;
    switch (p.kind) {
      case "task": {
        const d = dataOf(p, "task");
        if (isISODate(d.due) && !d.someday) push(p, "task", d.due, d.time ?? null, null, !d.time, !!d.done);
        break;
      }
      case "event": {
        const d = dataOf(p, "event");
        if (!isISODate(d.date)) break;
        if (d.weekly && d.weekly.length) {
          const span = Math.min(daysBetween(from, to), 400);
          for (let i = 0; i <= span; i++) {
            const day = addDays(from, i);
            if (eventOn(d, day)) push(p, "event", day, d.start ?? null, d.end ?? null, !!d.allDay || !d.start, false);
          }
        } else push(p, "event", d.date, d.start ?? null, d.end ?? null, !!d.allDay || !d.start, false);
        break;
      }
      case "assignment": {
        const d = dataOf(p, "assignment");
        if (isISODate(d.due)) push(p, "assignment", d.due, d.time ?? null, null, !d.time, !!d.submitted);
        break;
      }
      case "exam": {
        const d = dataOf(p, "exam");
        if (isISODate(d.date)) push(p, "exam", d.date, d.time ?? null, null, !d.time, false);
        break;
      }
      case "requirement": {
        const d = dataOf(p, "requirement");
        if (isISODate(d.due)) push(p, "requirement", d.due, null, null, true, !!d.ready);
        break;
      }
    }
  }
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.start ?? "") < (b.start ?? "") ? -1 : (a.start ?? "") > (b.start ?? "") ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Study
// ---------------------------------------------------------------------------

/** Assignments, exams and things to bring that are still open, soonest first. */
export function openStudyWork(pages: Record<string, PageMeta>, now: string = today(), horizonDays = 14): Occurrence[] {
  return occurrences(pages, addDays(now, -60), addDays(now, horizonDays)).filter(
    (o) => (o.kind === "assignment" || o.kind === "exam" || o.kind === "requirement") && (o.kind === "exam" ? o.date >= now : true),
  );
}

export function subjects(pages: Record<string, PageMeta>): PageMeta[] {
  return liveOfKind(pages, "subject").sort((a, b) => a.sortKey - b.sortKey || a.createdAt - b.createdAt);
}

/** Direct children of a subject, of one kind. */
export function inSubject(pages: Record<string, PageMeta>, subjectId: string, kind: DataKind): PageMeta[] {
  return Object.values(pages).filter((p) => p.parentId === subjectId && p.kind === kind && live(p));
}

export function goalFraction(d: GoalData): number {
  const sp = stepProgress(d.steps);
  if (sp.total > 0) return sp.done / sp.total;
  return Math.max(0, Math.min(1, d.progress ?? 0));
}

export function goalsFor(pages: Record<string, PageMeta>): PageMeta[] {
  return liveOfKind(pages, "goal").sort((a, b) => {
    const da = dataOf(a, "goal"), db = dataOf(b, "goal");
    return (da.target ?? "9999-99-99").localeCompare(db.target ?? "9999-99-99") || a.createdAt - b.createdAt;
  });
}

export function printQueueFor(pages: Record<string, PageMeta>): PageMeta[] {
  return liveOfKind(pages, "requirement")
    .filter((p) => dataOf(p, "requirement").print)
    .sort((a, b) => {
      const ra = !!dataOf(a, "requirement").ready;
      const rb = !!dataOf(b, "requirement").ready;
      if (ra !== rb) return ra ? 1 : -1;
      return (dataOf(a, "requirement").due ?? "9999-99-99").localeCompare(dataOf(b, "requirement").due ?? "9999-99-99");
    });
}

export function detectLinkProvider(url: string): { label: string; icon: string } {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return { label: "YouTube", icon: "▶️" };
  if (u.includes("t.me") || u.includes("telegram.")) return { label: "Telegram", icon: "✈️" };
  if (u.includes("classroom.google.com")) return { label: "Classroom", icon: "🏫" };
  if (u.includes("drive.google.com") || u.includes("docs.google.com")) return { label: "Google Drive", icon: "📁" };
  if (u.includes("madrasati.sa") || u.includes("schools.madrasati")) return { label: "منصة مدرستي", icon: "🇸🇦" };
  if (u.includes("github.com")) return { label: "GitHub", icon: "🐙" };
  if (u.includes("zoom.us") || u.includes("teams.microsoft.com") || u.includes("meet.google.com")) return { label: "Meeting", icon: "🎥" };
  return { label: "Link", icon: "🔗" };
}
