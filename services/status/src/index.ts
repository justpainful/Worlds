/**
 * status.enterworlds.space: checks every Worlds address every five minutes,
 * keeps 90 days of checks in D1, and draws the status page and its JSON.
 *
 * The site at the apex runs on a route, and a Worker cannot reach a route
 * Worker on its own zone through fetch, so the site is checked through the
 * SITE service binding. Every other address is a Custom Domain and is
 * fetched the way a visitor reaches it.
 */
import { bars, type Check, dayOf, DAYS, type DayRow, incidents, overall, probe, SERVICES, stateOf, uptime } from "./checks";
import { type Lang, type PageData, render } from "./page";

export interface Env {
  DB: D1Database;
  SITE?: Fetcher;
  ASSETS: Fetcher;
}

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'none'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export async function runChecks(env: Env, now = Math.floor(Date.now() / 1000)): Promise<Check[]> {
  const at = now - (now % 60);
  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      const fetcher = svc.id === "site" && env.SITE ? (req: Request) => env.SITE!.fetch(req) : (req: Request) => fetch(req);
      return { service: svc.id, at, ...(await probe(svc, fetcher)) };
    }),
  );
  const stmt = env.DB.prepare("INSERT INTO checks (service, at, ok, ms, code) VALUES (?, ?, ?, ?, ?)");
  const writes = results.map((r) => stmt.bind(r.service, r.at, r.ok, r.ms, r.code));
  // Keep 91 days; trim once an hour.
  if (new Date(now * 1000).getUTCMinutes() < 5) writes.push(env.DB.prepare("DELETE FROM checks WHERE at < ?").bind(now - (DAYS + 1) * 86400));
  await env.DB.batch(writes);
  return results;
}

export async function load(env: Env, now = Math.floor(Date.now() / 1000)): Promise<PageData> {
  const since = (dayOf(now) - DAYS + 1) * 86400 - 3 * 3600;
  const [latest, days, failed] = await env.DB.batch([
    env.DB.prepare(
      "SELECT service, at, ok, ms, code FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY service ORDER BY at DESC) AS rn FROM checks WHERE at >= ?) WHERE rn <= 2 ORDER BY service, at DESC",
    ).bind(now - 3 * 86400),
    env.DB.prepare("SELECT service, (at + 10800) / 86400 AS day, COUNT(*) AS n, SUM(ok) AS up FROM checks WHERE at >= ? GROUP BY service, day").bind(since),
    env.DB.prepare("SELECT service, at FROM checks WHERE ok = 0 AND at >= ?").bind(since),
  ]);
  const latestRows = latest.results as unknown as Check[];
  const dayRows = days.results as unknown as DayRow[];
  const lastAt: Record<string, number> = {};
  for (const r of latestRows) lastAt[r.service] = Math.max(lastAt[r.service] ?? 0, r.at);
  const today = dayOf(now);
  const services = SERVICES.map((svc) => {
    const mine = latestRows.filter((r) => r.service === svc.id);
    return { svc, state: stateOf(mine), ms: mine[0]?.ms ?? null, uptime: uptime(dayRows, svc.id), bars: bars(dayRows, svc.id, today) };
  });
  const times = Object.values(lastAt);
  return {
    overall: overall(services.map((s) => s.state)),
    lastAt: times.length ? Math.max(...times) : null,
    services,
    incidents: incidents(failed.results as unknown as { service: string; at: number }[], lastAt),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/api/status.json") {
      const data = await load(env);
      const body = {
        overall: data.overall,
        checkedAt: data.lastAt ? new Date(data.lastAt * 1000).toISOString() : null,
        services: data.services.map((s) => ({
          id: s.svc.id,
          name: { ar: s.svc.ar, en: s.svc.en },
          host: s.svc.host,
          state: s.state,
          ms: s.ms,
          uptime90: s.uptime,
          days: s.bars.map((b) => ({ day: new Date((b.day * 86400 - 10800 + 3600) * 1000).toISOString().slice(0, 10), checks: b.n, passed: b.up })),
        })),
        incidents: data.incidents.map((i) => ({ service: i.service, from: new Date(i.from * 1000).toISOString(), to: new Date(i.to * 1000).toISOString(), ongoing: i.ongoing })),
      };
      return Response.json(body, { headers: { ...SECURITY, "cache-control": "public, max-age=30", "access-control-allow-origin": "*" } });
    }
    const lang: Lang | null = url.pathname === "/" ? "ar" : url.pathname === "/en/" ? "en" : null;
    if (url.pathname === "/en") return Response.redirect(new URL("/en/", url).toString(), 301);
    if (!lang) return env.ASSETS.fetch(request);
    const html = render(await load(env), lang);
    return new Response(html, { headers: { ...SECURITY, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" } });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runChecks(env));
  },
} satisfies ExportedHandler<Env>;
