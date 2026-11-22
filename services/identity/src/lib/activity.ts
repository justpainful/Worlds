/**
 * What the numbers are made of (docs/admin/PLAN.md, phase 7): the day an
 * account was active, and the app version and country of each device. The
 * country is Cloudflare's two-letter guess for the request; the address itself
 * is never stored.
 */
import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { newId, now } from "./crypto";
import { sameSecret } from "./ratelimit";

export const DAY = 86_400_000;
export const dayOf = (ms: number) => Math.floor(ms / DAY);

function countryOf(c: Context<AppEnv>): string | null {
  const viaEdge = c.env.EDGE_SECRET && sameSecret(c.req.header("x-worlds-edge") ?? null, c.env.EDGE_SECRET);
  const raw = viaEdge ? c.req.header("x-worlds-country") : (c.req.raw as Request & { cf?: { country?: string } }).cf?.country;
  return raw && /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : null;
}

/** After a sign-in or a refresh: today counts as active, and the device's version and country are noted. */
export async function recordActivity(c: Context<AppEnv>, userId: string, deviceId: string): Promise<void> {
  const version = (c.req.header("x-worlds-version") ?? "").slice(0, 20) || null;
  const country = countryOf(c);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?1, ?2)").bind(userId, dayOf(now())),
      c.env.DB.prepare("UPDATE devices SET app_version = COALESCE(?1, app_version), country = COALESCE(?2, country) WHERE id = ?3").bind(version, country, deviceId),
    ]);
  } catch (e) {
    // Numbers never stop a sign-in.
    console.error("activity", e);
  }
}

/** One line per email the service tried to send; never the address or the text. */
export async function logEmail(env: Env, kind: string, provider: string | null, ok: boolean, error?: string): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO email_log (id, at, kind, provider, ok, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(newId(), now(), kind, provider, ok ? 1 : 0, error ? error.slice(0, 300) : null)
      .run();
  } catch {
    // The log is best effort.
  }
}
