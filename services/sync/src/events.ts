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
  | { type: "session.revoked"; userId: string; deviceId: string; sessionId: string }
  | { type: "user.erased"; userId: string }
  | { type: "workspace.purged"; workspaceId: string; docIds: string[] }
  | { type: "user.notify"; userId: string; notification: { id: string; topic: string; title: string; excerpt: string; link?: string; createdAt: number } };

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
      await env.INBOXES.getByName(ev.userId).revokeDevice(ev.deviceId, Math.floor(((ev as Partial<EventEnvelope>).at ?? Date.now()) / 1000), ev.type === "device.revoked");
      for (const { workspaceId, docId } of await env.INBOXES.getByName(ev.userId).liveDocs()) {
        n += await room(env, workspaceId, docId).revoke({ userId: ev.userId, deviceId: ev.deviceId });
      }
      return n;
    case "user.erased": {
      // The account is gone: its web copy and files, and its notifications.
      await eraseR2Prefix(env, `vault/${ev.userId}/`);
      await env.INBOXES.getByName(ev.userId).erase();
      return 0;
    }
    case "workspace.purged": {
      for (const docId of ev.docIds ?? []) n += await room(env, ev.workspaceId, docId).erase();
      await eraseR2Prefix(env, `ws/${ev.workspaceId}/`);
      return n;
    }
    case "user.notify": {
      // A note from Worlds itself: a support reply or a message from the team.
      const x = ev.notification;
      if (!x || typeof x.id !== "string") return 0;
      await env.INBOXES.getByName(ev.userId).put({
        id: x.id,
        kind: "worlds",
        topic: String(x.topic ?? "").slice(0, 40),
        title: String(x.title ?? "").slice(0, 200),
        link: typeof x.link === "string" ? x.link.slice(0, 500) : undefined,
        workspaceId: "",
        docId: "",
        threadId: "",
        commentId: "",
        from: "worlds",
        fromName: "Worlds",
        excerpt: String(x.excerpt ?? "").slice(0, 400),
        createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
      });
      return 0;
    }
  }
  return 0;
}

const KNOWN = new Set(["access.changed", "member.removed", "member.role_changed", "workspace.deleted", "device.revoked", "session.revoked", "user.notify", "user.erased", "workspace.purged"]);

/** Delete every object under a prefix in the blob bucket. */
async function eraseR2Prefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.BLOBS.list({ prefix, cursor });
    if (list.objects.length) await env.BLOBS.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

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
