//! Local side of live sync (docs/SYNC_PROTOCOL.md).
//!
//! Shared pages are edited as Yjs documents in the UI. This module is their
//! durable local replica: a compacted snapshot plus an append-only update
//! log per page and channel, the outbox of local updates the server has not
//! acknowledged yet, the server cursors, and the attachment upload queue.
//!
//! The block rows stay the page's readable form for search, history, MCP
//! and Claude. The UI mirrors the Yjs document into them through
//! [`mirror_write`], which refuses to overwrite block changes it has not
//! seen (Claude or MCP writing directly) so the UI can fold those into the
//! Yjs document first.

pub mod commands;
#[cfg(test)]
mod tests;

use crate::db::{mark_change, now};
use crate::store::{self, BlockInput, Ctx};
use anyhow::{anyhow, Result};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Migration 6. Applies on top of a database at version 5.
pub const MIGRATION: &str = r#"
    CREATE TABLE sync_docs (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        channel INTEGER NOT NULL,
        snapshot BLOB,
        snapshot_upto INTEGER NOT NULL DEFAULT 0,
        mirror_rev TEXT,
        mirror_state BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (page_id, channel)
    );

    CREATE TABLE sync_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        channel INTEGER NOT NULL,
        data BLOB NOT NULL,
        origin TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX sync_updates_page ON sync_updates(page_id, channel, id);

    CREATE TABLE sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        channel INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT
    );
    CREATE INDEX sync_outbox_page ON sync_outbox(page_id, state, id);

    CREATE TABLE sync_cursors (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        channel INTEGER NOT NULL,
        server_vector BLOB,
        level TEXT,
        synced_at INTEGER,
        last_error TEXT,
        PRIMARY KEY (page_id, channel)
    );

    CREATE TABLE sync_attachment_queue (
        attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
        page_id TEXT,
        workspace_id TEXT,
        sha256 TEXT,
        size INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        parts_done TEXT NOT NULL DEFAULT '[]',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
"#;

pub const CHANNEL_CONTENT: i64 = 0;
pub const CHANNEL_COMMENTS: i64 = 1;

fn check_channel(channel: i64) -> Result<()> {
    if channel == CHANNEL_CONTENT || channel == CHANNEL_COMMENTS {
        Ok(())
    } else {
        Err(anyhow!("unknown sync channel {channel}"))
    }
}

pub fn b64(data: &[u8]) -> String {
    B64.encode(data)
}

pub fn unb64(s: &str) -> Result<Vec<u8>> {
    B64.decode(s).map_err(|e| anyhow!("invalid base64: {e}"))
}

// ---------------------------------------------------------------------------
// Which pages sync
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageMode {
    pub shared: bool,
    pub workspace_id: Option<String>,
    /// The flag used for testing before Team workspaces exist.
    pub flagged: bool,
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(1))?.collect::<rusqlite::Result<_>>()?;
    Ok(names.iter().any(|n| n == column))
}

/// A page syncs when it belongs to a Team workspace (non-null workspace id)
/// or carries the `metadata.sync.shared` test flag.
pub fn page_mode(conn: &Connection, page_id: &str) -> Result<PageMode> {
    let metadata: String = conn
        .query_row("SELECT metadata FROM pages WHERE id = ?1", [page_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("page not found"))?;
    let meta: Value = serde_json::from_str(&metadata).unwrap_or(Value::Null);
    let flagged = meta.pointer("/sync/shared").and_then(Value::as_bool).unwrap_or(false);
    let workspace_id: Option<String> = if has_column(conn, "pages", "workspace_id")? {
        conn.query_row("SELECT workspace_id FROM pages WHERE id = ?1", [page_id], |r| r.get(0))?
    } else {
        None
    };
    Ok(PageMode { shared: workspace_id.is_some() || flagged, workspace_id, flagged })
}

/// Turn the testing flag on or off. Turning it off keeps the Yjs replica;
/// the block rows already hold the page.
pub fn set_shared(conn: &Connection, page_id: &str, shared: bool) -> Result<PageMode> {
    let metadata: String = conn
        .query_row("SELECT metadata FROM pages WHERE id = ?1", [page_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("page not found"))?;
    let mut meta: Value = serde_json::from_str(&metadata).unwrap_or_else(|_| serde_json::json!({}));
    if !meta.is_object() {
        meta = serde_json::json!({});
    }
    let sync = meta.as_object_mut().unwrap().entry("sync").or_insert_with(|| serde_json::json!({}));
    if !sync.is_object() {
        *sync = serde_json::json!({});
    }
    sync.as_object_mut().unwrap().insert("shared".into(), Value::Bool(shared));
    conn.execute("UPDATE pages SET metadata = ?1 WHERE id = ?2", params![meta.to_string(), page_id])?;
    mark_change(conn, Some(page_id), "page", "ui")?;
    page_mode(conn, page_id)
}

// ---------------------------------------------------------------------------
// Local replica: snapshot + update log
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub snapshot: Option<String>,
    pub updates: Vec<String>,
    /// Last update id included in `updates` (pass to `compact`).
    pub upto: i64,
    pub mirror_rev: Option<String>,
}

pub fn load(conn: &Connection, page_id: &str, channel: i64) -> Result<Loaded> {
    check_channel(channel)?;
    let doc: Option<(Option<Vec<u8>>, Option<String>)> = conn
        .query_row("SELECT snapshot, mirror_rev FROM sync_docs WHERE page_id = ?1 AND channel = ?2", params![page_id, channel], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let mut stmt = conn.prepare("SELECT id, data FROM sync_updates WHERE page_id = ?1 AND channel = ?2 ORDER BY id")?;
    let rows: Vec<(i64, Vec<u8>)> =
        stmt.query_map(params![page_id, channel], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let (snapshot, mirror_rev) = doc.unwrap_or((None, None));
    Ok(Loaded {
        snapshot: snapshot.map(|s| b64(&s)),
        upto: rows.last().map(|r| r.0).unwrap_or(0),
        updates: rows.into_iter().map(|r| b64(&r.1)).collect(),
        mirror_rev,
    })
}

fn ensure_doc(conn: &Connection, page_id: &str, channel: i64) -> Result<()> {
    let t = now();
    conn.execute(
        "INSERT OR IGNORE INTO sync_docs (page_id, channel, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![page_id, channel, t],
    )?;
    Ok(())
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Appended {
    pub update_id: i64,
    pub outbox_id: Option<i64>,
    /// Updates in the local log since the last snapshot (compact when large).
    pub log_len: i64,
}

/// Persist one Yjs update. Local edits (`outbox = true`) also enter the
/// outbox in the same transaction, so nothing typed offline can be lost.
pub fn append(conn: &Connection, page_id: &str, channel: i64, data: &[u8], origin: &str, outbox: bool) -> Result<Appended> {
    check_channel(channel)?;
    let tx = conn.unchecked_transaction()?;
    ensure_doc(&tx, page_id, channel)?;
    let t = now();
    tx.execute(
        "INSERT INTO sync_updates (page_id, channel, data, origin, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![page_id, channel, data, origin, t],
    )?;
    let update_id = tx.last_insert_rowid();
    let outbox_id = if outbox {
        tx.execute(
            "INSERT INTO sync_outbox (page_id, channel, data, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![page_id, channel, data, t],
        )?;
        Some(tx.last_insert_rowid())
    } else {
        None
    };
    tx.execute("UPDATE sync_docs SET updated_at = ?1 WHERE page_id = ?2 AND channel = ?3", params![t, page_id, channel])?;
    let log_len: i64 =
        tx.query_row("SELECT COUNT(*) FROM sync_updates WHERE page_id = ?1 AND channel = ?2", params![page_id, channel], |r| r.get(0))?;
    tx.commit()?;
    Ok(Appended { update_id, outbox_id, log_len })
}

/// Replace the log up to `upto` with `state` (the document's full state,
/// which includes every update up to and including `upto`).
pub fn compact(conn: &Connection, page_id: &str, channel: i64, state: &[u8], upto: i64) -> Result<()> {
    check_channel(channel)?;
    let tx = conn.unchecked_transaction()?;
    ensure_doc(&tx, page_id, channel)?;
    tx.execute(
        "UPDATE sync_docs SET snapshot = ?1, snapshot_upto = MAX(snapshot_upto, ?2), updated_at = ?3 WHERE page_id = ?4 AND channel = ?5",
        params![state, upto, now(), page_id, channel],
    )?;
    tx.execute("DELETE FROM sync_updates WHERE page_id = ?1 AND channel = ?2 AND id <= ?3", params![page_id, channel, upto])?;
    tx.commit()?;
    Ok(())
}

/// Forget a page's replica, outbox and cursors (access revoked).
pub fn purge(conn: &Connection, page_id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for table in ["sync_docs", "sync_updates", "sync_outbox", "sync_cursors"] {
        tx.execute(&format!("DELETE FROM {table} WHERE page_id = ?1"), [page_id])?;
    }
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub id: i64,
    pub page_id: String,
    pub channel: i64,
    pub data: String,
    pub attempts: i64,
    pub created_at: i64,
}

/// Pending outbox entries, oldest first (optionally for one page).
pub fn outbox_list(conn: &Connection, page_id: Option<&str>, limit: i64) -> Result<Vec<OutboxItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, page_id, channel, data, attempts, created_at FROM sync_outbox
         WHERE state = 'pending' AND (?1 IS NULL OR page_id = ?1) ORDER BY id LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![page_id, limit.clamp(1, 10_000)], |r| {
            Ok(OutboxItem {
                id: r.get(0)?,
                page_id: r.get(1)?,
                channel: r.get(2)?,
                data: b64(&r.get::<_, Vec<u8>>(3)?),
                attempts: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// The server persisted these: drop them.
pub fn outbox_ack(conn: &Connection, ids: &[i64]) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for id in ids {
        n += tx.execute("DELETE FROM sync_outbox WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(n)
}

/// Every pending entry of a page up to `upto` (after a full-state handshake
/// covered them).
pub fn outbox_ack_upto(conn: &Connection, page_id: &str, channel: i64, upto: i64) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM sync_outbox WHERE page_id = ?1 AND channel = ?2 AND state = 'pending' AND id <= ?3",
        params![page_id, channel, upto],
    )?)
}

/// The server refused these (permission changed while offline). They are
/// kept, out of the send queue, so nothing is silently thrown away.
pub fn outbox_reject(conn: &Connection, ids: &[i64], reason: &str) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for id in ids {
        n += tx.execute("UPDATE sync_outbox SET state = 'rejected', last_error = ?1 WHERE id = ?2", params![reason, id])?;
    }
    tx.commit()?;
    Ok(n)
}

/// A send attempt failed (network): count it, keep it pending.
pub fn outbox_fail(conn: &Connection, ids: &[i64], error: &str) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for id in ids {
        n += tx.execute("UPDATE sync_outbox SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2", params![error, id])?;
    }
    tx.commit()?;
    Ok(n)
}

pub fn outbox_max_id(conn: &Connection, page_id: &str, channel: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM sync_outbox WHERE page_id = ?1 AND channel = ?2 AND state = 'pending'",
        params![page_id, channel],
        |r| r.get(0),
    )?)
}

// ---------------------------------------------------------------------------
// Cursors and status
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CursorInput {
    pub server_vector: Option<String>,
    pub level: Option<String>,
    pub synced: bool,
    pub error: Option<String>,
}

pub fn cursor_set(conn: &Connection, page_id: &str, channel: i64, c: &CursorInput) -> Result<()> {
    check_channel(channel)?;
    let vector = c.server_vector.as_deref().map(unb64).transpose()?;
    let synced_at = c.synced.then(now);
    conn.execute(
        "INSERT INTO sync_cursors (page_id, channel, server_vector, level, synced_at, last_error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(page_id, channel) DO UPDATE SET
           server_vector = COALESCE(excluded.server_vector, server_vector),
           level = COALESCE(excluded.level, level),
           synced_at = COALESCE(excluded.synced_at, synced_at),
           last_error = excluded.last_error",
        params![page_id, channel, vector, c.level, synced_at, c.error],
    )?;
    Ok(())
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageStatus {
    pub page_id: String,
    pub pending: i64,
    pub rejected: i64,
    pub synced_at: Option<i64>,
    pub level: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub pending: i64,
    pub rejected: i64,
    pub attachments_pending: i64,
    pub attachments_failed: i64,
    pub pages: Vec<PageStatus>,
}

pub fn page_status(conn: &Connection, page_id: &str) -> Result<PageStatus> {
    let (pending, rejected): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(state = 'pending'), 0), COALESCE(SUM(state = 'rejected'), 0) FROM sync_outbox WHERE page_id = ?1",
        [page_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let cursor: Option<(Option<i64>, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT MIN(synced_at), MAX(level), MAX(last_error) FROM sync_cursors WHERE page_id = ?1 GROUP BY page_id",
            [page_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (synced_at, level, last_error) = cursor.unwrap_or((None, None, None));
    Ok(PageStatus { page_id: page_id.to_string(), pending, rejected, synced_at, level, last_error })
}

pub fn status(conn: &Connection) -> Result<Status> {
    let mut stmt = conn
        .prepare("SELECT page_id FROM sync_docs UNION SELECT page_id FROM sync_outbox UNION SELECT page_id FROM sync_cursors ORDER BY 1")?;
    let ids: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let pages = ids.iter().map(|id| page_status(conn, id)).collect::<Result<Vec<_>>>()?;
    let (attachments_pending, attachments_failed): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(status IN ('pending', 'uploading')), 0), COALESCE(SUM(status = 'failed'), 0) FROM sync_attachment_queue",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(Status {
        pending: pages.iter().map(|p| p.pending).sum(),
        rejected: pages.iter().map(|p| p.rejected).sum(),
        attachments_pending,
        attachments_failed,
        pages,
    })
}

// ---------------------------------------------------------------------------
// Block mirror
// ---------------------------------------------------------------------------

/// Stable revision of a page's block rows (FNV-1a 64 over ordered contents).
pub fn blocks_rev(conn: &Connection, page_id: &str) -> Result<String> {
    let mut stmt = conn.prepare("SELECT content FROM blocks WHERE page_id = ?1 ORDER BY sort_key, id")?;
    let rows: Vec<String> = stmt.query_map([page_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for row in &rows {
        for b in row.as_bytes().iter().chain([0x1e_u8].iter()) {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    Ok(format!("{h:016x}:{}", rows.len()))
}

fn current_blocks(conn: &Connection, page_id: &str) -> Result<Vec<Value>> {
    Ok(store::blocks_of(conn, page_id)?.into_iter().map(|b| b.content).collect())
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MirrorCheck {
    pub mirror_rev: Option<String>,
    pub current_rev: String,
    /// The Yjs state the last mirror was written from (base for folding).
    pub mirror_state: Option<String>,
    /// Present when the rows changed since the last mirror.
    pub current: Option<Vec<Value>>,
}

pub fn mirror_check(conn: &Connection, page_id: &str) -> Result<MirrorCheck> {
    let row: Option<(Option<String>, Option<Vec<u8>>)> = conn
        .query_row(
            "SELECT mirror_rev, mirror_state FROM sync_docs WHERE page_id = ?1 AND channel = ?2",
            params![page_id, CHANNEL_CONTENT],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (mirror_rev, mirror_state) = row.unwrap_or((None, None));
    let current_rev = blocks_rev(conn, page_id)?;
    let current = if mirror_rev.as_deref() != Some(current_rev.as_str()) { Some(current_blocks(conn, page_id)?) } else { None };
    Ok(MirrorCheck { mirror_rev, current_rev, mirror_state: mirror_state.map(|s| b64(&s)), current })
}

/// Record that `state` and the current block rows agree (after seeding the
/// Yjs document from the rows, or folding the rows into it), without writing
/// blocks. Refused when the rows moved past `base_rev` in the meantime.
pub fn mirror_adopt(conn: &Connection, page_id: &str, base_rev: &str, state: &[u8]) -> Result<MirrorOutcome> {
    let tx = conn.unchecked_transaction()?;
    let current_rev = blocks_rev(&tx, page_id)?;
    if current_rev != base_rev {
        let current = current_blocks(&tx, page_id)?;
        return Ok(MirrorOutcome::Conflict { current_rev, current });
    }
    ensure_doc(&tx, page_id, CHANNEL_CONTENT)?;
    tx.execute(
        "UPDATE sync_docs SET mirror_rev = ?1, mirror_state = ?2, updated_at = ?3 WHERE page_id = ?4 AND channel = ?5",
        params![current_rev, state, now(), page_id, CHANNEL_CONTENT],
    )?;
    tx.commit()?;
    Ok(MirrorOutcome::Written { rev: current_rev, remapped: vec![], updated_at: None })
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum MirrorOutcome {
    #[serde(rename_all = "camelCase")]
    Written { rev: String, remapped: Vec<(String, String)>, updated_at: Option<i64> },
    #[serde(rename_all = "camelCase")]
    Conflict { current_rev: String, current: Vec<Value> },
}

/// Write the Yjs document's blocks into the block rows. `base_rev` is the
/// revision the caller last saw; if the rows changed since (Claude or MCP),
/// nothing is written and the current rows come back to be folded in.
pub fn mirror_write(conn: &Connection, page_id: &str, blocks: Vec<BlockInput>, base_rev: &str, state: &[u8]) -> Result<MirrorOutcome> {
    store::snapshot_before_user_edit(conn, page_id)?;
    let tx = conn.unchecked_transaction()?;
    let current_rev = blocks_rev(&tx, page_id)?;
    if current_rev != base_rev {
        let current = current_blocks(&tx, page_id)?;
        return Ok(MirrorOutcome::Conflict { current_rev, current });
    }
    let r = store::save_blocks(&tx, &Ctx::user(), page_id, blocks)?;
    let rev = blocks_rev(&tx, page_id)?;
    ensure_doc(&tx, page_id, CHANNEL_CONTENT)?;
    tx.execute(
        "UPDATE sync_docs SET mirror_rev = ?1, mirror_state = ?2, updated_at = ?3 WHERE page_id = ?4 AND channel = ?5",
        params![rev, state, now(), page_id, CHANNEL_CONTENT],
    )?;
    tx.commit()?;
    Ok(MirrorOutcome::Written { rev, remapped: r.remapped, updated_at: Some(r.updated_at) })
}

// ---------------------------------------------------------------------------
// Attachment upload queue
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedAttachment {
    pub attachment_id: String,
    pub page_id: Option<String>,
    pub workspace_id: Option<String>,
    pub sha256: Option<String>,
    pub size: Option<i64>,
    pub status: String,
    pub parts_done: Vec<i64>,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub rel_path: String,
    pub mime: String,
}

pub fn attachment_enqueue(conn: &Connection, attachment_id: &str, page_id: Option<&str>, workspace_id: Option<&str>) -> Result<()> {
    let t = now();
    conn.execute(
        "INSERT INTO sync_attachment_queue (attachment_id, page_id, workspace_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(attachment_id) DO UPDATE SET
           page_id = COALESCE(excluded.page_id, page_id),
           workspace_id = COALESCE(excluded.workspace_id, workspace_id),
           status = CASE WHEN status = 'done' THEN status ELSE 'pending' END,
           updated_at = excluded.updated_at",
        params![attachment_id, page_id, workspace_id, t],
    )?;
    Ok(())
}

/// Uploads still to do (failed ones retry up to `max_attempts`).
pub fn attachment_queue(conn: &Connection, max_attempts: i64) -> Result<Vec<QueuedAttachment>> {
    let mut stmt = conn.prepare(
        "SELECT q.attachment_id, q.page_id, q.workspace_id, q.sha256, q.size, q.status, q.parts_done, q.attempts, q.last_error, a.rel_path, a.mime
         FROM sync_attachment_queue q JOIN attachments a ON a.id = q.attachment_id
         WHERE q.status IN ('pending', 'uploading') OR (q.status = 'failed' AND q.attempts < ?1)
         ORDER BY q.created_at",
    )?;
    let rows = stmt
        .query_map([max_attempts], |r| {
            let parts: String = r.get(6)?;
            Ok(QueuedAttachment {
                attachment_id: r.get(0)?,
                page_id: r.get(1)?,
                workspace_id: r.get(2)?,
                sha256: r.get(3)?,
                size: r.get(4)?,
                status: r.get(5)?,
                parts_done: serde_json::from_str(&parts).unwrap_or_default(),
                attempts: r.get(7)?,
                last_error: r.get(8)?,
                rel_path: r.get(9)?,
                mime: r.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentProgress {
    pub status: String,
    pub sha256: Option<String>,
    pub size: Option<i64>,
    pub parts_done: Option<Vec<i64>>,
    pub error: Option<String>,
}

pub fn attachment_update(conn: &Connection, attachment_id: &str, p: &AttachmentProgress) -> Result<()> {
    if !["pending", "uploading", "done", "failed"].contains(&p.status.as_str()) {
        return Err(anyhow!("unknown upload status {}", p.status));
    }
    let parts = p.parts_done.as_ref().map(serde_json::to_string).transpose()?;
    conn.execute(
        "UPDATE sync_attachment_queue SET
           status = ?1,
           sha256 = COALESCE(?2, sha256),
           size = COALESCE(?3, size),
           parts_done = COALESCE(?4, parts_done),
           attempts = attempts + (?1 = 'failed'),
           last_error = ?5,
           updated_at = ?6
         WHERE attachment_id = ?7",
        params![p.status, p.sha256, p.size, parts, p.error, now(), attachment_id],
    )?;
    Ok(())
}
