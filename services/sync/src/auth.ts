/**
 * Access tokens: EdDSA (Ed25519) JWTs issued by the identity service, with
 * claims { sub, dev, iat, exp }. Keys come from the identity service's JWKS
 * (GET /.well-known/jwks.json), cached in memory.
 */

export interface TokenClaims {
  sub: string;
  dev: string;
  iat: number;
  exp: number;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

interface Jwk {
  kty: string;
  crv?: string;
  x?: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const text = new TextEncoder();

/** JWKS cache shared by every request in this isolate. */
const cache = new Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }>();
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_REFRESH_MIN_MS = 30 * 1000;

async function importKey(jwk: Jwk): Promise<CryptoKey | null> {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) return null;
  if (jwk.use && jwk.use !== "sig") return null;
  return crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
}

async function loadKeys(url: string, fetcher: typeof fetch): Promise<Map<string, CryptoKey>> {
  const res = await fetcher(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new AuthError(`jwks fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const [i, jwk] of (body.keys ?? []).entries()) {
    const key = await importKey(jwk);
    if (key) keys.set(jwk.kid ?? `#${i}`, key);
  }
  cache.set(url, { keys, fetchedAt: Date.now() });
  return keys;
}

async function keyFor(url: string, kid: string | undefined, fetcher: typeof fetch): Promise<CryptoKey | null> {
  let entry = cache.get(url);
  if (!entry || Date.now() - entry.fetchedAt > JWKS_TTL_MS) {
    await loadKeys(url, fetcher);
    entry = cache.get(url)!;
  }
  const pick = (keys: Map<string, CryptoKey>) => (kid ? keys.get(kid) : keys.size === 1 ? [...keys.values()][0] : undefined) ?? null;
  let key = pick(entry.keys);
  // An unknown kid usually means the identity service rotated keys.
  if (!key && Date.now() - entry.fetchedAt > JWKS_REFRESH_MIN_MS) key = pick(await loadKeys(url, fetcher));
  return key;
}

/** Forget cached keys (tests, key rotation drills). */
export function clearJwksCache() {
  cache.clear();
}

export interface VerifyOptions {
  jwksUrl: string;
  issuer?: string;
  audience?: string;
  now?: number; // seconds
  leewaySeconds?: number;
  fetcher?: typeof fetch;
}

export async function verifyToken(token: string, opts: VerifyOptions): Promise<TokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("malformed token");
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    throw new AuthError("malformed token");
  }
  if (header.alg !== "EdDSA") throw new AuthError("unsupported algorithm");
  const key = await keyFor(opts.jwksUrl, header.kid, opts.fetcher ?? fetch);
  if (!key) throw new AuthError("unknown signing key");
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64urlToBytes(parts[2]), text.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AuthError("bad signature");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const leeway = opts.leewaySeconds ?? 30;
  const { sub, dev, iat, exp } = payload;
  if (typeof sub !== "string" || !sub) throw new AuthError("missing sub");
  if (typeof dev !== "string" || !dev) throw new AuthError("missing dev");
  if (typeof iat !== "number" || typeof exp !== "number") throw new AuthError("missing iat or exp");
  if (exp + leeway < now) throw new AuthError("token expired");
  if (iat - leeway > now) throw new AuthError("token issued in the future");
  if (opts.issuer && payload.iss !== opts.issuer) throw new AuthError("wrong issuer");
  if (opts.audience) {
    const aud = payload.aud;
    const list = Array.isArray(aud) ? aud : [aud];
    if (!list.includes(opts.audience)) throw new AuthError("wrong audience");
  }
  return { sub, dev, iat, exp };
}

/** Bearer token from the Authorization header or the WebSocket subprotocol list. */
export function tokenFrom(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim() || null;
  const protos = request.headers.get("sec-websocket-protocol");
  if (protos) {
    for (const p of protos.split(",").map((s) => s.trim())) {
      if (p.startsWith("bearer.")) return p.slice(7) || null;
    }
  }
  return null;
}

/** Constant-time comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const x = text.encode(a);
  const y = text.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Signed URLs for attachments (HMAC-SHA256 over the request's capability).
// ---------------------------------------------------------------------------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", text.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface BlobGrant {
  op: "get" | "put" | "part";
  workspaceId: string;
  hash: string;
  userId: string;
  exp: number; // seconds
  uploadId?: string;
  part?: number;
}

const grantText = (g: BlobGrant) => [g.op, g.workspaceId, g.hash, g.userId, g.exp, g.uploadId ?? "", g.part ?? ""].join("\n");

export async function signGrant(secret: string, g: BlobGrant): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), text.encode(grantText(g)));
  return bytesToB64url(new Uint8Array(sig));
}

export async function verifyGrant(secret: string, g: BlobGrant, sig: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (g.exp < now) return false;
  let bytes: Uint8Array;
  try {
    bytes = b64urlToBytes(sig);
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, text.encode(grantText(g)));
}
