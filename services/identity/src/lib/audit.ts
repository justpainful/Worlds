import type { ActorKind } from "../env";
import { newId, now } from "./crypto";

export interface AuditEntry {
  action: string;
  actorUserId: string | null;
  actorKind: ActorKind;
  deviceId?: string | null;
  workspaceId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  at: number;
  workspaceId: string | null;
  actorUserId: string | null;
  actorKind: ActorKind;
  deviceId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
}

/** A prepared statement so callers can batch it with the change it records. */
export function auditStmt(db: D1Database, e: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, at, workspace_id, actor_user_id, actor_kind, device_id, action, target_type, target_id, meta)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      newId(),
      now(),
      e.workspaceId ?? null,
      e.actorUserId,
      e.actorKind,
      e.deviceId ?? null,
      e.action,
      e.targetType ?? null,
      e.targetId ?? null,
      JSON.stringify(e.meta ?? {}),
    );
}

export async function audit(db: D1Database, e: AuditEntry): Promise<void> {
  await auditStmt(db, e).run();
}

export async function listAudit(db: D1Database, where: { workspaceId?: string; actorUserId?: string }, limit = 100, before?: number): Promise<AuditRow[]> {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (where.workspaceId) {
    args.push(where.workspaceId);
    clauses.push(`workspace_id = ?${args.length}`);
  }
  if (where.actorUserId) {
    args.push(where.actorUserId);
    clauses.push(`actor_user_id = ?${args.length}`);
  }
  if (before) {
    args.push(before);
    clauses.push(`at < ?${args.length}`);
  }
  args.push(Math.min(Math.max(limit, 1), 500));
  const sql = `SELECT * FROM audit_log ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY at DESC, id DESC LIMIT ?${args.length}`;
  const { results } = await db.prepare(sql).bind(...args).all<Record<string, unknown>>();
  return results.map((r) => ({
    id: r.id as string,
    at: r.at as number,
    workspaceId: (r.workspace_id as string) ?? null,
    actorUserId: (r.actor_user_id as string) ?? null,
    actorKind: r.actor_kind as ActorKind,
    deviceId: (r.device_id as string) ?? null,
    action: r.action as string,
    targetType: (r.target_type as string) ?? null,
    targetId: (r.target_id as string) ?? null,
    meta: JSON.parse((r.meta as string) || "{}"),
  }));
}
