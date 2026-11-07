//! Store for existing Worlds schema versions 10 and 11. No migrations are run.
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use std::collections::HashSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum StoreError { Sql(rusqlite::Error), Denied, Invalid, Schema(i64) }
impl From<rusqlite::Error> for StoreError { fn from(e: rusqlite::Error) -> Self { Self::Sql(e) } }
type Result<T> = std::result::Result<T, StoreError>;
fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64 }
fn valid_channel(c: i64) -> Result<()> { if c == 0 || c == 1 { Ok(()) } else { Err(StoreError::Invalid) } }
fn rank(level: &str) -> u8 { match level { "full" => 4, "edit" => 3, "comment" => 2, "view" => 1, _ => 0 } }

pub struct SyncStore { conn: Connection, page: String, user: String, workspace: String }
impl SyncStore {
    /// Opens an existing Worlds database only; the owner and workspace are pinned.
    pub fn open(path: &Path, page: &str, user: &str, workspace: &str) -> Result<Self> {
        if page.is_empty() || user.is_empty() || workspace.is_empty() { return Err(StoreError::Invalid); }
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if !(10..=11).contains(&version) { return Err(StoreError::Schema(version)); }
        let store = Self { conn, page: page.into(), user: user.into(), workspace: workspace.into() };
        store.authorize(1)?;
        Ok(store)
    }

    /// Cached local rights are an additional guard, never a replacement for server checks.
    fn authorize(&self, required: u8) -> Result<()> {
        let current: Option<String> = self.conn.query_row("SELECT user_id FROM account WHERE id=1 AND status='active'", [], |r| r.get(0)).optional()?;
        if current.as_deref() != Some(&self.user) { return Err(StoreError::Denied); }
        let page_ws: Option<Option<String>> = self.conn.query_row("SELECT workspace_id FROM pages WHERE id=?1 AND deleted_at IS NULL", [&self.page], |r| r.get(0)).optional()?;
        if page_ws.flatten().as_deref() != Some(&self.workspace) { return Err(StoreError::Denied); }
        let drawing_user: Option<String> = self.conn.query_row("SELECT user_id FROM drawing_sync_state WHERE page_id=?1", [&self.page], |r| r.get(0)).optional()?;
        if drawing_user.as_deref().is_some_and(|id| id != self.user) { return Err(StoreError::Denied); }
        let membership: Option<(String,String)> = self.conn.query_row("SELECT role,default_level FROM account_workspaces WHERE id=?1", [&self.workspace], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        let Some((role, default)) = membership else { return Err(StoreError::Denied) };
        if role == "owner" || role == "admin" { return Ok(()); }
        let mut cur = Some(self.page.clone());
        let mut seen = HashSet::new();
        while let Some(id) = cur {
            if !seen.insert(id.clone()) || seen.len() > 128 { return Err(StoreError::Denied); }
            let level: Option<String> = self.conn.query_row("SELECT level FROM account_page_access WHERE workspace_id=?1 AND page_id=?2", params![self.workspace,id], |r| r.get(0)).optional()?;
            if let Some(level) = level { return if rank(&level) >= required { Ok(()) } else { Err(StoreError::Denied) }; }
            cur = self.conn.query_row("SELECT parent_id FROM pages WHERE id=?1 AND workspace_id=?2", params![id,self.workspace], |r| r.get(0)).optional()?.flatten();
        }
        if role == "member" && rank(&default) >= required { Ok(()) } else { Err(StoreError::Denied) }
    }

    fn check(&self, channel: i64, local: bool) -> Result<()> {
        valid_channel(channel)?;
        self.authorize(if local && channel == 0 { 3 } else if local { 2 } else { 1 })
    }

    pub fn load(&self, channel: i64) -> Result<Vec<Vec<u8>>> {
        self.check(channel, false)?;
        let snapshot: Option<Option<Vec<u8>>> = self.conn.query_row("SELECT snapshot FROM sync_docs WHERE page_id=?1 AND channel=?2", params![self.page,channel], |r| r.get(0)).optional()?;
        let mut result = Vec::new();
        if let Some(Some(bytes)) = snapshot { result.push(bytes); }
        let mut q = self.conn.prepare("SELECT data FROM sync_updates WHERE page_id=?1 AND channel=?2 ORDER BY id")?;
        for row in q.query_map(params![self.page,channel], |r| r.get(0))? { result.push(row?); }
        Ok(result)
    }

    pub fn append(&mut self, channel: i64, bytes: &[u8], local: bool) -> Result<()> {
        if bytes.len() > 64*1024*1024 { return Err(StoreError::Invalid); }
        let tx = self.conn.unchecked_transaction()?;
        self.check(channel, local)?;
        let t = now();
        tx.execute("INSERT OR IGNORE INTO sync_docs(page_id,channel,created_at,updated_at) VALUES(?1,?2,?3,?3)",params![self.page,channel,t])?;
        tx.execute("INSERT INTO sync_updates(page_id,channel,data,origin,created_at) VALUES(?1,?2,?3,?4,?5)",params![self.page,channel,bytes,if local {"local"} else {"remote"},t])?;
        if local { tx.execute("INSERT INTO sync_outbox(page_id,channel,data,created_at) VALUES(?1,?2,?3,?4)",params![self.page,channel,bytes,t])?; }
        tx.execute("UPDATE sync_docs SET updated_at=?3 WHERE page_id=?1 AND channel=?2",params![self.page,channel,t])?;
        tx.commit()?;
        Ok(())
    }

    pub fn max_pending(&self, channel: i64) -> Result<Option<i64>> {
        self.check(channel,false)?;
        Ok(self.conn.query_row("SELECT MAX(id) FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending'",params![self.page,channel],|r|r.get(0))?)
    }
    pub fn acknowledge(&self, channel: i64, through: i64) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        self.check(channel,false)?;
        tx.execute("DELETE FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending' AND id<=?3",params![self.page,channel,through])?;
        tx.commit()?;
        Ok(())
    }
    /// This operation intentionally does not expose archived data or re-enable syncing.
    pub fn reject(&mut self, channel: i64, archive_id: &str, state: &[u8], reason: &str) -> Result<()> {
        if archive_id.is_empty() || state.len() > 64*1024*1024 || reason.len() > 10_000 { return Err(StoreError::Invalid); }
        let tx = self.conn.unchecked_transaction()?;
        self.check(channel,false)?;
        let existing: Option<(String,String,i64)> = tx.query_row("SELECT page_id,owner_id,channel FROM sync_rejected_snapshots WHERE id=?1", [archive_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        if existing.is_some_and(|v| v != (self.page.clone(), self.user.clone(), channel)) { return Err(StoreError::Denied); }
        let t = now();
        tx.execute("INSERT INTO sync_rejected_snapshots(id,page_id,channel,owner_id,data,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET data=excluded.data,reason=excluded.reason",params![archive_id,self.page,channel,self.user,state,reason,t])?;
        tx.execute("UPDATE sync_outbox SET state='rejected',last_error=?3 WHERE page_id=?1 AND channel=?2 AND state='pending'",params![self.page,channel,reason])?;
        tx.execute("INSERT OR IGNORE INTO sync_docs(page_id,channel,created_at,updated_at) VALUES(?1,?2,?3,?3)",params![self.page,channel,t])?;
        tx.execute("UPDATE sync_docs SET snapshot=x'0000',snapshot_upto=0,updated_at=?3 WHERE page_id=?1 AND channel=?2",params![self.page,channel,t])?;
        tx.execute("DELETE FROM sync_updates WHERE page_id=?1 AND channel=?2",params![self.page,channel])?;
        tx.commit()?;
        Ok(())
    }
}

