/**
 * Deleting an account (docs/admin/PLAN.md, phase 3, and the privacy policy):
 *
 * 1. Scheduled: every device signs out, the public profile, published pages and
 *    mail inbox disappear, and the person gets an email with the date.
 * 2. For 30 days, signing in again lets them cancel; everything comes back.
 * 3. On the date the cron erases the account: passkeys, devices, sessions,
 *    memberships, profile and its pictures, published pages, mail, notes, the
 *    web copy and notifications (through the sync service). Support requests
 *    stay without a name or email; the security log keeps an anonymous id.
 *
 * Pages on the person's own devices are theirs and never touched.
 */
import type { ActorKind, Env } from "../env";
import { auditStmt } from "../lib/audit";
import { now, sha256Hex } from "../lib/crypto";
import { eventStmt, type EventEnvelope } from "../lib/events";
import { ApiError } from "../lib/http";
import { sendSupportMail } from "../lib/supportMail";
import { noticeMail } from "../lib/noticeMail";
import { TRASH_MS } from "../routes/workspaces";
import { revokeDevice } from "./sessions";

export const DELETION_DAYS = 30;
const DAY = 86_400_000;

/** Shared workspaces this person owns with other members in them: they must hand them over first. */
export async function sharedOwned(db: D1Database, userId: string): Promise<{ id: string; name: string; members: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.name, (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS members
       FROM workspaces w WHERE w.owner_id = ?1 AND w.deleted_at IS NULL AND (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) > 1`,
    )
    .bind(userId)
    .all<{ id: string; name: string; members: number }>();
  return results;
}

export async function scheduleDeletion(
  env: Env,
  userId: string,
  by: { userId: string; deviceId: string | null; actor: ActorKind; who: "self" | "team"; reason?: string },
  lang: "ar" | "en",
  notify = true,
): Promise<{ dueAt: number; events: EventEnvelope[] }> {
  const blocked = await sharedOwned(env.DB, userId);
  if (blocked.length) throw new ApiError(409, "owns_shared_workspaces", "Hand over or delete your shared workspaces first.", { workspaces: blocked });
  const t = now();
  const dueAt = t + DELETION_DAYS * DAY;
  const u = await env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(userId).first<{ email: string }>();
  if (!u) throw new ApiError(404, "user_not_found", "No such account.");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET deletion_requested_at = ?1, deletion_due_at = ?2, deletion_by = ?3, updated_at = ?1 WHERE id = ?4").bind(t, dueAt, by.who, userId),
    auditStmt(env.DB, {
      action: by.who === "self" ? "account.deletion_scheduled" : "admin.user.deletion_scheduled",
      actorUserId: by.userId,
      actorKind: by.actor,
      deviceId: by.deviceId,
      targetType: "user",
      targetId: userId,
      meta: { dueAt, ...(by.reason ? { reason: by.reason } : {}) },
    }),
  ]);
  const events: EventEnvelope[] = [];
  const { results } = await env.DB.prepare("SELECT id FROM devices WHERE user_id = ?1 AND revoked_at IS NULL").bind(userId).all<{ id: string }>();
  for (const d of results) events.push(...(await revokeDevice(env, userId, d.id, { userId: by.userId, deviceId: by.deviceId, actor: by.actor }, "deletion")));
  // The person always hears about their own request; a team decision may be kept quiet (notify: false).
  if (by.who === "self" || notify) await sendSupportMail(env, { to: u.email, ...noticeMail(lang, by.who === "team" ? "deletion_scheduled_team" : "deletion_scheduled", { date: dueAt }) });
  return { dueAt, events };
}

export async function cancelDeletion(
  env: Env,
  userId: string,
  by: { userId: string; deviceId: string | null; actor: ActorKind; who: "self" | "team" },
  lang: "ar" | "en" = "ar",
  notify = true,
): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE users SET deletion_requested_at = NULL, deletion_due_at = NULL, deletion_by = NULL, updated_at = ?1 WHERE id = ?2 AND deletion_due_at IS NOT NULL")
    .bind(now(), userId)
    .run();
  if (!r.meta.changes) return false;
  await auditStmt(env.DB, {
    action: by.who === "self" ? "account.deletion_cancelled" : "admin.user.deletion_cancelled",
    actorUserId: by.userId,
    actorKind: by.actor,
    deviceId: by.deviceId,
    targetType: "user",
    targetId: userId,
  }).run();
  if (notify) {
    const u = await env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(userId).first<{ email: string }>();
    if (u) await sendSupportMail(env, { to: u.email, ...noticeMail(lang, "deletion_cancelled") });
  }
  return true;
}

/** Erase the account now. Returns the events for the sync service. */
export async function eraseAccount(env: Env, userId: string, why: "due" | "team"): Promise<EventEnvelope[]> {
  const db = env.DB;
  const u = await db.prepare("SELECT id FROM users WHERE id = ?1").bind(userId).first();
  if (!u) return [];
  const anon = `deleted:${(await sha256Hex(`erased:${userId}`)).slice(0, 12)}`;
  const events: EventEnvelope[] = [];
  const stmts: D1PreparedStatement[] = [];

  // Workspaces they own alone go with them (shared ones were handed over or blocked deletion).
  const { results: own } = await db.prepare("SELECT id FROM workspaces WHERE owner_id = ?1").bind(userId).all<{ id: string }>();
  for (const w of own) {
    const docs = await db.prepare("SELECT id FROM pages WHERE workspace_id = ?1").bind(w.id).all<{ id: string }>();
    const ev = eventStmt(db, { type: "workspace.purged", workspaceId: w.id, docIds: docs.results.map((d) => d.id) });
    stmts.push(ev.stmt, db.prepare("DELETE FROM workspaces WHERE id = ?1").bind(w.id));
    events.push(ev.envelope);
  }
  // Pictures of the public profile and the published pages' files.
  if (env.PROFILE_FILES) {
    let cursor: string | undefined;
    do {
      const list = await env.PROFILE_FILES.list({ prefix: `p/${userId}/`, cursor });
      if (list.objects.length) await env.PROFILE_FILES.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }
  const erased = eventStmt(db, { type: "user.erased", userId });
  events.push(erased.envelope);
  stmts.push(
    erased.stmt,
    // Support requests stay, without who asked.
    db.prepare("UPDATE support_tickets SET user_id = NULL, email = ?1, name = NULL WHERE user_id = ?2").bind(`${anon}@deleted.invalid`, userId),
    db.prepare("UPDATE support_files SET owner = ?1 WHERE owner = ?2").bind(anon, `u:${userId}`),
    // The security log keeps what happened, not who.
    db.prepare("UPDATE audit_log SET actor_user_id = ?1 WHERE actor_user_id = ?2").bind(anon, userId),
    db.prepare("UPDATE audit_log SET target_id = ?1 WHERE target_type = 'user' AND target_id = ?2").bind(anon, userId),
    db.prepare("DELETE FROM admin_notes WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM admin_roles WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM admin_stepups WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
    auditStmt(db, { action: "account.erased", actorUserId: null, actorKind: "system", targetType: "user", targetId: anon, meta: { why } }),
  );
  await db.batch(stmts);
  return events;
}

/** Cron: accounts whose 30 days are up, and workspaces 30 days in the trash. */
export async function deletionHousekeeping(env: Env): Promise<EventEnvelope[]> {
  const t = now();
  const events: EventEnvelope[] = [];
  const { results: due } = await env.DB.prepare("SELECT id FROM users WHERE deletion_due_at IS NOT NULL AND deletion_due_at <= ?1 LIMIT 20").bind(t).all<{ id: string }>();
  for (const u of due) events.push(...(await eraseAccount(env, u.id, "due")));
  const { results: trash } = await env.DB.prepare("SELECT id FROM workspaces WHERE deleted_at IS NOT NULL AND deleted_at <= ?1 LIMIT 20").bind(t - TRASH_MS).all<{ id: string }>();
  for (const w of trash) {
    const docs = await env.DB.prepare("SELECT id FROM pages WHERE workspace_id = ?1").bind(w.id).all<{ id: string }>();
    const ev = eventStmt(env.DB, { type: "workspace.purged", workspaceId: w.id, docIds: docs.results.map((d) => d.id) });
    await env.DB.batch([
      ev.stmt,
      env.DB.prepare("DELETE FROM workspaces WHERE id = ?1").bind(w.id),
      auditStmt(env.DB, { action: "workspace.purged", actorUserId: null, actorKind: "system", workspaceId: w.id, targetType: "workspace", targetId: w.id }),
    ]);
    events.push(ev.envelope);
  }
  // The security log is kept for 12 months.
  await env.DB.prepare("DELETE FROM audit_log WHERE at < ?1").bind(t - 365 * DAY).run();
  return events;
}

/** Everything the identity service keeps about the account, as one JSON object. */
export async function exportAccount(db: D1Database, userId: string): Promise<Record<string, unknown>> {
  const one = (sql: string) => db.prepare(sql).bind(userId);
  const [user, devices, passkeys, sessions, memberships, profile, published, mailbox, mail, tickets, messages, log] = await db.batch<Record<string, unknown>>([
    one("SELECT id, email, display_name, username, avatar_url, email_verified_at, created_at, updated_at, deletion_due_at FROM users WHERE id = ?1"),
    one("SELECT id, name, platform, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ?1"),
    one("SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ?1"),
    one("SELECT id, device_id, created_at, refreshed_at, expires_at, revoked_at FROM sessions WHERE user_id = ?1"),
    one("SELECT w.id, w.name, m.role, m.joined_at, w.owner_id = ?1 AS owner FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?1"),
    one("SELECT visible, data, avatar_key, banner_key, published_at, updated_at FROM public_profiles WHERE user_id = ?1"),
    one("SELECT slug, kind, title, html, lang, expires_at, views, created_at, updated_at FROM published_pages WHERE user_id = ?1"),
    one("SELECT key, created_at FROM mail_addresses WHERE user_id = ?1"),
    one("SELECT sender, subject, body, received_at, picked_at FROM mail_items WHERE user_id = ?1"),
    one("SELECT number, kind, subject, fields, status, created_at, updated_at FROM support_tickets WHERE user_id = ?1"),
    one("SELECT t.number, m.author, m.body, m.created_at FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id WHERE t.user_id = ?1 AND m.author != 'note'"),
    one("SELECT at, action, actor_kind, device_id, target_type, target_id, meta FROM audit_log WHERE actor_user_id = ?1 OR (target_type = 'user' AND target_id = ?1) ORDER BY at"),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    about: "Everything the Worlds account service keeps about this account. Pages on your devices stay there; the web copy and shared pages are kept by the sync service and can be downloaded from the app.",
    account: user.results[0] ?? null,
    devices: devices.results,
    passkeys: passkeys.results,
    sessions: sessions.results,
    workspaces: memberships.results,
    publicProfile: profile.results[0] ? { ...profile.results[0], data: JSON.parse(String(profile.results[0].data ?? "{}")) } : null,
    publishedPages: published.results,
    mail: { address: mailbox.results[0] ?? null, waiting: mail.results },
    supportRequests: tickets.results,
    supportMessages: messages.results,
    securityLog: log.results,
  };
}
