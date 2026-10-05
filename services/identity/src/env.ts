export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME: string;
  WEBAUTHN_ORIGIN: string;
  PUBLIC_URL: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  REFRESH_TOKEN_TTL_DAYS?: string;
  /** Ed25519 private key as a JWK (kty OKP, crv Ed25519, d, x). */
  JWT_PRIVATE_JWK?: string;
  /** Optional JSON array of older public JWKs still accepted during key rotation. */
  JWT_PREVIOUS_PUBLIC_JWKS?: string;
  /** Access change events: a queue binding, a webhook, or both. */
  REVOCATIONS?: Queue;
  SYNC_WEBHOOK_URL?: string;
  SYNC_WEBHOOK_SECRET?: string;
  /** Optional HTTP endpoint that delivers sign-in emails ({ to, subject, text }). */
  EMAIL_WEBHOOK_URL?: string;
  EMAIL_WEBHOOK_SECRET?: string;
}

export type ActorKind = "user" | "ai-on-behalf-of-user" | "automation" | "system";

/** The authenticated caller of an HTTP request. */
export interface Caller {
  userId: string;
  deviceId: string;
  actor: ActorKind;
}

export type AppEnv = { Bindings: Env; Variables: { caller: Caller } };
