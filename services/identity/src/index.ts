import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Env } from "./env";
import { checkAccess, listDocs, packMembers } from "./domain/access";
import type { Level } from "./domain/roles";
import { deliver, retryOutbox } from "./lib/events";
import { deletionHousekeeping } from "./domain/deletion";
import { ApiError } from "./lib/http";
import { jwks } from "./lib/jwt";
import { expectedOrigins } from "./lib/webauthn";
import { admin } from "./routes/admin";
import { support, supportHousekeeping } from "./routes/support";
import { auth } from "./routes/auth";
import { me } from "./routes/me";
import { pages } from "./routes/pages";
import { profiles } from "./routes/profiles";
import { published } from "./routes/published";
import { invites, workspaces } from "./routes/workspaces";

export const app = new Hono<AppEnv>();

// Worlds on the web calls this service from the browser (src/account/webAccount.ts).
// Only the origins in ALLOWED_ORIGINS may; the apps call it directly and need no CORS.
app.use(
  "*",
  cors({
    origin: (origin, c) => (allowedOrigins(c.env.ALLOWED_ORIGINS).includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "x-support-session"],
    maxAge: 600,
  }),
);

export function allowedOrigins(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o));
}

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
// WebAuthn related origins: the dashboard on admin.<domain> signs in with passkeys made for login.<domain>.
app.get("/.well-known/webauthn", (c) => c.json({ origins: expectedOrigins(c.env).slice(1) }, 200, { "cache-control": "public, max-age=3600" }));
app.route("/auth", auth);
app.route("/me", me);
app.route("/workspaces", workspaces);
app.route("/invites", invites);
app.route("/profiles", profiles);
app.route("/published", published);
app.route("/admin", admin);
app.route("/support", support);
app.route("/", pages);

/** Cron: deliver outstanding access events and clear expired rows. */
export async function scheduled(env: Env): Promise<void> {
  await retryOutbox(env);
  await supportHousekeeping(env);
  await deliver(env, await deletionHousekeeping(env));
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

  /** Members holding a role in a pack, for publishing to them (docs/PACKS.md, Design 3). */
  async packMembers(args: { workspaceId: string; packId: string; roleId: string }): Promise<{ userIds: string[] }> {
    if (!args || typeof args.workspaceId !== "string" || typeof args.packId !== "string" || typeof args.roleId !== "string") return { userIds: [] };
    return { userIds: await packMembers(this.env.DB, args) };
  }

  async listDocs(args: { userId: string; workspaceId: string }): Promise<{ docId: string; level: AccessLevel }[]> {
    if (!args || typeof args.userId !== "string" || typeof args.workspaceId !== "string") return [];
    return listDocs(this.env.DB, args);
  }
}
