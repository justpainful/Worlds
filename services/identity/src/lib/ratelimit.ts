import { now } from "./crypto";
import { tooMany } from "./http";

/**
 * Fixed-window counter in D1. Throws 429 once `limit` hits inside `windowMs`.
 * One UPSERT per call; good enough for sign-in endpoints at this scale.
 */
export async function rateLimit(db: D1Database, key: string, limit: number, windowMs: number): Promise<void> {
  const t = now();
  const start = t - (t % windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`,
    )
    .bind(key, start)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) throw tooMany(Math.ceil((start + windowMs - t) / 1000));
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "local";
}
