import type { ActorKind, Env } from "../env";
import { auditStmt } from "../lib/audit";
import { isValidEd25519PublicKey, newId, now, randomToken, sha256Hex, verifyEd25519 } from "../lib/crypto";
import { eventStmt, type EventEnvelope } from "../lib/events";
import { bad, unauthorized } from "../lib/http";
import { signAccessToken } from "../lib/jwt";

export interface DeviceInput {
  name: string;
  platform?: string;
  /** Raw Ed25519 public key (base64url). Refreshes must then be signed with the device key. */
  publicKey?: string;
}

export interface TokenSet {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  userId: string;
  deviceId: string;
}

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function refreshTtlMs(env: Env): number {
  const days = Number(env.REFRESH_TOKEN_TTL_DAYS ?? 60);
  return (Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 60) * 86_400_000;
}

export function parseDevice(v: unknown): DeviceInput {
  const d = (v ?? {}) as Record<string, unknown>;
  const name = typeof d.name === "string" && d.name.trim() ? d.name.trim().slice(0, 80) : "Unnamed device";
  const platform = typeof d.platform === "string" ? d.platform.slice(0, 40) : "";
  if (d.publicKey !== undefined && d.publicKey !== null && !isValidEd25519PublicKey(d.publicKey)) throw bad("invalid_device_key", "publicKey must be a raw Ed25519 key in base64url");
  return { name, platform, publicKey: (d.publicKey as string) || undefined };
}

/** The message a device signs to refresh: binds the token to the device key and a fresh timestamp. */
export async function refreshMessage(deviceId: string, ts: number, refreshToken: string): Promise<string> {
  return `worlds-refresh.v1:${deviceId}:${ts}:${await sha256Hex(refreshToken)}`;
}

/** Register a new device for the user and open its first session. */
export async function signIn(env: Env, userId: string, device: DeviceInput, how: string, actor: ActorKind = "user"): Promise<TokenSet> {
  const t = now();
  const deviceId = newId();
  const sessionId = newId();
  const refreshToken = randomToken("wr_");
  const expiresAt = t + refreshTtlMs(env);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO devices (id, user_id, name, platform, public_key, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)").bind(
      deviceId,
      userId,
      device.name,
      device.platform ?? "",
      device.publicKey ?? null,
      t,
    ),
    env.DB.prepare("INSERT INTO sessions (id, user_id, device_id, refresh_hash, created_at, refreshed_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)").bind(
      sessionId,
      userId,
      deviceId,
      await sha256Hex(refreshToken),
      t,
      expiresAt,
    ),
    auditStmt(env.DB, { action: "auth.signed_in", actorUserId: userId, actorKind: actor, deviceId, targetType: "device", targetId: deviceId, meta: { method: how, device: device.name } }),
  ]);
  const access = await signAccessToken(env, userId, deviceId, t);
  return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken, refreshTokenExpiresAt: expiresAt, userId, deviceId };
}

/**
 * Rotate a refresh token. Presenting an already rotated token is treated as
 * theft: the whole session is revoked.
 */
export async function refresh(
  env: Env,
  input: { refreshToken: string; deviceId?: string; ts?: number; signature?: string },
  onEvents: (events: EventEnvelope[]) => void,
): Promise<TokenSet> {
  const hash = await sha256Hex(input.refreshToken);
  const t = now();
  const row = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.device_id, s.expires_at, s.revoked_at, d.public_key, d.revoked_at AS device_revoked
     FROM sessions s JOIN devices d ON d.id = s.device_id WHERE s.refresh_hash = ?1`,
  )
    .bind(hash)
    .first<{ id: string; user_id: string; device_id: string; expires_at: number; revoked_at: number | null; public_key: string | null; device_revoked: number | null }>();

  if (!row) {
    const reused = await env.DB.prepare("SELECT id, user_id, device_id FROM sessions WHERE previous_hash = ?1 AND revoked_at IS NULL")
      .bind(hash)
      .first<{ id: string; user_id: string; device_id: string }>();
    if (reused) {
      const ev = eventStmt(env.DB, { type: "session.revoked", userId: reused.user_id, deviceId: reused.device_id, sessionId: reused.id });
      await env.DB.batch([
        env.DB.prepare("UPDATE sessions SET revoked_at = ?1, revoke_reason = 'refresh_reuse' WHERE id = ?2").bind(t, reused.id),
        auditStmt(env.DB, { action: "auth.refresh_reuse_detected", actorUserId: reused.user_id, actorKind: "system", deviceId: reused.device_id, targetType: "session", targetId: reused.id }),
        ev.stmt,
      ]);
      onEvents([ev.envelope]);
      throw unauthorized("refresh_reused", "This sign-in was ended for safety. Sign in again.");
    }
    throw unauthorized("invalid_refresh_token", "Sign in again.");
  }
  if (row.revoked_at || row.device_revoked) throw unauthorized("session_revoked", "This device was signed out.");
  if (row.expires_at <= t) throw unauthorized("session_expired", "Your sign-in expired. Sign in again.");
  if (input.deviceId && input.deviceId !== row.device_id) throw unauthorized("device_mismatch");
  if (row.public_key) {
    // Device-bound: proof of possession of the device key.
    if (!input.signature || typeof input.ts !== "number" || Math.abs(t - input.ts) > REFRESH_SKEW_MS) throw unauthorized("device_signature_required");
    const ok = await verifyEd25519(row.public_key, await refreshMessage(row.device_id, input.ts, input.refreshToken), input.signature);
    if (!ok) throw unauthorized("device_signature_invalid");
  }
  const next = randomToken("wr_");
  const expiresAt = t + refreshTtlMs(env);
  const res = await env.DB.batch([
    env.DB.prepare(
      "UPDATE sessions SET previous_hash = refresh_hash, refresh_hash = ?1, refreshed_at = ?2, expires_at = ?3 WHERE id = ?4 AND refresh_hash = ?5 AND revoked_at IS NULL",
    ).bind(await sha256Hex(next), t, expiresAt, row.id, hash),
    env.DB.prepare("UPDATE devices SET last_seen_at = ?1 WHERE id = ?2").bind(t, row.device_id),
  ]);
  if (!res[0].meta.changes) throw unauthorized("invalid_refresh_token", "Sign in again.");
  const access = await signAccessToken(env, row.user_id, row.device_id, t);
  return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken: next, refreshTokenExpiresAt: expiresAt, userId: row.user_id, deviceId: row.device_id };
}

/** Revoke a device and every session on it. */
export async function revokeDevice(env: Env, userId: string, deviceId: string, by: { userId: string; deviceId: string | null; actor: ActorKind }, reason: string): Promise<EventEnvelope[]> {
  const t = now();
  const ev = eventStmt(env.DB, { type: "device.revoked", userId, deviceId });
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE devices SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL").bind(t, deviceId, userId),
    env.DB.prepare("UPDATE sessions SET revoked_at = ?1, revoke_reason = ?2 WHERE device_id = ?3 AND revoked_at IS NULL").bind(t, reason, deviceId),
  ]);
  if (!res[0].meta.changes) return [];
  await env.DB.batch([
    auditStmt(env.DB, { action: reason === "signed_out" ? "auth.signed_out" : "device.revoked", actorUserId: by.userId, actorKind: by.actor, deviceId: by.deviceId, targetType: "device", targetId: deviceId }),
    ev.stmt,
  ]);
  return [ev.envelope];
}
