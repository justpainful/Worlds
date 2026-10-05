/**
 * UserInbox: one Durable Object per user, holding their notifications feed
 * (mentions and replies). Adding is idempotent by notification id.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export interface Notification {
  id: string;
  kind: "mention" | "reply";
  workspaceId: string;
  docId: string;
  threadId: string;
  commentId: string;
  from: string;
  /** The author's display name from the page's people directory, when known. */
  fromName?: string;
  excerpt: string;
  createdAt: number;
  readAt?: number | null;
}

const MAX_KEPT = 1000;

export class UserInbox extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          read_at INTEGER,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created_at);
      `);
    });
  }

  async add(n: Notification): Promise<void> {
    this.sql.exec("INSERT OR IGNORE INTO notifications (id, created_at, read_at, payload) VALUES (?, ?, NULL, ?)", n.id, n.createdAt, JSON.stringify(n));
    this.sql.exec("DELETE FROM notifications WHERE id IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT -1 OFFSET ?)", MAX_KEPT);
  }

  async list(opts: { before?: number; limit?: number } = {}): Promise<{ items: Notification[]; unread: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = this.sql
      .exec("SELECT payload, read_at FROM notifications WHERE created_at < ? ORDER BY created_at DESC LIMIT ?", opts.before ?? Number.MAX_SAFE_INTEGER, limit)
      .toArray();
    const items = rows.map((r) => ({ ...(JSON.parse(String(r.payload)) as Notification), readAt: r.read_at === null ? null : Number(r.read_at) }));
    const unread = Number(this.sql.exec("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL").one().n);
    return { items, unread };
  }

  async markRead(ids: string[] | null): Promise<number> {
    const t = Date.now();
    if (!ids) return this.sql.exec("UPDATE notifications SET read_at = ? WHERE read_at IS NULL", t).rowsWritten;
    let n = 0;
    for (const id of ids) n += this.sql.exec("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL", t, id).rowsWritten;
    return n;
  }
}
