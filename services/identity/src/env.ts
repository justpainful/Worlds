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
  /** Resend (resend.com) API key: the simplest hosted sender. */
  RESEND_API_KEY?: string;
  /** Brevo (brevo.com) API key: a second free sender after Resend. */
  BREVO_API_KEY?: string;
  /** From address for sign-in emails, e.g. "Worlds <login@example.com>". */
  EMAIL_FROM?: string;
  /** Cloudflare Email Service binding (`send_email` in wrangler.toml); tried before Resend. */
  EMAIL?: SendEmailBinding;
  /** Shared with services/edge: a request carrying it came through the edge, so its x-worlds-client-ip is the visitor's. */
  EDGE_SECRET?: string;
  /** Web origins allowed to call this service from a browser, comma separated (https://app.enterworlds.space). */
  ALLOWED_ORIGINS?: string;
}

/** The part of Cloudflare's `send_email` binding this service uses. */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    text: string;
    html?: string;
  }): Promise<unknown>;
}

export type ActorKind = "user" | "ai-on-behalf-of-user" | "automation" | "system";

/** The authenticated caller of an HTTP request. */
export interface Caller {
  userId: string;
  deviceId: string;
  actor: ActorKind;
}

export type AppEnv = { Bindings: Env; Variables: { caller: Caller } };
