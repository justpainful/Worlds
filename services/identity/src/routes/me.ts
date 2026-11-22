import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { revokeDevice } from "../domain/sessions";
import { audit, listAudit } from "../lib/audit";
import { emit, requireAuth } from "../lib/auth";
import { now } from "../lib/crypto";
import { bad, body, conflict, forbidden, notFound, optStr, str } from "../lib/http";
import { cancelDeletion, DELETION_DAYS, exportAccount, scheduleDeletion, sharedOwned } from "../domain/deletion";
import { rateLimit } from "../lib/ratelimit";
import { authenticationOptions, webauthn } from "../lib/webauthn";
import { checkUsername, usernameTaken } from "../lib/usernames";
import { bannedWordIn } from "../lib/names";
import { consumeEmailCode, newChallenge, takeChallenge, userById, userView } from "./auth";
import { ownerRoutes } from "./profiles";

export const me = new Hono<AppEnv>();
me.use("*", requireAuth);
ownerRoutes(me);

me.get("/", async (c) => {
  const u = await userById(c.env.DB, c.get("caller").userId);
  if (!u) throw notFound();
  return c.json(userView(u));
});

me.patch("/", async (c) => {
  const caller = c.get("caller");
  const b = await body(c.req);
  const name = optStr(b.displayName, "displayName", 80);
  if (name && (await bannedWordIn(c.env.DB, name))) throw bad("name_not_allowed", "That name is not allowed.");
  const avatar = b.avatarUrl === null ? null : optStr(b.avatarUrl, "avatarUrl", 500);
  if (avatar && !/^https:\/\//.test(avatar)) throw bad("invalid_avatar", "avatarUrl must be an https URL");
  // A username is required and cannot be cleared, only changed to another free one.
  const username = b.username === undefined ? undefined : checkUsername(b.username);
  if (username && (await usernameTaken(c.env.DB, username, caller.userId))) throw conflict("username_taken", "That username is taken.");
  if (username) {
    try {
      await c.env.DB.prepare("UPDATE users SET username = ?1, username_auto = 0, updated_at = ?2 WHERE id = ?3").bind(username, now(), caller.userId).run();
    } catch {
      throw conflict("username_taken", "That username is taken.");
    }
  }
  await c.env.DB.prepare(
    "UPDATE users SET display_name = COALESCE(?1, display_name), avatar_url = CASE WHEN ?2 = 1 THEN ?3 ELSE avatar_url END, updated_at = ?4 WHERE id = ?5",
  )
    .bind(name ?? null, b.avatarUrl !== undefined ? 1 : 0, avatar ?? null, now(), caller.userId)
    .run();
  await audit(c.env.DB, { action: "account.updated", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId: caller.userId });
  return c.json(userView((await userById(c.env.DB, caller.userId))!));
});

me.get("/devices", async (c) => {
  const caller = c.get("caller");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, platform, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY last_seen_at DESC",
  )
    .bind(caller.userId)
    .all<{ id: string; name: string; platform: string; created_at: number; last_seen_at: number }>();
  return c.json(
    results.map((d) => ({ id: d.id, name: d.name, platform: d.platform, createdAt: d.created_at, lastSeenAt: d.last_seen_at, current: d.id === caller.deviceId })),
  );
});

me.patch("/devices/:id", async (c) => {
  const caller = c.get("caller");
  const name = str((await body(c.req)).name, "name", 80);
  const r = await c.env.DB.prepare("UPDATE devices SET name = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL").bind(name, c.req.param("id"), caller.userId).run();
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** Revoke a device: its sessions end at once and the sync service is told. */
me.delete("/devices/:id", async (c) => {
  const caller = c.get("caller");
  const events = await revokeDevice(c.env, caller.userId, c.req.param("id"), { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor }, "revoked");
  if (!events.length) throw notFound();
  emit(c, events);
  return c.json({ ok: true });
});

me.get("/passkeys", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ?1 ORDER BY created_at")
    .bind(c.get("caller").userId)
    .all<{ id: string; name: string; device_type: string | null; backed_up: number; created_at: number; last_used_at: number | null }>();
  return c.json(results.map((p) => ({ id: p.id, name: p.name, synced: p.backed_up === 1, createdAt: p.created_at, lastUsedAt: p.last_used_at })));
});

me.delete("/passkeys/:id", async (c) => {
  const caller = c.get("caller");
  const r = await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ?1 AND user_id = ?2").bind(c.req.param("id"), caller.userId).run();
  if (!r.meta.changes) throw notFound();
  await audit(c.env.DB, { action: "passkey.removed", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "passkey", targetId: c.req.param("id") });
  return c.json({ ok: true });
});

/** The account's own security events. */
me.get("/audit", async (c) => {
  const limit = Number(c.req.query("limit") ?? 100);
  return c.json(await listAudit(c.env.DB, { actorUserId: c.get("caller").userId }, limit));
});

// ---------------------------------------------------------------------------
// Deleting the account, and a copy of its data (domain/deletion.ts)
// ---------------------------------------------------------------------------

me.get("/deletion", async (c) => {
  const userId = c.get("caller").userId;
  const u = await c.env.DB.prepare("SELECT deletion_due_at FROM users WHERE id = ?1").bind(userId).first<{ deletion_due_at: number | null }>();
  return c.json({ dueAt: u?.deletion_due_at ?? null, days: DELETION_DAYS, sharedWorkspaces: await sharedOwned(c.env.DB, userId) });
});

/** Passkey options for confirming a big step (deleting the account): only this account's passkeys, with biometrics or PIN. */
me.post("/confirm/options", async (c) => {
  const userId = c.get("caller").userId;
  const { results } = await c.env.DB.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?1").bind(userId).all<{ id: string; transports: string }>();
  if (!results.length) throw bad("no_passkey", "This account has no passkey. Confirm with an email code instead.");
  const options = await authenticationOptions(
    c.env,
    results.map((r) => ({ id: r.id, transports: JSON.parse(r.transports) as string[] })),
  );
  return c.json({ challengeId: await newChallenge(c.env.DB, "authenticate", options.challenge, userId), options });
});

/** The person proves it is them: an email code sent to their own address, or one of their passkeys. */
async function confirmed(c: Context<AppEnv>, b: Record<string, unknown>): Promise<void> {
  const userId = c.get("caller").userId;
  if (b.code !== undefined) {
    const email = await consumeEmailCode(c, b.challengeId, b.code);
    const u = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(userId).first<{ email: string }>();
    if (!u || u.email !== email) throw forbidden("code_not_yours", "That code was sent to another address.");
    return;
  }
  const ch = await takeChallenge(c.env.DB, str(b.challengeId, "challengeId", 64), "authenticate");
  if (ch.user_id !== userId) throw bad("challenge_mismatch");
  const response = b.response as { id?: unknown } | undefined;
  const cred = await c.env.DB.prepare("SELECT id, public_key, counter, transports FROM passkeys WHERE id = ?1 AND user_id = ?2")
    .bind(str(response?.id, "response.id", 1024), userId)
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
}

me.post("/deletion", async (c) => {
  const caller = c.get("caller");
  const b = await body(c.req);
  await confirmed(c, b);
  const lang = b.lang === "en" ? "en" : "ar";
  const r = await scheduleDeletion(c.env, caller.userId, { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor, who: "self" }, lang);
  emit(c, r.events);
  return c.json({ dueAt: r.dueAt });
});

me.delete("/deletion", async (c) => {
  const caller = c.get("caller");
  const ok = await cancelDeletion(c.env, caller.userId, { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor, who: "self" });
  if (!ok) throw notFound("not_scheduled", "This account is not scheduled for deletion.");
  return c.json({ ok: true });
});

/** A copy of everything the account service keeps about this account. */
me.get("/export", async (c) => {
  const caller = c.get("caller");
  await rateLimit(c.env.DB, `export:${caller.userId}`, 10, 86_400_000);
  const data = await exportAccount(c.env.DB, caller.userId);
  await audit(c.env.DB, { action: "account.exported", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId: caller.userId });
  const day = new Date().toISOString().slice(0, 10);
  return c.json(data, 200, { "content-disposition": "attachment; filename=" + JSON.stringify(`worlds-account-${day}.json`) });
});
