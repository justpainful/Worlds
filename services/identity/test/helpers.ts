import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { b64urlEncode } from "../src/lib/crypto";
import type { EmailMessage } from "../src/lib/email";
import type { WebAuthnVerifier } from "../src/lib/webauthn";
import { refreshMessage } from "../src/domain/sessions";

export const mailbox: EmailMessage[] = [];

/**
 * WebAuthn with the cryptography mocked: a "response" is valid when it echoes
 * the challenge it answers and is not marked invalid. Everything else (options,
 * challenge storage and expiry, credential lookup, counters) runs for real.
 */
export const mockWebAuthn: WebAuthnVerifier = {
  async verifyRegistration(_env, response, expectedChallenge) {
    const r = response as { id: string; challenge: string; invalid?: boolean };
    if (r.invalid || r.challenge !== expectedChallenge) return null;
    return { credentialId: r.id, publicKey: "cose-key", counter: 0, transports: ["internal"], deviceType: "multiDevice", backedUp: true };
  },
  async verifyAuthentication(_env, response, expectedChallenge, credential) {
    const r = response as { id: string; challenge: string; invalid?: boolean };
    if (r.invalid || r.challenge !== expectedChallenge || r.id !== credential.id) return null;
    return { newCounter: credential.counter + 1 };
  },
};

export interface Res<T = any> {
  status: number;
  json: T;
}

let ipCounter = 0;

/** Call the worker in-process. Each call gets its own client IP unless one is given. */
export async function api<T = any>(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string>; ip?: string } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { "cf-connecting-ip": opts.ip ?? `test-${++ipCounter}`, ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const req = new Request(`http://identity.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML pages
  }
  return { status: res.status, json };
}

let n = 0;
export function uniqueEmail(prefix = "user"): string {
  return `${prefix}.${Date.now().toString(36)}.${++n}@example.com`;
}

export function lastCode(to: string): string {
  const m = [...mailbox].reverse().find((x) => x.to === to);
  if (!m) throw new Error(`no email to ${to}`);
  return /(\d{6})/.exec(m.subject)![1];
}

export interface DeviceKey {
  publicKey: string;
  sign(message: string): Promise<string>;
}

export async function deviceKey(): Promise<DeviceKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  return {
    publicKey: b64urlEncode(raw),
    async sign(message) {
      return b64urlEncode(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(message)));
    },
  };
}

export interface Session {
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  key?: DeviceKey;
}

/** Create (or sign in to) an account with an email code. */
export async function signUp(name = "Test", opts: { email?: string; key?: DeviceKey; deviceName?: string } = {}): Promise<Session> {
  const email = opts.email ?? uniqueEmail(name.toLowerCase().replace(/\s+/g, ""));
  const start = await api("POST", "/auth/email/start", { body: { email } });
  if (start.status !== 200) throw new Error(`start failed ${start.status} ${JSON.stringify(start.json)}`);
  const verify = await api("POST", "/auth/email/verify", {
    body: { challengeId: start.json.challengeId, code: lastCode(email), displayName: name, device: { name: opts.deviceName ?? `${name}'s PC`, platform: "windows", publicKey: opts.key?.publicKey } },
  });
  if (verify.status !== 200) throw new Error(`verify failed ${verify.status} ${JSON.stringify(verify.json)}`);
  return { userId: verify.json.userId, deviceId: verify.json.deviceId, accessToken: verify.json.accessToken, refreshToken: verify.json.refreshToken, email, key: opts.key };
}

export async function signedRefresh(s: { deviceId: string; refreshToken: string; key: DeviceKey }, ts = Date.now()) {
  return {
    refreshToken: s.refreshToken,
    deviceId: s.deviceId,
    ts,
    signature: await s.key.sign(await refreshMessage(s.deviceId, ts, s.refreshToken)),
  };
}

export async function auditActions(where: { workspaceId?: string; actorUserId?: string }): Promise<{ action: string; actor_kind: string; device_id: string | null; target_id: string | null }[]> {
  const col = where.workspaceId ? "workspace_id" : "actor_user_id";
  const val = where.workspaceId ?? where.actorUserId;
  const { results } = await env.DB.prepare(`SELECT action, actor_kind, device_id, target_id FROM audit_log WHERE ${col} = ?1 ORDER BY at, rowid`).bind(val).all();
  return results as any;
}

export async function outbox(type?: string): Promise<any[]> {
  const { results } = await env.DB.prepare(`SELECT payload FROM outbox ${type ? "WHERE type = ?1" : ""} ORDER BY created_at, rowid`)
    .bind(...(type ? [type] : []))
    .all<{ payload: string }>();
  return results.map((r) => JSON.parse(r.payload));
}

/** A workspace owned by a fresh user, plus helpers to add people with a role. */
export async function workspaceWithOwner(name = "Team") {
  const owner = await signUp("Owner");
  const ws = await api("POST", "/workspaces", { token: owner.accessToken, body: { name } });
  if (ws.status !== 201) throw new Error(`create workspace failed ${ws.status}`);
  const id = ws.json.id as string;
  const add = async (role: "admin" | "member" | "guest", who: string = role) => {
    const user = await signUp(who);
    const inv = await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: { role } });
    const acc = await api("POST", `/invites/${inv.json.token}/accept`, { token: user.accessToken });
    if (acc.status !== 200) throw new Error(`accept failed ${acc.status} ${JSON.stringify(acc.json)}`);
    return user;
  };
  return { id, owner, add };
}
