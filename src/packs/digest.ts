/**
 * The automation every pack can switch on: once a day, what needs attention
 * (its alerts) lands in Inbox as one item, so a late invoice or an absence
 * the parent has not heard about is not missed when Worlds is not open on
 * that pack. Off until the person turns it on for a pack in Settings.
 */
import { tr } from "../i18n/ui";
import type { PageMeta } from "../lib/types";
import type { PackDef } from "./definition";
import { enabledPacks, PACK_DEFS } from "./registry";
import { alertItems, todayIso } from "./rules";

/** Pack ids whose daily summary is on. */
export const DIGEST_KEY = "packs.digest";
/** The day each pack's summary was last made, so it is made once a day. */
export const DIGEST_DAY_KEY = "packs.digestDay";

export function digestOn(settings: Record<string, unknown>): Set<string> {
  const v = settings[DIGEST_KEY];
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
}

/** "Late invoices (2) · Low stock (1)", in the interface language; empty when nothing needs attention. */
export function digestText(pages: Record<string, PageMeta>, pack: PackDef, today: string, t: (s: string) => string = tr): string {
  const parts = (pack.alerts ?? [])
    .map((a) => ({ label: t(a.label), n: alertItems(pages, pack, a, today).length }))
    .filter((a) => a.n > 0)
    .map((a) => `${a.label} (${a.n})`);
  return parts.length ? `${t(pack.label)}: ${parts.join(" · ")}` : "";
}

/** Which packs get a summary today, and its text. Pure, so it is tested without the app. */
export function dueDigests(
  pages: Record<string, PageMeta>,
  settings: Record<string, unknown>,
  today: string,
  t: (s: string) => string = tr,
): { pack: PackDef; title: string }[] {
  const on = enabledPacks(settings);
  const wanted = digestOn(settings);
  const done = (settings[DIGEST_DAY_KEY] ?? {}) as Record<string, string>;
  return PACK_DEFS.filter((p) => on.has(p.id) && wanted.has(p.id) && done[p.id] !== today)
    .map((pack) => ({ pack, title: digestText(pages, pack, today, t) }))
    .filter((d) => d.title);
}

/**
 * Make today's summaries. `create` adds the Inbox item; the day is recorded
 * only for packs whose item was made, so a failed write is tried again later.
 */
export async function runDigests(
  pages: Record<string, PageMeta>,
  settings: Record<string, unknown>,
  create: (title: string) => Promise<unknown>,
  setDone: (days: Record<string, string>) => void,
  today = todayIso(),
): Promise<number> {
  const due = dueDigests(pages, settings, today);
  if (!due.length) return 0;
  const days = { ...((settings[DIGEST_DAY_KEY] ?? {}) as Record<string, string>) };
  let made = 0;
  for (const d of due) {
    if (await create(d.title)) {
      days[d.pack.id] = today;
      made++;
    }
  }
  if (made) setDone(days);
  return made;
}
