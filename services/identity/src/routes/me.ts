import { Hono } from "hono";
import type { AppEnv } from "../env";
import { revokeDevice } from "../domain/sessions";
import { audit, listAudit } from "../lib/audit";
import { emit, requireAuth } from "../lib/auth";
import { now } from "../lib/crypto";
import { bad, body, notFound, optStr, str } from "../lib/http";
import { userView } from "./auth";

export const me = new Hono<AppEnv>();
me.use("*", requireAuth);

me.get("/", async (c) => {
  const u = await c.env.DB.prepare("SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?1")
    .bind(c.get("caller").userId)
    .first<{ id: string; email: string; display_name: string; avatar_url: string | null; created_at: number }>();
  if (!u) throw notFound();
  return c.json(userView(u));
});

me.patch("/", async (c) => {
  const caller = c.get("caller");
  const b = await body(c.req);
  const name = optStr(b.displayName, "displayName", 80);
  const avatar = b.avatarUrl === null ? null : optStr(b.avatarUrl, "avatarUrl", 500);
  if (avatar && !/^https:\/\//.test(avatar)) throw bad("invalid_avatar", "avatarUrl must be an https URL");
  await c.env.DB.prepare(
    "UPDATE users SET display_name = COALESCE(?1, display_name), avatar_url = CASE WHEN ?2 = 1 THEN ?3 ELSE avatar_url END, updated_at = ?4 WHERE id = ?5",
  )
    .bind(name ?? null, b.avatarUrl !== undefined ? 1 : 0, avatar ?? null, now(), caller.userId)
    .run();
  await audit(c.env.DB, { action: "account.updated", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId: caller.userId });
  const u = await c.env.DB.prepare("SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?1")
    .bind(caller.userId)
    .first<{ id: string; email: string; display_name: string; avatar_url: string | null; created_at: number }>();
  return c.json(userView(u!));
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
