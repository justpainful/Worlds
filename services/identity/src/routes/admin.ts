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
import { ApiError, bad, body, conflict, forbidden, normalizeEmail, notFound, optStr, str } from "../lib/http";
import { checkUsername, usernameTaken } from "../lib/usernames";
import { foldName } from "../lib/names";
import { reportersOf, setTeamHidden, targetKey, type Target } from "../lib/content";
import { eventStmt } from "../lib/events";
import { noticeMail } from "../lib/noticeMail";
import { cancelDeletion, eraseAccount, exportAccount, scheduleDeletion } from "../domain/deletion";
import { authenticationOptions, webauthn } from "../lib/webauthn";
import { consumeEmailCode, newChallenge, takeChallenge, userById, userView } from "./auth";
import { SUPPORT_SITE, replyAddress, sendSupportMail, supportMail, ticketRef } from "../lib/supportMail";
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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  moderator: ["users.read", "users.edit", "users.suspend", "notes", "audit", "stats", "tickets", "names", "content"],
  support: ["users.read", "users.email", "notes", "stats", "tickets"],
};

/** Actions that need a second check made in the last STEP_UP_MS. */
const NEEDS_STEP_UP: ReadonlySet<Permission> = new Set(["users.edit_email", "users.suspend", "users.ban", "users.devices", "team", "users.delete", "users.export", "content.workspaces"]);
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
admin.use("*", requireAuth, requireAdmin);

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
