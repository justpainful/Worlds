/**
 * The control dashboard's API (admin.enterworlds.space, docs/admin/PLAN.md).
 *
 * Every request needs a signed-in account with a team role: the owners named
 * in ADMIN_OWNERS, or a row in admin_roles. Each role has a fixed set of
 * permissions, checked on every route. Risky actions also need a fresh second
 * check (a passkey with fingerprint, face or PIN, or an email code) made in
 * the last few minutes on the same dashboard device. Everything the team
 * changes is written to the security log with the reason given.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { revokeDevice } from "../domain/sessions";
import { FOREVER, activeSuspension } from "../domain/suspension";
import { auditStmt } from "../lib/audit";
import { emit, requireAuth } from "../lib/auth";
import { newId, now } from "../lib/crypto";
import type { EventEnvelope } from "../lib/events";
import { ApiError, bad, body, conflict, forbidden, normalizeEmail, notFound, optStr, str, unauthorized } from "../lib/http";
import { checkUsername, usernameTaken } from "../lib/usernames";
import { foldName } from "../lib/names";
import { reportersOf, setTeamHidden, targetKey, type Target } from "../lib/content";
import { SETTING_KEYS, settings, type SettingKey } from "../lib/control";
import { dayOf } from "../lib/activity";
import { hmacSha256Hex } from "../lib/crypto";
import { sha256Hex } from "../lib/crypto";
import { SUGGESTION_STATUSES, suggestionView, type SuggestionRow, type SuggestionStatus } from "./community";
import { eventStmt } from "../lib/events";
import { noticeMail } from "../lib/noticeMail";
import { cancelDeletion, eraseAccount, exportAccount, scheduleDeletion } from "../domain/deletion";
import { authenticationOptions, webauthn } from "../lib/webauthn";
import { consumeEmailCode, newChallenge, takeChallenge, userById, userView } from "./auth";
import { SUPPORT_SITE, replyAddress, sendSupportMail, supportMail, ticketRef } from "../lib/supportMail";
import { notifyTeam } from "./support";
import { randomToken } from "../lib/crypto";
import { STATUSES, addMessage, assertKind, messageView, notifyStmt, safeJson, ticketView, type MessageRow, type TicketRow, type TicketStatus } from "./support";

export type AdminRole = "owner" | "moderator" | "support";

export const PERMISSIONS = [
  "users.read", // the list and each account's details
  "users.email", // see email addresses and search by them
  "users.edit", // name, username, picture
  "users.edit_email",
  "users.suspend", // suspend for a while, and lift it
  "users.ban",
  "users.devices", // sign devices out, remove passkeys
  "notes",
  "audit",
  "stats",
  "team",
  "tickets", // support requests: read, answer, notes, status
  "tickets.private", // security reports
  "users.delete", // schedule or erase an account
  "users.export", // a copy of an account's data
  "names", // reserved usernames and words not allowed in names
  "content", // public profiles, published pages, reports, suspicious accounts
  "content.workspaces", // move or trash someone's shared workspace
  "community", // suggestions, the roadmap, testers, surveys
  "messages", // write to one person in their app
  "control", // sign-ups, maintenance, versions, flags, announcements, blocks
  "control.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  moderator: ["users.read", "users.edit", "users.suspend", "notes", "audit", "stats", "tickets", "names", "content", "community", "control.read"],
  support: ["users.read", "users.email", "notes", "stats", "tickets", "community", "messages", "control.read"],
};

/** Actions that need a second check made in the last STEP_UP_MS. */
const NEEDS_STEP_UP: ReadonlySet<Permission> = new Set(["users.edit_email", "users.suspend", "users.ban", "users.devices", "team", "users.delete", "users.export", "content.workspaces", "control"]);
export const STEP_UP_MS = 10 * 60 * 1000;

const DAY = 86_400_000;

type AdminCtx = Context<AppEnv & { Variables: { role: AdminRole } }>;

export function envOwners(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function roleOf(c: Context<AppEnv>, userId: string): Promise<AdminRole | null> {
  if (envOwners(c.env.ADMIN_OWNERS).includes(userId)) return "owner";
  const row = await c.env.DB.prepare("SELECT role FROM admin_roles WHERE user_id = ?1").bind(userId).first<{ role: AdminRole }>();
  return row?.role ?? null;
}

const requireAdmin: MiddlewareHandler<AppEnv & { Variables: { role: AdminRole } }> = async (c, next) => {
  const role = await roleOf(c as unknown as Context<AppEnv>, c.get("caller").userId);
  if (!role) throw forbidden("not_admin", "This account has no access to the dashboard.");
  c.set("role", role);
  await next();
};

function can(c: AdminCtx, p: Permission): boolean {
  return ROLE_PERMISSIONS[c.get("role")].includes(p);
}

async function stepUpUntil(c: AdminCtx): Promise<number | null> {
  const caller = c.get("caller");
  const row = await c.env.DB.prepare("SELECT expires_at FROM admin_stepups WHERE device_id = ?1 AND user_id = ?2 AND expires_at > ?3")
    .bind(caller.deviceId, caller.userId, now())
    .first<{ expires_at: number }>();
  return row?.expires_at ?? null;
}

/** The permission, and a fresh second check when the action is risky. */
async function need(c: AdminCtx, p: Permission): Promise<void> {
  if (!can(c, p)) throw forbidden("not_allowed", "Your role cannot do this.");
  if (NEEDS_STEP_UP.has(p) && !(await stepUpUntil(c))) throw new ApiError(403, "step_up_required", "Confirm it is you first.");
}

/** The team may not act on someone with an equal or higher role, and nobody acts on an owner named in the settings. */
async function guardTarget(c: AdminCtx, targetId: string): Promise<void> {
  if (targetId === c.get("caller").userId) throw forbidden("own_account", "Use your own account settings for your account.");
  if (envOwners(c.env.ADMIN_OWNERS).includes(targetId)) throw forbidden("protected_owner", "This owner can only be changed in the service settings.");
  const target = await roleOf(c as unknown as Context<AppEnv>, targetId);
  if (target && c.get("role") !== "owner") throw forbidden("protected_member", "Only an owner can act on a team member.");
}

function reasonOf(v: unknown): string {
  return str(v, "reason", 500);
}

function logStmt(c: AdminCtx, action: string, targetId: string, meta: Record<string, unknown> = {}): D1PreparedStatement {
  const caller = c.get("caller");
  return auditStmt(c.env.DB, { action, actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId, meta: { ...meta, role: c.get("role") } });
}

interface UserListRow {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  created_at: number;
  suspended_until: number | null;
  banned: number;
  suspend_reason: string | null;
  last_seen: number | null;
  devices: number;
  team_role: AdminRole | null;
}

function listItem(c: AdminCtx, r: UserListRow, owners: string[]) {
  const s = activeSuspension(r);
  return {
    id: r.id,
    email: can(c, "users.email") ? r.email : null,
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen,
    devices: r.devices,
    status: s ? (s.banned ? "banned" : "suspended") : "active",
    suspendedUntil: s && !s.banned ? s.until : null,
    teamRole: owners.includes(r.id) ? "owner" : r.team_role,
  };
}

const LIST_COLS = `u.id, u.email, u.display_name, u.username, u.avatar_url, u.created_at, u.suspended_until, u.banned, u.suspend_reason,
  (SELECT MAX(d.last_seen_at) FROM devices d WHERE d.user_id = u.id) AS last_seen,
  (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS devices,
  (SELECT r.role FROM admin_roles r WHERE r.user_id = u.id) AS team_role`;

export const admin = new Hono<AppEnv & { Variables: { role: AdminRole } }>();
/**
 * Claude's MCP server signs in with a key (x-worlds-admin-key) instead of a
 * session: it reads as the owner who made the key, and the only change it can
 * make is to propose one (POST /admin/proposals), which a person approves.
 */
const keyOrSession: MiddlewareHandler<AppEnv & { Variables: { role: AdminRole } }> = async (c, next) => {
  const key = c.req.header("x-worlds-admin-key");
  if (!key) return requireAuth(c as unknown as Context<AppEnv>, next);
  const row = await c.env.DB.prepare("SELECT id, user_id FROM admin_keys WHERE key_hash = ?1 AND revoked_at IS NULL").bind(await sha256Hex(key)).first<{ id: string; user_id: string }>();
  if (!row) throw unauthorized("invalid_key", "That key is not valid.");
  const writes = c.req.method !== "GET" && c.req.method !== "HEAD";
  if (writes && c.req.path !== "/admin/proposals") throw forbidden("propose_only", "Claude can only propose changes; a person approves them in the dashboard.");
  c.set("caller", { userId: row.user_id, deviceId: `key:${row.id}`, actor: "ai-on-behalf-of-user" });
  await c.env.DB.prepare("UPDATE admin_keys SET last_used_at = ?1 WHERE id = ?2").bind(now(), row.id).run();
  await next();
};
admin.use("*", keyOrSession, requireAdmin);

// ---------------------------------------------------------------------------
// Who am I, and the second check
// ---------------------------------------------------------------------------

admin.get("/me", async (c) => {
  const caller = c.get("caller");
  const u = await userById(c.env.DB, caller.userId);
  if (!u) throw notFound();
  const passkeys = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?1").bind(caller.userId).first<{ n: number }>();
  return c.json({
    user: userView(u),
    role: c.get("role"),
    permissions: ROLE_PERMISSIONS[c.get("role")],
    stepUpUntil: await stepUpUntil(c),
    hasPasskey: (passkeys?.n ?? 0) > 0,
  });
});

async function grantStepUp(c: AdminCtx, method: string) {
  const caller = c.get("caller");
  const until = now() + STEP_UP_MS;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO admin_stepups (device_id, user_id, method, expires_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(device_id) DO UPDATE SET user_id = ?2, method = ?3, expires_at = ?4",
    ).bind(caller.deviceId, caller.userId, method, until),
    auditStmt(c.env.DB, { action: "admin.confirmed", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId: caller.userId, meta: { method } }),
  ]);
  return { stepUpUntil: until };
}

admin.post("/stepup/passkey/options", async (c) => {
  const caller = c.get("caller");
  const { results } = await c.env.DB.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?1").bind(caller.userId).all<{ id: string; transports: string }>();
  if (!results.length) throw bad("no_passkey", "This account has no passkey. Confirm with an email code instead.");
  const options = await authenticationOptions(
    c.env,
    results.map((r) => ({ id: r.id, transports: JSON.parse(r.transports) as string[] })),
  );
  const challengeId = await newChallenge(c.env.DB, "authenticate", options.challenge, caller.userId);
  return c.json({ challengeId, options });
});

admin.post("/stepup/passkey/verify", async (c) => {
  const caller = c.get("caller");
  const b = await body(c.req);
  const ch = await takeChallenge(c.env.DB, str(b.challengeId, "challengeId", 64), "authenticate");
  if (ch.user_id !== caller.userId) throw bad("challenge_mismatch");
  const response = b.response as { id?: unknown } | undefined;
  const cred = await c.env.DB.prepare("SELECT id, public_key, counter, transports FROM passkeys WHERE id = ?1 AND user_id = ?2")
    .bind(str(response?.id, "response.id", 1024), caller.userId)
    .first<{ id: string; public_key: string; counter: number; transports: string }>();
  if (!cred) throw forbidden("passkey_unknown", "That passkey is not one of yours.");
  const v = await webauthn().verifyAuthentication(
    c.env,
    b.response,
    ch.challenge,
    { id: cred.id, publicKey: cred.public_key, counter: cred.counter, transports: JSON.parse(cred.transports) as string[] },
    true,
  );
  if (!v) throw forbidden("passkey_invalid", "The passkey could not be verified.");
  await c.env.DB.prepare("UPDATE passkeys SET counter = ?1, last_used_at = ?2 WHERE id = ?3").bind(v.newCounter, now(), cred.id).run();
  return c.json(await grantStepUp(c, "passkey"));
});

/** The code comes from POST /auth/email/start with the account's own email. */
admin.post("/stepup/email/verify", async (c) => {
  const b = await body(c.req);
  const email = await consumeEmailCode(c as unknown as Context<AppEnv>, b.challengeId, b.code);
  const u = await userById(c.env.DB, c.get("caller").userId);
  if (!u || u.email !== email) throw forbidden("code_not_yours", "That code was sent to another address.");
  return c.json(await grantStepUp(c, "email"));
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

admin.get("/stats", async (c) => {
  await need(c, "stats");
  const t = now();
  const db = c.env.DB;
  const one = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const [users, newUsers, active, platforms, perDay, spaces, publicStuff, passkeys] = await db.batch<Record<string, number | string | null>>([
    one(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN suspended_until > ?1 AND banned = 0 THEN 1 ELSE 0 END) AS suspended,
        SUM(CASE WHEN suspended_until > ?1 AND banned = 1 THEN 1 ELSE 0 END) AS banned
       FROM users`,
      t,
    ),
    one(
      `SELECT SUM(CASE WHEN created_at > ?1 THEN 1 ELSE 0 END) AS day,
        SUM(CASE WHEN created_at > ?2 THEN 1 ELSE 0 END) AS week,
        SUM(CASE WHEN created_at > ?3 THEN 1 ELSE 0 END) AS month
       FROM users`,
      t - DAY,
      t - 7 * DAY,
      t - 30 * DAY,
    ),
    one(
      `SELECT COUNT(DISTINCT CASE WHEN last_seen_at > ?1 THEN user_id END) AS day,
        COUNT(DISTINCT CASE WHEN last_seen_at > ?2 THEN user_id END) AS week,
        COUNT(DISTINCT CASE WHEN last_seen_at > ?3 THEN user_id END) AS month,
        SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS devices
       FROM devices`,
      t - DAY,
      t - 7 * DAY,
      t - 30 * DAY,
    ),
    one(
      "SELECT platform, COUNT(*) AS devices, COUNT(DISTINCT user_id) AS users FROM devices WHERE revoked_at IS NULL AND last_seen_at > ?1 GROUP BY platform ORDER BY devices DESC",
      t - 30 * DAY,
    ),
    one("SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS n FROM users WHERE created_at > ?1 GROUP BY day ORDER BY day", t - 30 * DAY),
    one(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END) AS shared
       FROM (SELECT w.id, (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS n FROM workspaces w)`,
    ),
    one(
      `SELECT (SELECT COUNT(*) FROM public_profiles WHERE visible = 1) AS profiles,
        (SELECT COUNT(*) FROM published_pages WHERE kind = 'page') AS pages,
        (SELECT COUNT(*) FROM published_pages WHERE kind = 'share' AND (expires_at IS NULL OR expires_at > ?1)) AS shares`,
      t,
    ),
    one("SELECT COUNT(*) AS passkeys, COUNT(DISTINCT user_id) AS users FROM passkeys"),
  ]);
  const first = (r: D1Result<Record<string, number | string | null>>) => r.results[0] ?? {};
  const n = (v: unknown) => Number(v ?? 0);
  const u = first(users);
  const nu = first(newUsers);
  const a = first(active);
  const s = first(spaces);
  const p = first(publicStuff);
  const k = first(passkeys);
  return c.json({
    at: t,
    users: { total: n(u.total), suspended: n(u.suspended), banned: n(u.banned), withPasskey: n(k.users) },
    signups: { day: n(nu.day), week: n(nu.week), month: n(nu.month), perDay: perDay.results.map((r) => ({ day: n(r.day) * DAY, count: n(r.n) })) },
    active: { day: n(a.day), week: n(a.week), month: n(a.month), devices: n(a.devices) },
    platforms: platforms.results.map((r) => ({ platform: String(r.platform || "unknown"), devices: n(r.devices), users: n(r.users) })),
    workspaces: { total: n(s.total), shared: n(s.shared) },
    public: { profiles: n(p.profiles), pages: n(p.pages), shares: n(p.shares) },
    passkeys: n(k.passkeys),
  });
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

admin.get("/users", async (c) => {
  await need(c, "users.read");
  const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 100);
  const status = c.req.query("status") ?? "all";
  const sort = c.req.query("sort") ?? "created";
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const owners = envOwners(c.env.ADMIN_OWNERS);
  const t = now();

  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  if (q) {
    const like = arg(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const fields = [`lower(u.display_name) LIKE ${like} ESCAPE '\\'`, `u.username LIKE ${like} ESCAPE '\\'`, `u.id = ${arg(q)}`];
    if (can(c, "users.email")) fields.push(`u.email LIKE ${like} ESCAPE '\\'`);
    where.push(`(${fields.join(" OR ")})`);
  }
  if (status === "active") where.push(`(u.suspended_until IS NULL OR u.suspended_until <= ${arg(t)})`);
  else if (status === "suspended") where.push(`(u.suspended_until > ${arg(t)} AND u.banned = 0)`);
  else if (status === "banned") where.push(`(u.suspended_until > ${arg(t)} AND u.banned = 1)`);
  else if (status === "deleting") where.push("u.deletion_due_at IS NOT NULL");
  else if (status === "team") {
    const ids = owners.map((o) => arg(o));
    where.push(`(u.id IN (SELECT user_id FROM admin_roles)${ids.length ? ` OR u.id IN (${ids.join(", ")})` : ""})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = sort === "active" ? "last_seen IS NULL, last_seen DESC" : sort === "name" ? "lower(u.display_name), u.username" : "u.created_at DESC";

  const countArgs = [...args];
  const rows = await c.env.DB.prepare(`SELECT ${LIST_COLS} FROM users u ${whereSql} ORDER BY ${order}, u.id LIMIT ${arg(limit)} OFFSET ${arg(offset)}`)
    .bind(...args)
    .all<UserListRow>();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${whereSql}`).bind(...countArgs).first<{ n: number }>();
  return c.json({ total: total?.n ?? 0, offset, limit, users: rows.results.map((r) => listItem(c, r, owners)) });
});

admin.get("/users/:id", async (c) => {
  await need(c, "users.read");
  const id = c.req.param("id");
  const db = c.env.DB;
  const owners = envOwners(c.env.ADMIN_OWNERS);
  const row = await db.prepare(`SELECT ${LIST_COLS}, u.username_auto, u.email_verified_at, u.updated_at, u.suspended_at, u.deletion_due_at, u.deletion_by FROM users u WHERE u.id = ?1`)
    .bind(id)
    .first<UserListRow & { username_auto: number; email_verified_at: number | null; updated_at: number; suspended_at: number | null; deletion_due_at: number | null; deletion_by: string | null }>();
  if (!row) throw notFound("user_not_found", "There is no account with that id.");
  const [devices, passkeys, spaces, profile, pages, mail, notes, log] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT id, name, platform, public_key IS NOT NULL AS bound, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ?1 ORDER BY revoked_at IS NOT NULL, last_seen_at DESC LIMIT 50").bind(id),
    db.prepare("SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ?1 ORDER BY created_at").bind(id),
    db
      .prepare(
        `SELECT w.id, w.name, m.role, w.owner_id = ?1 AS owns, m.joined_at,
          (SELECT COUNT(*) FROM members x WHERE x.workspace_id = w.id) AS members,
          (SELECT COUNT(*) FROM pages p WHERE p.workspace_id = w.id) AS pages
         FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?1 ORDER BY m.joined_at`,
      )
      .bind(id),
    db.prepare("SELECT visible, avatar_key IS NOT NULL AS avatar, banner_key IS NOT NULL AS banner, published_at, updated_at FROM public_profiles WHERE user_id = ?1").bind(id),
    db.prepare("SELECT slug, kind, title, views, expires_at, password_hash IS NOT NULL AS locked, created_at, updated_at FROM published_pages WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 100").bind(id),
    db
      .prepare("SELECT a.key, a.created_at, (SELECT COUNT(*) FROM mail_items i WHERE i.user_id = a.user_id AND i.picked_at IS NULL) AS waiting FROM mail_addresses a WHERE a.user_id = ?1")
      .bind(id),
    db
      .prepare(
        `SELECT n.id, n.body, n.created_at, n.author_id, a.display_name AS author_name, a.username AS author_username
         FROM admin_notes n LEFT JOIN users a ON a.id = n.author_id WHERE n.user_id = ?1 ORDER BY n.created_at DESC`,
      )
      .bind(id),
    db
      .prepare(
        "SELECT id, at, actor_user_id, actor_kind, device_id, action, target_type, target_id, meta FROM audit_log WHERE actor_user_id = ?1 OR (target_type = 'user' AND target_id = ?1) ORDER BY at DESC LIMIT 60",
      )
      .bind(id),
  ]);
  const s = activeSuspension(row);
  const b = (v: unknown) => v === 1 || v === true;
  const prof = profile.results[0];
  const box = mail.results[0];
  return c.json({
    ...listItem(c, row, owners),
    usernameAuto: row.username_auto === 1,
    emailVerifiedAt: can(c, "users.email") ? row.email_verified_at : null,
    updatedAt: row.updated_at,
    suspension: s ? { until: s.banned ? null : s.until, banned: s.banned, reason: s.reason, since: row.suspended_at } : null,
    deletion: row.deletion_due_at ? { dueAt: row.deletion_due_at, by: row.deletion_by } : null,
    devices: devices.results.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      deviceKey: b(d.bound),
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
    })),
    passkeys: passkeys.results.map((p) => ({ id: p.id, name: p.name, synced: b(p.backed_up), createdAt: p.created_at, lastUsedAt: p.last_used_at })),
    workspaces: spaces.results.map((w) => ({ id: w.id, name: w.name, role: w.role, owns: b(w.owns), members: w.members, pages: w.pages, joinedAt: w.joined_at })),
    profile: prof ? { visible: b(prof.visible), avatar: b(prof.avatar), banner: b(prof.banner), publishedAt: prof.published_at, updatedAt: prof.updated_at } : null,
    published: pages.results.map((p) => ({
      slug: p.slug,
      kind: p.kind,
      title: p.title,
      views: p.views,
      expiresAt: p.expires_at,
      locked: b(p.locked),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    mail: box ? { address: can(c, "users.email") ? box.key : null, createdAt: box.created_at, waiting: box.waiting } : null,
    notes: can(c, "notes")
      ? notes.results.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, author: n.author_id ? { id: n.author_id, name: n.author_name, username: n.author_username } : null }))
      : [],
    activity: can(c, "audit") ? log.results.map(logRow) : [],
  });
});

function logRow(r: Record<string, unknown>) {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse((r.meta as string) || "{}");
  } catch {
    // An old row with broken meta still shows.
  }
  return {
    id: r.id,
    at: r.at,
    actorUserId: r.actor_user_id ?? null,
    actorKind: r.actor_kind,
    deviceId: r.device_id ?? null,
    action: r.action,
    targetType: r.target_type ?? null,
    targetId: r.target_id ?? null,
    meta,
    ...(r.actor_name !== undefined ? { actorName: r.actor_name ?? null, actorUsername: r.actor_username ?? null, targetName: r.target_name ?? null } : {}),
  };
}

/** Change the name, username, picture or email. Each changed field needs its own permission. */
admin.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const b = await body(c.req);
  const reason = reasonOf(b.reason);
  const old = await userById(c.env.DB, id);
  if (!old) throw notFound("user_not_found");
  await guardTarget(c, id);

  const sets: string[] = [];
  const args: unknown[] = [];
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const set = (col: string, field: string, from: unknown, to: unknown) => {
    if (from === to) return;
    args.push(to);
    sets.push(`${col} = ?${args.length}`);
    changed[field] = { from, to };
  };

  if (b.displayName !== undefined || b.username !== undefined || b.avatarUrl !== undefined) await need(c, "users.edit");
  if (b.displayName !== undefined) set("display_name", "displayName", old.display_name, str(b.displayName, "displayName", 80));
  if (b.username !== undefined) {
    const username = checkUsername(b.username);
    if (username !== old.username && (await usernameTaken(c.env.DB, username, id))) throw conflict("username_taken", "That username is taken.");
    set("username", "username", old.username, username);
    if (username !== old.username) sets.push("username_auto = 0");
  }
  if (b.avatarUrl !== undefined) {
    const avatar = b.avatarUrl === null ? null : optStr(b.avatarUrl, "avatarUrl", 500) ?? null;
    if (avatar && !/^https:\/\//.test(avatar)) throw bad("invalid_avatar", "avatarUrl must be an https URL");
    set("avatar_url", "avatarUrl", old.avatar_url, avatar);
  }
  if (b.email !== undefined) {
    await need(c, "users.edit_email");
    const email = normalizeEmail(b.email);
    if (email !== old.email) {
      const taken = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?1 AND id != ?2").bind(email, id).first();
      if (taken) throw conflict("email_taken", "Another account uses that email.");
    }
    set("email", "email", old.email, email);
  }
  if (!Object.keys(changed).length) return c.json({ ok: true, changed: [] });

  args.push(now());
  sets.push(`updated_at = ?${args.length}`);
  args.push(id);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${args.length}`).bind(...args),
      // The email's old and new values stay out of the log: the field name is enough.
      logStmt(c, "admin.user.updated", id, {
        reason,
        changed: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, k === "email" ? { changed: true } : v])),
      }),
    ]);
  } catch {
    throw conflict("taken", "That username or email is taken.");
  }
  return c.json({ ok: true, changed: Object.keys(changed) });
});

async function signOutAll(c: AdminCtx, userId: string, reason: string): Promise<EventEnvelope[]> {
  const { results } = await c.env.DB.prepare("SELECT id FROM devices WHERE user_id = ?1 AND revoked_at IS NULL").bind(userId).all<{ id: string }>();
  const caller = c.get("caller");
  const events: EventEnvelope[] = [];
  for (const d of results) events.push(...(await revokeDevice(c.env, userId, d.id, { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor }, reason)));
  return events;
}

/**
 * Suspend for a number of days, or ban ({ ban: true }). Either way every
 * device signs out at once, sign-in stops, and the public profile and
 * published pages disappear until it is lifted.
 */
admin.post("/users/:id/suspend", async (c) => {
  const id = c.req.param("id");
  const b = await body(c.req);
  const reason = reasonOf(b.reason);
  const ban = b.ban === true;
  await need(c, ban ? "users.ban" : "users.suspend");
  if (!(await userById(c.env.DB, id))) throw notFound("user_not_found");
  await guardTarget(c, id);
  let until = FOREVER;
  if (!ban) {
    const days = Number(b.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw bad("invalid_days", "days must be a whole number from 1 to 365");
    until = now() + days * DAY;
  }
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET suspended_until = ?1, suspended_at = ?2, suspend_reason = ?3, banned = ?4, updated_at = ?2 WHERE id = ?5").bind(until, t, reason, ban ? 1 : 0, id),
    logStmt(c, ban ? "admin.user.banned" : "admin.user.suspended", id, { reason, ...(ban ? {} : { until }) }),
  ]);
  emit(c as unknown as Context<AppEnv>, await signOutAll(c, id, ban ? "banned" : "suspended"));
  const target = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(id).first<{ email: string }>();
  if (target && b.tell !== false) {
    const mail = noticeMail(b.lang === "en" ? "en" : "ar", ban ? "account_banned" : "account_suspended", { date: until, reason: b.tellReason === false ? undefined : reason });
    const sent = sendSupportMail(c.env, { to: target.email, ...mail });
    try {
      c.executionCtx.waitUntil(sent);
    } catch {
      await sent;
    }
  }
  return c.json({ ok: true, until: ban ? null : until, banned: ban });
});

admin.post("/users/:id/unsuspend", async (c) => {
  const id = c.req.param("id");
  const b = await body(c.req);
  const reason = reasonOf(b.reason);
  const row = await c.env.DB.prepare("SELECT suspended_until, banned FROM users WHERE id = ?1").bind(id).first<{ suspended_until: number | null; banned: number }>();
  if (!row) throw notFound("user_not_found");
  const s = activeSuspension(row);
  if (!s) throw conflict("not_suspended", "This account is not suspended.");
  await need(c, s.banned ? "users.ban" : "users.suspend");
  await guardTarget(c, id);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET suspended_until = NULL, suspended_at = NULL, suspend_reason = NULL, banned = 0, updated_at = ?1 WHERE id = ?2").bind(now(), id),
    logStmt(c, s.banned ? "admin.user.unbanned" : "admin.user.unsuspended", id, { reason }),
  ]);
  return c.json({ ok: true });
});

/** Sign out one device ({ deviceId }) or all of them. */
admin.post("/users/:id/signout", async (c) => {
  const id = c.req.param("id");
  const b = await body(c.req);
  const reason = reasonOf(b.reason);
  await need(c, "users.devices");
  await guardTarget(c, id);
  const deviceId = optStr(b.deviceId, "deviceId", 64);
  const caller = c.get("caller");
  const events = deviceId
    ? await revokeDevice(c.env, id, deviceId, { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor }, "admin")
    : await signOutAll(c, id, "admin");
  if (deviceId && !events.length) throw notFound("device_not_found", "That device is not signed in.");
  await logStmt(c, "admin.user.signed_out", id, { reason, devices: deviceId ? [deviceId] : events.length }).run();
  emit(c as unknown as Context<AppEnv>, events);
  return c.json({ ok: true, devices: events.length });
});

admin.delete("/users/:id/passkeys/:passkey", async (c) => {
  const id = c.req.param("id");
  const reason = reasonOf(c.req.query("reason"));
  await need(c, "users.devices");
  await guardTarget(c, id);
  const r = await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ?1 AND user_id = ?2").bind(c.req.param("passkey"), id).run();
  if (!r.meta.changes) throw notFound("passkey_not_found");
  await logStmt(c, "admin.user.passkey_removed", id, { reason, passkey: c.req.param("passkey") }).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Private notes
// ---------------------------------------------------------------------------

admin.post("/users/:id/notes", async (c) => {
  await need(c, "notes");
  const id = c.req.param("id");
  if (!(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(id).first())) throw notFound("user_not_found");
  const text = str((await body(c.req)).body, "body", 4000);
  const note = { id: newId(), body: text, createdAt: now() };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO admin_notes (id, user_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(note.id, id, c.get("caller").userId, text, note.createdAt),
    logStmt(c, "admin.note.added", id, { note: note.id }),
  ]);
  return c.json(note, 201);
});

admin.delete("/notes/:note", async (c) => {
  await need(c, "notes");
  const note = await c.env.DB.prepare("SELECT user_id, author_id FROM admin_notes WHERE id = ?1").bind(c.req.param("note")).first<{ user_id: string; author_id: string | null }>();
  if (!note) throw notFound("note_not_found");
  if (note.author_id !== c.get("caller").userId && c.get("role") !== "owner") throw forbidden("not_your_note", "Only its author or an owner can remove a note.");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM admin_notes WHERE id = ?1").bind(c.req.param("note")), logStmt(c, "admin.note.removed", note.user_id, { note: c.req.param("note") })]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The security log of every account
// ---------------------------------------------------------------------------

admin.get("/audit", async (c) => {
  await need(c, "audit");
  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  const user = c.req.query("user");
  if (user) {
    const p = arg(user);
    where.push(`(l.actor_user_id = ${p} OR (l.target_type = 'user' AND l.target_id = ${p}))`);
  }
  const action = (c.req.query("action") ?? "").trim();
  if (action) where.push(`l.action LIKE ${arg(`${action.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)} ESCAPE '\\'`);
  const kind = c.req.query("kind");
  if (kind) where.push(`l.actor_kind = ${arg(kind)}`);
  const before = Number(c.req.query("before"));
  if (Number.isFinite(before) && before > 0) where.push(`l.at < ${arg(before)}`);
  const since = Number(c.req.query("since"));
  if (Number.isFinite(since) && since > 0) where.push(`l.at >= ${arg(since)}`);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 200);
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, a.display_name AS actor_name, a.username AS actor_username, tu.display_name AS target_name
     FROM audit_log l LEFT JOIN users a ON a.id = l.actor_user_id LEFT JOIN users tu ON l.target_type = 'user' AND tu.id = l.target_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.at DESC, l.id DESC LIMIT ${arg(limit)}`,
  )
    .bind(...args)
    .all<Record<string, unknown>>();
  const entries = results.map(logRow);
  return c.json({ entries, next: entries.length === limit ? (entries[entries.length - 1].at as number) : null });
});

// ---------------------------------------------------------------------------
// The team
// ---------------------------------------------------------------------------

admin.get("/team", async (c) => {
  await need(c, "users.read");
  const owners = envOwners(c.env.ADMIN_OWNERS);
  const ids = owners.map((_, i) => `?${i + 1}`);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.username, u.avatar_url, r.role, r.granted_at, r.granted_by
     FROM users u LEFT JOIN admin_roles r ON r.user_id = u.id
     WHERE r.user_id IS NOT NULL${ids.length ? ` OR u.id IN (${ids.join(", ")})` : ""} ORDER BY r.granted_at`,
  )
    .bind(...owners)
    .all<{ id: string; display_name: string; username: string; avatar_url: string | null; role: AdminRole | null; granted_at: number | null; granted_by: string | null }>();
  return c.json(
    results.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      username: r.username,
      avatarUrl: r.avatar_url,
      role: owners.includes(r.id) ? "owner" : r.role,
      fixed: owners.includes(r.id),
      grantedAt: r.granted_at,
    })),
  );
});

admin.put("/team/:id", async (c) => {
  await need(c, "team");
  const id = c.req.param("id");
  const b = await body(c.req);
  const role = b.role;
  if (role !== "owner" && role !== "moderator" && role !== "support") throw bad("invalid_role", "role must be owner, moderator or support");
  if (id === c.get("caller").userId) throw forbidden("own_account", "You cannot change your own role.");
  if (envOwners(c.env.ADMIN_OWNERS).includes(id)) throw forbidden("protected_owner", "This owner can only be changed in the service settings.");
  if (!(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(id).first())) throw notFound("user_not_found");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO admin_roles (user_id, role, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id) DO UPDATE SET role = ?2, granted_by = ?3, granted_at = ?4",
    ).bind(id, role, c.get("caller").userId, now()),
    logStmt(c, "admin.team.role_set", id, { to: role }),
  ]);
  return c.json({ ok: true, role });
});

admin.delete("/team/:id", async (c) => {
  await need(c, "team");
  const id = c.req.param("id");
  if (id === c.get("caller").userId) throw forbidden("own_account", "You cannot remove yourself.");
  if (envOwners(c.env.ADMIN_OWNERS).includes(id)) throw forbidden("protected_owner", "This owner can only be changed in the service settings.");
  const r = await c.env.DB.prepare("DELETE FROM admin_roles WHERE user_id = ?1").bind(id).run();
  if (!r.meta.changes) throw notFound("not_on_team");
  await logStmt(c, "admin.team.removed", id).run();
  // The person's dashboard devices lose their second check with the role.
  await c.env.DB.prepare("DELETE FROM admin_stepups WHERE user_id = ?1").bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Support requests (routes/support.ts)
// ---------------------------------------------------------------------------

type TicketJoined = TicketRow & { assignee_name?: string | null; user_name?: string | null; user_username?: string | null; last_author?: string | null };

function ticketAdminView(c: AdminCtx, t: TicketJoined) {
  return {
    ...ticketView(t),
    email: can(c, "users.email") ? t.email : null,
    name: t.name,
    userId: t.user_id,
    userName: t.user_name ?? null,
    userUsername: t.user_username ?? null,
    priority: t.priority,
    assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name ?? null } : null,
    tags: safeJson<string[]>(t.tags, []),
    private: t.private === 1,
    via: t.via,
    firstReplyAt: t.first_reply_at,
    lastAuthor: t.last_author ?? null,
  };
}

const TICKET_COLS = `t.*, a.display_name AS assignee_name, u.display_name AS user_name, u.username AS user_username,
  (SELECT m.author FROM support_messages m WHERE m.ticket_id = t.id AND m.author != 'note' ORDER BY m.created_at DESC LIMIT 1) AS last_author`;
const TICKET_FROM = "support_tickets t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users u ON u.id = t.user_id";

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

async function ticketByNumber(c: AdminCtx): Promise<TicketRow> {
  const n = Number(c.req.param("number"));
  const t = Number.isInteger(n) ? await c.env.DB.prepare("SELECT * FROM support_tickets WHERE number = ?1").bind(n).first<TicketRow>() : null;
  if (!t || (t.private === 1 && !can(c, "tickets.private"))) throw notFound("request_not_found");
  return t;
}

admin.get("/support", async (c) => {
  await need(c, "tickets");
  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  const status = c.req.query("status") ?? "active";
  if (status === "active") where.push("t.status IN ('open', 'working')");
  else if (STATUSES.includes(status as TicketStatus)) where.push(`t.status = ${arg(status)}`);
  const kind = c.req.query("kind");
  if (kind) where.push(`t.kind = ${arg(kind)}`);
  if (c.req.query("mine") === "1") where.push(`t.assignee_id = ${arg(c.get("caller").userId)}`);
  const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 100);
  if (q) {
    const num = Number(q.replace(/^w-?/i, ""));
    const like = arg(likeOf(q));
    const parts = [`lower(t.subject) LIKE ${like} ESCAPE '\\'`];
    if (Number.isInteger(num) && num > 0) parts.push(`t.number = ${arg(num)}`);
    if (can(c, "users.email")) parts.push(`t.email LIKE ${like} ESCAPE '\\'`);
    where.push(`(${parts.join(" OR ")})`);
  }
  if (!can(c, "tickets.private")) where.push("t.private = 0");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countArgs = [...args];
  const { results } = await c.env.DB.prepare(
    `SELECT ${TICKET_COLS} FROM ${TICKET_FROM} ${whereSql}
     ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT ${arg(limit)} OFFSET ${arg(offset)}`,
  )
    .bind(...args)
    .all<TicketJoined>();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM support_tickets t ${whereSql}`).bind(...countArgs).first<{ n: number }>();
  const counts = await c.env.DB.prepare(`SELECT status, COUNT(*) AS n FROM support_tickets ${can(c, "tickets.private") ? "" : "WHERE private = 0"} GROUP BY status`).all<{
    status: string;
    n: number;
  }>();
  return c.json({
    total: total?.n ?? 0,
    counts: Object.fromEntries(counts.results.map((r) => [r.status, r.n])),
    requests: results.map((t) => ticketAdminView(c, t)),
  });
});

admin.get("/support/:number", async (c) => {
  await need(c, "tickets");
  const t = await ticketByNumber(c);
  const full = await c.env.DB.prepare(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.id = ?1`).bind(t.id).first<TicketJoined>();
  const { results } = await c.env.DB.prepare(
    "SELECT m.*, u.display_name AS author_name FROM support_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ?1 ORDER BY m.created_at",
  )
    .bind(t.id)
    .all<MessageRow & { author_name: string | null }>();
  const others = await c.env.DB.prepare(
    "SELECT number, subject, status, created_at FROM support_tickets WHERE (email = ?1 OR (user_id IS NOT NULL AND user_id = ?2)) AND id != ?3 ORDER BY created_at DESC LIMIT 10",
  )
    .bind(t.email, t.user_id, t.id)
    .all<{ number: number; subject: string; status: string; created_at: number }>();
  return c.json({
    ...ticketAdminView(c, full!),
    messages: results.map((m) => messageView(m, m.author === "person" ? (t.name ?? full?.user_name ?? null) : m.author_name)),
    others: others.results.map((o) => ({ number: o.number, subject: o.subject, status: o.status, createdAt: o.created_at })),
  });
});

/** Answer the person: mail from support@ and, for an account, a note in the app. */
admin.post("/support/:number/reply", async (c) => {
  await need(c, "tickets");
  const t = await ticketByNumber(c);
  const b = await body(c.req);
  const text = str(b.body, "body", 10_000);
  const status = (b.status === "solved" || b.status === "working" ? b.status : "waiting") as TicketStatus;
  const m = await addMessage(c.env, t, { author: "team", authorId: c.get("caller").userId, body: text, via: "dashboard" }, status);
  const mailed = await sendSupportMail(c.env, { to: t.email, ...supportMail(status === "solved" ? "solved" : "reply", t, text), replyTo: replyAddress(c.env, t.reply_key) });
  const stmts: D1PreparedStatement[] = [logStmt(c, "admin.support.replied", t.user_id ?? t.id, { request: t.number, status, mailed })];
  const events: EventEnvelope[] = [];
  if (t.user_id) {
    const n = notifyStmt(c.env.DB, t.user_id, {
      id: `support:${t.id}:${m.id}`,
      topic: "support.reply",
      title: `${ticketRef(t.number)} · ${t.subject}`,
      excerpt: text.slice(0, 300),
      link: `${SUPPORT_SITE}/requests/${t.number}`,
    });
    stmts.push(n.stmt);
    events.push(n.envelope);
  }
  await c.env.DB.batch(stmts);
  emit(c as unknown as Context<AppEnv>, events);
  return c.json({ ok: true, mailed, message: messageView(m) });
});

admin.post("/support/:number/note", async (c) => {
  await need(c, "tickets");
  const t = await ticketByNumber(c);
  const text = str((await body(c.req)).body, "body", 10_000);
  const m = await addMessage(c.env, t, { author: "note", authorId: c.get("caller").userId, body: text, via: "dashboard" });
  return c.json(messageView(m), 201);
});

admin.patch("/support/:number", async (c) => {
  await need(c, "tickets");
  const t = await ticketByNumber(c);
  const b = await body(c.req);
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => {
    args.push(v);
    sets.push(`${col} = ?${args.length}`);
  };
  const changed: Record<string, unknown> = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status as TicketStatus)) throw bad("invalid_status");
    set("status", b.status);
    set("closed_at", b.status === "solved" || b.status === "closed" ? (t.closed_at ?? now()) : null);
    changed.status = b.status;
  }
  if (b.priority !== undefined) {
    if (!["low", "normal", "high", "urgent"].includes(b.priority as string)) throw bad("invalid_priority");
    set("priority", b.priority);
    changed.priority = b.priority;
  }
  if (b.assignee !== undefined) {
    if (b.assignee !== null && (typeof b.assignee !== "string" || !(await roleOf(c as unknown as Context<AppEnv>, b.assignee)))) throw bad("invalid_assignee", "Assign to someone on the team.");
    set("assignee_id", b.assignee);
    changed.assignee = b.assignee;
  }
  if (b.kind !== undefined) {
    set("kind", assertKind(b.kind));
    changed.kind = b.kind;
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > 10 || b.tags.some((x) => typeof x !== "string" || x.length > 30)) throw bad("invalid_tags");
    set("tags", JSON.stringify(b.tags));
    changed.tags = b.tags;
  }
  if (!sets.length) return c.json({ ok: true });
  set("updated_at", now());
  args.push(t.id);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE support_tickets SET ${sets.join(", ")} WHERE id = ?${args.length}`).bind(...args),
    logStmt(c, "admin.support.updated", t.user_id ?? t.id, { request: t.number, ...changed }),
  ]);
  return c.json({ ok: true });
});

admin.get("/support-files/*", async (c) => {
  await need(c, "tickets");
  const key = c.req.path.replace(/^.*?\/support-files\//, "");
  const f = await c.env.DB.prepare("SELECT f.mime, t.private FROM support_files f LEFT JOIN support_tickets t ON t.id = f.ticket_id WHERE f.key = ?1")
    .bind(key)
    .first<{ mime: string; private: number | null }>();
  if (!f || (f.private === 1 && !can(c, "tickets.private")) || !c.env.PROFILE_FILES) throw notFound();
  const obj = await c.env.PROFILE_FILES.get(key);
  if (!obj) throw notFound();
  return new Response(obj.body, { headers: { "content-type": f.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});

// ---------------------------------------------------------------------------
// Deletion, export and the workspace trash (domain/deletion.ts)
// ---------------------------------------------------------------------------

admin.get("/deletions", async (c) => {
  await need(c, "users.read");
  const { results } = await c.env.DB.prepare(
    `SELECT ${LIST_COLS}, u.deletion_requested_at, u.deletion_due_at, u.deletion_by FROM users u WHERE u.deletion_due_at IS NOT NULL ORDER BY u.deletion_due_at`,
  ).all<UserListRow & { deletion_requested_at: number; deletion_due_at: number; deletion_by: string }>();
  const owners = envOwners(c.env.ADMIN_OWNERS);
  return c.json(results.map((r) => ({ ...listItem(c, r, owners), requestedAt: r.deletion_requested_at, dueAt: r.deletion_due_at, by: r.deletion_by })));
});

/** Schedule the 30 days ({ now: false }) or erase at once ({ now: true }). */
admin.post("/users/:id/delete", async (c) => {
  await need(c, "users.delete");
  const id = c.req.param("id");
  const b = await body(c.req);
  const reason = reasonOf(b.reason);
  if (!(await userById(c.env.DB, id))) throw notFound("user_not_found");
  await guardTarget(c, id);
  const caller = c.get("caller");
  if (b.now === true) {
    await logStmt(c, "admin.user.erased", id, { reason }).run();
    emit(c as unknown as Context<AppEnv>, await eraseAccount(c.env, id, "team"));
    return c.json({ ok: true, erased: true });
  }
  const r = await scheduleDeletion(c.env, id, { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor, who: "team", reason }, b.lang === "en" ? "en" : "ar");
  emit(c as unknown as Context<AppEnv>, r.events);
  return c.json({ ok: true, dueAt: r.dueAt });
});

admin.post("/users/:id/deletion/cancel", async (c) => {
  await need(c, "users.delete");
  const id = c.req.param("id");
  const caller = c.get("caller");
  const ok = await cancelDeletion(c.env, id, { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor, who: "team" });
  if (!ok) throw notFound("not_scheduled", "This account is not scheduled for deletion.");
  return c.json({ ok: true });
});

admin.get("/users/:id/export", async (c) => {
  await need(c, "users.export");
  const id = c.req.param("id");
  if (!(await userById(c.env.DB, id))) throw notFound("user_not_found");
  await logStmt(c, "admin.user.exported", id).run();
  return c.json(await exportAccount(c.env.DB, id));
});

// ---------------------------------------------------------------------------
// Reserved usernames and words not allowed in names (lib/names.ts)
// ---------------------------------------------------------------------------

admin.get("/names", async (c) => {
  await need(c, "names");
  const [reserved, banned] = await c.env.DB.batch<{ name?: string; word?: string; reason?: string | null; added_at: number; added_by: string | null }>([
    c.env.DB.prepare("SELECT name, reason, added_at, added_by FROM reserved_names ORDER BY name"),
    c.env.DB.prepare("SELECT word, added_at, added_by FROM banned_words ORDER BY word"),
  ]);
  return c.json({
    reserved: reserved.results.map((r) => ({ name: r.name, reason: r.reason ?? null, addedAt: r.added_at })),
    banned: banned.results.map((r) => ({ word: r.word, addedAt: r.added_at })),
  });
});

admin.post("/names/reserved", async (c) => {
  await need(c, "names");
  const b = await body(c.req);
  const name = checkUsername(b.name);
  const taken = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?1").bind(name).first();
  if (taken) throw conflict("username_taken", "Someone already has that username.");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO reserved_names (name, reason, added_by, added_at) VALUES (?1, ?2, ?3, ?4)").bind(name, optStr(b.reason, "reason", 200) ?? null, c.get("caller").userId, now()),
    logStmt(c, "admin.names.reserved", c.get("caller").userId, { name }),
  ]);
  return c.json({ ok: true, name }, 201);
});

admin.delete("/names/reserved/:name", async (c) => {
  await need(c, "names");
  const name = c.req.param("name").toLowerCase();
  const r = await c.env.DB.prepare("DELETE FROM reserved_names WHERE name = ?1").bind(name).run();
  if (!r.meta.changes) throw notFound();
  await logStmt(c, "admin.names.released", c.get("caller").userId, { name }).run();
  return c.json({ ok: true });
});

admin.post("/names/banned", async (c) => {
  await need(c, "names");
  const word = foldName(str((await body(c.req)).word, "word", 40)).trim();
  if (word.length < 2) throw bad("invalid_word", "Use at least two letters.");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO banned_words (word, added_by, added_at) VALUES (?1, ?2, ?3)").bind(word, c.get("caller").userId, now()),
    logStmt(c, "admin.names.banned", c.get("caller").userId, { count: 1 }),
  ]);
  return c.json({ ok: true, word }, 201);
});

admin.delete("/names/banned/:word", async (c) => {
  await need(c, "names");
  const r = await c.env.DB.prepare("DELETE FROM banned_words WHERE word = ?1").bind(foldName(decodeURIComponent(c.req.param("word")))).run();
  if (!r.meta.changes) throw notFound();
  await logStmt(c, "admin.names.unbanned", c.get("caller").userId, { count: 1 }).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public content: profiles, published pages, shared workspaces (lib/content.ts)
// ---------------------------------------------------------------------------

const likeQ = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (m) => "\\" + m)}%`;

async function tellOwner(c: AdminCtx, ownerId: string, title: string, reason: string, tell: boolean) {
  if (!tell) return;
  const owner = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(ownerId).first<{ email: string }>();
  if (owner) await sendSupportMail(c.env, { to: owner.email, ...noticeMail("ar", "content_removed", { title, reason }) });
  const n = notifyStmt(c.env.DB, ownerId, { id: `content:${ownerId}:${now()}`, topic: "content.removed", title, excerpt: reason });
  await n.stmt.run();
  emit(c as unknown as Context<AppEnv>, [n.envelope]);
}

admin.get("/content/profiles", async (c) => {
  await need(c, "content");
  const q = (c.req.query("q") ?? "").trim();
  const state = c.req.query("state") ?? "all";
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    args.push(likeQ(q));
    where.push(`(u.username LIKE ?${args.length} ESCAPE '\\' OR lower(u.display_name) LIKE ?${args.length} ESCAPE '\\')`);
  }
  if (state === "visible") where.push("p.visible = 1 AND p.team_hidden = 0");
  else if (state === "hidden") where.push("p.visible = 0");
  else if (state === "team") where.push("p.team_hidden = 1");
  const { results } = await c.env.DB.prepare(
    `SELECT p.user_id, p.visible, p.team_hidden, p.team_reason, p.published_at, p.updated_at, p.avatar_key IS NOT NULL AS avatar, u.username, u.display_name
     FROM public_profiles p JOIN users u ON u.id = p.user_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.team_hidden DESC, p.updated_at DESC LIMIT 200`,
  )
    .bind(...args)
    .all<{ user_id: string; visible: number; team_hidden: number; team_reason: string | null; published_at: number; updated_at: number; avatar: number; username: string; display_name: string }>();
  return c.json(
    await Promise.all(
      results.map(async (r) => ({
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name,
        visible: r.visible === 1,
        teamHidden: r.team_hidden === 1,
        teamReason: r.team_reason,
        publishedAt: r.published_at,
        updatedAt: r.updated_at,
        reports: await reportersOf(c.env.DB, { type: "profile", username: r.username }),
      })),
    ),
  );
});

admin.get("/content/pages", async (c) => {
  await need(c, "content");
  const q = (c.req.query("q") ?? "").trim();
  const kind = c.req.query("kind");
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    args.push(likeQ(q));
    where.push(`(lower(p.title) LIKE ?${args.length} ESCAPE '\\' OR u.username LIKE ?${args.length} ESCAPE '\\' OR p.slug LIKE ?${args.length} ESCAPE '\\')`);
  }
  if (kind === "page" || kind === "share") {
    args.push(kind);
    where.push(`p.kind = ?${args.length}`);
  }
  if (c.req.query("state") === "team") where.push("p.team_hidden = 1");
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.kind, p.title, p.lang, p.views, p.expires_at, p.password_hash IS NOT NULL AS locked, p.team_hidden, p.team_reason, p.created_at, p.updated_at, u.id AS user_id, u.username, u.display_name
     FROM published_pages p JOIN users u ON u.id = p.user_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.team_hidden DESC, p.updated_at DESC LIMIT 200`,
  )
    .bind(...args)
    .all<Record<string, unknown>>();
  return c.json(
    await Promise.all(
      results.map(async (r) => ({
        id: r.id,
        slug: r.slug,
        kind: r.kind,
        title: r.title,
        lang: r.lang,
        views: r.views,
        expiresAt: r.expires_at,
        locked: r.locked === 1,
        teamHidden: r.team_hidden === 1,
        teamReason: r.team_reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name,
        reports: await reportersOf(c.env.DB, r.kind === "share" ? { type: "share", slug: String(r.slug) } : { type: "page", username: String(r.username), slug: String(r.slug) }),
      })),
    ),
  );
});

/** Hide or show a profile ({ username }) or a published page ({ pageId }), with a reason the owner is told. */
admin.post("/content/hide", async (c) => {
  await need(c, "content");
  const b = await body(c.req);
  const hidden = b.hidden !== false;
  const reason = hidden ? reasonOf(b.reason) : (optStr(b.reason, "reason", 500) ?? "");
  let target: Target | null = null;
  if (typeof b.username === "string") target = { type: "profile", username: b.username.toLowerCase() };
  else if (typeof b.pageId === "string") {
    const p = await c.env.DB.prepare("SELECT p.kind, p.slug, u.username FROM published_pages p JOIN users u ON u.id = p.user_id WHERE p.id = ?1").bind(b.pageId).first<{ kind: string; slug: string; username: string }>();
    if (p) target = p.kind === "share" ? { type: "share", slug: p.slug } : { type: "page", username: p.username, slug: p.slug };
  }
  if (!target) throw notFound("content_not_found");
  const hit = await setTeamHidden(c.env.DB, target, hidden, hidden ? reason : null);
  if (!hit) throw notFound("content_not_found");
  await logStmt(c, hidden ? "admin.content.hidden" : "admin.content.shown", hit.ownerId, { content: targetKey(target), reason }).run();
  if (hidden) await tellOwner(c, hit.ownerId, hit.title, reason, b.tell !== false);
  return c.json({ ok: true });
});

admin.get("/content/workspaces", async (c) => {
  await need(c, "content");
  const q = (c.req.query("q") ?? "").trim();
  const trash = c.req.query("state") === "trash";
  const args: unknown[] = [];
  const where = [trash ? "w.deleted_at IS NOT NULL" : "w.deleted_at IS NULL"];
  if (q) {
    args.push(likeQ(q));
    where.push(`(lower(w.name) LIKE ?${args.length} ESCAPE '\\' OR o.username LIKE ?${args.length} ESCAPE '\\')`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.name, w.created_at, w.updated_at, w.deleted_at, o.id AS owner_id, o.username AS owner_username, o.display_name AS owner_name,
       (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS members,
       (SELECT COUNT(*) FROM pages p WHERE p.workspace_id = w.id) AS pages
     FROM workspaces w JOIN users o ON o.id = w.owner_id WHERE ${where.join(" AND ")} ORDER BY w.updated_at DESC LIMIT 200`,
  )
    .bind(...args)
    .all<Record<string, unknown>>();
  return c.json(
    results.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
      deletedAt: w.deleted_at,
      owner: { id: w.owner_id, username: w.owner_username, name: w.owner_name },
      members: w.members,
      pages: w.pages,
    })),
  );
});

admin.get("/content/workspaces/:id", async (c) => {
  await need(c, "content");
  const { results } = await c.env.DB.prepare(
    "SELECT u.id, u.username, u.display_name, m.role, m.joined_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?1 ORDER BY m.joined_at",
  )
    .bind(c.req.param("id"))
    .all<{ id: string; username: string; display_name: string; role: string; joined_at: number }>();
  return c.json(results.map((m) => ({ id: m.id, username: m.username, displayName: m.display_name, role: m.role, joinedAt: m.joined_at })));
});

/** Give a workspace to one of its members (the old owner becomes an admin). */
admin.post("/content/workspaces/:id/owner", async (c) => {
  await need(c, "content.workspaces");
  const id = c.req.param("id");
  const b = await body(c.req);
  const reason = reasonOf(b.reason);
  const to = str(b.userId, "userId", 64);
  const w = await c.env.DB.prepare("SELECT owner_id FROM workspaces WHERE id = ?1").bind(id).first<{ owner_id: string }>();
  if (!w) throw notFound("workspace_not_found");
  const member = await c.env.DB.prepare("SELECT 1 FROM members WHERE workspace_id = ?1 AND user_id = ?2").bind(id, to).first();
  if (!member) throw bad("not_a_member", "The new owner must be a member of the workspace.");
  const ev = eventStmt(c.env.DB, { type: "access.changed", workspaceId: id, docIds: null, userIds: [w.owner_id, to] });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE workspaces SET owner_id = ?1, updated_at = ?2 WHERE id = ?3").bind(to, now(), id),
    c.env.DB.prepare("UPDATE members SET role = 'admin' WHERE workspace_id = ?1 AND user_id = ?2").bind(id, w.owner_id),
    c.env.DB.prepare("UPDATE members SET role = 'owner' WHERE workspace_id = ?1 AND user_id = ?2").bind(id, to),
    logStmt(c, "admin.workspace.owner_changed", to, { workspace: id, from: w.owner_id, reason }),
    ev.stmt,
  ]);
  emit(c as unknown as Context<AppEnv>, [ev.envelope]);
  return c.json({ ok: true });
});

/** Into the trash ({ restore: false }) or back out of it ({ restore: true }). */
admin.post("/content/workspaces/:id/trash", async (c) => {
  await need(c, "content.workspaces");
  const id = c.req.param("id");
  const b = await body(c.req);
  const reason = reasonOf(b.reason);
  const restore = b.restore === true;
  const w = await c.env.DB.prepare("SELECT owner_id, deleted_at FROM workspaces WHERE id = ?1").bind(id).first<{ owner_id: string; deleted_at: number | null }>();
  if (!w || (restore ? !w.deleted_at : !!w.deleted_at)) throw notFound("workspace_not_found");
  const ev = eventStmt(c.env.DB, restore ? { type: "access.changed", workspaceId: id, docIds: null, userIds: null } : { type: "workspace.deleted", workspaceId: id });
  await c.env.DB.batch([
    restore
      ? c.env.DB.prepare("UPDATE workspaces SET deleted_at = NULL, deleted_by = NULL, updated_at = ?1 WHERE id = ?2").bind(now(), id)
      : c.env.DB.prepare("UPDATE workspaces SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1 WHERE id = ?3").bind(now(), c.get("caller").userId, id),
    logStmt(c, restore ? "admin.workspace.restored" : "admin.workspace.deleted", w.owner_id, { workspace: id, reason }),
    ev.stmt,
  ]);
  emit(c as unknown as Context<AppEnv>, [ev.envelope]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Suspicious accounts
// ---------------------------------------------------------------------------

/** Throwaway mail services; a sign-up from one is worth a look. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "temp-mail.org", "tempmail.com", "tempmail.net",
  "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com", "throwawaymail.com", "mohmal.com", "emailondeck.com",
  "mintemail.com", "spamgourmet.com", "tempr.email", "tempmailo.com", "minuteinbox.com", "mail.tm", "moakt.com", "emailfake.com",
]);
/** Words that pretend to speak for Worlds. */
const IMPERSONATION = ["worlds", "support", "admin", "official", "staff", "claude", "anthropic", "enterworlds", "وورلدز", "الدعم", "رسمي"];

admin.get("/suspicious", async (c) => {
  await need(c, "content");
  const t = now();
  const since = t - 30 * 86_400_000;
  const owners = envOwners(c.env.ADMIN_OWNERS);
  const { results } = await c.env.DB.prepare(
    `SELECT ${LIST_COLS},
       (SELECT COUNT(*) FROM published_pages p WHERE p.user_id = u.id AND p.created_at < u.created_at + 3600000) AS quick_pages,
       (SELECT r.reviewed_at FROM suspicious_reviews r WHERE r.user_id = u.id) AS reviewed_at
     FROM users u WHERE u.created_at > ?1 ORDER BY u.created_at DESC LIMIT 1000`,
  )
    .bind(since)
    .all<UserListRow & { quick_pages: number; reviewed_at: number | null }>();
  // Bursts: five or more sign-ups within ten minutes of each other.
  const times = results.map((r) => r.created_at).sort((a, b) => a - b);
  const inBurst = (ts: number) => times.filter((x) => Math.abs(x - ts) <= 5 * 60_000).length >= 5;
  const out = [];
  for (const r of results) {
    if (r.reviewed_at || owners.includes(r.id) || r.team_role) continue;
    const reasons: string[] = [];
    const domain = r.email.split("@")[1]?.toLowerCase() ?? "";
    if (DISPOSABLE.has(domain)) reasons.push("disposable_email");
    const name = foldName(`${r.username ?? ""} ${r.display_name}`);
    if (IMPERSONATION.some((w) => name.includes(foldName(w)))) reasons.push("impersonation");
    if (r.quick_pages >= 3) reasons.push("quick_publishing");
    if (inBurst(r.created_at)) reasons.push("signup_burst");
    if (r.username && (await reportersOf(c.env.DB, { type: "profile", username: r.username })) > 0) reasons.push("reported");
    if (reasons.length) out.push({ ...listItem(c, r, owners), reasons });
  }
  return c.json(out.slice(0, 200));
});

admin.post("/suspicious/:id/review", async (c) => {
  await need(c, "content");
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO suspicious_reviews (user_id, reviewed_by, reviewed_at) VALUES (?1, ?2, ?3)").bind(id, c.get("caller").userId, now()),
    logStmt(c, "admin.suspicious.reviewed", id),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Community: suggestions, testers, surveys, messages (routes/community.ts)
// ---------------------------------------------------------------------------

admin.get("/suggestions", async (c) => {
  await need(c, "community");
  const status = c.req.query("status");
  const args: unknown[] = [];
  const where: string[] = [];
  if (status && SUGGESTION_STATUSES.includes(status as SuggestionStatus)) {
    args.push(status);
    where.push(`s.status = ?${args.length}`);
  }
  if (c.req.query("public") === "0") where.push("s.public = 0");
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS votes, u.display_name AS user_name, u.username AS user_username
     FROM suggestions s LEFT JOIN users u ON u.id = s.user_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.public, votes DESC, s.updated_at DESC LIMIT 300`,
  )
    .bind(...args)
    .all<SuggestionRow & { user_name: string | null; user_username: string | null }>();
  return c.json(
    results.map((s) => ({
      ...suggestionView(s),
      public: s.public === 1,
      mergedInto: s.merged_into,
      userId: s.user_id,
      userName: s.user_name,
      userUsername: s.user_username,
      email: can(c, "users.email") ? s.email : null,
    })),
  );
});

/** Approve for the board, move along the roadmap, note the version it shipped in. Shipping tells everyone who voted. */
admin.patch("/suggestions/:id", async (c) => {
  await need(c, "community");
  const id = c.req.param("id");
  const s = await c.env.DB.prepare("SELECT * FROM suggestions WHERE id = ?1").bind(id).first<SuggestionRow>();
  if (!s) throw notFound();
  const b = await body(c.req);
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => {
    args.push(v);
    sets.push(`${col} = ?${args.length}`);
  };
  if (b.status !== undefined) {
    if (!SUGGESTION_STATUSES.includes(b.status as SuggestionStatus)) throw bad("invalid_status");
    set("status", b.status);
  }
  if (b.public !== undefined) set("public", b.public ? 1 : 0);
  if (b.title !== undefined) set("title", str(b.title, "title", 140));
  if (b.body !== undefined) set("body", optStr(b.body, "body", 4000) ?? "");
  if (b.shippedIn !== undefined) set("shipped_in", optStr(b.shippedIn, "shippedIn", 20) ?? null);
  if (b.teamNote !== undefined) set("team_note", optStr(b.teamNote, "teamNote", 500) ?? null);
  if (!sets.length) return c.json({ ok: true });
  set("updated_at", now());
  args.push(id);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE suggestions SET ${sets.join(", ")} WHERE id = ?${args.length}`).bind(...args), logStmt(c, "admin.suggestion.updated", c.get("caller").userId, { suggestion: s.number, ...b })]);
  let told = 0;
  if (b.status === "shipped" && s.status !== "shipped") {
    const version = (optStr(b.shippedIn, "shippedIn", 20) ?? s.shipped_in) || "";
    const { results } = await c.env.DB.prepare("SELECT voter FROM suggestion_votes WHERE suggestion_id = ?1 AND voter LIKE 'u:%'").bind(id).all<{ voter: string }>();
    const stmts = results.map((v) =>
      notifyStmt(c.env.DB, v.voter.slice(2), {
        id: `idea:${id}:shipped`,
        topic: "suggestion.shipped",
        title: s.title,
        excerpt: version ? `Worlds ${version}` : "",
        link: "https://support.enterworlds.space/roadmap",
      }),
    );
    if (stmts.length) await c.env.DB.batch(stmts.map((x) => x.stmt));
    emit(c as unknown as Context<AppEnv>, stmts.map((x) => x.envelope));
    told = stmts.length;
  }
  return c.json({ ok: true, told });
});

/** Fold a duplicate into another idea: its votes move over and it stops showing. */
admin.post("/suggestions/:id/merge", async (c) => {
  await need(c, "community");
  const id = c.req.param("id");
  const into = str((await body(c.req)).into, "into", 64);
  if (into === id) throw bad("same_suggestion");
  const target = await c.env.DB.prepare("SELECT id, number FROM suggestions WHERE id = ?1").bind(into).first<{ id: string; number: number }>();
  if (!target) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO suggestion_votes (suggestion_id, voter, created_at) SELECT ?1, voter, created_at FROM suggestion_votes WHERE suggestion_id = ?2").bind(into, id),
    c.env.DB.prepare("DELETE FROM suggestion_votes WHERE suggestion_id = ?1").bind(id),
    c.env.DB.prepare("UPDATE suggestions SET status = 'duplicate', merged_into = ?1, public = 0, updated_at = ?2 WHERE id = ?3").bind(into, now(), id),
    logStmt(c, "admin.suggestion.merged", c.get("caller").userId, { into: target.number }),
  ]);
  return c.json({ ok: true });
});

admin.get("/testers", async (c) => {
  await need(c, "community");
  const { results } = await c.env.DB.prepare(
    "SELECT t.*, u.display_name, u.username FROM testers t JOIN users u ON u.id = t.user_id ORDER BY CASE t.status WHEN 'applied' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, t.applied_at DESC",
  ).all<{ user_id: string; status: string; platforms: string; note: string | null; applied_at: number; decided_at: number | null; display_name: string; username: string }>();
  return c.json(
    results.map((t) => ({ userId: t.user_id, displayName: t.display_name, username: t.username, status: t.status, platforms: safeJson<string[]>(t.platforms, []), note: t.note, appliedAt: t.applied_at, decidedAt: t.decided_at })),
  );
});

admin.post("/testers/:id", async (c) => {
  await need(c, "community");
  const id = c.req.param("id");
  const status = (await body(c.req)).status;
  if (status !== "accepted" && status !== "removed") throw bad("invalid_status");
  const r = await c.env.DB.prepare("UPDATE testers SET status = ?1, decided_at = ?2, decided_by = ?3 WHERE user_id = ?4").bind(status, now(), c.get("caller").userId, id).run();
  if (!r.meta.changes) throw notFound();
  await logStmt(c, `admin.testers.${status}`, id).run();
  if (status === "accepted") {
    const n = notifyStmt(c.env.DB, id, { id: `tester:${id}:accepted`, topic: "testers.accepted", title: "Worlds", excerpt: "testers.accepted" });
    await n.stmt.run();
    emit(c as unknown as Context<AppEnv>, [n.envelope]);
  }
  return c.json({ ok: true });
});

admin.get("/surveys", async (c) => {
  await need(c, "community");
  const { results } = await c.env.DB.prepare("SELECT * FROM surveys ORDER BY created_at DESC LIMIT 50").all<{
    id: string;
    question_ar: string;
    question_en: string;
    choices: string;
    audience: string;
    active: number;
    created_at: number;
    ends_at: number | null;
  }>();
  const out = [];
  for (const s of results) {
    const answers = await c.env.DB.prepare("SELECT choice, text, created_at FROM survey_answers WHERE survey_id = ?1 ORDER BY created_at DESC").bind(s.id).all<{ choice: number | null; text: string | null; created_at: number }>();
    const choices = safeJson<{ ar: string; en: string }[]>(s.choices, []);
    out.push({
      id: s.id,
      question: { ar: s.question_ar, en: s.question_en },
      choices,
      audience: s.audience,
      active: s.active === 1,
      createdAt: s.created_at,
      endsAt: s.ends_at,
      answers: answers.results.length,
      counts: choices.map((_, i) => answers.results.filter((a) => a.choice === i).length),
      texts: choices.length ? [] : answers.results.slice(0, 200).map((a) => ({ text: a.text, at: a.created_at })),
    });
  }
  return c.json(out);
});

admin.post("/surveys", async (c) => {
  await need(c, "community");
  const b = await body(c.req);
  const choices = Array.isArray(b.choices) ? (b.choices as unknown[]).slice(0, 8) : [];
  const clean = choices.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return { ar: str(o.ar, "choice.ar", 80), en: str(o.en, "choice.en", 80) };
  });
  const id = newId();
  const days = Number(b.days);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO surveys (id, question_ar, question_en, choices, audience, created_by, created_at, ends_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(
      id,
      str(b.questionAr, "questionAr", 300),
      str(b.questionEn, "questionEn", 300),
      JSON.stringify(clean),
      b.audience === "testers" ? "testers" : "all",
      c.get("caller").userId,
      now(),
      Number.isInteger(days) && days > 0 ? now() + days * 86_400_000 : null,
    ),
    logStmt(c, "admin.survey.created", c.get("caller").userId, { survey: id }),
  ]);
  return c.json({ id }, 201);
});

admin.patch("/surveys/:id", async (c) => {
  await need(c, "community");
  const active = (await body(c.req)).active;
  if (typeof active !== "boolean") throw bad("invalid_request");
  const r = await c.env.DB.prepare("UPDATE surveys SET active = ?1 WHERE id = ?2").bind(active ? 1 : 0, c.req.param("id")).run();
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** Every conversation with people, newest first; the person's unread replies first. */
admin.get("/messages", async (c) => {
  await need(c, "messages");
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, u.display_name, u.username,
       (SELECT m.author FROM team_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_author,
       (SELECT m.body FROM team_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
     FROM team_threads t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 200`,
  ).all<{ id: string; user_id: string; subject: string; status: string; created_at: number; updated_at: number; display_name: string; username: string; last_author: string; last_body: string }>();
  return c.json(results.map((t) => ({ id: t.id, userId: t.user_id, displayName: t.display_name, username: t.username, subject: t.subject, status: t.status, updatedAt: t.updated_at, lastAuthor: t.last_author, last: t.last_body })));
});

admin.get("/messages/:id", async (c) => {
  await need(c, "messages");
  const t = await c.env.DB.prepare("SELECT t.*, u.display_name, u.username FROM team_threads t JOIN users u ON u.id = t.user_id WHERE t.id = ?1").bind(c.req.param("id")).first<{
    id: string;
    user_id: string;
    subject: string;
    status: string;
    display_name: string;
    username: string;
  }>();
  if (!t) throw notFound();
  const { results } = await c.env.DB.prepare("SELECT m.*, a.display_name AS author_name FROM team_messages m LEFT JOIN users a ON a.id = m.author_id WHERE m.thread_id = ?1 ORDER BY m.created_at")
    .bind(t.id)
    .all<{ id: string; author: string; author_name: string | null; body: string; created_at: number; read_at: number | null }>();
  return c.json({
    id: t.id,
    userId: t.user_id,
    displayName: t.display_name,
    username: t.username,
    subject: t.subject,
    status: t.status,
    messages: results.map((m) => ({ id: m.id, author: m.author, authorName: m.author_name, body: m.body, createdAt: m.created_at, read: !!m.read_at })),
  });
});

async function sendTeamMessage(c: AdminCtx, threadId: string, userId: string, subject: string, text: string, mail: boolean) {
  const id = newId();
  const n = notifyStmt(c.env.DB, userId, { id: `dm:${id}`, topic: "messages.team", title: subject, excerpt: text.slice(0, 300) });
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO team_messages (id, thread_id, author, author_id, body, created_at) VALUES (?1, ?2, 'team', ?3, ?4, ?5)").bind(id, threadId, c.get("caller").userId, text, now()),
    c.env.DB.prepare("UPDATE team_threads SET updated_at = ?1, status = 'open' WHERE id = ?2").bind(now(), threadId),
    logStmt(c, "admin.message.sent", userId, { thread: threadId }),
    n.stmt,
  ]);
  emit(c as unknown as Context<AppEnv>, [n.envelope]);
  if (mail) {
    const u = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(userId).first<{ email: string }>();
    if (u) await sendSupportMail(c.env, { to: u.email, ...noticeMail("ar", "team_message", { body: text }) });
  }
  return id;
}

/** Start a conversation with one person: it appears in their app; with { email: true } they also get it by email. */
admin.post("/users/:id/messages", async (c) => {
  await need(c, "messages");
  const userId = c.req.param("id");
  if (!(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(userId).first())) throw notFound("user_not_found");
  const b = await body(c.req);
  const subject = str(b.subject, "subject", 140);
  const text = str(b.body, "body", 4000);
  const threadId = newId();
  await c.env.DB.prepare("INSERT INTO team_threads (id, user_id, subject, started_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)").bind(threadId, userId, subject, c.get("caller").userId, now()).run();
  await sendTeamMessage(c, threadId, userId, subject, text, b.email === true);
  return c.json({ id: threadId }, 201);
});

admin.post("/messages/:id", async (c) => {
  await need(c, "messages");
  const t = await c.env.DB.prepare("SELECT id, user_id, subject FROM team_threads WHERE id = ?1").bind(c.req.param("id")).first<{ id: string; user_id: string; subject: string }>();
  if (!t) throw notFound();
  const b = await body(c.req);
  if (b.close === true) {
    await c.env.DB.prepare("UPDATE team_threads SET status = 'closed', updated_at = ?1 WHERE id = ?2").bind(now(), t.id).run();
    return c.json({ ok: true });
  }
  const id = await sendTeamMessage(c, t.id, t.user_id, t.subject, str(b.body, "body", 4000), b.email === true);
  return c.json({ id }, 201);
});

// ---------------------------------------------------------------------------
// Controls over the service (lib/control.ts, routes/config.ts)
// ---------------------------------------------------------------------------

admin.get("/control", async (c) => {
  await need(c, "control.read");
  const db = c.env.DB;
  const [flags, ann, invites, wait, blocked] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT * FROM feature_flags ORDER BY key"),
    db.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50"),
    db.prepare("SELECT label, max_uses, uses, expires_at, created_at, substr(code_hash, 1, 8) AS id FROM signup_invites ORDER BY created_at DESC LIMIT 100"),
    db.prepare("SELECT email, lang, created_at, invited_at FROM waitlist ORDER BY invited_at IS NOT NULL, created_at LIMIT 500"),
    db.prepare("SELECT value, kind, reason, added_at FROM blocked_emails ORDER BY added_at DESC"),
  ]);
  return c.json({
    settings: await settings(db),
    flags: flags.results.map((f) => ({ key: f.key, description: f.description, mode: f.mode, percent: f.percent, users: safeJson<string[]>(f.users as string, []), updatedAt: f.updated_at })),
    announcements: ann.results.map((a) => ({
      id: a.id,
      text: { ar: a.text_ar, en: a.text_en },
      level: a.level,
      link: a.link,
      platforms: safeJson<string[]>(a.platforms as string, []),
      minVersion: a.min_version,
      maxVersion: a.max_version,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      dismissible: a.dismissible === 1,
      active: a.active === 1,
      createdAt: a.created_at,
    })),
    invites: invites.results.map((i) => ({ id: i.id, label: i.label, maxUses: i.max_uses, uses: i.uses, expiresAt: i.expires_at, createdAt: i.created_at })),
    waitlist: wait.results.map((w) => ({ email: can(c, "users.email") ? w.email : null, lang: w.lang, createdAt: w.created_at, invitedAt: w.invited_at })),
    waitlistCount: wait.results.length,
    blocked: blocked.results.map((b) => ({ value: b.value, kind: b.kind, reason: b.reason, addedAt: b.added_at })),
  });
});

/** Change one setting (signups, maintenance, minVersion, publishing, incident). */
admin.put("/control/settings/:key", async (c) => {
  await need(c, "control");
  const key = c.req.param("key") as SettingKey;
  if (!SETTING_KEYS.includes(key)) throw bad("invalid_setting");
  const b = await body(c.req);
  const value = b.value as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad("invalid_value");
  const json = JSON.stringify(value);
  if (json.length > 8000) throw bad("too_large");
  if (key === "signups" && !["open", "closed", "invite"].includes(value.mode as string)) throw bad("invalid_value", "mode must be open, closed or invite");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO service_settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = ?4").bind(
      key,
      json,
      c.get("caller").userId,
      now(),
    ),
    logStmt(c, "admin.control.setting", c.get("caller").userId, { key, value }),
  ]);
  return c.json({ ok: true, settings: await settings(c.env.DB) });
});

admin.put("/control/flags/:key", async (c) => {
  await need(c, "control");
  const key = c.req.param("key");
  if (!/^[a-z][a-z0-9_.-]{1,40}$/.test(key)) throw bad("invalid_key", "Use lowercase letters, digits, dots, dashes and underscores.");
  const b = await body(c.req);
  const mode = b.mode as string;
  if (!["off", "all", "testers", "percent", "users"].includes(mode)) throw bad("invalid_mode");
  const percent = Math.min(Math.max(Number(b.percent ?? 0) || 0, 0), 100);
  const users = Array.isArray(b.users) ? b.users.filter((u): u is string => typeof u === "string").slice(0, 500) : [];
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO feature_flags (key, description, mode, percent, users, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(key) DO UPDATE SET description = COALESCE(?2, description), mode = ?3, percent = ?4, users = ?5, updated_at = ?6",
    ).bind(key, optStr(b.description, "description", 200) ?? null, mode, percent, JSON.stringify(users), now()),
    logStmt(c, "admin.control.flag", c.get("caller").userId, { key, mode, percent }),
  ]);
  return c.json({ ok: true });
});

admin.delete("/control/flags/:key", async (c) => {
  await need(c, "control");
  await c.env.DB.prepare("DELETE FROM feature_flags WHERE key = ?1").bind(c.req.param("key")).run();
  await logStmt(c, "admin.control.flag_removed", c.get("caller").userId, { key: c.req.param("key") }).run();
  return c.json({ ok: true });
});

admin.post("/control/announcements", async (c) => {
  await need(c, "control");
  const b = await body(c.req);
  const id = newId();
  const level = ["info", "warning", "critical"].includes(b.level as string) ? (b.level as string) : "info";
  const platforms = Array.isArray(b.platforms) ? b.platforms.filter((p): p is string => typeof p === "string").slice(0, 10) : [];
  const link = optStr(b.link, "link", 300) ?? null;
  if (link && !/^https:\/\//.test(link)) throw bad("invalid_link", "Links must start with https://");
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO announcements (id, text_ar, text_en, level, link, platforms, min_version, max_version, starts_at, ends_at, dismissible, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    ).bind(
      id,
      str(b.textAr, "textAr", 300),
      str(b.textEn, "textEn", 300),
      level,
      link,
      JSON.stringify(platforms),
      optStr(b.minVersion, "minVersion", 20) ?? null,
      optStr(b.maxVersion, "maxVersion", 20) ?? null,
      num(b.startsAt),
      num(b.endsAt),
      b.dismissible === false ? 0 : 1,
      c.get("caller").userId,
      now(),
    ),
    logStmt(c, "admin.control.announcement", c.get("caller").userId, { id, level }),
  ]);
  return c.json({ id }, 201);
});

admin.patch("/control/announcements/:id", async (c) => {
  await need(c, "control");
  const active = (await body(c.req)).active;
  if (typeof active !== "boolean") throw bad("invalid_request");
  const r = await c.env.DB.prepare("UPDATE announcements SET active = ?1 WHERE id = ?2").bind(active ? 1 : 0, c.req.param("id")).run();
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** A new invitation code. It is shown once; only its hash is kept. */
admin.post("/control/invites", async (c) => {
  await need(c, "control");
  const b = await body(c.req);
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
  const days = Number(b.days);
  const max = Math.min(Math.max(Number(b.maxUses ?? 1) || 1, 1), 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO signup_invites (code_hash, label, max_uses, expires_at, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(
      await sha256Hex(code),
      optStr(b.label, "label", 80) ?? null,
      max,
      Number.isInteger(days) && days > 0 ? now() + days * 86_400_000 : null,
      c.get("caller").userId,
      now(),
    ),
    logStmt(c, "admin.control.invite", c.get("caller").userId, { maxUses: max }),
  ]);
  return c.json({ code, maxUses: max }, 201);
});

/** Send an invitation code to people on the waiting list, from support@. */
admin.post("/control/waitlist/invite", async (c) => {
  await need(c, "control");
  const b = await body(c.req);
  const count = Math.min(Math.max(Number(b.count ?? 10) || 10, 1), 100);
  const { results } = await c.env.DB.prepare("SELECT email, lang FROM waitlist WHERE invited_at IS NULL ORDER BY created_at LIMIT ?1").bind(count).all<{ email: string; lang: string }>();
  let sent = 0;
  for (const w of results) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO signup_invites (code_hash, label, max_uses, expires_at, created_by, created_at) VALUES (?1, ?2, 1, ?3, ?4, ?5)").bind(await sha256Hex(code), "waitlist", now() + 30 * 86_400_000, c.get("caller").userId, now()),
      c.env.DB.prepare("UPDATE waitlist SET invited_at = ?1 WHERE email = ?2").bind(now(), w.email),
    ]);
    const lang = w.lang === "en" ? "en" : "ar";
    const text = lang === "ar" ? `رمز دعوتك: ${code}\nاكتبه عند إنشاء حسابك في Worlds. يعمل 30 يومًا.` : `Your invitation code: ${code}\nType it when you create your Worlds account. It works for 30 days.`;
    if (await sendSupportMail(c.env, { to: w.email, ...noticeMail(lang, "team_message", { body: text }) })) sent++;
  }
  await logStmt(c, "admin.control.waitlist_invited", c.get("caller").userId, { count: sent }).run();
  return c.json({ ok: true, sent });
});

admin.post("/control/blocked", async (c) => {
  await need(c, "control");
  const b = await body(c.req);
  const raw = str(b.value, "value", 254).toLowerCase().replace(/^@/, "");
  const kind = raw.includes("@") ? "email" : "domain";
  if (kind === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) throw bad("invalid_value", "Write an email address or a domain such as example.com");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO blocked_emails (value, kind, reason, added_by, added_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(raw, kind, optStr(b.reason, "reason", 200) ?? null, c.get("caller").userId, now()),
    logStmt(c, "admin.control.blocked", c.get("caller").userId, { kind }),
  ]);
  return c.json({ ok: true, kind }, 201);
});

admin.delete("/control/blocked/:value", async (c) => {
  await need(c, "control");
  await c.env.DB.prepare("DELETE FROM blocked_emails WHERE value = ?1").bind(decodeURIComponent(c.req.param("value")).toLowerCase()).run();
  return c.json({ ok: true });
});

/** Request counters that are at or near their limit now, to lift one by hand. */
admin.get("/control/limits", async (c) => {
  await need(c, "control.read");
  const { results } = await c.env.DB.prepare("SELECT key, window_start, count FROM rate_limits WHERE window_start > ?1 ORDER BY count DESC LIMIT 100").bind(now() - 86_400_000).all<{
    key: string;
    window_start: number;
    count: number;
  }>();
  const showEmail = can(c, "users.email");
  return c.json(results.map((r) => ({ key: showEmail ? r.key : r.key.replace(/[^:]+@[^:]+/, "***"), id: r.key, windowStart: r.window_start, count: r.count })));
});

admin.delete("/control/limits", async (c) => {
  await need(c, "control");
  const key = str((await body(c.req)).key, "key", 400);
  await c.env.DB.prepare("DELETE FROM rate_limits WHERE key = ?1").bind(key).run();
  await logStmt(c, "admin.control.limit_cleared", c.get("caller").userId).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Numbers (docs/admin/PLAN.md, phase 7; lib/activity.ts)
// ---------------------------------------------------------------------------

admin.get("/insights", async (c) => {
  await need(c, "stats");
  const db = c.env.DB;
  const t = now();
  const today = dayOf(t);
  const d30 = t - 30 * DAY;
  const [versions, countries, daily, wau, mau, funnelCodes, funnelNew, funnelTwo, funnelShared, email, emailFails, support, replies, ratings, usage] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT platform, COALESCE(app_version, '?') AS version, COUNT(*) AS devices FROM devices WHERE revoked_at IS NULL AND last_seen_at > ?1 GROUP BY platform, version ORDER BY devices DESC").bind(d30),
    db.prepare("SELECT country, COUNT(DISTINCT user_id) AS users FROM devices WHERE last_seen_at > ?1 AND country IS NOT NULL GROUP BY country ORDER BY users DESC LIMIT 40").bind(d30),
    db.prepare("SELECT day, COUNT(*) AS users FROM activity_days WHERE day > ?1 GROUP BY day ORDER BY day").bind(today - 30),
    db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM activity_days WHERE day > ?1").bind(today - 7),
    db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM activity_days WHERE day > ?1").bind(today - 30),
    db.prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind = 'code' AND ok = 1 AND at > ?1").bind(d30),
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at > ?1").bind(d30),
    db.prepare("SELECT COUNT(*) AS n FROM (SELECT user_id FROM devices d JOIN users u ON u.id = d.user_id WHERE u.created_at > ?1 GROUP BY user_id HAVING COUNT(*) > 1)").bind(d30),
    db
      .prepare(
        "SELECT COUNT(DISTINCT m.user_id) AS n FROM members m JOIN users u ON u.id = m.user_id WHERE u.created_at > ?1 AND (SELECT COUNT(*) FROM members x WHERE x.workspace_id = m.workspace_id) > 1",
      )
      .bind(d30),
    db.prepare("SELECT CAST(at / 86400000 AS INTEGER) AS day, kind, COALESCE(provider, '-') AS provider, SUM(ok) AS ok, SUM(1 - ok) AS failed FROM email_log WHERE at > ?1 GROUP BY day, kind, provider ORDER BY day").bind(d30),
    db.prepare("SELECT at, kind, error FROM email_log WHERE ok = 0 ORDER BY at DESC LIMIT 15"),
    db.prepare("SELECT kind, status, COUNT(*) AS n FROM support_tickets WHERE created_at > ?1 GROUP BY kind, status").bind(d30),
    db.prepare("SELECT (first_reply_at - created_at) AS ms FROM support_tickets WHERE first_reply_at IS NOT NULL AND created_at > ?1 ORDER BY ms").bind(d30),
    db.prepare("SELECT SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS yes, SUM(CASE WHEN rating = 0 THEN 1 ELSE 0 END) AS no FROM support_tickets WHERE created_at > ?1").bind(d30),
    // The newest report of each device in the last week.
    db.prepare("SELECT r.data FROM usage_reports r WHERE r.day > ?1 AND r.day = (SELECT MAX(x.day) FROM usage_reports x WHERE x.device_id = r.device_id)").bind(today - 7),
  ]);
  const n = (r: D1Result<Record<string, unknown>>) => Number(r.results[0]?.n ?? 0);

  // Cohorts by week of sign-up, for the last eight weeks: who came back after a week and after a month.
  const cohorts = [];
  for (let w = 8; w >= 1; w--) {
    const from = t - w * 7 * DAY;
    const to = from + 7 * DAY;
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS size,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM activity_days a WHERE a.user_id = u.id AND a.day >= CAST(u.created_at / 86400000 AS INTEGER) + 7) THEN 1 ELSE 0 END) AS week,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM activity_days a WHERE a.user_id = u.id AND a.day >= CAST(u.created_at / 86400000 AS INTEGER) + 30) THEN 1 ELSE 0 END) AS month
         FROM users u WHERE u.created_at >= ?1 AND u.created_at < ?2`,
      )
      .bind(from, to)
      .first<{ size: number; week: number | null; month: number | null }>();
    cohorts.push({ from, size: row?.size ?? 0, week: row?.week ?? 0, month: to + 30 * DAY <= t ? (row?.month ?? 0) : null });
  }

  const replyMs = replies.results.map((r) => Number(r.ms));
  const median = replyMs.length ? replyMs[Math.floor(replyMs.length / 2)] : null;

  // Usage reports: averages, how many use each feature, packs, languages and errors per version.
  const reports = usage.results.map((r) => safeJson<UsageReport>(r.data as string, {}));
  const features: Record<string, number> = {};
  const packs: Record<string, number> = {};
  const langs: Record<string, number> = {};
  const errors: Record<string, number> = {};
  let pages = 0;
  let blocks = 0;
  for (const r of reports) {
    pages += r.pages ?? 0;
    blocks += r.blocks ?? 0;
    for (const [k, v] of Object.entries(r.features ?? {})) if (v) features[k] = (features[k] ?? 0) + 1;
    for (const p of r.packs ?? []) packs[p] = (packs[p] ?? 0) + 1;
    if (r.language) langs[r.language] = (langs[r.language] ?? 0) + 1;
    if (r.errors) errors[`${r.platform ?? "?"} ${r.version ?? "?"}`] = (errors[`${r.platform ?? "?"} ${r.version ?? "?"}`] ?? 0) + r.errors;
  }

  return c.json({
    at: t,
    versions: versions.results,
    countries: countries.results,
    active: { perDay: daily.results.map((r) => ({ day: Number(r.day) * DAY, users: Number(r.users) })), week: n(wau), month: n(mau) },
    cohorts,
    funnel: { codes: n(funnelCodes), accounts: n(funnelNew), secondDevice: n(funnelTwo), sharedWorkspace: n(funnelShared) },
    email: { perDay: email.results.map((r) => ({ day: Number(r.day) * DAY, kind: r.kind, provider: r.provider, ok: Number(r.ok), failed: Number(r.failed) })), failures: emailFails.results },
    support: { byKind: support.results, medianFirstReplyMs: median, solved: Number(ratings.results[0]?.yes ?? 0), notSolved: Number(ratings.results[0]?.no ?? 0) },
    usage: {
      devices: reports.length,
      avgPages: reports.length ? Math.round(pages / reports.length) : 0,
      avgBlocks: reports.length ? Math.round(blocks / reports.length) : 0,
      features,
      packs,
      languages: langs,
      errors,
    },
  });
});

interface UsageReport {
  platform?: string;
  version?: string;
  pages?: number;
  blocks?: number;
  attachments?: number;
  attachmentBytes?: number;
  features?: Record<string, boolean>;
  packs?: string[];
  language?: string;
  theme?: string;
  errors?: number;
}

/** Bytes kept per account and per workspace on the sync service, and profile pictures here. */
admin.get("/insights/storage", async (c) => {
  await need(c, "stats");
  let sync: { total: number; objects: number; users: Record<string, number>; workspaces: Record<string, number>; complete: boolean } | null = null;
  const base = c.env.SYNC_WEBHOOK_URL?.replace(/\/internal\/events$/, "");
  if (base && c.env.SYNC_WEBHOOK_SECRET) {
    const ts = Math.floor(Date.now() / 1000);
    try {
      const r = await fetch(`${base}/internal/storage?ts=${ts}`, { headers: { "x-worlds-signature": `sha256=${await hmacSha256Hex(c.env.SYNC_WEBHOOK_SECRET, `storage:${ts}`)}` } });
      if (r.ok) sync = await r.json();
    } catch {
      // Shown as unavailable.
    }
  }
  const pictures: Record<string, number> = {};
  if (c.env.PROFILE_FILES) {
    let cursor: string | undefined;
    let count = 0;
    do {
      const list = await c.env.PROFILE_FILES.list({ prefix: "p/", cursor, limit: 1000 });
      for (const o of list.objects) {
        const id = o.key.split("/")[1];
        if (id) pictures[id] = (pictures[id] ?? 0) + o.size;
        count++;
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor && count < 20_000);
  }
  const perUser: Record<string, { web: number; pictures: number }> = {};
  for (const [id, b] of Object.entries(sync?.users ?? {})) perUser[id] = { web: b, pictures: 0 };
  for (const [id, b] of Object.entries(pictures)) perUser[id] = { web: perUser[id]?.web ?? 0, pictures: b };
  const top = Object.entries(perUser)
    .map(([id, v]) => ({ id, ...v, total: v.web + v.pictures }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 25);
  const names = top.length
    ? (
        await c.env.DB.prepare(`SELECT id, display_name, username FROM users WHERE id IN (${top.map((_, i) => `?${i + 1}`).join(", ")})`)
          .bind(...top.map((x) => x.id))
          .all<{ id: string; display_name: string; username: string }>()
      ).results
    : [];
  const wsTop = Object.entries(sync?.workspaces ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  const wsNames = wsTop.length
    ? (
        await c.env.DB.prepare(`SELECT id, name FROM workspaces WHERE id IN (${wsTop.map((_, i) => `?${i + 1}`).join(", ")})`)
          .bind(...wsTop.map(([id]) => id))
          .all<{ id: string; name: string }>()
      ).results
    : [];
  return c.json({
    sync: sync ? { total: sync.total, objects: sync.objects, complete: sync.complete } : null,
    pictures: Object.values(pictures).reduce((a, b) => a + b, 0),
    accounts: top.map((x) => ({ ...x, name: names.find((n) => n.id === x.id)?.display_name ?? null, username: names.find((n) => n.id === x.id)?.username ?? null })),
    workspaces: wsTop.map(([id, bytes]) => ({ id, bytes, name: wsNames.find((w) => w.id === id)?.name ?? null })),
  });
});

async function cached<T>(c: AdminCtx, key: string, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
  const row = await c.env.DB.prepare("SELECT value, at FROM stats_cache WHERE key = ?1").bind(key).first<{ value: string; at: number }>();
  if (row && now() - row.at < maxAgeMs && c.req.query("fresh") !== "1") return JSON.parse(row.value) as T;
  const value = await load();
  await c.env.DB.prepare("INSERT OR REPLACE INTO stats_cache (key, value, at) VALUES (?1, ?2, ?3)").bind(key, JSON.stringify(value), now()).run();
  return value;
}

/** Downloads of every release asset, from GitHub's public API (kept an hour). */
admin.get("/insights/downloads", async (c) => {
  await need(c, "stats");
  const releases = await cached(c, "github-releases", 3_600_000, async () => {
    const r = await fetch("https://api.github.com/repos/justpainful/Worlds/releases?per_page=30", { headers: { "user-agent": "worlds-dashboard", accept: "application/vnd.github+json" } });
    if (!r.ok) throw new ApiError(502, "github_unavailable", `GitHub answered ${r.status}`);
    const list = (await r.json()) as { tag_name: string; published_at: string; assets: { name: string; download_count: number; size: number }[] }[];
    return list.map((x) => ({ tag: x.tag_name, publishedAt: x.published_at, assets: x.assets.map((a) => ({ name: a.name, downloads: a.download_count, size: a.size })) }));
  });
  return c.json(releases);
});

/**
 * Cloudflare usage against the free plan, and visits per site, from the
 * GraphQL Analytics API. Needs CF_API_TOKEN (Account Analytics: Read, Zone
 * Analytics: Read) and CF_ACCOUNTS / CF_ZONE as settings; says so when missing.
 */
admin.get("/insights/cloudflare", async (c) => {
  await need(c, "stats");
  const token = c.env.CF_API_TOKEN;
  const accounts = (c.env.CF_ACCOUNTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !accounts.length) return c.json({ configured: false });
  const data = await cached(c, "cloudflare-usage", 3_600_000, async () => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const until = new Date().toISOString();
    const day = since.slice(0, 10);
    const gql = async (query: string, variables: Record<string, unknown>) => {
      const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const j = (await r.json()) as { data?: unknown; errors?: { message: string }[] };
      if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
      return j.data as Record<string, unknown>;
    };
    const out: Record<string, unknown> = { since, until, accounts: [] as unknown[] };
    for (const acc of accounts) {
      try {
        const d = await gql(
          `query($a: String!, $s: Time!, $u: Time!, $day: Date!) { viewer { accounts(filter: { accountTag: $a }) {
            workers: workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $s, datetime_leq: $u }) { sum { requests errors } dimensions { scriptName } }
            d1: d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $day }) { sum { rowsRead rowsWritten } }
            r2: r2StorageAdaptiveGroups(limit: 100, filter: { datetime_geq: $s, datetime_leq: $u }) { max { payloadSize objectCount } dimensions { bucketName } }
            dos: durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: { datetime_geq: $s, datetime_leq: $u }) { sum { requests } }
          } } }`,
          { a: acc, s: since, u: until, day },
        );
        (out.accounts as unknown[]).push({ id: acc, data: (d.viewer as { accounts: unknown[] }).accounts[0] ?? null });
      } catch (e) {
        (out.accounts as unknown[]).push({ id: acc, error: String(e).slice(0, 300) });
      }
    }
    if (c.env.CF_ZONE) {
      try {
        const d = await gql(
          `query($z: String!, $s: Time!, $u: Time!) { viewer { zones(filter: { zoneTag: $z }) {
            hosts: httpRequestsAdaptiveGroups(limit: 50, filter: { datetime_geq: $s, datetime_leq: $u, requestSource: "eyeball" }, orderBy: [count_DESC]) { count dimensions { clientRequestHTTPHost } }
            paths: httpRequestsAdaptiveGroups(limit: 30, filter: { datetime_geq: $s, datetime_leq: $u, requestSource: "eyeball", edgeResponseContentTypeName: "html" }, orderBy: [count_DESC]) { count dimensions { clientRequestHTTPHost clientRequestPath } }
          } } }`,
          { z: c.env.CF_ZONE, s: since, u: until },
        );
        out.zone = (d.viewer as { zones: unknown[] }).zones[0] ?? null;
      } catch (e) {
        out.zoneError = String(e).slice(0, 300);
      }
    }
    return out;
  });
  // The free plan, per day unless said otherwise.
  return c.json({
    configured: true,
    limits: { workerRequests: 100_000, d1RowsRead: 5_000_000, d1RowsWritten: 100_000, r2Bytes: 10 * 1024 ** 3, doRequests: 100_000 },
    ...data,
  });
});

// ---------------------------------------------------------------------------
// Claude: keys for the MCP server, and the changes it proposes
// ---------------------------------------------------------------------------

/** The changes Claude may propose, and the dashboard route each one becomes once approved. */
export const PROPOSALS: Record<string, { method: string; path: (p: Record<string, unknown>) => string; body: (p: Record<string, unknown>) => Record<string, unknown> }> = {
  reply: { method: "POST", path: (p) => `/admin/support/${Number(p.number)}/reply`, body: (p) => ({ body: p.body, status: p.status }) },
  note: { method: "POST", path: (p) => `/admin/users/${encodeURIComponent(String(p.userId))}/notes`, body: (p) => ({ body: p.body }) },
  suspend: { method: "POST", path: (p) => `/admin/users/${encodeURIComponent(String(p.userId))}/suspend`, body: (p) => ({ days: p.days, ban: p.ban === true, reason: p.reason }) },
  unsuspend: { method: "POST", path: (p) => `/admin/users/${encodeURIComponent(String(p.userId))}/unsuspend`, body: (p) => ({ reason: p.reason }) },
  hide: { method: "POST", path: () => "/admin/content/hide", body: (p) => ({ username: p.username, pageId: p.pageId, reason: p.reason, hidden: true }) },
  show: { method: "POST", path: () => "/admin/content/hide", body: (p) => ({ username: p.username, pageId: p.pageId, hidden: false }) },
  ticket: { method: "PATCH", path: (p) => `/admin/support/${Number(p.number)}`, body: (p) => ({ status: p.status, priority: p.priority }) },
  suggestion: { method: "PATCH", path: (p) => `/admin/suggestions/${encodeURIComponent(String(p.id))}`, body: (p) => ({ status: p.status, public: p.public, shippedIn: p.shippedIn }) },
  message: { method: "POST", path: (p) => `/admin/users/${encodeURIComponent(String(p.userId))}/messages`, body: (p) => ({ subject: p.subject, body: p.body, email: p.email === true }) },
};

admin.post("/proposals", async (c) => {
  const b = await body(c.req);
  const action = str(b.action, "action", 20);
  if (!PROPOSALS[action]) throw bad("invalid_action", `action must be one of ${Object.keys(PROPOSALS).join(", ")}`);
  const payload = (b.payload ?? {}) as Record<string, unknown>;
  if (typeof payload !== "object" || Array.isArray(payload) || JSON.stringify(payload).length > 12_000) throw bad("invalid_payload");
  const summary = str(b.summary, "summary", 300);
  const id = newId();
  const keyId = c.get("caller").deviceId.startsWith("key:") ? c.get("caller").deviceId.slice(4) : null;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO admin_proposals (id, key_id, action, payload, summary, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(id, keyId, action, JSON.stringify(payload), summary, now()),
    logStmt(c, "admin.proposal.created", c.get("caller").userId, { proposal: id, action }),
  ]);
  emit(
    c as unknown as Context<AppEnv>,
    await notifyTeam(c.env, { id: `proposal:${id}`, topic: "claude.proposal", title: "Claude", excerpt: summary, link: "https://admin.enterworlds.space/#/claude" }),
  );
  return c.json({ id, status: "pending", approveAt: "https://admin.enterworlds.space/#/claude" }, 201);
});

admin.get("/proposals", async (c) => {
  await need(c, "users.read");
  const status = c.req.query("status") ?? "pending";
  const { results } = await c.env.DB.prepare(
    "SELECT p.*, k.label AS key_label, u.display_name AS decided_name FROM admin_proposals p LEFT JOIN admin_keys k ON k.id = p.key_id LEFT JOIN users u ON u.id = p.decided_by WHERE p.status = ?1 OR ?1 = 'all' ORDER BY p.created_at DESC LIMIT 100",
  )
    .bind(status)
    .all<Record<string, unknown>>();
  return c.json(
    results.map((p) => {
      const payload = safeJson<Record<string, unknown>>(p.payload as string, {});
      const route = PROPOSALS[p.action as string];
      return {
        id: p.id,
        action: p.action,
        payload,
        summary: p.summary,
        status: p.status,
        keyLabel: p.key_label ?? null,
        createdAt: p.created_at,
        decidedBy: p.decided_name ?? null,
        decidedAt: p.decided_at,
        result: p.result,
        // What the dashboard calls when someone approves it, with their own rights.
        call: route ? { method: route.method, path: route.path(payload), body: route.body(payload) } : null,
      };
    }),
  );
});

/** Recorded after the dashboard made the change (or chose not to). */
admin.post("/proposals/:id/decide", async (c) => {
  if (c.get("caller").deviceId.startsWith("key:")) throw forbidden("not_allowed", "Only a person on the team can decide.");
  const b = await body(c.req);
  const status = b.status === "approved" ? "approved" : b.status === "rejected" ? "rejected" : null;
  if (!status) throw bad("invalid_status");
  const r = await c.env.DB.prepare("UPDATE admin_proposals SET status = ?1, decided_by = ?2, decided_at = ?3, result = ?4 WHERE id = ?5 AND status = 'pending'")
    .bind(status, c.get("caller").userId, now(), optStr(b.result, "result", 500) ?? null, c.req.param("id"))
    .run();
  if (!r.meta.changes) throw notFound();
  await logStmt(c, `admin.proposal.${status}`, c.get("caller").userId, { proposal: c.req.param("id") }).run();
  return c.json({ ok: true });
});

admin.get("/keys", async (c) => {
  await need(c, "users.read");
  const { results } = await c.env.DB.prepare("SELECT k.id, k.label, k.created_at, k.last_used_at, k.revoked_at, u.display_name FROM admin_keys k JOIN users u ON u.id = k.user_id ORDER BY k.created_at DESC").all<{
    id: string;
    label: string;
    created_at: number;
    last_used_at: number | null;
    revoked_at: number | null;
    display_name: string;
  }>();
  return c.json(results.map((k) => ({ id: k.id, label: k.label, owner: k.display_name, createdAt: k.created_at, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at })));
});

/** A key for Claude's MCP server: it reads as you and can only propose changes. Shown once. */
admin.post("/keys", async (c) => {
  await need(c, "team");
  if (c.get("role") !== "owner") throw forbidden("not_allowed", "Only an owner can make a key.");
  const label = optStr((await body(c.req)).label, "label", 60) ?? "Claude";
  const key = randomToken("wak_");
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO admin_keys (id, key_hash, label, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(id, await sha256Hex(key), label, c.get("caller").userId, now()),
    logStmt(c, "admin.key.created", c.get("caller").userId, { key: id, label }),
  ]);
  return c.json({ id, key, label }, 201);
});

admin.delete("/keys/:id", async (c) => {
  await need(c, "team");
  const r = await c.env.DB.prepare("UPDATE admin_keys SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL").bind(now(), c.req.param("id")).run();
  if (!r.meta.changes) throw notFound();
  await logStmt(c, "admin.key.revoked", c.get("caller").userId, { key: c.req.param("id") }).run();
  return c.json({ ok: true });
});
