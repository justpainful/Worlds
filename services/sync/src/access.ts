import type { AccessQuery, Env, IdentityRpc } from "./env";
import type { AccessLevel } from "./protocol";

/** Anything that answers "what may this user do with this document?". */
export interface AccessChecker {
  checkAccess(q: AccessQuery): Promise<{ level: AccessLevel }>;
}

const LEVELS: AccessLevel[] = ["none", "view", "comment", "edit", "full"];

export function normalizeLevel(v: unknown): AccessLevel {
  return typeof v === "string" && (LEVELS as string[]).includes(v) ? (v as AccessLevel) : "none";
}

export const atLeast = (level: AccessLevel, min: AccessLevel) => LEVELS.indexOf(level) >= LEVELS.indexOf(min);

/** Production: the identity service over its Service Binding RPC. */
export class ServiceBindingAccess implements AccessChecker {
  constructor(private readonly rpc: IdentityRpc) {}
  async checkAccess(q: AccessQuery): Promise<{ level: AccessLevel }> {
    const r = await this.rpc.checkAccess({ userId: q.userId, workspaceId: q.workspaceId, docId: q.docId });
    return { level: normalizeLevel(r?.level) };
  }
}

/** In-memory checker for unit tests and local experiments. */
export class FakeAccess implements AccessChecker {
  private grants = new Map<string, AccessLevel>();
  set(userId: string, workspaceId: string, docId: string | "*", level: AccessLevel) {
    this.grants.set(`${userId}|${workspaceId}|${docId}`, level);
  }
  async checkAccess(q: AccessQuery): Promise<{ level: AccessLevel }> {
    const level = this.grants.get(`${q.userId}|${q.workspaceId}|${q.docId}`) ?? this.grants.get(`${q.userId}|${q.workspaceId}|*`) ?? "none";
    return { level };
  }
}

export const accessFor = (env: Env): AccessChecker => new ServiceBindingAccess(env.IDENTITY);
