/**
 * WorkspaceHub: one Durable Object per workspace.
 *
 * Knows which documents have live sessions (so a revocation reaches every
 * open page at once) and keeps the ledger of resumable attachment uploads
 * (content-addressed, so the same bytes are stored once per workspace).
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { AccessLevel } from "./protocol";

export interface UploadState {
  hash: string;
  uploadId: string;
  size: number;
  mime: string;
  partSize: number;
  status: "uploading" | "complete";
  parts: { partNumber: number; etag: string; size: number }[];
}

export class WorkspaceHub extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS live_docs (doc_id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS uploads (
          hash TEXT PRIMARY KEY,
          upload_id TEXT NOT NULL,
          size INTEGER NOT NULL,
          mime TEXT NOT NULL,
          part_size INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS parts (
          hash TEXT NOT NULL,
          part INTEGER NOT NULL,
          etag TEXT NOT NULL,
          size INTEGER NOT NULL,
          PRIMARY KEY (hash, part)
        );
      `);
    });
  }

  async register(_workspaceId: string, docId: string): Promise<void> {
    this.sql.exec("INSERT INTO live_docs (doc_id, seen_at) VALUES (?, ?) ON CONFLICT(doc_id) DO UPDATE SET seen_at = excluded.seen_at", docId, Date.now());
  }

  async unregister(_workspaceId: string, docId: string): Promise<void> {
    this.sql.exec("DELETE FROM live_docs WHERE doc_id = ?", docId);
  }

  async liveDocs(): Promise<string[]> {
    return this.sql.exec("SELECT doc_id FROM live_docs").toArray().map((r) => String(r.doc_id));
  }

  /** Fan a revocation out to every document with live sessions in this workspace. */
  async revoke(workspaceId: string, input: { userId: string; deviceId?: string; level?: AccessLevel }): Promise<number> {
    let total = 0;
    for (const docId of await this.liveDocs()) {
      total += await this.env.DOCS.getByName(`${workspaceId}/${docId}`).revoke(input);
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Upload ledger
  // -------------------------------------------------------------------------

  async upload(hash: string): Promise<UploadState | null> {
    const u = this.sql.exec("SELECT * FROM uploads WHERE hash = ?", hash).toArray()[0];
    if (!u) return null;
    const parts = this.sql
      .exec("SELECT part, etag, size FROM parts WHERE hash = ? ORDER BY part", hash)
      .toArray()
      .map((r) => ({ partNumber: Number(r.part), etag: String(r.etag), size: Number(r.size) }));
    return {
      hash,
      uploadId: String(u.upload_id),
      size: Number(u.size),
      mime: String(u.mime),
      partSize: Number(u.part_size),
      status: String(u.status) as UploadState["status"],
      parts,
    };
  }

  /** Record a new multipart upload. If one already exists, it wins and is returned. */
  async beginUpload(input: { hash: string; uploadId: string; size: number; mime: string; partSize: number }): Promise<UploadState> {
    this.sql.exec(
      "INSERT OR IGNORE INTO uploads (hash, upload_id, size, mime, part_size, status, created_at) VALUES (?, ?, ?, ?, ?, 'uploading', ?)",
      input.hash,
      input.uploadId,
      input.size,
      input.mime,
      input.partSize,
      Date.now(),
    );
    return (await this.upload(input.hash))!;
  }

  async recordPart(hash: string, uploadId: string, part: number, etag: string, size: number): Promise<boolean> {
    const u = this.sql.exec("SELECT upload_id FROM uploads WHERE hash = ?", hash).toArray()[0];
    if (!u || String(u.upload_id) !== uploadId) return false;
    this.sql.exec(
      "INSERT INTO parts (hash, part, etag, size) VALUES (?, ?, ?, ?) ON CONFLICT(hash, part) DO UPDATE SET etag = excluded.etag, size = excluded.size",
      hash,
      part,
      etag,
      size,
    );
    return true;
  }

  async completeUpload(hash: string): Promise<void> {
    this.sql.exec("UPDATE uploads SET status = 'complete', completed_at = ? WHERE hash = ?", Date.now(), hash);
    this.sql.exec("DELETE FROM parts WHERE hash = ?", hash);
  }

  /** Forget an upload (failed verification) so it can start over. */
  async resetUpload(hash: string): Promise<void> {
    this.sql.exec("DELETE FROM uploads WHERE hash = ?", hash);
    this.sql.exec("DELETE FROM parts WHERE hash = ?", hash);
  }
}
