import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Env } from "./env";
import { checkAccess, listDocs } from "./domain/access";
import type { Level } from "./domain/roles";
import { retryOutbox } from "./lib/events";
import { ApiError } from "./lib/http";
import { jwks } from "./lib/jwt";
import { auth } from "./routes/auth";
import { me } from "./routes/me";
import { pages } from "./routes/pages";
import { invites, workspaces } from "./routes/workspaces";

export const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (err.status === 429 && typeof err.extra?.retryAfter === "number") headers["retry-after"] = String(err.extra.retryAfter);
    return c.json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status, headers);
  }
  if (err instanceof HTTPException) return c.json({ error: "http_error", message: err.message }, err.status);
  console.error("identity: unhandled error", err);
  return c.json({ error: "internal", message: "Something went wrong on our side." }, 500);
});

app.notFound((c) => c.json({ error: "not_found", message: "Not found." }, 404));

app.get("/", (c) => c.json({ service: "worlds-identity", ok: true }));
app.get("/.well-known/jwks.json", async (c) => c.json(await jwks(c.env), 200, { "cache-control": "public, max-age=300" }));
app.route("/auth", auth);
app.route("/me", me);
app.route("/workspaces", workspaces);
app.route("/invites", invites);
app.route("/", pages);

/** Cron: deliver outstanding access events and clear expired rows. */
export async function scheduled(env: Env): Promise<void> {
  await retryOutbox(env);
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_codes WHERE expires_at < ?1").bind(t - 86_400_000),
    env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?1").bind(t - 3_600_000),
    env.DB.prepare("DELETE FROM handoffs WHERE expires_at < ?1").bind(t - 3_600_000),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(t - 86_400_000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1 OR (revoked_at IS NOT NULL AND revoked_at < ?1)").bind(t - 30 * 86_400_000),
    env.DB.prepare("DELETE FROM outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?1").bind(t - 7 * 86_400_000),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;

export type AccessLevel = Extract<Level, "full" | "edit" | "comment" | "view" | "none">;

/**
 * Service Binding RPC for the sync service (see docs/contracts/identity.md).
 *
 *   [[services]]
 *   binding = "IDENTITY"
 *   service = "worlds-identity"
 *   entrypoint = "IdentityRPC"
 */
export class IdentityRPC extends WorkerEntrypoint<Env> {
  async checkAccess(args: { userId: string; workspaceId: string; docId: string }): Promise<{ level: AccessLevel }> {
    if (!args || typeof args.userId !== "string" || typeof args.workspaceId !== "string" || typeof args.docId !== "string") return { level: "none" };
    return checkAccess(this.env.DB, args);
  }

  async listDocs(args: { userId: string; workspaceId: string }): Promise<{ docId: string; level: AccessLevel }[]> {
    if (!args || typeof args.userId !== "string" || typeof args.workspaceId !== "string") return [];
    return listDocs(this.env.DB, args);
  }
}
