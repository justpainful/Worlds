import { now } from "../lib/crypto";
import { ApiError } from "../lib/http";

/** A ban is stored as a suspension that never ends. */
export const FOREVER = 8_640_000_000_000_000;

export interface Suspension {
  until: number;
  banned: boolean;
  reason: string | null;
}

export function activeSuspension(row: { suspended_until: number | null; banned?: number | null; suspend_reason?: string | null } | null, t = now()): Suspension | null {
  if (!row || !row.suspended_until || row.suspended_until <= t) return null;
  return { until: row.suspended_until, banned: row.banned === 1, reason: row.suspend_reason ?? null };
}

export async function suspensionOf(db: D1Database, userId: string): Promise<Suspension | null> {
  const row = await db.prepare("SELECT suspended_until, banned, suspend_reason FROM users WHERE id = ?1").bind(userId).first<{ suspended_until: number | null; banned: number; suspend_reason: string | null }>();
  return activeSuspension(row);
}

/** Sign-in and refresh stop here while the account is suspended. */
export function suspendedError(s: Suspension): ApiError {
  return s.banned
    ? new ApiError(403, "account_banned", "This account is banned.", { banned: true })
    : new ApiError(403, "account_suspended", "This account is suspended for now.", { until: s.until });
}
