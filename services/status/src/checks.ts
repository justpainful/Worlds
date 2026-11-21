/**
 * What status.enterworlds.space watches, how each address is checked, and how
 * the stored checks turn into a state, daily bars and incidents. Pure apart
 * from `probe`, so the rules are tested in Node.
 */

export type Group = "app" | "sites";

export interface Service {
  id: string;
  ar: string;
  en: string;
  host: string;
  url: string;
  group: Group;
  /** How an answer counts as working. */
  expect: "page" | "json-ok" | "redirect";
}

export const SERVICES: Service[] = [
  { id: "app", ar: "Worlds على الويب", en: "Worlds on the web", host: "app.enterworlds.space", url: "https://app.enterworlds.space/", group: "app", expect: "page" },
  { id: "login", ar: "الحسابات وتسجيل الدخول", en: "Accounts and sign-in", host: "login.enterworlds.space", url: "https://login.enterworlds.space/", group: "app", expect: "json-ok" },
  { id: "connect", ar: "المزامنة والتعاون", en: "Sync and collaboration", host: "connect.enterworlds.space", url: "https://connect.enterworlds.space/health", group: "app", expect: "json-ok" },
  { id: "profile", ar: "الملفات العامة والصفحات المنشورة", en: "Public profiles and published pages", host: "profile.enterworlds.space", url: "https://profile.enterworlds.space/", group: "app", expect: "page" },
  { id: "site", ar: "الموقع", en: "Website", host: "enterworlds.space", url: "https://enterworlds.space/", group: "sites", expect: "page" },
  { id: "demo", ar: "النسخة التجريبية", en: "Demo", host: "demo.enterworlds.space", url: "https://demo.enterworlds.space/", group: "sites", expect: "page" },
  { id: "changelog", ar: "سجل التحديثات", en: "Changelog", host: "changelog.enterworlds.space", url: "https://changelog.enterworlds.space/", group: "sites", expect: "page" },
  { id: "downloads", ar: "التنزيلات", en: "Downloads", host: "github.com/justpainful/Worlds/releases", url: "https://github.com/justpainful/Worlds/releases/latest", group: "sites", expect: "redirect" },
];

/** A check slower than this still works, but shows as slow. */
export const SLOW_MS = 2500;
export const TIMEOUT_MS = 10_000;
export const DAYS = 90;
/** Checks run every five minutes; two failures in a row are an outage. */
export const INTERVAL_S = 300;
/** Days are counted in Riyadh time (UTC+3, no daylight saving). */
export const DAY_OFFSET_S = 3 * 3600;

export interface Check {
  service: string;
  at: number;
  ok: number;
  ms: number;
  code: number;
}

export type State = "up" | "slow" | "degraded" | "down" | "unknown";

export async function probe(svc: Service, fetcher: (req: Request) => Promise<Response> = fetch): Promise<Omit<Check, "service" | "at">> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(
      new Request(svc.url, {
        method: svc.expect === "redirect" ? "HEAD" : "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "worlds-status (+https://status.enterworlds.space)", accept: svc.expect === "json-ok" ? "application/json" : "text/html" },
      }),
    );
    let ok = false;
    if (svc.expect === "redirect") ok = res.status === 302 || res.status === 301 || res.status === 200;
    else if (svc.expect === "json-ok") ok = res.status === 200 && (await res.json().catch(() => null) as { ok?: boolean } | null)?.ok === true;
    else ok = res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/html");
    if (svc.expect !== "json-ok") await res.body?.cancel();
    return { ok: ok ? 1 : 0, ms: Date.now() - started, code: res.status };
  } catch {
    return { ok: 0, ms: Date.now() - started, code: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** The state from a service's latest checks, newest first. */
export function stateOf(latest: Check[]): State {
  const [last, prev] = latest;
  if (!last) return "unknown";
  if (last.ok) return last.ms > SLOW_MS ? "slow" : "up";
  return prev && !prev.ok ? "down" : "degraded";
}

export function overall(states: State[]): State {
  if (states.includes("down")) return "down";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("slow")) return "slow";
  if (states.every((s) => s === "unknown")) return "unknown";
  return "up";
}

export const dayOf = (at: number) => Math.floor((at + DAY_OFFSET_S) / 86400);

export interface DayRow { service: string; day: number; n: number; up: number }
export interface Bar { day: number; n: number; up: number; level: "none" | "full" | "partial" | "bad" }

/** One bar per day for the last DAYS days, oldest first. */
export function bars(rows: DayRow[], service: string, today: number): Bar[] {
  const by = new Map(rows.filter((r) => r.service === service).map((r) => [r.day, r]));
  return Array.from({ length: DAYS }, (_, i) => {
    const day = today - (DAYS - 1 - i);
    const r = by.get(day);
    if (!r || !r.n) return { day, n: 0, up: 0, level: "none" as const };
    const share = r.up / r.n;
    return { day, n: r.n, up: r.up, level: share >= 0.995 ? "full" : share >= 0.95 ? "partial" : "bad" };
  });
}

export function uptime(rows: DayRow[], service: string): number | null {
  let n = 0;
  let up = 0;
  for (const r of rows) if (r.service === service) { n += r.n; up += r.up; }
  return n ? up / n : null;
}

export interface Incident { service: string; from: number; to: number; ongoing: boolean; checks: number }

/**
 * Outages from failed checks: failures no more than one missed check apart are
 * one incident, and an incident needs two failed checks in a row.
 */
export function incidents(failed: { service: string; at: number }[], lastAt: Record<string, number>): Incident[] {
  const out: Incident[] = [];
  const sorted = [...failed].sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : a.at - b.at));
  let cur: Incident | null = null;
  for (const f of sorted) {
    if (cur && cur.service === f.service && f.at - cur.to <= INTERVAL_S + 120) {
      cur.to = f.at;
      cur.checks++;
      continue;
    }
    if (cur && cur.checks >= 2) out.push(cur);
    cur = { service: f.service, from: f.at, to: f.at, ongoing: false, checks: 1 };
  }
  if (cur && cur.checks >= 2) out.push(cur);
  for (const i of out) i.ongoing = lastAt[i.service] === i.to;
  return out.sort((a, b) => b.from - a.from);
}
