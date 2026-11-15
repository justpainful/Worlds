/**
 * A signed-in person's workspace from Worlds on the web, kept on their
 * account (src/web/vault.ts is the client). One JSON snapshot per person and
 * their attached files, in R2 under vault/<userId>/. Only that person can
 * read or write it: the key comes from their verified token, never from the
 * request.
 *
 *   GET  /v1/vault              the snapshot, with its etag (404 when none yet)
 *   PUT  /v1/vault              replace it; If-Match: <etag> or "none" for the first
 *                               write. A stale etag answers 412 with the current one,
 *                               so a second device merges instead of overwriting.
 *   GET  /v1/vault/files/:id    one attached file
 *   PUT  /v1/vault/files/:id    store one attached file
 */
import type { Env } from "./env";
import { json, problem } from "./http";

export const MAX_SNAPSHOT = 32 * 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const key = (userId: string) => `vault/${userId}/workspace.json`;
const fileKey = (userId: string, id: string) => `vault/${userId}/files/${id}`;

async function readLimited(request: Request, limit: number): Promise<ArrayBuffer | Response> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return problem(413, "too large");
  const body = await request.arrayBuffer();
  if (body.byteLength > limit) return problem(413, "too large");
  return body;
}

export async function vault(request: Request, env: Env, userId: string, parts: string[]): Promise<Response> {
  const method = request.method;

  if (parts.length === 2) {
    if (method === "GET") {
      const obj = await env.BLOBS.get(key(userId));
      if (!obj) return problem(404, "no workspace saved yet");
      return new Response(obj.body, { headers: { "content-type": "application/json", etag: obj.httpEtag, "cache-control": "no-store" } });
    }
    if (method === "PUT") {
      const expected = request.headers.get("if-match");
      if (!expected) return problem(428, "If-Match is required");
      const body = await readLimited(request, MAX_SNAPSHOT);
      if (body instanceof Response) return body;
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return problem(400, "not JSON");
      }
      if (!parsed || typeof parsed !== "object" || (parsed as { v?: unknown }).v !== 1) return problem(400, "not a Worlds workspace");
      const current = await env.BLOBS.head(key(userId));
      const stale = expected === "none" ? current !== null : !current || current.httpEtag !== expected;
      if (stale) return json({ error: "stale", etag: current?.httpEtag ?? null }, 412);
      const put = await env.BLOBS.put(key(userId), body, {
        httpMetadata: { contentType: "application/json" },
        ...(current ? { onlyIf: { etagMatches: current.etag } } : {}),
      });
      // Another write landed between the check and this one.
      if (!put) return json({ error: "stale", etag: (await env.BLOBS.head(key(userId)))?.httpEtag ?? null }, 412);
      return json({ etag: put.httpEtag });
    }
    return problem(405, "method not allowed");
  }

  if (parts.length === 4 && parts[2] === "files" && FILE_ID.test(parts[3])) {
    const k = fileKey(userId, parts[3]);
    if (method === "GET") {
      const obj = await env.BLOBS.get(k);
      if (!obj) return problem(404, "no such file");
      return new Response(obj.body, {
        headers: {
          "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (method === "PUT") {
      const body = await readLimited(request, MAX_FILE);
      if (body instanceof Response) return body;
      const type = request.headers.get("content-type") ?? "application/octet-stream";
      await env.BLOBS.put(k, body, { httpMetadata: { contentType: type.slice(0, 100) } });
      return json({ ok: true });
    }
    return problem(405, "method not allowed");
  }

  return problem(404, "not found");
}
