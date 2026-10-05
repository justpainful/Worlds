import type { Env } from "../env";
import { hmacSha256Hex, newId, now } from "./crypto";

/**
 * Access change events for the sync service. Written to the outbox in the
 * same request as the change, then delivered (queue and/or webhook) at least
 * once; the cron retries anything undelivered. See docs/contracts/identity.md.
 */
export type AccessEvent =
  | { type: "access.changed"; workspaceId: string; docIds: string[] | null; userIds: string[] | null }
  | { type: "member.removed"; workspaceId: string; userId: string }
  | { type: "member.role_changed"; workspaceId: string; userId: string; role: string }
  | { type: "workspace.deleted"; workspaceId: string }
  | { type: "device.revoked"; userId: string; deviceId: string }
  | { type: "session.revoked"; userId: string; deviceId: string; sessionId: string };

export type EventEnvelope = AccessEvent & { id: string; at: number };

export function eventStmt(db: D1Database, e: AccessEvent): { stmt: D1PreparedStatement; envelope: EventEnvelope } {
  const envelope = { ...e, id: newId(), at: now() } as EventEnvelope;
  return {
    envelope,
    stmt: db.prepare("INSERT INTO outbox (id, type, payload, created_at) VALUES (?1, ?2, ?3, ?4)").bind(envelope.id, e.type, JSON.stringify(envelope), envelope.at),
  };
}

async function deliverOne(env: Env, ev: EventEnvelope): Promise<void> {
  let sent = false;
  if (env.REVOCATIONS) {
    await env.REVOCATIONS.send(ev);
    sent = true;
  }
  if (env.SYNC_WEBHOOK_URL) {
    const body = JSON.stringify(ev);
    const sig = env.SYNC_WEBHOOK_SECRET ? await hmacSha256Hex(env.SYNC_WEBHOOK_SECRET, body) : "";
    const res = await fetch(env.SYNC_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worlds-event-id": ev.id, ...(sig ? { "x-worlds-signature": `sha256=${sig}` } : {}) },
      body,
    });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
    sent = true;
  }
  // With no consumer configured the event stays recorded in the outbox only.
  void sent;
}

export async function deliver(env: Env, events: EventEnvelope[]): Promise<void> {
  for (const ev of events) {
    try {
      await deliverOne(env, ev);
      await env.DB.prepare("UPDATE outbox SET delivered_at = ?1, attempts = attempts + 1 WHERE id = ?2").bind(now(), ev.id).run();
    } catch (e) {
      await env.DB.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2").bind(String(e).slice(0, 300), ev.id).run();
    }
  }
}

/** Cron: retry undelivered events (oldest first), give up after 50 attempts. */
export async function retryOutbox(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT payload FROM outbox WHERE delivered_at IS NULL AND attempts < 50 ORDER BY created_at LIMIT 100").all<{ payload: string }>();
  await deliver(env, results.map((r) => JSON.parse(r.payload) as EventEnvelope));
  return results.length;
}
