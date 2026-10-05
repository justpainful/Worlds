import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { parseDevice, refresh, revokeDevice, signIn } from "../domain/sessions";
import { audit, auditStmt } from "../lib/audit";
import { callerFromToken, emit, requireAuth } from "../lib/auth";
import { newId, now, randomDigits, randomToken, sha256B64url, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { codeEmail, emailSender } from "../lib/email";
import { ApiError, bad, body, normalizeEmail, optStr, str, unauthorized } from "../lib/http";
import { clientIp, rateLimit } from "../lib/ratelimit";
import { authenticationOptions, registrationOptions, webauthn } from "../lib/webauthn";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 10 * 60 * 1000;
const HOUR = 3_600_000;

export const auth = new Hono<AppEnv>();

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: number;
}

export function userView(u: UserRow) {
  return { id: u.id, email: u.email, displayName: u.display_name, avatarUrl: u.avatar_url, createdAt: u.created_at };
}

async function userById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?1").bind(id).first<UserRow>();
}

// ---------------------------------------------------------------------------
// Email one-time codes: new devices, recovery, and creating an account.
// ---------------------------------------------------------------------------

auth.post("/email/start", async (c) => {
  const b = await body(c.req);
  const email = normalizeEmail(b.email);
  await rateLimit(c.env.DB, `email-start:ip:${clientIp(c.req.raw)}`, 30, HOUR);
  await rateLimit(c.env.DB, `email-start:email:${email}`, 5, HOUR);
  const id = newId();
  const code = randomDigits(6);
  const t = now();
  await c.env.DB.prepare("INSERT INTO email_codes (id, email, code_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, email, await sha256Hex(`${id}:${code}`), t, t + CODE_TTL_MS)
    .run();
  await emailSender(c.env).send({ to: email, ...codeEmail(code) });
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
  await audit(c.env.DB, { action: "auth.email_code_sent", actorUserId: existing?.id ?? null, actorKind: "user", targetType: "email_code", targetId: id });
  // The same answer whether or not an account exists.
  return c.json({ challengeId: id, expiresAt: t + CODE_TTL_MS });
});

auth.post("/email/verify", async (c) => {
  const b = await body(c.req);
  const challengeId = str(b.challengeId, "challengeId", 64);
  const code = str(b.code, "code", 12).replace(/\s+/g, "");
  await rateLimit(c.env.DB, `email-verify:ip:${clientIp(c.req.raw)}`, 30, 10 * 60 * 1000);
  const row = await c.env.DB.prepare("SELECT id, email, code_hash, attempts, expires_at, consumed_at FROM email_codes WHERE id = ?1")
    .bind(challengeId)
    .first<{ id: string; email: string; code_hash: string; attempts: number; expires_at: number; consumed_at: number | null }>();
  if (!row || row.consumed_at) throw bad("invalid_code", "That code is no longer valid. Ask for a new one.");
  if (row.expires_at <= now()) throw bad("code_expired", "That code expired. Ask for a new one.");
  if (row.attempts >= CODE_MAX_ATTEMPTS) throw new ApiError(429, "too_many_attempts", "Too many wrong codes. Ask for a new one.");
  const ok = timingSafeEqual(await sha256Hex(`${row.id}:${code}`), row.code_hash);
  if (!ok) {
    const attempts = row.attempts + 1;
    await c.env.DB.prepare("UPDATE email_codes SET attempts = ?1, consumed_at = CASE WHEN ?1 >= ?2 THEN ?3 ELSE consumed_at END WHERE id = ?4")
      .bind(attempts, CODE_MAX_ATTEMPTS, now(), row.id)
      .run();
    await audit(c.env.DB, { action: "auth.email_code_failed", actorUserId: null, actorKind: "user", targetType: "email_code", targetId: row.id, meta: { attempts } });
    throw new ApiError(400, "invalid_code", "That code is not right.", { attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - attempts) });
  }
  const used = await c.env.DB.prepare("UPDATE email_codes SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL").bind(now(), row.id).run();
  if (!used.meta.changes) throw bad("invalid_code", "That code is no longer valid. Ask for a new one.");

  let user = await c.env.DB.prepare("SELECT id, email, display_name, avatar_url, created_at FROM users WHERE email = ?1").bind(row.email).first<UserRow>();
  let created = false;
  if (!user) {
    const t = now();
    const id = newId();
    const name = optStr(b.displayName, "displayName", 80) ?? row.email.split("@")[0];
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO users (id, email, display_name, email_verified_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)").bind(id, row.email, name, t),
      auditStmt(c.env.DB, { action: "account.created", actorUserId: id, actorKind: "user", targetType: "user", targetId: id, meta: { method: "email" } }),
    ]);
    user = (await userById(c.env.DB, id))!;
    created = true;
  }
  const tokens = await signIn(c.env, user.id, parseDevice(b.device), "email");
  return c.json({ ...tokens, user: userView(user), created });
});

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

async function newChallenge(db: D1Database, kind: "register" | "authenticate", challenge: string, userId: string | null): Promise<string> {
  const id = newId();
  const t = now();
  await db.prepare("INSERT INTO webauthn_challenges (id, kind, challenge, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(id, kind, challenge, userId, t, t + CHALLENGE_TTL_MS)
    .run();
  return id;
}

async function takeChallenge(db: D1Database, id: string, kind: "register" | "authenticate"): Promise<{ challenge: string; user_id: string | null }> {
  const row = await db
    .prepare("UPDATE webauthn_challenges SET consumed_at = ?1 WHERE id = ?2 AND kind = ?3 AND consumed_at IS NULL AND expires_at > ?1 RETURNING challenge, user_id")
    .bind(now(), id, kind)
    .first<{ challenge: string; user_id: string | null }>();
  if (!row) throw bad("challenge_expired", "That passkey request expired. Try again.");
  return row;
}

/** Bearer token, or an add-passkey ticket from the browser page. */
async function registrant(c: Context<AppEnv>, ticket: unknown, consume: boolean): Promise<{ userId: string; deviceId: string | null; via: string }> {
  const h = c.req.header("authorization");
  if (h?.startsWith("Bearer ")) {
    const caller = await callerFromToken(c, h.slice(7).trim());
    if (!caller) throw unauthorized("invalid_token");
    return { userId: caller.userId, deviceId: caller.deviceId, via: "app" };
  }
  if (typeof ticket !== "string" || !ticket) throw unauthorized("unauthorized", "Sign in first.");
  const hash = await sha256Hex(ticket);
  const sql = consume
    ? "UPDATE handoffs SET consumed_at = ?2 WHERE secret_hash = ?1 AND kind = 'add-passkey' AND consumed_at IS NULL AND expires_at > ?2 RETURNING user_id"
    : "SELECT user_id FROM handoffs WHERE secret_hash = ?1 AND kind = 'add-passkey' AND consumed_at IS NULL AND expires_at > ?2";
  const row = await c.env.DB.prepare(sql).bind(hash, now()).first<{ user_id: string }>();
  if (!row) throw unauthorized("ticket_expired", "This link expired. Start again from Worlds.");
  return { userId: row.user_id, deviceId: null, via: "browser" };
}

/** The app asks for a short-lived ticket to add a passkey in the browser. */
auth.post("/passkey/ticket", requireAuth, async (c) => {
  const caller = c.get("caller");
  const ticket = randomToken("wt_");
  const t = now();
  await c.env.DB.prepare("INSERT INTO handoffs (id, kind, secret_hash, user_id, created_at, expires_at) VALUES (?1, 'add-passkey', ?2, ?3, ?4, ?5)")
    .bind(newId(), await sha256Hex(ticket), caller.userId, t, t + TICKET_TTL_MS)
    .run();
  const url = `${c.env.PUBLIC_URL.replace(/\/$/, "")}/passkey?mode=add&ticket=${encodeURIComponent(ticket)}`;
  return c.json({ ticket, url, expiresAt: t + TICKET_TTL_MS });
});

auth.post("/passkey/register/options", async (c) => {
  const b = await body(c.req);
  await rateLimit(c.env.DB, `passkey:ip:${clientIp(c.req.raw)}`, 60, 10 * 60 * 1000);
  const who = await registrant(c, b.ticket, false);
  const user = await userById(c.env.DB, who.userId);
  if (!user) throw unauthorized();
  const { results } = await c.env.DB.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?1").bind(user.id).all<{ id: string; transports: string }>();
  const options = await registrationOptions(
    c.env,
    { id: user.id, email: user.email, displayName: user.display_name },
    results.map((r) => ({ id: r.id, transports: JSON.parse(r.transports) as string[] })),
  );
  const challengeId = await newChallenge(c.env.DB, "register", options.challenge, user.id);
  return c.json({ challengeId, options });
});

auth.post("/passkey/register/verify", async (c) => {
  const b = await body(c.req);
  const challengeId = str(b.challengeId, "challengeId", 64);
  const who = await registrant(c, b.ticket, false);
  const ch = await takeChallenge(c.env.DB, challengeId, "register");
  if (ch.user_id !== who.userId) throw bad("challenge_mismatch");
  const v = await webauthn().verifyRegistration(c.env, b.response, ch.challenge);
  if (!v) throw bad("passkey_invalid", "The passkey could not be verified.");
  if (who.via === "browser") await registrant(c, b.ticket, true);
  const name = optStr(b.name, "name", 60) ?? "Passkey";
  const t = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      ).bind(v.credentialId, who.userId, v.publicKey, v.counter, JSON.stringify(v.transports), v.deviceType, v.backedUp ? 1 : 0, name, t),
      auditStmt(c.env.DB, { action: "passkey.added", actorUserId: who.userId, actorKind: "user", deviceId: who.deviceId, targetType: "passkey", targetId: v.credentialId, meta: { via: who.via } }),
    ]);
  } catch {
    throw bad("passkey_exists", "This passkey is already registered.");
  }
  return c.json({ ok: true, passkey: { id: v.credentialId, name, createdAt: t } });
});

auth.post("/passkey/login/options", async (c) => {
  await rateLimit(c.env.DB, `passkey:ip:${clientIp(c.req.raw)}`, 60, 10 * 60 * 1000);
  const options = await authenticationOptions(c.env);
  const challengeId = await newChallenge(c.env.DB, "authenticate", options.challenge, null);
  return c.json({ challengeId, options });
});

/**
 * Verify a passkey assertion. With `handoff.codeChallenge` (the browser page)
 * the answer is a one-time code for the app; otherwise tokens directly.
 */
auth.post("/passkey/login/verify", async (c) => {
  const b = await body(c.req);
  const challengeId = str(b.challengeId, "challengeId", 64);
  const response = b.response as { id?: unknown } | undefined;
  const credentialId = str(response?.id, "response.id", 1024);
  const ch = await takeChallenge(c.env.DB, challengeId, "authenticate");
  const cred = await c.env.DB.prepare("SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?1")
    .bind(credentialId)
    .first<{ id: string; user_id: string; public_key: string; counter: number; transports: string }>();
  if (!cred) throw unauthorized("passkey_unknown", "This passkey is not registered with Worlds.");
  const v = await webauthn().verifyAuthentication(c.env, b.response, ch.challenge, {
    id: cred.id,
    publicKey: cred.public_key,
    counter: cred.counter,
    transports: JSON.parse(cred.transports) as string[],
  });
  if (!v) {
    await audit(c.env.DB, { action: "auth.passkey_failed", actorUserId: cred.user_id, actorKind: "user", targetType: "passkey", targetId: cred.id });
    throw unauthorized("passkey_invalid", "The passkey could not be verified.");
  }
  await c.env.DB.prepare("UPDATE passkeys SET counter = ?1, last_used_at = ?2 WHERE id = ?3").bind(v.newCounter, now(), cred.id).run();
  const handoff = b.handoff as { codeChallenge?: unknown } | undefined;
  if (handoff) {
    const codeChallenge = str(handoff.codeChallenge, "handoff.codeChallenge", 128);
    const code = randomToken("wc_");
    const t = now();
    await c.env.DB.prepare("INSERT INTO handoffs (id, kind, secret_hash, user_id, code_challenge, created_at, expires_at) VALUES (?1, 'signin', ?2, ?3, ?4, ?5, ?6)")
      .bind(newId(), await sha256Hex(code), cred.user_id, codeChallenge, t, t + HANDOFF_TTL_MS)
      .run();
    return c.json({ code });
  }
  const user = (await userById(c.env.DB, cred.user_id))!;
  const tokens = await signIn(c.env, user.id, parseDevice(b.device), "passkey");
  return c.json({ ...tokens, user: userView(user) });
});

/** The app exchanges the browser's one-time code (PKCE S256) for tokens. */
auth.post("/token", async (c) => {
  const b = await body(c.req);
  const code = str(b.code, "code", 128);
  const verifier = str(b.codeVerifier, "codeVerifier", 128);
  await rateLimit(c.env.DB, `token:ip:${clientIp(c.req.raw)}`, 60, 10 * 60 * 1000);
  const row = await c.env.DB.prepare(
    "UPDATE handoffs SET consumed_at = ?2 WHERE secret_hash = ?1 AND kind = 'signin' AND consumed_at IS NULL AND expires_at > ?2 RETURNING user_id, code_challenge",
  )
    .bind(await sha256Hex(code), now())
    .first<{ user_id: string; code_challenge: string }>();
  if (!row) throw bad("invalid_grant", "This sign-in expired. Try again.");
  if (!timingSafeEqual(await sha256B64url(verifier), row.code_challenge)) throw bad("invalid_grant", "This sign-in could not be verified.");
  const user = (await userById(c.env.DB, row.user_id))!;
  const tokens = await signIn(c.env, user.id, parseDevice(b.device), "passkey");
  return c.json({ ...tokens, user: userView(user) });
});

auth.post("/refresh", async (c) => {
  const b = await body(c.req);
  const tokens = await refresh(
    c.env,
    {
      refreshToken: str(b.refreshToken, "refreshToken", 200),
      deviceId: optStr(b.deviceId, "deviceId", 64),
      ts: typeof b.ts === "number" ? b.ts : undefined,
      signature: optStr(b.signature, "signature", 200),
    },
    (events) => emit(c, events),
  );
  return c.json(tokens);
});

/** Sign out this device: revokes it and all its sessions. */
auth.post("/logout", requireAuth, async (c) => {
  const caller = c.get("caller");
  emit(c, await revokeDevice(c.env, caller.userId, caller.deviceId, { userId: caller.userId, deviceId: caller.deviceId, actor: caller.actor }, "signed_out"));
  return c.json({ ok: true });
});

