/**
 * Calendars in both directions, through the iCalendar format every calendar
 * app speaks:
 *
 * - In: the secret iCal address of a Google or Apple (iCloud) calendar is
 *   read every 30 minutes; its events show in the Worlds calendar.
 * - Out: Worlds keeps its own events and dated tasks as a feed at
 *   http://127.0.0.1:47321/calendar.ics?token=... for calendar apps on this
 *   computer, and as a .ics file to import anywhere.
 */
import { useEffect, useState } from "react";
import { api, isTauri } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { occurrences, today, addDays } from "./model";
import { download } from "../files/zip";
import { parseIcs, type ExternalEvent } from "./ics";

export { parseIcs, type ExternalEvent };

const SUBS_KEY = "calendar.subscriptions";
const CACHE_KEY = "calendar.external";

export interface Subscription {
  url: string;
  name: string;
}

export function subscriptions(): Subscription[] {
  const v = useStore.getState().settings[SUBS_KEY];
  return Array.isArray(v) ? (v as Subscription[]) : [];
}

let cache: ExternalEvent[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as ExternalEvent[];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

export async function refreshSubscriptions() {
  const all: ExternalEvent[] = [];
  for (const sub of subscriptions()) {
    try {
      const url = sub.url.replace(/^webcal:\/\//i, "https://");
      const text = isTauri ? await api.fetchArticle(url) : await (await fetch(url)).text();
      all.push(...parseIcs(text, sub.name));
    } catch {
      /* keep the last copy of a calendar that cannot be reached */
      all.push(...cache.filter((e) => e.calendar === sub.name));
    }
  }
  cache = all;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all.slice(0, 5000)));
  } catch {
    /* storage full: the events stay for this session */
  }
  listeners.forEach((f) => f());
}

/** Events from subscribed calendars between two ISO days. */
export function useExternalEvents(from: string, to: string): ExternalEvent[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return cache.filter((e) => e.date >= from && e.date <= to);
}

export function addSubscription(url: string, name: string) {
  const s = useStore.getState();
  s.setSetting(SUBS_KEY, [...subscriptions().filter((x) => x.url !== url), { url, name }]);
  setTimeout(refreshSubscriptions, 50);
}

export function removeSubscription(url: string) {
  const s = useStore.getState();
  const gone = subscriptions().find((x) => x.url === url);
  s.setSetting(SUBS_KEY, subscriptions().filter((x) => x.url !== url));
  cache = cache.filter((e) => e.calendar !== gone?.name);
  listeners.forEach((f) => f());
}

// ---- Out ------------------------------------------------------------------

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** Worlds events and dated tasks from a month back to six months ahead, as iCalendar. */
export function buildIcs(pages: Record<string, PageMeta>): string {
  const from = addDays(today(), -31);
  const to = addDays(today(), 183);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Worlds//Worlds 1.0//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Worlds"];
  for (const o of occurrences(pages, from, to, { includeDone: false })) {
    const d = o.date.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${o.key}@worlds`, `DTSTAMP:${stamp}`);
    if (o.start) {
      lines.push(`DTSTART:${d}T${o.start.replace(":", "")}00`);
      lines.push(`DTEND:${d}T${(o.end ?? o.start).replace(":", "")}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`);
    }
    lines.push(`SUMMARY:${icsText(pageTitle(o.page))}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function exportIcs() {
  download(`Worlds ${today()}.ics`, buildIcs(useStore.getState().pages), "text/calendar");
}

let feedTimer = 0;

/** Keep the local feed fresh and read subscriptions every 30 minutes. */
export function startCalendarSync() {
  if (feedTimer) return;
  const write = () => {
    try {
      useStore.getState().setSetting("calendar.ics", buildIcs(useStore.getState().pages));
    } catch {
      /* the next change writes it */
    }
  };
  let pending = 0;
  useStore.subscribe((s, prev) => {
    if (s.pages === prev.pages) return;
    window.clearTimeout(pending);
    pending = window.setTimeout(write, 5000);
  });
  window.setTimeout(write, 8000);
  feedTimer = window.setInterval(refreshSubscriptions, 30 * 60000);
  window.setTimeout(refreshSubscriptions, 6000);
}
