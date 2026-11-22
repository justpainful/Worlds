/**
 * GET /config: what the app and the web need to know about the service right
 * now, read at start and every few minutes (docs/admin/PLAN.md, phase 6).
 *
 *   ?platform=windows&version=1.0.1&lang=ar
 *
 * With a sign-in token the feature flags are this person's; without one they
 * are the ones switched on for everyone.
 */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { callerFromToken } from "../lib/auth";
import { compareVersions, inPercent, settings } from "../lib/control";
import { now } from "../lib/crypto";
import { safeJson } from "./support";

const DOWNLOADS = "https://enterworlds.space/apps/";

export const config = new Hono<AppEnv>();

config.get("/", async (c) => {
  const platform = (c.req.query("platform") ?? "").toLowerCase().slice(0, 20);
  const version = (c.req.query("version") ?? "").slice(0, 20);
  const s = await settings(c.env.DB);
  const t = now();

  let userId: string | null = null;
  const h = c.req.header("authorization");
  if (h?.startsWith("Bearer ")) userId = (await callerFromToken(c, h.slice(7).trim()))?.userId ?? null;
  const tester = userId ? !!(await c.env.DB.prepare("SELECT 1 FROM testers WHERE user_id = ?1 AND status = 'accepted'").bind(userId).first()) : false;

  const flags: Record<string, boolean> = {};
  const { results: rows } = await c.env.DB.prepare("SELECT key, mode, percent, users FROM feature_flags").all<{ key: string; mode: string; percent: number; users: string }>();
  for (const f of rows) {
    flags[f.key] =
      f.mode === "all" ||
      (f.mode === "testers" && tester) ||
      (f.mode === "percent" && !!userId && (await inPercent(userId, f.key, f.percent))) ||
      (f.mode === "users" && !!userId && safeJson<string[]>(f.users, []).includes(userId));
  }

  const { results: ann } = await c.env.DB.prepare(
    "SELECT * FROM announcements WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?1) AND (ends_at IS NULL OR ends_at > ?1) ORDER BY created_at DESC LIMIT 10",
  )
    .bind(t)
    .all<{ id: string; text_ar: string; text_en: string; level: string; link: string | null; platforms: string; min_version: string | null; max_version: string | null; dismissible: number }>();
  const announcements = ann
    .filter((a) => {
      const plats = safeJson<string[]>(a.platforms, []);
      if (plats.length && platform && !plats.includes(platform)) return false;
      if (version && a.min_version && compareVersions(version, a.min_version) < 0) return false;
      if (version && a.max_version && compareVersions(version, a.max_version) > 0) return false;
      return true;
    })
    .map((a) => ({ id: a.id, text: { ar: a.text_ar, en: a.text_en }, level: a.level, link: a.link, dismissible: a.dismissible === 1 }));

  const min = platform ? s.minVersion[platform] : undefined;
  const update = min && version && compareVersions(version, min.version) < 0 ? { required: true, minimum: min.version, dismissible: min.dismissible, url: DOWNLOADS } : { required: false };

  return c.json(
    {
      at: t,
      signups: s.signups.mode,
      maintenance: s.maintenance.on ? s.maintenance : { on: false, readOnly: false },
      update,
      announcements,
      flags,
      publishing: s.publishing,
      incident: s.incident.on ? s.incident : { on: false },
      tester,
    },
    200,
    { "cache-control": userId ? "private, no-store" : "public, max-age=60" },
  );
});
