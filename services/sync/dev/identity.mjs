// Local stand-in for the identity service, for running the sync service on
// one machine (see docs/SYNC_PROTOCOL.md, "Run it locally"). It speaks the
// same contract as services/identity: an Ed25519 JWKS, EdDSA access tokens
// with { sub, dev, iat, exp }, and checkAccess() over a Service Binding.
// Never deploy it: it mints tokens for anyone who asks.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

const KID = "dev-key";
let keys = null;

// Grants live in a Durable Object: RPC calls and HTTP requests can land in
// different isolates, so module memory is not shared between them.
export class Grants extends DurableObject {
  async get(key) {
    return (await this.ctx.storage.get(key)) ?? null;
  }
  async set(key, level) {
    await this.ctx.storage.put(key, level);
  }
}
const grants = (env) => env.GRANTS.getByName("grants");

async function keypair() {
  if (keys) return keys;
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  keys = { privateKey: pair.privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, kid: KID, alg: "EdDSA", use: "sig" } };
  return keys;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function mint(sub, dev, ttl) {
  const { privateKey } = await keypair();
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: "EdDSA", typ: "JWT", kid: KID });
  const body = enc({ sub, dev, iat: now, exp: now + ttl });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

/** The same named entrypoint as services/identity (docs/contracts/identity.md). */
export class IdentityRPC extends WorkerEntrypoint {
  async checkAccess({ userId, workspaceId, docId }) {
    const g = grants(this.env);
    const level = (await g.get(`${userId}|${workspaceId}|${docId}`)) ?? (await g.get(`${userId}|${workspaceId}|*`)) ?? this.env.DEFAULT_LEVEL ?? "edit";
    return { level };
  }

  async listDocs() {
    return [];
  }
}

export default class DevIdentity extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/jwks.json") {
      return Response.json({ keys: [(await keypair()).publicJwk] });
    }
    if (url.pathname === "/dev/token") {
      const sub = url.searchParams.get("sub");
      if (!sub) return new Response("sub is required", { status: 400 });
      const dev = url.searchParams.get("dev") ?? `${sub}-device`;
      const ttl = Number(url.searchParams.get("ttl") ?? 12 * 3600);
      return Response.json({ token: await mint(sub, dev, ttl) });
    }
    if (url.pathname === "/dev/grant" && request.method === "POST") {
      const { userId, workspaceId, docId, level } = await request.json();
      await grants(this.env).set(`${userId}|${workspaceId}|${docId ?? "*"}`, level);
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }
}
