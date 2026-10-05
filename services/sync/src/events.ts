/**
 * Access change events from the identity service (docs/contracts/identity.md,
 * section 4), delivered as a signed webhook (POST /internal/events) and/or
 * through the REVOCATIONS queue. Every handler is idempotent: closing a
 * socket twice or re-checking access twice changes nothing.
 */
import type { Env } from "./env";

export type AccessEvent =
  | { type: "access.changed"; workspaceId: string; docIds: string[] | null; userIds: string[] | null }
  | { type: "member.removed"; workspaceId: string; userId: string }
  | { type: "member.role_changed"; workspaceId: string; userId: string; role: string }
  | { type: "workspace.deleted"; workspaceId: string }
  | { type: "device.revoked"; userId: string; deviceId: string }
  | { type: "session.revoked"; userId: string; deviceId: string; sessionId: string };

export type EventEnvelope = AccessEvent & { id: string; at: number };

/** Documents with live sessions in a workspace (all of them when docIds is null). */
async function docsOf(env: Env, workspaceId: string, docIds: string[] | null): Promise<string[]> {
  return docIds ?? (await env.HUBS.getByName(workspaceId).liveDocs());
}

const room = (env: Env, workspaceId: string, docId: string) => env.DOCS.getByName(`${workspaceId}/${docId}`);

/** Apply one event. Returns how many sockets it touched. */
export async function applyEvent(env: Env, ev: AccessEvent): Promise<number> {
  let n = 0;
  switch (ev.type) {
    case "access.changed":
      for (const docId of await docsOf(env, ev.workspaceId, ev.docIds)) n += await room(env, ev.workspaceId, docId).recheck({ userIds: ev.userIds });
      return n;
    case "member.removed":
      return env.HUBS.getByName(ev.workspaceId).revoke(ev.workspaceId, { userId: ev.userId });
    case "member.role_changed":
      for (const docId of await docsOf(env, ev.workspaceId, null)) n += await room(env, ev.workspaceId, docId).recheck({ userIds: [ev.userId] });
      return n;
    case "workspace.deleted":
      for (const docId of await docsOf(env, ev.workspaceId, null)) n += await room(env, ev.workspaceId, docId).closeAll("workspace deleted");
      return n;
    case "device.revoked":
    case "session.revoked":
      for (const { workspaceId, docId } of await env.INBOXES.getByName(ev.userId).liveDocs()) {
        n += await room(env, workspaceId, docId).revoke({ userId: ev.userId, deviceId: ev.deviceId });
      }
      return n;
  }
  return 0;
}

const KNOWN = new Set(["access.changed", "member.removed", "member.role_changed", "workspace.deleted", "device.revoked", "session.revoked"]);

export function parseEvent(v: unknown): EventEnvelope | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (typeof e.type !== "string" || !KNOWN.has(e.type) || typeof e.id !== "string") return null;
  return e as unknown as EventEnvelope;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time check of `x-worlds-signature: sha256=<hex>`. */
export async function validSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const want = await hmacHex(secret, body);
  const got = header.slice(7).toLowerCase();
  let diff = want.length ^ got.length;
  for (let i = 0; i < Math.max(want.length, got.length); i++) diff |= (want.charCodeAt(i) || 0) ^ (got.charCodeAt(i) || 0);
  return diff === 0;
}
