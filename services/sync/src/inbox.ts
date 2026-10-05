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
        CREATE TABLE IF NOT EXISTS live_docs (
          workspace_id TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          seen_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, doc_id)
        );
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

  /** Remember a document this user connected to (for device revocations). */
  async noteLive(workspaceId: string, docId: string): Promise<void> {
    this.sql.exec(
      "INSERT INTO live_docs (workspace_id, doc_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id, doc_id) DO UPDATE SET seen_at = excluded.seen_at",
      workspaceId,
      docId,
      Date.now(),
    );
  }

  /** Documents this user connected to recently (sockets last at most a day). */
  async liveDocs(): Promise<{ workspaceId: string; docId: string }[]> {
    this.sql.exec("DELETE FROM live_docs WHERE seen_at < ?", Date.now() - 7 * 24 * 3600 * 1000);
    return this.sql
      .exec("SELECT workspace_id, doc_id FROM live_docs")
      .toArray()
      .map((r) => ({ workspaceId: String(r.workspace_id), docId: String(r.doc_id) }));
  }

  async markRead(ids: string[] | null): Promise<number> {
    const t = Date.now();
    if (!ids) return this.sql.exec("UPDATE notifications SET read_at = ? WHERE read_at IS NULL", t).rowsWritten;
    let n = 0;
    for (const id of ids) n += this.sql.exec("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL", t, id).rowsWritten;
    return n;
  }
}
