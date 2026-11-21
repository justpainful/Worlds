/**
 * Reminders on date properties. Each date property can ask to be reminded
 * at its time or some minutes before; while Worlds is open, a check every
 * 30 seconds shows the reminders that came due, as a system notification
 * where the system allows it and always as a toast with an Open button.
 */
import type { PageMeta } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { tr } from "../i18n/ui";
import { propsOf, type Property } from "./properties";

const FIRED_KEY = "reminders.fired";
const DEFAULT_TIME = "09:00";

/** When a date property's reminder is due, or null without one. */
export function reminderAt(p: Property): number | null {
  if (p.type !== "date" || p.remind == null || typeof p.value !== "string" || !p.value) return null;
  const day = p.value.slice(0, 10);
  const time = p.time && /^\d{2}:\d{2}$/.test(p.time) ? p.time : DEFAULT_TIME;
  const at = new Date(`${day}T${time}:00`);
  if (Number.isNaN(at.getTime())) return null;
  return at.getTime() - p.remind * 60000;
}

export interface DueReminder {
  page: PageMeta;
  prop: Property;
  at: number;
  key: string;
}

/** Reminders due between `from` (exclusive) and `to` (inclusive). */
export function dueReminders(pages: Record<string, PageMeta>, from: number, to: number): DueReminder[] {
  const out: DueReminder[] = [];
  for (const page of Object.values(pages)) {
    if (page.deletedAt || page.archived) continue;
    for (const prop of propsOf(page)) {
      const at = reminderAt(prop);
      if (at !== null && at > from && at <= to) out.push({ page, prop, at, key: `${page.id}:${prop.id}:${at}` });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Upcoming reminders, soonest first, for the Home widgets and the Inbox. */
export function upcomingReminders(pages: Record<string, PageMeta>, limit = 10): DueReminder[] {
  const now = Date.now();
  return dueReminders(pages, now, now + 60 * 86400000).slice(0, limit);
}

function describe(r: DueReminder): string {
  const when = new Date(`${String(r.prop.value).slice(0, 10)}T${r.prop.time ?? DEFAULT_TIME}:00`);
  const time = when.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return `${r.prop.name}: ${time}`;
}

function notify(r: DueReminder) {
  const s = useStore.getState();
  const title = pageTitle(r.page);
  s.toast({ message: `${tr("Reminder")}: ${title} · ${describe(r)}`, action: { label: tr("Open"), run: () => useStore.getState().openPage(r.page.id) } });
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title, { body: describe(r), tag: r.key });
      n.onclick = () => {
        window.focus();
        useStore.getState().openPage(r.page.id);
      };
    }
  } catch {
    /* the toast is enough */
  }
}

let timer = 0;
let last = 0;

/** Start checking for reminders. Safe to call more than once. */
export function startReminders() {
  if (timer) return;
  // Reminders that came due while Worlds was closed are shown once, if they are from the last day.
  last = Date.now() - 86400000;
  const tick = () => {
    const s = useStore.getState();
    const now = Date.now();
    const fired = new Set((s.settings[FIRED_KEY] as string[] | undefined) ?? []);
    const due = dueReminders(s.pages, last, now).filter((r) => !fired.has(r.key));
    last = now;
    if (!due.length) return;
    for (const r of due) notify(r);
    s.setSetting(FIRED_KEY, [...fired, ...due.map((r) => r.key)].slice(-300));
  };
  timer = window.setInterval(tick, 30000);
  window.setTimeout(tick, 4000);
}

/** Ask once for permission to show system notifications, when the first reminder is set. */
export function askForNotifications() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  } catch {
    /* not available here */
  }
}
