import type { Env } from "../env";
import { b64urlDecode, b64urlEncode, sha256B64url } from "./crypto";

/** Access token claims. Exactly these four; the sync service relies on them. */
export interface AccessClaims {
  sub: string; // user id
  dev: string; // device id
  iat: number; // seconds
  exp: number; // seconds
}

interface Keys {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string; alg: "EdDSA"; use: "sig" };
  verifiers: Map<string, CryptoKey>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
let cache: { source: string; keys: Promise<Keys> } | null = null;

/** Key id: a short thumbprint of the public key (RFC 7638 style). */
async function thumbprint(x: string): Promise<string> {
  return (await sha256B64url(JSON.stringify({ crv: "Ed25519", kty: "OKP", x }))).slice(0, 16);
}

async function loadKeys(env: Env): Promise<Keys> {
  const source = env.JWT_PRIVATE_JWK ?? "";
  if (cache && cache.source === source) return cache.keys;
  const keys = (async () => {
    let jwk: JsonWebKey;
    if (source) {
      jwk = JSON.parse(source) as JsonWebKey;
    } else if (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") {
      // Local development only: an ephemeral key per isolate.
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
      jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    } else {
      throw new Error("JWT_PRIVATE_JWK is not configured");
    }
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d || !jwk.x) throw new Error("JWT_PRIVATE_JWK must be an Ed25519 private JWK");
    const privateKey = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x }, { name: "Ed25519" }, false, ["sign"]);
    const kid = await thumbprint(jwk.x);
    const publicJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x, kid, alg: "EdDSA" as const, use: "sig" as const };
    const verifiers = new Map<string, CryptoKey>();
    verifiers.set(kid, await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]));
    for (const old of JSON.parse(env.JWT_PREVIOUS_PUBLIC_JWKS || "[]") as JsonWebKey[]) {
      if (!old.x) continue;
      const oldKid = await thumbprint(old.x);
      verifiers.set(oldKid, await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: old.x }, { name: "Ed25519" }, false, ["verify"]));
    }
    return { kid, privateKey, publicJwk, verifiers };
  })();
  cache = { source, keys };
  return keys;
}

export async function jwks(env: Env): Promise<{ keys: object[] }> {
  const k = await loadKeys(env);
  const previous = (JSON.parse(env.JWT_PREVIOUS_PUBLIC_JWKS || "[]") as JsonWebKey[]).filter((j) => j.x);
  const old = await Promise.all(
    previous.map(async (j) => ({ kty: "OKP", crv: "Ed25519", x: j.x, kid: await thumbprint(j.x!), alg: "EdDSA", use: "sig" })),
  );
  return { keys: [k.publicJwk, ...old] };
}

export function accessTtlSeconds(env: Env): number {
  const n = Number(env.ACCESS_TOKEN_TTL_SECONDS ?? 900);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 900;
}

export async function signAccessToken(env: Env, userId: string, deviceId: string, nowMs = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const k = await loadKeys(env);
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + accessTtlSeconds(env);
  const claims: AccessClaims = { sub: userId, dev: deviceId, iat, exp };
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: k.kid })));
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, k.privateKey, enc.encode(`${header}.${payload}`));
  return { token: `${header}.${payload}.${b64urlEncode(sig)}`, expiresAt: exp * 1000 };
}

/** Verify signature, algorithm and expiry. Returns null for any invalid token. */
export async function verifyAccessToken(env: Env, token: string, nowMs = Date.now()): Promise<AccessClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(dec.decode(b64urlDecode(parts[0]))) as { alg?: string; kid?: string };
    if (header.alg !== "EdDSA") return null;
    const k = await loadKeys(env);
    const key = header.kid ? k.verifiers.get(header.kid) : k.verifiers.get(k.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64urlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const claims = JSON.parse(dec.decode(b64urlDecode(parts[1]))) as AccessClaims;
    if (typeof claims.sub !== "string" || typeof claims.dev !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp * 1000 <= nowMs) return null;
    return claims;
  } catch {
    return null;
  }
}
