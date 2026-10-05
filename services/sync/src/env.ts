import type { AccessLevel } from "./protocol";
import type { DocRoom } from "./doc";
import type { WorkspaceHub } from "./hub";
import type { UserInbox } from "./inbox";

export interface AccessQuery {
  userId: string;
  workspaceId: string;
  docId: string;
}

/**
 * The identity service's RPC surface, reached through a Service Binding.
 * This is the whole contract the sync service depends on.
 */
export interface IdentityRpc {
  checkAccess(q: AccessQuery): Promise<{ level: AccessLevel }>;
}

export interface Env {
  DOCS: DurableObjectNamespace<DocRoom>;
  HUBS: DurableObjectNamespace<WorkspaceHub>;
  INBOXES: DurableObjectNamespace<UserInbox>;
  BLOBS: R2Bucket;
  IDENTITY: Service & IdentityRpc;

  /** Identity service JWKS, for example https://identity.example/.well-known/jwks.json */
  JWKS_URL: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
  /** Shared secret for POST /internal/revoke. */
  INTERNAL_SECRET: string;
  /** HMAC key for access change events from the identity service (POST /internal/events). */
  SYNC_WEBHOOK_SECRET?: string;
  /** HMAC secret for signed attachment URLs. */
  SIGNING_SECRET: string;
  /** Allowed CORS origins, comma separated, or "*". */
  ALLOWED_ORIGINS?: string;

  /** Tuning (strings because they come from [vars]). */
  COMPACT_EVERY?: string;
  VERSION_INTERVAL_MS?: string;
  ACCESS_TTL_MS?: string;
  PART_SIZE?: string;
}

export const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
