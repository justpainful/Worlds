import type { Context, MiddlewareHandler } from "hono";
import type { ActorKind, AppEnv, Caller } from "../env";
import { deliver, type EventEnvelope } from "./events";
import { unauthorized } from "./http";
import { verifyAccessToken } from "./jwt";

/** Who is really acting: the user, Claude on the user's behalf, or an automation. */
export function actorFrom(header: string | undefined): ActorKind {
  if (header === "ai-on-behalf-of-user" || header === "automation") return header;
  return "user";
}

export async function callerFromToken(c: Context<AppEnv>, token: string): Promise<Caller | null> {
  const claims = await verifyAccessToken(c.env, token);
  if (!claims) return null;
  const dev = await c.env.DB.prepare("SELECT revoked_at FROM devices WHERE id = ?1 AND user_id = ?2").bind(claims.dev, claims.sub).first<{ revoked_at: number | null }>();
  if (!dev || dev.revoked_at) return null;
  return { userId: claims.sub, deviceId: claims.dev, actor: actorFrom(c.req.header("x-worlds-actor")) };
}

/** Bearer access token; the device must still be active (revocation is immediate). */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const h = c.req.header("authorization");
  if (!h || !h.startsWith("Bearer ")) throw unauthorized("unauthorized", "Sign in first.");
  const caller = await callerFromToken(c, h.slice(7).trim());
  if (!caller) throw unauthorized("invalid_token", "Your session ended. Sign in again.");
  c.set("caller", caller);
  await next();
};

/** Deliver events after the response, without blocking it. */
export function emit(c: Context<AppEnv>, events: EventEnvelope[]): void {
  if (!events.length) return;
  const p = deliver(c.env, events);
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    // No execution context (direct calls in tests): delivery still runs.
  }
}
