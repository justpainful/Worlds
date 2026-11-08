//! Store for existing Worlds schema versions 10 and 11. No migrations are run.
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use std::collections::HashSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum StoreError { Sql(rusqlite::Error), Denied, Invalid, Conflict, Schema(i64) }
impl From<rusqlite::Error> for StoreError { fn from(e: rusqlite::Error) -> Self { Self::Sql(e) } }
type Result<T> = std::result::Result<T, StoreError>;
fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64 }
fn valid_channel(c: i64) -> Result<()> { if c == 0 || c == 1 { Ok(()) } else { Err(StoreError::Invalid) } }
fn rank(level: &str) -> u8 { match level { "full" => 4, "edit" => 3, "comment" => 2, "view" => 1, _ => 0 } }

#[derive(Debug, PartialEq, Eq)]
pub struct RejectedSnapshot { pub id: String, pub channel: i64, pub reason: String, pub created_at: i64, pub size: i64 }
#[derive(Debug, PartialEq, Eq)]
pub struct RejectedPage { pub items: Vec<RejectedSnapshot>, pub next: Option<(i64, String)> }

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
        self.require_original_path()?;
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
            // An incomplete or cross-workspace ancestry is not a root. Never
            // fall back to the workspace default for a missing cached parent.
            let parent: Option<Option<String>> = self.conn.query_row("SELECT parent_id FROM pages WHERE id=?1 AND workspace_id=?2 AND deleted_at IS NULL", params![id,self.workspace], |r| r.get(0)).optional()?;
            let Some(parent) = parent else { return Err(StoreError::Denied) };
            let level: Option<String> = self.conn.query_row("SELECT level FROM account_page_access WHERE workspace_id=?1 AND page_id=?2", params![self.workspace,id], |r| r.get(0)).optional()?;
            if let Some(level) = level { return if rank(&level) >= required { Ok(()) } else { Err(StoreError::Denied) }; }
            cur = parent;
        }
        if role == "member" && rank(&default) >= required { Ok(()) } else { Err(StoreError::Denied) }
    }

    // Archiving after access removal protects local edits. The account and
    // original page binding must still match; archive contents are not exposed here.
    fn authorize_archive(&self, channel: i64) -> Result<()> {
        self.require_original_path()?;
        valid_channel(channel)?;
        let current: Option<String> = self.conn.query_row("SELECT user_id FROM account WHERE id=1 AND status='active'", [], |r| r.get(0)).optional()?;
        if current.as_deref() != Some(&self.user) { return Err(StoreError::Denied); }
        let ws: Option<Option<String>> = self.conn.query_row("SELECT workspace_id FROM pages WHERE id=?1", [&self.page], |r| r.get(0)).optional()?;
        if ws.flatten().as_deref() != Some(&self.workspace) { return Err(StoreError::Denied); }
        let owner: Option<String> = self.conn.query_row("SELECT user_id FROM drawing_sync_state WHERE page_id=?1", [&self.page], |r| r.get(0)).optional()?;
        if owner.as_deref().is_some_and(|id| id != self.user) { return Err(StoreError::Denied); }
        Ok(())
    }
    // On Apple, ask SQLite's own VFS whether the opened main database still
    // corresponds to its pathname. This detects a replacement visible at the
    // check; it does not establish provenance or prevent a swap-and-restore
    // between checks, nor does it pin WAL and parent-directory identities.
    #[cfg(any(target_os="macos", target_os="ios"))]
    fn require_original_path(&self) -> Result<()> {
        let mut moved: std::ffi::c_int = -1;
        let status = unsafe {
            rusqlite::ffi::sqlite3_file_control(self.conn.handle(), b"main\0".as_ptr().cast(),
                rusqlite::ffi::SQLITE_FCNTL_HAS_MOVED, (&mut moved as *mut std::ffi::c_int).cast())
        };
        if status != rusqlite::ffi::SQLITE_OK || moved != 0 { return Err(StoreError::Denied); }
        Ok(())
    }
    #[cfg(not(any(target_os="macos", target_os="ios")))]
    fn require_original_path(&self) -> Result<()> { Ok(()) }
    fn check(&self, channel: i64, local: bool) -> Result<()> {
        valid_channel(channel)?;
        self.authorize(if local && channel == 0 { 3 } else if local { 2 } else { 1 })
    }

    pub fn load(&self, channel: i64) -> Result<Vec<Vec<u8>>> {
        self.load_with_hook(channel, || Ok(()))
    }
    fn load_with_hook(&self, channel: i64, after_snapshot: impl FnOnce() -> Result<()>) -> Result<Vec<Vec<u8>>> {
        let tx=self.conn.unchecked_transaction()?;
        let result=self.load_entries(channel,after_snapshot)?;
        tx.commit()?;
        Ok(result)
    }
    fn load_entries(&self, channel: i64, after_snapshot: impl FnOnce() -> Result<()>) -> Result<Vec<Vec<u8>>> {
        self.check(channel, false)?;
        let snapshot: Option<Option<Vec<u8>>> = self.conn.query_row("SELECT snapshot FROM sync_docs WHERE page_id=?1 AND channel=?2", params![self.page,channel], |r| r.get(0)).optional()?;
        let mut result = Vec::new();
        if let Some(Some(bytes)) = snapshot { result.push(bytes); }
        after_snapshot()?;
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

    /// Experimental sidecar schema. Existing outbox rows are deliberately not
    /// assigned an owner. Never invoke this as an automatic Worlds migration.
    pub fn prepare_owned_outbox(&mut self) -> Result<()> {
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, rusqlite::TransactionBehavior::Immediate)?;
        self.check(0, true)?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS native_sync_outbox_owner_v1(
            outbox_id INTEGER PRIMARY KEY, page_id TEXT NOT NULL, channel INTEGER NOT NULL,
            user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, data BLOB NOT NULL,
            created_at INTEGER NOT NULL)")?;
        tx.commit()?;
        Ok(())
    }

    /// Write the original Worlds rows and the owner binding atomically.
    pub fn append_owned(&mut self, channel: i64, bytes: &[u8]) -> Result<()> {
        if bytes.len() > 64 * 1024 * 1024 { return Err(StoreError::Invalid); }
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, rusqlite::TransactionBehavior::Immediate)?;
        self.check(channel, true)?;
        let t = now();
        tx.execute("INSERT OR IGNORE INTO sync_docs(page_id,channel,created_at,updated_at) VALUES(?1,?2,?3,?3)",params![self.page,channel,t])?;
        tx.execute("INSERT INTO sync_updates(page_id,channel,data,origin,created_at) VALUES(?1,?2,?3,'local',?4)",params![self.page,channel,bytes,t])?;
        tx.execute("INSERT INTO sync_outbox(page_id,channel,data,created_at) VALUES(?1,?2,?3,?4)",params![self.page,channel,bytes,t])?;
        let id = tx.last_insert_rowid();
        tx.execute("INSERT INTO native_sync_outbox_owner_v1(outbox_id,page_id,channel,user_id,workspace_id,data,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,self.page,channel,self.user,self.workspace,bytes,t])?;
        tx.execute("UPDATE sync_docs SET updated_at=?3 WHERE page_id=?1 AND channel=?2",params![self.page,channel,t])?;
        tx.commit()?;
        Ok(())
    }

    fn require_owned_pending(&self, channel: i64) -> Result<()> {
        let unknown: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox o LEFT JOIN native_sync_outbox_owner_v1 n ON n.outbox_id=o.id WHERE o.page_id=?1 AND o.channel=?2 AND o.state='pending' AND (n.outbox_id IS NULL OR n.page_id!=o.page_id OR n.channel!=o.channel OR n.user_id!=?3 OR n.workspace_id!=?4 OR n.data!=o.data OR n.created_at!=o.created_at))",params![self.page,channel,self.user,self.workspace],|r|r.get(0))?;
        if unknown { Err(StoreError::Denied) } else { Ok(()) }
    }

    /// Only usable by a future isolated sender which also proves document
    /// provenance. A mixed or pre-migration queue is always blocked.
    pub fn owned_max_pending(&self, channel: i64) -> Result<Option<i64>> {
        let tx = self.conn.unchecked_transaction()?;
        self.check(channel, false)?;
        self.require_owned_pending(channel)?;
        let value = tx.query_row("SELECT MAX(id) FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending'",params![self.page,channel],|r|r.get(0))?;
        tx.commit()?; Ok(value)
    }

    pub fn acknowledge_owned(&mut self, channel: i64, through: i64) -> Result<()> {
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, rusqlite::TransactionBehavior::Immediate)?;
        self.check(channel, false)?;
        self.require_owned_pending(channel)?;
        tx.execute("DELETE FROM native_sync_outbox_owner_v1 WHERE outbox_id IN (SELECT id FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending' AND id<=?3)",params![self.page,channel,through])?;
        tx.execute("DELETE FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending' AND id<=?3",params![self.page,channel,through])?;
        tx.commit()?; Ok(())
    }

    /// Enroll only a completely empty channel. Existing documents and queues
    /// are never claimed, migrated, or erased by this experiment.
    pub fn enroll_empty_owned_document(&mut self, channel: i64, server: &str) -> Result<()> {
        if server.is_empty() || server.len() > 2048 { return Err(StoreError::Invalid); }
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, rusqlite::TransactionBehavior::Immediate)?;
        self.check(channel, true)?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS native_sync_document_owner_v1(page_id TEXT NOT NULL,channel INTEGER NOT NULL,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,server TEXT NOT NULL,PRIMARY KEY(page_id,channel));
            CREATE TABLE IF NOT EXISTS native_sync_update_owner_v1(update_id INTEGER PRIMARY KEY,page_id TEXT NOT NULL,channel INTEGER NOT NULL,data BLOB NOT NULL,created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS native_sync_outbox_owner_v1(outbox_id INTEGER PRIMARY KEY,page_id TEXT NOT NULL,channel INTEGER NOT NULL,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,data BLOB NOT NULL,created_at INTEGER NOT NULL)")?;
        let occupied: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_docs WHERE page_id=?1 AND channel=?2) OR EXISTS(SELECT 1 FROM sync_updates WHERE page_id=?1 AND channel=?2) OR EXISTS(SELECT 1 FROM sync_outbox WHERE page_id=?1 AND channel=?2) OR EXISTS(SELECT 1 FROM native_sync_document_owner_v1 WHERE page_id=?1 AND channel=?2)",params![self.page,channel],|r|r.get(0))?;
        if occupied { return Err(StoreError::Denied); }
        tx.execute("INSERT INTO native_sync_document_owner_v1(page_id,channel,user_id,workspace_id,server) VALUES(?1,?2,?3,?4,?5)",params![self.page,channel,self.user,self.workspace,server])?;
        tx.commit()?; Ok(())
    }

    fn require_owned_document(&self, channel: i64, server: &str) -> Result<()> {
        let bound: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM native_sync_document_owner_v1 WHERE page_id=?1 AND channel=?2 AND user_id=?3 AND workspace_id=?4 AND server=?5)",params![self.page,channel,self.user,self.workspace,server],|r|r.get(0))?;
        if !bound { return Err(StoreError::Denied); }
        let untrusted: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM sync_docs WHERE page_id=?1 AND channel=?2 AND snapshot IS NOT NULL) OR EXISTS(SELECT 1 FROM sync_updates u LEFT JOIN native_sync_update_owner_v1 n ON n.update_id=u.id WHERE u.page_id=?1 AND u.channel=?2 AND (n.update_id IS NULL OR n.page_id!=u.page_id OR n.channel!=u.channel OR n.data!=u.data OR n.created_at!=u.created_at OR u.origin!='local')) OR EXISTS(SELECT 1 FROM native_sync_update_owner_v1 n LEFT JOIN sync_updates u ON u.id=n.update_id WHERE n.page_id=?1 AND n.channel=?2 AND (u.id IS NULL OR u.page_id!=n.page_id OR u.channel!=n.channel))",params![self.page,channel],|r|r.get(0))?;
        if untrusted { return Err(StoreError::Denied); }
        self.require_owned_pending(channel)
    }

    /// Local update and provenance records commit together. This path does not
    /// yet admit incoming service updates or original-editor writes.
    pub fn append_owned_document(&mut self, channel: i64, server: &str, bytes: &[u8]) -> Result<()> {
        use yrs::updates::decoder::Decode;
        if bytes.len()>64*1024*1024 || yrs::Update::decode_v1(bytes).is_err() { return Err(StoreError::Invalid); }
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, rusqlite::TransactionBehavior::Immediate)?;
        self.check(channel,true)?; self.require_owned_document(channel,server)?;
        let t=now();
        tx.execute("INSERT OR IGNORE INTO sync_docs(page_id,channel,created_at,updated_at) VALUES(?1,?2,?3,?3)",params![self.page,channel,t])?;
        tx.execute("INSERT INTO sync_updates(page_id,channel,data,origin,created_at) VALUES(?1,?2,?3,'local',?4)",params![self.page,channel,bytes,t])?;
        let update_id=tx.last_insert_rowid();
        tx.execute("INSERT INTO native_sync_update_owner_v1(update_id,page_id,channel,data,created_at) VALUES(?1,?2,?3,?4,?5)",params![update_id,self.page,channel,bytes,t])?;
        tx.execute("INSERT INTO sync_outbox(page_id,channel,data,created_at) VALUES(?1,?2,?3,?4)",params![self.page,channel,bytes,t])?;
        let outbox_id=tx.last_insert_rowid();
        tx.execute("INSERT INTO native_sync_outbox_owner_v1(outbox_id,page_id,channel,user_id,workspace_id,data,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![outbox_id,self.page,channel,self.user,self.workspace,bytes,t])?;
        tx.execute("UPDATE sync_docs SET updated_at=?3 WHERE page_id=?1 AND channel=?2",params![self.page,channel,t])?;
        tx.commit()?; Ok(())
    }

    /// Snapshot of a verified experimental log and its pending watermark.
    /// The caller must obtain server identity and authorization independently.
    pub fn owned_document_batch(&self, channel: i64, server: &str, vector: &[u8]) -> Result<(Vec<u8>,Option<i64>)> {
        let tx=self.conn.unchecked_transaction()?;
        self.check(channel,false)?; self.require_owned_document(channel,server)?;
        let doc=crate::CollaborationDoc::default();
        for bytes in self.load_entries(channel,||Ok(()))? { doc.apply(&bytes).map_err(|_|StoreError::Invalid)?; }
        let watermark=tx.query_row("SELECT MAX(id) FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending'",params![self.page,channel],|r|r.get(0))?;
        let diff=doc.diff(vector).map_err(|_|StoreError::Invalid)?;
        tx.commit()?; Ok((diff,watermark))
    }

    pub fn acknowledge_owned_document(&mut self, channel: i64, server: &str, through: i64) -> Result<()> {
        let tx=rusqlite::Transaction::new_unchecked(&self.conn,rusqlite::TransactionBehavior::Immediate)?;
        self.check(channel,false)?; self.require_owned_document(channel,server)?;
        tx.execute("DELETE FROM native_sync_outbox_owner_v1 WHERE outbox_id IN (SELECT id FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending' AND id<=?3)",params![self.page,channel,through])?;
        tx.execute("DELETE FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending' AND id<=?3",params![self.page,channel,through])?;
        tx.commit()?; Ok(())
    }

    /// Rebuild and compare the complete CRDT state under an immediate SQLite transaction,
    /// then append both log and outbox atomically. The service still enforces live rights.
    pub fn insert_plain_checked(&mut self, base: &[u8], block_index: u32, block_id: &str, expected: &str, offset: u32, insert: &str) -> Result<Vec<u8>> {
        self.edit_plain_checked(base,block_index,block_id,expected,offset,Some(insert),0,None)
    }
    pub fn delete_plain_checked(&mut self, base: &[u8], block_index: u32, block_id: &str, expected: &str, offset: u32, length: u32) -> Result<Vec<u8>> {
        self.edit_plain_checked(base,block_index,block_id,expected,offset,None,length,None)
    }
    pub fn format_plain_checked(&mut self, base: &[u8], block_index: u32, block_id: &str, expected: &str, offset: u32, length: u32, mark: &str, enabled: bool) -> Result<Vec<u8>> {
        self.edit_plain_checked(base,block_index,block_id,expected,offset,None,length,Some((mark,enabled)))
    }
    fn edit_plain_checked(&mut self, base: &[u8], block_index: u32, block_id: &str, expected: &str, offset: u32, insert: Option<&str>, length: u32, format: Option<(&str,bool)>) -> Result<Vec<u8>> {
        use yrs::{Doc, ReadTxn, StateVector, Transact, Update};
        use yrs::updates::decoder::Decode;
        if base.len() > 64 * 1024 * 1024 { return Err(StoreError::Invalid); }
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, rusqlite::TransactionBehavior::Immediate)?;
        self.check(0, true)?;
        let updates = self.load_entries(0, || Ok(()))?;
        let current = Doc::new();
        for bytes in updates {
            let update = Update::decode_v1(&bytes).map_err(|_| StoreError::Invalid)?;
            current.transact_mut().apply_update(update).map_err(|_| StoreError::Invalid)?;
        }
        let proposed = Doc::new();
        proposed.transact_mut().apply_update(Update::decode_v1(base).map_err(|_| StoreError::Invalid)?).map_err(|_| StoreError::Invalid)?;
        let canonical = |doc: &Doc| doc.transact().encode_state_as_update_v1(&StateVector::default());
        if canonical(&current) != canonical(&proposed) { return Err(StoreError::Conflict); }
        let update = match (insert,format) {
            (Some(value),None) => crate::editor::prepare_plain_insert(base,block_index,block_id,expected,offset,value),
            (None,Some((mark,enabled))) => crate::editor::prepare_basic_mark(base,block_index,block_id,expected,offset,length,mark,enabled),
            (None,None) => crate::editor::prepare_plain_delete(base,block_index,block_id,expected,offset,length),
            _ => return Err(StoreError::Invalid),
        }.map_err(|_| StoreError::Invalid)?;
        let t = now();
        tx.execute("INSERT OR IGNORE INTO sync_docs(page_id,channel,created_at,updated_at) VALUES(?1,0,?2,?2)", params![self.page,t])?;
        tx.execute("INSERT INTO sync_updates(page_id,channel,data,origin,created_at) VALUES(?1,0,?2,'local',?3)", params![self.page,update,t])?;
        tx.execute("INSERT INTO sync_outbox(page_id,channel,data,created_at) VALUES(?1,0,?2,?3)", params![self.page,update,t])?;
        tx.execute("UPDATE sync_docs SET updated_at=?2 WHERE page_id=?1 AND channel=0", params![self.page,t])?;
        tx.commit()?;
        Ok(update)
    }

    pub fn max_pending(&self, channel: i64) -> Result<Option<i64>> {
        self.max_pending_with_hook(channel, || Ok(()))
    }
    fn max_pending_with_hook(&self, channel: i64, after_authorize: impl FnOnce() -> Result<()>) -> Result<Option<i64>> {
        let tx=self.conn.unchecked_transaction()?;
        self.check(channel,false)?;
        after_authorize()?;
        let pending=self.conn.query_row("SELECT MAX(id) FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending'",params![self.page,channel],|r|r.get(0))?;
        tx.commit()?;
        Ok(pending)
    }
    pub fn acknowledge(&self, channel: i64, through: i64) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        self.check(channel,false)?;
        tx.execute("DELETE FROM sync_outbox WHERE page_id=?1 AND channel=?2 AND state='pending' AND id<=?3",params![self.page,channel,through])?;
        tx.commit()?;
        Ok(())
    }
    /// Read-only access, bound to the active account and cached page view rights.
    /// Cached rights are not proof of current remote authorization.
    pub fn rejected_list(&self, before: Option<(i64, &str)>) -> Result<RejectedPage> {
        if before.as_ref().is_some_and(|(_, id)| id.is_empty() || id.len() > 256) { return Err(StoreError::Invalid); }
        let tx = self.conn.unchecked_transaction()?;
        self.authorize(1)?;
        let (before_time,before_id) = before.map_or((None,None), |(time,id)| (Some(time),Some(id)));
        let mut items = Vec::new();
        {
            let mut query = tx.prepare("SELECT id,channel,reason,created_at,LENGTH(data) FROM sync_rejected_snapshots WHERE page_id=?1 AND owner_id=?2 AND (?3 IS NULL OR created_at<?3 OR (created_at=?3 AND id<?4)) ORDER BY created_at DESC,id DESC LIMIT 101")?;
            for row in query.query_map(params![self.page,self.user,before_time,before_id], |r| Ok(RejectedSnapshot { id:r.get(0)?,channel:r.get(1)?,reason:r.get(2)?,created_at:r.get(3)?,size:r.get(4)? }))? {
                let item = row?;
                valid_channel(item.channel)?;
                if item.id.is_empty() || item.id.len() > 256 || item.id.contains('\0') || item.reason.len() > 10_000 || !(0..=64*1024*1024).contains(&item.size) { return Err(StoreError::Invalid); }
                items.push(item);
            }
        }
        let more = items.len() > 100; items.truncate(100);
        let next = if more { items.last().map(|item| (item.created_at,item.id.clone())) } else { None };
        tx.commit()?;
        Ok(RejectedPage { items, next })
    }
    /// Returns an immutable Yjs update for inspection. It never modifies the
    /// live document, clears the archive, or queues a change for transmission.
    pub fn rejected_read(&self, id: &str) -> Result<Vec<u8>> {
        self.rejected_read_channel(id,None)
    }
    pub fn rejected_read_channel(&self, id: &str, required: Option<i64>) -> Result<Vec<u8>> {
        use yrs::updates::decoder::Decode;
        if id.is_empty() || id.len() > 256 { return Err(StoreError::Invalid); }
        let tx = self.conn.unchecked_transaction()?;
        self.authorize(1)?;
        let row: Option<(i64, i64)> = tx.query_row("SELECT channel,LENGTH(data) FROM sync_rejected_snapshots WHERE id=?1 AND page_id=?2 AND owner_id=?3",params![id,self.page,self.user],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let (channel,size) = row.ok_or(StoreError::Denied)?;
        valid_channel(channel)?;
        if required.is_some_and(|expected| expected != channel) { return Err(StoreError::Denied); }
        if !(0..=64*1024*1024).contains(&size) { return Err(StoreError::Invalid); }
        let bytes: Vec<u8> = tx.query_row("SELECT data FROM sync_rejected_snapshots WHERE id=?1 AND page_id=?2 AND owner_id=?3",params![id,self.page,self.user],|r|r.get(0))?;
        yrs::Update::decode_v1(&bytes).map_err(|_| StoreError::Invalid)?;
        tx.commit()?;
        Ok(bytes)
    }
    /// This operation intentionally does not expose archived data or re-enable syncing.
    pub fn reject(&mut self, channel: i64, archive_id: &str, state: &[u8], reason: &str) -> Result<()> {
        use yrs::{Doc, ReadTxn, StateVector, Transact, Update};
        use yrs::updates::decoder::Decode;
        if uuid::Uuid::parse_str(archive_id).is_err() || state.len() > 64*1024*1024 || reason.len() > 10_000 { return Err(StoreError::Invalid); }
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, rusqlite::TransactionBehavior::Immediate)?;
        self.authorize_archive(channel)?;
        let existing: Option<(String,String,i64,Vec<u8>)> = tx.query_row("SELECT page_id,owner_id,channel,data FROM sync_rejected_snapshots WHERE id=?1", [archive_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        if existing.as_ref().is_some_and(|v| v.0 != self.page || v.1 != self.user || v.2 != channel) { return Err(StoreError::Denied); }
        // Capture every durable change in the same transaction that clears the
        // live log. The caller's in-memory document may lag a persisted write.
        // Merge both versions; malformed data fails closed before any reset.
        let doc = Doc::new();
        if let Some((_,_,_,bytes)) = existing {
            doc.transact_mut().apply_update(Update::decode_v1(&bytes).map_err(|_| StoreError::Invalid)?).map_err(|_| StoreError::Invalid)?;
        }
        let snapshot: Option<Option<Vec<u8>>> = tx.query_row("SELECT snapshot FROM sync_docs WHERE page_id=?1 AND channel=?2", params![self.page,channel], |r| r.get(0)).optional()?;
        if let Some(Some(bytes)) = snapshot {
            doc.transact_mut().apply_update(Update::decode_v1(&bytes).map_err(|_| StoreError::Invalid)?).map_err(|_| StoreError::Invalid)?;
        }
        {
            let mut query = tx.prepare("SELECT data FROM sync_updates WHERE page_id=?1 AND channel=?2 ORDER BY id")?;
            for row in query.query_map(params![self.page,channel], |r| r.get::<_, Vec<u8>>(0))? {
                let bytes = row?;
                doc.transact_mut().apply_update(Update::decode_v1(&bytes).map_err(|_| StoreError::Invalid)?).map_err(|_| StoreError::Invalid)?;
            }
        }
        doc.transact_mut().apply_update(Update::decode_v1(state).map_err(|_| StoreError::Invalid)?).map_err(|_| StoreError::Invalid)?;
        let merged = doc.transact().encode_state_as_update_v1(&StateVector::default());
        if merged.len() > 64*1024*1024 { return Err(StoreError::Invalid); }
        let t = now();
        tx.execute("INSERT INTO sync_rejected_snapshots(id,page_id,channel,owner_id,data,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET data=excluded.data,reason=excluded.reason",params![archive_id,self.page,channel,self.user,merged,reason,t])?;
        tx.execute("UPDATE sync_outbox SET state='rejected',last_error=?3 WHERE page_id=?1 AND channel=?2 AND state='pending'",params![self.page,channel,reason])?;
        tx.execute("INSERT OR IGNORE INTO sync_docs(page_id,channel,created_at,updated_at) VALUES(?1,?2,?3,?3)",params![self.page,channel,t])?;
        tx.execute("UPDATE sync_docs SET snapshot=x'0000',snapshot_upto=0,updated_at=?3 WHERE page_id=?1 AND channel=?2",params![self.page,channel,t])?;
        tx.execute("DELETE FROM sync_updates WHERE page_id=?1 AND channel=?2",params![self.page,channel])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    #[test]
    fn load_uses_one_snapshot_across_auth_and_compaction() {
        let directory=std::env::temp_dir().join(format!("worlds-sync-snapshot-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&directory).unwrap();
        let path=directory.join("worlds.db"); let conn=Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA user_version=11;
            CREATE TABLE pages(id TEXT PRIMARY KEY,workspace_id TEXT,parent_id TEXT,deleted_at INTEGER);
            CREATE TABLE account(id INTEGER PRIMARY KEY,user_id TEXT,status TEXT);
            CREATE TABLE account_workspaces(id TEXT PRIMARY KEY,role TEXT,default_level TEXT);
            CREATE TABLE account_page_access(workspace_id TEXT,page_id TEXT,level TEXT);
            CREATE TABLE drawing_sync_state(page_id TEXT,user_id TEXT);
            CREATE TABLE sync_docs(page_id TEXT,channel INTEGER,snapshot BLOB,PRIMARY KEY(page_id,channel));
            CREATE TABLE sync_updates(id INTEGER PRIMARY KEY,page_id TEXT,channel INTEGER,data BLOB);
            CREATE TABLE sync_outbox(id INTEGER PRIMARY KEY,page_id TEXT,channel INTEGER,state TEXT);
            INSERT INTO pages VALUES('p','w',NULL,NULL); INSERT INTO account VALUES(1,'u','active');
            INSERT INTO account_workspaces VALUES('w','member','edit');
            INSERT INTO sync_docs VALUES('p',0,x'01'); INSERT INTO sync_updates VALUES(1,'p',0,x'02');
            INSERT INTO sync_outbox VALUES(7,'p',0,'pending');").unwrap();
        drop(conn);
        let store=SyncStore::open(&path,"p","u","w").unwrap();
        let result=store.load_with_hook(0,|| {
            let writer=Connection::open(&path)?;
            writer.execute_batch("BEGIN IMMEDIATE; UPDATE sync_docs SET snapshot=x'03'; DELETE FROM sync_updates; UPDATE account SET user_id='other' WHERE id=1; COMMIT;")?;
            Ok(())
        }).unwrap();
        assert_eq!(result,vec![vec![1],vec![2]]);
        assert!(matches!(store.load(0),Err(StoreError::Denied)));
        let writer=Connection::open(&path).unwrap(); writer.execute("UPDATE account SET user_id='u' WHERE id=1",[]).unwrap(); drop(writer);
        let pending=store.max_pending_with_hook(0,|| {
            let writer=Connection::open(&path)?;
            writer.execute_batch("BEGIN IMMEDIATE; UPDATE account SET user_id='other' WHERE id=1; INSERT INTO sync_outbox VALUES(8,'p',0,'pending'); COMMIT;")?;
            Ok(())
        }).unwrap();
        assert_eq!(pending,Some(7));
        assert!(matches!(store.max_pending(0),Err(StoreError::Denied)));
        drop(store); std::fs::remove_dir_all(directory).unwrap();
    }
}



