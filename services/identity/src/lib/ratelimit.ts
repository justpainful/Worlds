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

/**
 * The caller's IP. Behind the enterworlds.space edge (services/edge) every
 * request arrives from the edge's own address, so the edge sends the
 * visitor's IP in x-worlds-client-ip with EDGE_SECRET in x-worlds-edge. The
 * header is used only with the right secret; anyone else's is ignored.
 */
export function clientIp(req: Request, edgeSecret?: string): string {
  if (edgeSecret && sameSecret(req.headers.get("x-worlds-edge"), edgeSecret)) {
    const forwarded = req.headers.get("x-worlds-client-ip");
    if (forwarded) return forwarded;
  }
  return req.headers.get("cf-connecting-ip") ?? "local";
}

function sameSecret(a: string | null, b: string): boolean {
  if (a === null || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
