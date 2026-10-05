/**
 * Worlds sync service: live collaboration, offline catch-up, comments,
 * notifications, author history and attachments. See docs/SYNC_PROTOCOL.md.
 */
import { accessFor, atLeast, normalizeLevel } from "./access";
import { completeUpload, describe, HASH_RE, planUpload, serveBlob } from "./attachments";
import { AuthError, safeEqual, type TokenClaims, tokenFrom, verifyToken } from "./auth";
import type { Env } from "./env";
import { applyEvent, parseEvent, validSignature } from "./events";
import { cors, json, problem } from "./http";
import { type AccessLevel, CH_COMMENTS, CH_CONTENT, PROTOCOL } from "./protocol";

export { DocRoom } from "./doc";
export { WorkspaceHub } from "./hub";
export { UserInbox } from "./inbox";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function authenticate(request: Request, env: Env): Promise<TokenClaims | Response> {
  const token = tokenFrom(request);
  if (!token) return problem(401, "missing access token");
  try {
    return await verifyToken(token, { jwksUrl: env.JWKS_URL, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE });
  } catch (e) {
    if (e instanceof AuthError) return problem(401, e.message);
    return problem(503, "could not verify token");
  }
}

async function levelFor(env: Env, userId: string, workspaceId: string, docId: string): Promise<AccessLevel | Response> {
  try {
    return normalizeLevel((await accessFor(env).checkAccess({ userId, workspaceId, docId })).level);
  } catch {
    return problem(503, "access check unavailable");
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;

  if (method === "GET" && url.pathname === "/health") return json({ ok: true, protocol: PROTOCOL });

  // POST /internal/revoke { userId, workspaceId, docId?, deviceId?, level? }
  if (url.pathname === "/internal/revoke") {
    if (method !== "POST") return problem(405, "method not allowed");
    const auth = request.headers.get("authorization") ?? "";
    const secret = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : (request.headers.get("x-internal-secret") ?? "");
    if (!env.INTERNAL_SECRET || !safeEqual(secret, env.INTERNAL_SECRET)) return problem(403, "forbidden");
    const b = ((await readJson(request)) ?? {}) as { userId?: string; workspaceId?: string; docId?: string; deviceId?: string; level?: string };
    if (!b.userId || !b.workspaceId || !ID_RE.test(b.workspaceId) || (b.docId && !ID_RE.test(b.docId))) return problem(400, "userId and workspaceId are required");
    const input = { userId: b.userId, deviceId: b.deviceId, level: b.level ? normalizeLevel(b.level) : undefined };
    const closed = b.docId
      ? await env.DOCS.getByName(`${b.workspaceId}/${b.docId}`).revoke(input)
      : await env.HUBS.getByName(b.workspaceId).revoke(b.workspaceId, input);
    return json({ ok: true, affected: closed });
  }

  // Access change events from the identity service (signed webhook).
  if (url.pathname === "/internal/events") {
    if (method !== "POST") return problem(405, "method not allowed");
    const body = await request.text();
    if (!env.SYNC_WEBHOOK_SECRET || !(await validSignature(env.SYNC_WEBHOOK_SECRET, body, request.headers.get("x-worlds-signature")))) {
      return problem(403, "forbidden");
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* answered below */
    }
    const ev = parseEvent(parsed);
    // Unknown event types are acknowledged so the sender does not retry them forever.
    if (!ev) return json({ ok: true, ignored: true });
    return json({ ok: true, affected: await applyEvent(env, ev) });
  }

  // Signed blob routes: no bearer token, the signature is the capability.
  if (parts[0] === "v1" && parts[1] === "blobs") {
    const [, , ws, hash, sub, n] = parts;
    if (!ws || !ID_RE.test(ws) || !hash || !HASH_RE.test(hash)) return problem(404, "not found");
    if (parts.length === 4 && ["GET", "HEAD", "PUT"].includes(method)) return serveBlob(request, env, ws, hash, null);
    if (parts.length === 6 && sub === "parts" && method === "PUT") return serveBlob(request, env, ws, hash, Number(n));
    return problem(404, "not found");
  }

  if (parts[0] !== "v1") return problem(404, "not found");

  const claims = await authenticate(request, env);
  if (claims instanceof Response) return claims;
  const userId = claims.sub;

  // Notifications feed (per user, no document access needed).
  if (parts[1] === "notifications") {
    const inbox = env.INBOXES.getByName(userId);
    if (parts.length === 2 && method === "GET") {
      const before = url.searchParams.get("before");
      const limit = url.searchParams.get("limit");
      return json(await inbox.list({ before: before ? Number(before) : undefined, limit: limit ? Number(limit) : undefined }));
    }
    if (parts.length === 3 && parts[2] === "read" && method === "POST") {
      const b = ((await readJson(request)) ?? {}) as { ids?: unknown };
      const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : null;
      return json({ ok: true, marked: await inbox.markRead(ids) });
    }
    return problem(404, "not found");
  }

  // /v1/workspaces/:ws/docs/:doc/...
  if (parts[1] !== "workspaces" || parts[3] !== "docs") return problem(404, "not found");
  const workspaceId = parts[2];
  const docId = parts[4];
  if (!workspaceId || !docId || !ID_RE.test(workspaceId) || !ID_RE.test(docId)) return problem(404, "not found");
  const rest = parts.slice(5);
  const level = await levelFor(env, userId, workspaceId, docId);
  if (level instanceof Response) return level;
  if (level === "none") return problem(403, "no access to this document");
  const room = env.DOCS.getByName(`${workspaceId}/${docId}`);

  if (rest[0] === "sync" && rest.length === 1 && method === "GET") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return problem(426, "expected websocket upgrade");
    const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((s) => s.trim());
    const headers = new Headers(request.headers);
    headers.set("x-worlds-user", userId);
    headers.set("x-worlds-device", claims.dev);
    headers.set("x-worlds-level", level);
    headers.set("x-worlds-exp", String(claims.exp));
    headers.set("x-worlds-workspace", workspaceId);
    headers.set("x-worlds-doc", docId);
    if (offered.includes(PROTOCOL)) headers.set("x-worlds-subprotocol", PROTOCOL);
    return room.fetch(new Request(request.url, { headers }));
  }

  if (rest[0] === "state" && rest.length === 1 && method === "GET") {
    const channel = url.searchParams.get("channel") === "comments" ? CH_COMMENTS : CH_CONTENT;
    const state = await room.getState(workspaceId, docId, channel);
    return new Response(state, { headers: { "content-type": "application/octet-stream" } });
  }

  if (rest[0] === "versions") {
    if (rest.length === 1 && method === "GET") return json({ versions: await room.listVersions(workspaceId, docId) });
    if (rest.length === 1 && method === "POST") {
      if (!atLeast(level, "edit")) return problem(403, "edit access required");
      const b = ((await readJson(request)) ?? {}) as { label?: unknown };
      const label = typeof b.label === "string" ? b.label.slice(0, 200) : null;
      return json(await room.createVersion(workspaceId, docId, userId, label), 201);
    }
    if (rest.length === 2 && method === "GET") {
      const state = await room.getVersion(rest[1]);
      if (!state) return problem(404, "version not found");
      return new Response(state, { headers: { "content-type": "application/octet-stream" } });
    }
  }

  if (rest[0] === "attachments") {
    const c = { env, origin: url.origin, workspaceId, userId };
    if (rest[1] === "uploads") {
      if (!atLeast(level, "edit")) return problem(403, "edit access required");
      if (rest.length === 2 && method === "POST") return planUpload(c, await readJson(request));
      if (rest.length === 4 && rest[3] === "complete" && method === "POST" && HASH_RE.test(rest[2])) return completeUpload(c, rest[2]);
    }
    if (rest.length === 2 && method === "GET" && HASH_RE.test(rest[1])) return describe(c, rest[1]);
  }

  return problem(404, "not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return cors(request, env.ALLOWED_ORIGINS, new Response(null, { status: 204 }));
    try {
      return cors(request, env.ALLOWED_ORIGINS, await route(request, env));
    } catch (e) {
      return cors(request, env.ALLOWED_ORIGINS, problem(500, e instanceof Error ? e.message : "internal error"));
    }
  },

  /** The identity service's REVOCATIONS queue, when this Worker consumes it. */
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const ev = parseEvent(msg.body);
      try {
        if (ev) await applyEvent(env, ev);
        msg.ack();
      } catch {
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
