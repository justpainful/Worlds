const enc = new TextEncoder();

export function now(): number {
  return Date.now();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** An opaque secret for refresh tokens, invite links and handoff codes. */
export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${b64urlEncode(randomBytes(bytes))}`;
}

/** Uniform 6 digit code (rejection sampling, no modulo bias). */
export function randomDigits(n = 6): string {
  let out = "";
  while (out.length < n) {
    const b = randomBytes(1)[0];
    if (b < 250) out += String(b % 10);
  }
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256B64url(input: string): Promise<string> {
  return b64urlEncode(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Verify an Ed25519 signature made with a device key (raw 32 byte public key, base64url). */
export async function verifyEd25519(publicKeyB64url: string, message: string, signatureB64url: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", b64urlDecode(publicKeyB64url), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, b64urlDecode(signatureB64url), enc.encode(message));
  } catch {
    return false;
  }
}

export function isValidEd25519PublicKey(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 40 || s.length > 50) return false;
  try {
    return b64urlDecode(s).length === 32;
  } catch {
    return false;
  }
}
