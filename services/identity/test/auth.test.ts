import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { b64urlDecode, sha256B64url } from "../src/lib/crypto";
import { verifyAccessToken } from "../src/lib/jwt";
import { api, auditActions, deviceKey, lastCode, mailbox, outbox, signedRefresh, signUp, uniqueEmail } from "./helpers";

const dec = new TextDecoder();
const claimsOf = (jwt: string) => JSON.parse(dec.decode(b64urlDecode(jwt.split(".")[1])));
const headerOf = (jwt: string) => JSON.parse(dec.decode(b64urlDecode(jwt.split(".")[0])));

describe("email one-time codes", () => {
  it("issues a code by email and signs in a new account", async () => {
    const email = uniqueEmail("new");
    const start = await api("POST", "/auth/email/start", { body: { email } });
    expect(start.status).toBe(200);
    expect(start.json.challengeId).toBeTruthy();
    expect(mailbox.at(-1)?.to).toBe(email);
    const code = lastCode(email);
    expect(code).toMatch(/^\d{6}$/);
    // The code itself is never stored.
    const row = await env.DB.prepare("SELECT code_hash FROM email_codes WHERE id = ?1").bind(start.json.challengeId).first<{ code_hash: string }>();
    expect(row!.code_hash).not.toContain(code);

    const v = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code, displayName: "Nora", device: { name: "Desk PC" } } });
    expect(v.status).toBe(200);
    expect(v.json.created).toBe(true);
    expect(v.json.user.displayName).toBe("Nora");
    expect(v.json.user.email).toBe(email);
    expect(v.json.accessToken).toBeTruthy();
    expect(v.json.refreshToken).toMatch(/^wr_/);

    // A second sign-in with the same email reaches the same account on a new device.
    const again = await signUp("Nora", { email });
    expect(again.userId).toBe(v.json.userId);
    expect(again.deviceId).not.toBe(v.json.deviceId);
  });

  it("rejects a wrong code, counts attempts and locks after five", async () => {
    const email = uniqueEmail("wrong");
    const start = await api("POST", "/auth/email/start", { body: { email } });
    const code = lastCode(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= 5; i++) {
      const r = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: wrong } });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("invalid_code");
      expect(r.json.attemptsLeft).toBe(5 - i);
    }
    // Even the right code no longer works.
    const r = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("invalid_code");
  });

  it("expires codes", async () => {
    const email = uniqueEmail("late");
    const start = await api("POST", "/auth/email/start", { body: { email } });
    await env.DB.prepare("UPDATE email_codes SET expires_at = ?1 WHERE id = ?2").bind(Date.now() - 1, start.json.challengeId).run();
    const r = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: lastCode(email) } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("code_expired");
  });

  it("uses a code only once", async () => {
    const email = uniqueEmail("once");
    const start = await api("POST", "/auth/email/start", { body: { email } });
    const code = lastCode(email);
    expect((await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code } })).status).toBe(200);
    const r = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code } });
    expect(r.status).toBe(400);
  });

  it("rate limits code requests per email", async () => {
    const email = uniqueEmail("spam");
    for (let i = 0; i < 5; i++) expect((await api("POST", "/auth/email/start", { body: { email } })).status).toBe(200);
    const r = await api("POST", "/auth/email/start", { body: { email } });
    expect(r.status).toBe(429);
    expect(r.json.error).toBe("rate_limited");
  });

  it("rejects malformed emails", async () => {
    const r = await api("POST", "/auth/email/start", { body: { email: "not-an-email" } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("invalid_email");
  });
});

describe("access tokens", () => {
  it("are EdDSA JWTs with exactly sub, dev, iat, exp, verifiable with the published JWKS", async () => {
    const s = await signUp("Jwt");
    expect(headerOf(s.accessToken).alg).toBe("EdDSA");
    const claims = claimsOf(s.accessToken);
    expect(Object.keys(claims).sort()).toEqual(["dev", "exp", "iat", "sub"]);
    expect(claims.sub).toBe(s.userId);
    expect(claims.dev).toBe(s.deviceId);
    expect(claims.exp - claims.iat).toBe(900);

    const jwks = await api("GET", "/.well-known/jwks.json");
    expect(jwks.status).toBe(200);
    const jwk = jwks.json.keys.find((k: { kid: string }) => k.kid === headerOf(s.accessToken).kid);
    expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });
    expect(jwk.d).toBeUndefined();
    // Verify the way the sync service will: WebCrypto with the public JWK only.
    const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
    const [h, p, sig] = s.accessToken.split(".");
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
  });

  it("are refused when tampered with or expired", async () => {
    const s = await signUp("Tamper");
    const [h, p, sig] = s.accessToken.split(".");
    const forged = btoa(JSON.stringify({ ...claimsOf(s.accessToken), sub: "someone-else" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect((await api("GET", "/me", { token: `${h}.${forged}.${sig}` })).status).toBe(401);
    expect(await verifyAccessToken(env, s.accessToken, Date.now() + 901_000)).toBeNull();
    expect((await api("GET", "/me", { token: s.accessToken })).status).toBe(200);
    void p;
  });
});

describe("refresh tokens", () => {
  it("rotate on every refresh", async () => {
    const s = await signUp("Rotate");
    const r1 = await api("POST", "/auth/refresh", { body: { refreshToken: s.refreshToken, deviceId: s.deviceId } });
    expect(r1.status).toBe(200);
    expect(r1.json.refreshToken).not.toBe(s.refreshToken);
    expect(claimsOf(r1.json.accessToken).dev).toBe(s.deviceId);
    const r2 = await api("POST", "/auth/refresh", { body: { refreshToken: r1.json.refreshToken } });
    expect(r2.status).toBe(200);
  });

  it("revoke the session when an old refresh token is replayed", async () => {
    const s = await signUp("Replay");
    const r1 = await api("POST", "/auth/refresh", { body: { refreshToken: s.refreshToken } });
    const replay = await api("POST", "/auth/refresh", { body: { refreshToken: s.refreshToken } });
    expect(replay.status).toBe(401);
    expect(replay.json.error).toBe("refresh_reused");
    // The legitimate newer token is dead too.
    const r2 = await api("POST", "/auth/refresh", { body: { refreshToken: r1.json.refreshToken } });
    expect(r2.status).toBe(401);
    expect((await auditActions({ actorUserId: s.userId })).map((a) => a.action)).toContain("auth.refresh_reuse_detected");
    expect((await outbox("session.revoked")).some((e) => e.deviceId === s.deviceId)).toBe(true);
  });

  it("are bound to the device key when the device has one", async () => {
    const key = await deviceKey();
    const s = await signUp("Bound", { key });
    const unsigned = await api("POST", "/auth/refresh", { body: { refreshToken: s.refreshToken, deviceId: s.deviceId } });
    expect(unsigned.status).toBe(401);
    expect(unsigned.json.error).toBe("device_signature_required");

    const other = await deviceKey();
    const forged = await api("POST", "/auth/refresh", { body: await signedRefresh({ ...s, key: other }) });
    expect(forged.status).toBe(401);
    expect(forged.json.error).toBe("device_signature_invalid");

    const stale = await api("POST", "/auth/refresh", { body: await signedRefresh({ ...s, key }, Date.now() - 10 * 60 * 1000) });
    expect(stale.status).toBe(401);

    const ok = await api("POST", "/auth/refresh", { body: await signedRefresh({ ...s, key }) });
    expect(ok.status).toBe(200);
  });

  it("are refused after expiry", async () => {
    const s = await signUp("Expire");
    await env.DB.prepare("UPDATE sessions SET expires_at = 1 WHERE device_id = ?1").bind(s.deviceId).run();
    const r = await api("POST", "/auth/refresh", { body: { refreshToken: s.refreshToken } });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("session_expired");
  });
});

describe("devices", () => {
  it("are listed with the current one marked, and can be renamed", async () => {
    const email = uniqueEmail("devices");
    const a = await signUp("Dev", { email, deviceName: "Laptop" });
    const b = await signUp("Dev", { email, deviceName: "Desktop" });
    const list = await api("GET", "/me/devices", { token: a.accessToken });
    expect(list.json.map((d: { name: string }) => d.name).sort()).toEqual(["Desktop", "Laptop"]);
    expect(list.json.find((d: { id: string }) => d.id === a.deviceId).current).toBe(true);
    expect((await api("PATCH", `/me/devices/${b.deviceId}`, { token: a.accessToken, body: { name: "Studio" } })).status).toBe(200);
  });

  it("revoking a device kills its sessions and tokens at once", async () => {
    const email = uniqueEmail("revoke");
    const a = await signUp("Rev", { email });
    const b = await signUp("Rev", { email });
    const r = await api("DELETE", `/me/devices/${b.deviceId}`, { token: a.accessToken });
    expect(r.status).toBe(200);
    // Access token of the revoked device stops working immediately.
    expect((await api("GET", "/me", { token: b.accessToken })).status).toBe(401);
    // Its refresh token too.
    const ref = await api("POST", "/auth/refresh", { body: { refreshToken: b.refreshToken } });
    expect(ref.status).toBe(401);
    expect(ref.json.error).toBe("session_revoked");
    // The other device is unaffected.
    expect((await api("GET", "/me", { token: a.accessToken })).status).toBe(200);
    const sessions = await env.DB.prepare("SELECT revoked_at FROM sessions WHERE device_id = ?1").bind(b.deviceId).all<{ revoked_at: number | null }>();
    expect(sessions.results.every((x) => x.revoked_at)).toBe(true);
    expect((await outbox("device.revoked")).some((e) => e.deviceId === b.deviceId && e.userId === a.userId)).toBe(true);
    expect((await auditActions({ actorUserId: a.userId })).map((x) => x.action)).toContain("device.revoked");
    // Nobody else can revoke it.
    const stranger = await signUp("Stranger");
    expect((await api("DELETE", `/me/devices/${a.deviceId}`, { token: stranger.accessToken })).status).toBe(404);
  });

  it("logout revokes the current device", async () => {
    const s = await signUp("Bye");
    expect((await api("POST", "/auth/logout", { token: s.accessToken })).status).toBe(200);
    expect((await api("GET", "/me", { token: s.accessToken })).status).toBe(401);
    expect((await api("POST", "/auth/refresh", { body: { refreshToken: s.refreshToken } })).status).toBe(401);
    expect((await auditActions({ actorUserId: s.userId })).map((x) => x.action)).toContain("auth.signed_out");
  });
});

describe("passkeys", () => {
  async function addPasskey(token: string, id: string) {
    const opts = await api("POST", "/auth/passkey/register/options", { token, body: {} });
    expect(opts.status).toBe(200);
    expect(opts.json.options.rp.id).toBe("localhost");
    expect(opts.json.options.authenticatorSelection.residentKey).toBe("required");
    return api("POST", "/auth/passkey/register/verify", { token, body: { challengeId: opts.json.challengeId, response: { id, challenge: opts.json.options.challenge }, name: "Windows Hello" } });
  }

  it("registers a passkey for a signed-in account and signs in with it", async () => {
    const s = await signUp("Passkey");
    const credId = `cred-${crypto.randomUUID()}`;
    const reg = await addPasskey(s.accessToken, credId);
    expect(reg.status).toBe(200);
    const list = await api("GET", "/me/passkeys", { token: s.accessToken });
    expect(list.json).toHaveLength(1);
    expect(list.json[0].name).toBe("Windows Hello");

    const opts = await api("POST", "/auth/passkey/login/options", { body: {} });
    expect(opts.status).toBe(200);
    const login = await api("POST", "/auth/passkey/login/verify", {
      body: { challengeId: opts.json.challengeId, response: { id: credId, challenge: opts.json.options.challenge }, device: { name: "Second PC" } },
    });
    expect(login.status).toBe(200);
    expect(login.json.userId).toBe(s.userId);
    expect(login.json.deviceId).not.toBe(s.deviceId);
    const counter = await env.DB.prepare("SELECT counter FROM passkeys WHERE id = ?1").bind(credId).first<{ counter: number }>();
    expect(counter!.counter).toBe(1);
    const actions = (await auditActions({ actorUserId: s.userId })).map((a) => a.action);
    expect(actions).toContain("passkey.added");
    expect(actions.filter((a) => a === "auth.signed_in")).toHaveLength(2);
  });

  it("refuses a bad assertion, an unknown credential and a reused challenge", async () => {
    const s = await signUp("PkBad");
    const credId = `cred-${crypto.randomUUID()}`;
    await addPasskey(s.accessToken, credId);
    const o1 = await api("POST", "/auth/passkey/login/options", { body: {} });
    const bad = await api("POST", "/auth/passkey/login/verify", { body: { challengeId: o1.json.challengeId, response: { id: credId, challenge: o1.json.options.challenge, invalid: true } } });
    expect(bad.status).toBe(401);
    // The challenge was consumed by the failed attempt.
    const reuse = await api("POST", "/auth/passkey/login/verify", { body: { challengeId: o1.json.challengeId, response: { id: credId, challenge: o1.json.options.challenge } } });
    expect(reuse.status).toBe(400);
    expect(reuse.json.error).toBe("challenge_expired");
    const o2 = await api("POST", "/auth/passkey/login/options", { body: {} });
    const unknown = await api("POST", "/auth/passkey/login/verify", { body: { challengeId: o2.json.challengeId, response: { id: "nope", challenge: o2.json.options.challenge } } });
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe("passkey_unknown");
  });

  it("hands a browser sign-in back to the app with a one-time PKCE code", async () => {
    const s = await signUp("Handoff");
    const credId = `cred-${crypto.randomUUID()}`;
    await addPasskey(s.accessToken, credId);
    const verifier = "v".repeat(20) + crypto.randomUUID();
    const challenge = await sha256B64url(verifier);
    const opts = await api("POST", "/auth/passkey/login/options", { body: {} });
    const login = await api("POST", "/auth/passkey/login/verify", {
      body: { challengeId: opts.json.challengeId, response: { id: credId, challenge: opts.json.options.challenge }, handoff: { codeChallenge: challenge } },
    });
    expect(login.status).toBe(200);
    expect(login.json.code).toMatch(/^wc_/);
    expect(login.json.accessToken).toBeUndefined();

    const wrong = await api("POST", "/auth/token", { body: { code: login.json.code, codeVerifier: "wrong-verifier-wrong-verifier-wrong-verifier", device: { name: "PC" } } });
    expect(wrong.status).toBe(400);
    // A failed exchange burns the code.
    const late = await api("POST", "/auth/token", { body: { code: login.json.code, codeVerifier: verifier, device: { name: "PC" } } });
    expect(late.status).toBe(400);

    const o2 = await api("POST", "/auth/passkey/login/options", { body: {} });
    const l2 = await api("POST", "/auth/passkey/login/verify", {
      body: { challengeId: o2.json.challengeId, response: { id: credId, challenge: o2.json.options.challenge }, handoff: { codeChallenge: challenge } },
    });
    const tok = await api("POST", "/auth/token", { body: { code: l2.json.code, codeVerifier: verifier, device: { name: "PC" } } });
    expect(tok.status).toBe(200);
    expect(tok.json.userId).toBe(s.userId);
  });

  it("adds a passkey from the browser with a one-time ticket", async () => {
    const s = await signUp("Ticket");
    const t = await api("POST", "/auth/passkey/ticket", { token: s.accessToken });
    expect(t.status).toBe(200);
    expect(t.json.url).toContain("/passkey?mode=add&ticket=");
    const opts = await api("POST", "/auth/passkey/register/options", { body: { ticket: t.json.ticket } });
    expect(opts.status).toBe(200);
    const credId = `cred-${crypto.randomUUID()}`;
    const reg = await api("POST", "/auth/passkey/register/verify", { body: { ticket: t.json.ticket, challengeId: opts.json.challengeId, response: { id: credId, challenge: opts.json.options.challenge } } });
    expect(reg.status).toBe(200);
    // The ticket is single use.
    const again = await api("POST", "/auth/passkey/register/options", { body: { ticket: t.json.ticket } });
    expect(again.status).toBe(401);
    const page = await api("GET", "/passkey?mode=add");
    expect(page.status).toBe(200);
    expect(String(page.json)).toContain("Add a passkey");
  });
});
