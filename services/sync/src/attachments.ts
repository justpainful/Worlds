/**
 * Attachments in R2, keyed by content hash per workspace:
 *   ws/<workspaceId>/sha256/<hex>
 *
 * Upload: ask for a plan (POST .../attachments/uploads). Bytes already
 * stored need no upload at all; small files get one signed PUT that R2
 * verifies against the hash; large files get a resumable multipart upload
 * whose parts are tracked by the workspace hub, then a completion step that
 * re-hashes the stored object. Download: a short-lived signed GET with
 * Range support (resumable). Every grant is issued only after checkAccess.
 */
import { type BlobGrant, signGrant, verifyGrant } from "./auth";
import { type Env, num } from "./env";
import { json, problem } from "./http";

export const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_SIZE = 5 * 1024 * 1024 * 1024;
const MIN_PART = 5 * 1024 * 1024; // R2 multipart minimum for every part but the last
const GRANT_SECONDS = 60 * 60;

export const blobKey = (workspaceId: string, hash: string) => `ws/${workspaceId}/sha256/${hash}`;

const partSize = (env: Env) => Math.max(MIN_PART, num(env.PART_SIZE, 8 * 1024 * 1024));

async function signedUrl(origin: string, env: Env, g: BlobGrant): Promise<string> {
  const sig = await signGrant(env.SIGNING_SECRET, g);
  const path = g.op === "part" ? `/v1/blobs/${g.workspaceId}/${g.hash}/parts/${g.part}` : `/v1/blobs/${g.workspaceId}/${g.hash}`;
  const q = new URLSearchParams({ op: g.op, uid: g.userId, exp: String(g.exp), sig });
  if (g.uploadId) q.set("uploadId", g.uploadId);
  return `${origin}${path}?${q}`;
}

interface Ctx {
  env: Env;
  origin: string;
  workspaceId: string;
  userId: string;
}

/** POST .../attachments/uploads { sha256, size, mime } (edit access). */
export async function planUpload(c: Ctx, body: unknown): Promise<Response> {
  const b = (body ?? {}) as { sha256?: unknown; size?: unknown; mime?: unknown };
  const hash = typeof b.sha256 === "string" ? b.sha256.toLowerCase() : "";
  const size = typeof b.size === "number" ? b.size : NaN;
  const mime = typeof b.mime === "string" && b.mime.length <= 255 ? b.mime : "application/octet-stream";
  if (!HASH_RE.test(hash)) return problem(400, "sha256 must be 64 hex characters");
  if (!Number.isInteger(size) || size <= 0 || size > MAX_SIZE) return problem(400, "size is out of range");

  const key = blobKey(c.workspaceId, hash);
  const head = await c.env.BLOBS.head(key);
  if (head) return json({ status: "complete", sha256: hash, size: head.size });

  const exp = Math.floor(Date.now() / 1000) + GRANT_SECONDS;
  const ps = partSize(c.env);
  if (size <= ps) {
    const url = await signedUrl(c.origin, c.env, { op: "put", workspaceId: c.workspaceId, hash, userId: c.userId, exp });
    return json({ status: "pending", mode: "single", sha256: hash, size, url, expiresAt: exp });
  }

  const hub = c.env.HUBS.getByName(c.workspaceId);
  let state = await hub.upload(hash);
  if (state && (state.status === "complete" || state.size !== size)) {
    // Stale ledger entry (object deleted, or a different declared size): start over.
    await hub.resetUpload(hash);
    state = null;
  }
  if (!state) {
    const mp = await c.env.BLOBS.createMultipartUpload(key, { httpMetadata: { contentType: mime }, customMetadata: { sha256: hash } });
    state = await hub.beginUpload({ hash, uploadId: mp.uploadId, size, mime, partSize: ps });
    if (state.uploadId !== mp.uploadId) await mp.abort().catch(() => undefined);
  }
  const partCount = Math.ceil(size / state.partSize);
  const done = new Set(state.parts.map((p) => p.partNumber));
  const parts = [];
  for (let n = 1; n <= partCount; n++) {
    if (done.has(n)) continue;
    parts.push({ partNumber: n, url: await signedUrl(c.origin, c.env, { op: "part", workspaceId: c.workspaceId, hash, userId: c.userId, exp, uploadId: state.uploadId, part: n }) });
  }
  return json({
    status: "pending",
    mode: "multipart",
    sha256: hash,
    size,
    uploadId: state.uploadId,
    partSize: state.partSize,
    partCount,
    partsDone: [...done].sort((a, b) => a - b),
    parts,
    expiresAt: exp,
  });
}

/** POST .../attachments/uploads/:hash/complete (edit access). */
export async function completeUpload(c: Ctx, hash: string): Promise<Response> {
  const key = blobKey(c.workspaceId, hash);
  if (await c.env.BLOBS.head(key)) return json({ status: "complete", sha256: hash });
  const hub = c.env.HUBS.getByName(c.workspaceId);
  const state = await hub.upload(hash);
  if (!state) return problem(404, "no upload in progress");
  const partCount = Math.ceil(state.size / state.partSize);
  const have = new Set(state.parts.map((p) => p.partNumber));
  const missing: number[] = [];
  for (let n = 1; n <= partCount; n++) if (!have.has(n)) missing.push(n);
  if (missing.length) return json({ status: "pending", missing }, 409);

  const mp = c.env.BLOBS.resumeMultipartUpload(key, state.uploadId);
  try {
    await mp.complete(state.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
  } catch (e) {
    // A concurrent completion may have won.
    if (await c.env.BLOBS.head(key)) return json({ status: "complete", sha256: hash });
    return problem(502, `could not complete upload: ${e instanceof Error ? e.message : "unknown"}`);
  }
  // Multipart objects carry no verified hash: read it back and check.
  const obj = await c.env.BLOBS.get(key);
  const actual = obj ? await sha256Hex(obj.body) : "";
  if (actual !== hash) {
    await c.env.BLOBS.delete(key);
    await hub.resetUpload(hash);
    return problem(422, "uploaded bytes do not match sha256");
  }
  await hub.completeUpload(hash);
  return json({ status: "complete", sha256: hash });
}

/** GET .../attachments/:hash (view access): metadata and a signed download URL. */
export async function describe(c: Ctx, hash: string): Promise<Response> {
  const head = await c.env.BLOBS.head(blobKey(c.workspaceId, hash));
  if (!head) return problem(404, "attachment not found");
  const exp = Math.floor(Date.now() / 1000) + GRANT_SECONDS;
  return json({
    sha256: hash,
    size: head.size,
    mime: head.httpMetadata?.contentType ?? "application/octet-stream",
    url: await signedUrl(c.origin, c.env, { op: "get", workspaceId: c.workspaceId, hash, userId: c.userId, exp }),
    expiresAt: exp,
  });
}

/** Signed blob routes: /v1/blobs/:ws/:hash and /v1/blobs/:ws/:hash/parts/:n */
export async function serveBlob(request: Request, env: Env, workspaceId: string, hash: string, part: number | null): Promise<Response> {
  const url = new URL(request.url);
  const op = url.searchParams.get("op") as BlobGrant["op"] | null;
  const grant: BlobGrant = {
    op: op ?? "get",
    workspaceId,
    hash,
    userId: url.searchParams.get("uid") ?? "",
    exp: Number(url.searchParams.get("exp") ?? 0),
    uploadId: url.searchParams.get("uploadId") ?? undefined,
    part: part ?? undefined,
  };
  const expected = request.method === "GET" || request.method === "HEAD" ? "get" : part === null ? "put" : "part";
  if (grant.op !== expected || !(await verifyGrant(env.SIGNING_SECRET, grant, url.searchParams.get("sig") ?? ""))) {
    return problem(403, "invalid or expired signature");
  }
  const key = blobKey(workspaceId, hash);

  if (expected === "get") {
    const obj = await env.BLOBS.get(key, { range: request.headers, onlyIf: request.headers });
    if (!obj) return problem(404, "attachment not found");
    const headers = new Headers({ "accept-ranges": "bytes", etag: obj.httpEtag, "cache-control": "private, max-age=3600" });
    headers.set("content-type", obj.httpMetadata?.contentType ?? "application/octet-stream");
    if (!("body" in obj)) return new Response(null, { status: 304, headers });
    const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
    if (range && request.headers.has("range")) {
      const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
      const length = range.suffix !== undefined ? range.suffix : (range.length ?? obj.size - offset);
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set("content-length", String(length));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set("content-length", String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  }

  if (expected === "put") {
    if (await env.BLOBS.head(key)) return json({ status: "complete", sha256: hash });
    try {
      await env.BLOBS.put(key, await request.arrayBuffer(), {
        sha256: hash,
        httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
        customMetadata: { sha256: hash },
      });
    } catch {
      return problem(422, "uploaded bytes do not match sha256");
    }
    return json({ status: "complete", sha256: hash });
  }

  // Multipart part.
  const hub = env.HUBS.getByName(workspaceId);
  const state = await hub.upload(hash);
  if (!state || state.uploadId !== grant.uploadId || state.status !== "uploading") return problem(409, "upload is not in progress");
  const partCount = Math.ceil(state.size / state.partSize);
  if (!part || part < 1 || part > partCount) return problem(400, "part number out of range");
  const bytes = await request.arrayBuffer();
  const expectedSize = part < partCount ? state.partSize : state.size - state.partSize * (partCount - 1);
  if (bytes.byteLength !== expectedSize) return problem(400, `part ${part} must be ${expectedSize} bytes`);
  const mp = env.BLOBS.resumeMultipartUpload(key, state.uploadId);
  const uploaded = await mp.uploadPart(part, bytes);
  await hub.recordPart(hash, state.uploadId, part, uploaded.etag, bytes.byteLength);
  return json({ partNumber: part, etag: uploaded.etag });
}

async function sha256Hex(body: ReadableStream): Promise<string> {
  const digest = new crypto.DigestStream("SHA-256");
  await body.pipeTo(digest);
  const buf = new Uint8Array(await digest.digest);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
