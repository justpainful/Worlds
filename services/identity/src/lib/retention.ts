/**
 * How long old records are kept (docs/admin/PLAN.md, section 2): the security
 * log for 12 months and closed support requests for 2 years by default, both
 * set from the dashboard (settings.retention). The cron runs every 5 minutes;
 * this sweep claims the day first, so it runs about once a day.
 */
import type { Env } from "../env";
import { auditStmt } from "./audit";
import { now } from "./crypto";
import { MAX_RETENTION_MONTHS, settings } from "./control";

const DAY = 86_400_000;
/** Twelve months is 365 days, as the log was kept before it could be changed. */
export const monthsMs = (months: number) => Math.round((months * 365 * DAY) / 12);
/** A row in service_settings that settings() ignores: when the last sweep ran. */
export const RETENTION_GUARD = "retention_ran_at";
/** Closed requests erased per sweep; the rest wait for the next day. */
const TICKETS_PER_SWEEP = 200;

function clampMonths(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_RETENTION_MONTHS) : fallback;
}

export interface RetentionResult {
  ran: boolean;
  audit: number;
  tickets: number;
}

/** Cron: erase security log entries and closed requests older than their periods, once a day. */
export async function retentionHousekeeping(env: Env, opts: { force?: boolean } = {}): Promise<RetentionResult> {
  const t = now();
  if (!opts.force) {
    const claim = await env.DB.prepare(
      "INSERT INTO service_settings (key, value, updated_by, updated_at) VALUES (?1, ?2, NULL, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3 WHERE service_settings.updated_at <= ?4",
    )
      .bind(RETENTION_GUARD, String(t), t, t - DAY)
      .run();
    if (!claim.meta.changes) return { ran: false, audit: 0, tickets: 0 };
  }
  const r = (await settings(env.DB)).retention;
  const auditCut = t - monthsMs(clampMonths(r.auditMonths, 12));
  const ticketCut = t - monthsMs(clampMonths(r.closedTicketMonths, 24));

  const audit = await env.DB.prepare("DELETE FROM audit_log WHERE at < ?1").bind(auditCut).run();

  const { results: old } = await env.DB.prepare("SELECT id FROM support_tickets WHERE status = 'closed' AND COALESCE(closed_at, updated_at) < ?1 LIMIT ?2")
    .bind(ticketCut, TICKETS_PER_SWEEP)
    .all<{ id: string }>();
  for (const tk of old) {
    // Pictures live in the files bucket; drop them before the rows that name them.
    const { results: files } = await env.DB.prepare("SELECT key FROM support_files WHERE ticket_id = ?1").bind(tk.id).all<{ key: string }>();
    for (const f of files) await env.PROFILE_FILES?.delete(f.key);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM support_files WHERE ticket_id = ?1").bind(tk.id),
      env.DB.prepare("DELETE FROM support_messages WHERE ticket_id = ?1").bind(tk.id),
      env.DB.prepare("DELETE FROM support_tickets WHERE id = ?1").bind(tk.id),
    ]);
  }

  const counts = { audit: audit.meta.changes ?? 0, tickets: old.length };
  if (counts.audit || counts.tickets) {
    await auditStmt(env.DB, { action: "retention.swept", actorUserId: null, actorKind: "system", meta: { ...counts, auditMonths: r.auditMonths, closedTicketMonths: r.closedTicketMonths } }).run();
  }
  return { ran: true, ...counts };
}
