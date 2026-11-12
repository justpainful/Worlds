use anyhow::{bail, Result};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use std::path::Path;
mod resource_ops;
mod isolated_import;
mod attachment_staging;
mod attachment_bundle;
#[allow(dead_code)] mod gallery_file_import;
mod automation_ops;
#[allow(dead_code)]
mod template_preflight;

#[path = "../../../src-tauri/src/content.rs"]
mod content;
#[path = "../../../src-tauri/src/store/mod.rs"]
mod store;
#[path = "../../../src-tauri/src/templates.rs"]
mod templates;

// These non-editor dependencies must not silently grant access.
mod account { pub mod permissions {
    use anyhow::{bail, Result}; use rusqlite::Connection;
    pub enum Level { View, Edit }
    pub fn require(_: &Connection, _: &str, _: Level) -> Result<()> { bail!("workspace authorization unavailable") }
} }
mod drawing_copy {
    use anyhow::{bail, Result}; use rusqlite::Connection;
    pub struct Permit;
    pub fn require_current(_: &Connection, _: &str, _: Option<&Permit>) -> Result<()> { bail!("drawing copy unavailable") }
}
mod drawing;
mod attachment_open;
// Publication validation needs library ownership dependencies which are not
// available in this isolated target; refuse instead of weakening validation.
// A personal-only bridge must refuse, rather than silently omit, a sync outbox.
mod drawing_sync {
    use anyhow::{bail, Result}; use rusqlite::Connection; use serde_json::Value;
    pub fn check_bound_identity(conn: &Connection, page: &str) -> Result<()> {
        let bound: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM drawing_sync_state WHERE page_id=?1)", [page], |r| r.get(0))?;
        if bound { bail!("drawing sync binding unavailable") } Ok(())
    }
    pub fn queue_local(conn: &Connection, page: &str, _: &Value, _: &Value) -> Result<()> { check_bound_identity(conn, page) }
}
mod drawing_library {
    use anyhow::{bail, Result}; use serde_json::Value;
    pub fn validate_scene_publication(_: &Value) -> Result<()> { bail!("drawing library publication validation unavailable") }
}
mod db {
    use anyhow::Result; use rusqlite::{params, Connection}; use std::path::PathBuf;
    pub fn now() -> i64 { chrono::Utc::now().timestamp_millis() }
    pub fn new_id() -> String { uuid::Uuid::now_v7().simple().to_string() }
    pub fn attachments_dir() -> PathBuf { PathBuf::from("__attachments_disabled__") }
    pub fn mark_change(c: &Connection, page: Option<&str>, kind: &str, origin: &str) -> Result<()> {
        c.execute("INSERT INTO changes(page_id,kind,origin,at) VALUES(?1,?2,?3,?4)",params![page,kind,origin,now()])?; Ok(())
    }
}

/// Every native write is made by the person, but it is recorded with its own
/// change origin. The desktop's change watcher ignores only "ui" rows (its own
/// editor), so a "native" row makes an open desktop window merge the edit
/// instead of meeting it later as a save conflict.
pub(crate) const NATIVE_ORIGIN: &str = "native";
pub(crate) fn native_ctx() -> store::Ctx {
    store::Ctx { actor: "user".into(), op_id: None, origin: NATIVE_ORIGIN.into() }
}

fn open_existing(path: &Path) -> Result<Connection> {
    if !path.is_absolute() || !path.is_file() { bail!("an existing absolute database path is required") }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")?;
    let v: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if v != 11 { bail!("unsupported schema version {v}; migrations are disabled") }
    Ok(conn)
}

fn require_personal(c: &Connection, id: &str) -> Result<()> { check_personal(c, id, false) }

/// Same checks as `require_personal`, except that the page must be in Trash.
fn require_personal_trashed(c: &Connection, id: &str) -> Result<()> { check_personal(c, id, true) }

fn check_personal(c: &Connection, id: &str, trashed: bool) -> Result<()> {
    let row: Option<(Option<String>, String, Option<i64>)> = c.query_row(
        "SELECT workspace_id,metadata,deleted_at FROM pages WHERE id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let (workspace, metadata, deleted) = row.ok_or_else(|| anyhow::anyhow!("page unavailable"))?;
    // JSON parsers disagree about duplicate object keys. Reject them at every
    // depth before authorization or a read-modify-write can discard data.
    let unambiguous: i64 = c.query_row(
        "SELECT CASE WHEN json_valid(?1) THEN NOT EXISTS(SELECT 1 FROM json_tree(?1) WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*) > 1) ELSE 0 END",
        [&metadata], |r| r.get(0))?;
    if unambiguous != 1 { bail!("invalid or ambiguous metadata") }
    let value: Value = serde_json::from_str(&metadata)?;
    if !value.is_object() { bail!("invalid metadata") }
    if let Some(sync) = value.get("sync") {
        if !sync.is_object() || sync.get("shared").is_some_and(|shared| shared.as_bool() != Some(false)) { bail!("shared or invalid synchronization metadata") }
    }
    if workspace.is_some() || deleted.is_some() != trashed {
        bail!("page is shared, deleted, or unavailable")
    }
    Ok(())
}

/// Uses the current Rust store implementation. No migrations or shared writes.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct BlockInput { pub id: String, pub content: Value }

pub fn save_blocks(path: &Path, page: &str, base: i64, blocks: Vec<BlockInput>) -> Result<Value> {
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    let kind: String = tx.query_row("SELECT kind FROM pages WHERE id=?1", [page], |r| r.get(0))?;
    if kind != "page" && kind != "document" { bail!("only page and document blocks are supported") }
    if store::page_changed_since(&tx, page, base)? { bail!("conflict: the page changed since it was loaded") }
    store::snapshot_before_user_edit(&tx, page)?;
    let input = blocks.into_iter().map(|block| store::BlockInput { id: block.id, content: block.content }).collect();
    let result = store::save_blocks(&tx, &native_ctx(), page, input)?;
    tx.commit()?;
    Ok(serde_json::to_value(result)?)
}

/// Full content and ordering are compared in the same write transaction.
/// Millisecond timestamps alone cannot detect reordered rows or equal-time writes.
pub fn save_blocks_checked(path: &Path, page: &str, base: i64, expected: Vec<BlockInput>, blocks: Vec<BlockInput>) -> Result<Value> {
    save_blocks_checked_with_kind(path,page,base,expected,blocks,None)
}

pub fn save_blocks_checked_kind(path: &Path, page: &str, base: i64, expected: Vec<BlockInput>, blocks: Vec<BlockInput>, expected_kind: &str) -> Result<Value> {
    if expected_kind != "page" && expected_kind != "document" { bail!("invalid expected page kind") }
    save_blocks_checked_with_kind(path,page,base,expected,blocks,Some(expected_kind))
}

fn save_blocks_checked_with_kind(path: &Path, page: &str, base: i64, expected: Vec<BlockInput>, blocks: Vec<BlockInput>, expected_kind: Option<&str>) -> Result<Value> {
    use std::collections::HashSet;
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    let (kind, current_at): (String,i64) = tx.query_row("SELECT kind,updated_at FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?,r.get(1)?)))?;
    if expected_kind.is_some_and(|expected| expected != kind) { bail!("conflict: page kind changed") }
    if kind != "page" && kind != "document" { bail!("only page and document blocks are supported") }
    if current_at != base { bail!("conflict: page revision changed") }
    let current: Vec<(String,String,String)> = tx.prepare("SELECT id,content,properties FROM blocks WHERE page_id=?1 ORDER BY sort_key")?
        .query_map([page], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    if current.len() != expected.len() { bail!("conflict: block count changed") }
    let mut expected_refs = HashSet::new();
    for ((id, json, _), old) in current.iter().zip(expected.iter()) {
        let unambiguous: i64 = tx.query_row("SELECT CASE WHEN json_valid(?1) THEN NOT EXISTS(SELECT 1 FROM json_tree(?1) WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*) > 1) ELSE 0 END", [json], |r|r.get(0))?;
        if unambiguous != 1 { bail!("unsupported edit: ambiguous block content") }
        let value: Value = serde_json::from_str(json)?;
        if id != &old.id || value != old.content { bail!("conflict: block content or order changed") }
        let mut refs = Vec::new(); content::collect_refs(&value, &mut refs);
        expected_refs.extend(refs.into_iter().map(|(target,kind)| (id.clone(),target,kind.to_string())));
    }
    // The original writer rebuilds the entire reference index. Refuse when the
    // existing index contains unknown or stale entries, instead of silently
    // deleting them as a side effect of an unrelated text edit.
    let stored_refs: HashSet<(String,String,String)> = tx.prepare("SELECT source_block,target_page,kind FROM refs WHERE source_page=?1")?
        .query_map([page],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    if stored_refs != expected_refs { bail!("unsupported edit: reference index differs from block content") }
    let mut ids = HashSet::new();
    let mut next_refs = HashSet::new();
    for block in &blocks {
        if block.id.is_empty() || !ids.insert(block.id.clone()) || !block.content.is_object() { bail!("invalid block ID or content") }
        if block.content.pointer("/attrs/bid").and_then(Value::as_str) != Some(block.id.as_str()) { bail!("invalid block identity") }
        let owner: Option<String> = tx.query_row("SELECT page_id FROM blocks WHERE id=?1", [&block.id], |r| r.get(0)).optional()?;
        if owner.as_deref().is_some_and(|other| other != page) { bail!("conflict: block ID belongs to another page") }
        let mut refs = Vec::new(); content::collect_refs(&block.content, &mut refs);
        next_refs.extend(refs.into_iter().map(|(target,kind)| (block.id.clone(),target,kind.to_string())));
    }
    // Native editor has no representation for the separate properties column.
    // Never delete a block with nonempty or malformed properties, including
    // properties changed since the initial read. The check and write share the
    // same immediate transaction.
    for (id, _, raw) in &current {
        if !ids.contains(id) {
            let properties: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
            if !properties.as_object().is_some_and(|object| object.is_empty()) {
                bail!("unsupported edit: block has properties that cannot be discarded")
            }
        }
    }
    if current.iter().any(|(id,_,_)| !ids.contains(id)) {
        store::snapshot(&tx,page,"user",None,Some("Before block deletion"))?;
    } else { store::snapshot_before_user_edit(&tx, page)?; }
    let before_values: Vec<(String,Value)>=current.iter().map(|(id,raw,_)|Ok((id.clone(),serde_json::from_str(raw)?))).collect::<Result<_>>()?;
    let next_values: Vec<(String,Value)>=blocks.iter().map(|block|(block.id.clone(),block.content.clone())).collect();
    let originals=resource_ops::prepare_unchanged_blocks(&tx,page,&before_values,&next_values)?;
    let input = blocks.into_iter().map(|block| store::BlockInput { id: block.id, content: block.content }).collect();
    let result = store::save_blocks(&tx, &native_ctx(), page, input)?;
    if !result.remapped.is_empty() { bail!("conflict: block identifiers were remapped") }
    resource_ops::restore_unchanged_blocks(&tx,page,originals)?;
    let written_refs: HashSet<(String,String,String)> = tx.prepare("SELECT source_block,target_page,kind FROM refs WHERE source_page=?1")?
        .query_map([page],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    if written_refs != next_refs { bail!("conflict: reference index could not be preserved") }
    let saved_at: i64 = tx.query_row("SELECT updated_at FROM pages WHERE id=?1", [page], |r| r.get(0))?;
    let mut result = serde_json::to_value(result)?;
    result["updatedAt"] = Value::from(saved_at);
    tx.commit()?;
    Ok(result)
}
pub fn rename_page(path: &Path, page: &str, base: i64, title: String) -> Result<Value> {
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    if store::page_changed_since(&tx, page, base)? { bail!("conflict: the page changed since it was loaded") }
    let result = store::update_page(&tx, &native_ctx(), page, store::PagePatch { title: Some(title), ..Default::default() })?;
    tx.commit()?;
    Ok(serde_json::to_value(result)?)
}

/// Idempotent, title-aware CAS for an experimental personal-copy rename.
pub fn rename_page_checked(path: &Path, page: &str, base: i64, expected_title: String, title: String, operation_id: &str) -> Result<Value> {
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx,page)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_page_renames_v1(operation_id TEXT PRIMARY KEY,page_id TEXT NOT NULL,base INTEGER NOT NULL,expected_title TEXT NOT NULL,title TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    let previous:Option<(String,i64,String,String,String)>=tx.query_row("SELECT page_id,base,expected_title,title,result_json FROM native_personal_page_renames_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    if let Some((saved_page,saved_base,saved_expected,saved_title,result))=previous {
        if saved_page!=page || saved_base!=base || saved_expected!=expected_title || saved_title!=title { bail!("conflict: rename operation input changed") }
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page) { bail!("conflict: invalid rename record") }
        tx.commit()?; return Ok(value)
    }
    let (current_title,current_revision):(String,i64)=tx.query_row("SELECT title,updated_at FROM pages WHERE id=?1",[page],|r|Ok((r.get(0)?,r.get(1)?)))?;
    if current_title!=expected_title || current_revision!=base { bail!("conflict: page title or revision changed") }
    let result=serde_json::to_value(store::update_page(&tx,&native_ctx(),page,store::PagePatch { title:Some(title.clone()), ..Default::default() })?)?;
    tx.execute("INSERT INTO native_personal_page_renames_v1(operation_id,page_id,base,expected_title,title,result_json) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![operation_id,page,base,expected_title,title,result.to_string()])?;
    tx.commit()?; Ok(result)
}



/// Creates a personal page using the existing Rust store. Restricted to page kind.
pub fn create_page(path: &Path, title: String, parent: Option<String>) -> Result<Value> {
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(parent_id) = parent.as_deref() { require_personal(&tx, parent_id)?; }
    let input = store::NewPage { title: Some(title), parent_id: parent, kind: Some("page".into()), ..Default::default() };
    let result = store::create_page(&tx, &native_ctx(), input)?;
    require_created_personal(&tx, &result.id)?;
    tx.commit()?;
    Ok(serde_json::to_value(result)?)
}

/// Experimental retry-safe creation in a single local copy. The same operation
/// ID and identical inputs return the original result, never create a second page.
pub fn create_page_idempotent(path: &Path, title: String, parent: Option<String>, operation_id: &str) -> Result<Value> {
    let operation_id = uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(parent_id) = parent.as_deref() { require_personal(&tx, parent_id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_page_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    reject_creation_collision(&tx,&operation_id,&["native_personal_document_creations_v1","native_personal_project_creations_v1","native_personal_presentation_creations_v1","native_personal_gallery_creations_v1","native_personal_stream_creations_v1","native_personal_drawing_creations_v1"])?;
    let previous: Option<(String,Option<String>,String,String)> = tx.query_row("SELECT title,parent_id,page_id,result_json FROM native_personal_page_creations_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    if let Some((saved_title,saved_parent,page_id,result)) = previous {
        if saved_title != title || saved_parent != parent { bail!("conflict: creation operation input changed") }
        require_personal(&tx,&page_id)?;
        let value: Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page_id.as_str()) { bail!("conflict: invalid creation record") }
        tx.commit()?; return Ok(value)
    }
    let input=store::NewPage { title:Some(title.clone()), parent_id:parent.clone(), kind:Some("page".into()), ..Default::default() };
    let result=serde_json::to_value(store::create_page(&tx,&native_ctx(),input)?)?;
    let page_id=result.get("id").and_then(Value::as_str).ok_or_else(||anyhow::anyhow!("invalid created page"))?;
    require_created_personal(&tx,page_id)?;
    tx.execute("INSERT INTO native_personal_page_creations_v1(operation_id,title,parent_id,page_id,result_json) VALUES(?1,?2,?3,?4,?5)",rusqlite::params![operation_id,title,parent,page_id,result.to_string()])?;
    tx.commit()?; Ok(result)
}

/// A document uses the source application's document defaults and icon.
pub fn create_document_idempotent(path:&Path,title:String,parent:Option<String>,parent_revision:Option<i64>,operation_id:&str)->Result<Value> {
    if parent.is_some()!=parent_revision.is_some() { bail!("invalid document parent revision") }
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(id)=parent.as_deref() { require_personal(&tx,id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_document_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    reject_creation_collision(&tx,&operation_id,&["native_personal_page_creations_v1","native_personal_project_creations_v1","native_personal_presentation_creations_v1","native_personal_gallery_creations_v1","native_personal_stream_creations_v1","native_personal_drawing_creations_v1"])?;
    let prior:Option<(String,Option<String>,Option<i64>,String,String)>=tx.query_row("SELECT title,parent_id,parent_revision,page_id,result_json FROM native_personal_document_creations_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    if let Some((old_title,old_parent,old_revision,page_id,result))=prior {
        if old_title!=title || old_parent!=parent || old_revision!=parent_revision { bail!("conflict: creation operation input changed") }
        require_personal(&tx,&page_id)?;
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page_id.as_str()) || value.get("kind").and_then(Value::as_str)!=Some("document") { bail!("conflict: invalid document creation record") }
        tx.commit()?; return Ok(value)
    }
    if let (Some(id),Some(expected))=(parent.as_deref(),parent_revision) {
        let current:i64=tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[id],|r|r.get(0))?;
        if current!=expected { bail!("conflict: parent changed") }
    }
    let metadata=serde_json::json!({"doc":{"size":"A4","orientation":"portrait","margins":{"top":25,"right":22,"bottom":25,"left":22},"header":"","footer":"","font":"Default","fontSize":12,"lineHeight":1.5}});
    let input=store::NewPage { title:Some(title.clone()),icon:Some("pi:document".into()),parent_id:parent.clone(),kind:Some("document".into()),metadata:Some(metadata),..Default::default() };
    let result=serde_json::to_value(store::create_page(&tx,&native_ctx(),input)?)?;
    let page_id=result.get("id").and_then(Value::as_str).ok_or_else(||anyhow::anyhow!("invalid created document"))?;
    require_created_personal(&tx,page_id)?;
    tx.execute("INSERT INTO native_personal_document_creations_v1(operation_id,title,parent_id,parent_revision,page_id,result_json) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![operation_id,title,parent,parent_revision,page_id,result.to_string()])?;
    tx.commit()?; Ok(result)
}

/// The desktop's `pages_assign_workspace` trigger moves a new top-level page
/// into the active Team workspace. Native writes are personal only, so refuse
/// and roll back instead of creating a shared page outside sync.
fn require_created_personal(c:&Connection,page:&str)->Result<()> {
    let workspace:Option<String>=c.query_row("SELECT workspace_id FROM pages WHERE id=?1",[page],|r|r.get(0))?;
    if workspace.is_some() { bail!("team workspace: new pages would join the active team workspace") }
    require_personal(c,page)
}

fn reject_creation_collision(conn:&Connection,operation_id:&str,tables:&[&str])->Result<()> {
    for table in tables {
        // All table names are hard-coded by the caller, never supplied by FFI.
        let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",[table],|r|r.get(0))?;
        if exists && conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE operation_id=?1)"),[operation_id],|r|r.get::<_,bool>(0))? { bail!("conflict: creation operation belongs to another kind") }
    }
    Ok(())
}

/// Creates a project using the source resource defaults and icon.
pub fn create_project_idempotent(path:&Path,title:String,parent:Option<String>,parent_revision:Option<i64>,operation_id:&str)->Result<Value> {
    if parent.is_some()!=parent_revision.is_some() { bail!("invalid project parent revision") }
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(id)=parent.as_deref() { require_personal(&tx,id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_project_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    reject_creation_collision(&tx,&operation_id,&["native_personal_page_creations_v1","native_personal_document_creations_v1","native_personal_presentation_creations_v1","native_personal_gallery_creations_v1","native_personal_stream_creations_v1","native_personal_drawing_creations_v1"])?;
    let prior:Option<(String,Option<String>,Option<i64>,String,String)>=tx.query_row("SELECT title,parent_id,parent_revision,page_id,result_json FROM native_personal_project_creations_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    if let Some((old_title,old_parent,old_revision,page_id,result))=prior {
        if old_title!=title || old_parent!=parent || old_revision!=parent_revision { bail!("conflict: creation operation input changed") }
        require_personal(&tx,&page_id)?;
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page_id.as_str()) || value.get("kind").and_then(Value::as_str)!=Some("project") { bail!("conflict: invalid project creation record") }
        tx.commit()?; return Ok(value)
    }
    if let (Some(id),Some(expected))=(parent.as_deref(),parent_revision) {
        let current:i64=tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[id],|r|r.get(0))?;
        if current!=expected { bail!("conflict: parent changed") }
    }
    let metadata=serde_json::json!({"project":{"status":"active","start":null,"due":null,"description":"","links":[]}});
    let input=store::NewPage { title:Some(title.clone()),icon:Some("pi:briefcase".into()),parent_id:parent.clone(),kind:Some("project".into()),metadata:Some(metadata),..Default::default() };
    let result=serde_json::to_value(store::create_page(&tx,&native_ctx(),input)?)?;
    let page_id=result.get("id").and_then(Value::as_str).ok_or_else(||anyhow::anyhow!("invalid created project"))?;
    require_created_personal(&tx,page_id)?;
    tx.execute("INSERT INTO native_personal_project_creations_v1(operation_id,title,parent_id,parent_revision,page_id,result_json) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![operation_id,title,parent,parent_revision,page_id,result.to_string()])?;
    tx.commit()?; Ok(result)
}

/// Creates a gallery using the source resource defaults and icon.
pub fn create_gallery_idempotent(path:&Path,title:String,parent:Option<String>,parent_revision:Option<i64>,operation_id:&str)->Result<Value> {
    if parent.is_some()!=parent_revision.is_some() { bail!("invalid gallery parent revision") }
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(id)=parent.as_deref() { require_personal(&tx,id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_gallery_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    reject_creation_collision(&tx,&operation_id,&["native_personal_page_creations_v1","native_personal_document_creations_v1","native_personal_presentation_creations_v1","native_personal_project_creations_v1","native_personal_stream_creations_v1","native_personal_drawing_creations_v1"])?;
    let prior:Option<(String,Option<String>,Option<i64>,String,String)>=tx.query_row("SELECT title,parent_id,parent_revision,page_id,result_json FROM native_personal_gallery_creations_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    if let Some((old_title,old_parent,old_revision,page_id,result))=prior {
        if old_title!=title || old_parent!=parent || old_revision!=parent_revision { bail!("conflict: creation operation input changed") }
        require_personal(&tx,&page_id)?;
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page_id.as_str()) || value.get("kind").and_then(Value::as_str)!=Some("gallery") { bail!("conflict: invalid gallery creation record") }
        tx.commit()?; return Ok(value)
    }
    if let (Some(id),Some(expected))=(parent.as_deref(),parent_revision) {
        let current:i64=tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[id],|r|r.get(0))?;
        if current!=expected { bail!("conflict: parent changed") }
    }
    let metadata=serde_json::json!({"gallery":{"view":"grid"}});
    let input=store::NewPage { title:Some(title.clone()),icon:Some("pi:image".into()),parent_id:parent.clone(),kind:Some("gallery".into()),metadata:Some(metadata),..Default::default() };
    let result=serde_json::to_value(store::create_page(&tx,&native_ctx(),input)?)?;
    let page_id=result.get("id").and_then(Value::as_str).ok_or_else(||anyhow::anyhow!("invalid created gallery"))?;
    require_created_personal(&tx,page_id)?;
    tx.execute("INSERT INTO native_personal_gallery_creations_v1(operation_id,title,parent_id,parent_revision,page_id,result_json) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![operation_id,title,parent,parent_revision,page_id,result.to_string()])?;
    tx.commit()?; Ok(result)
}

/// Creates a drawing using the source resource defaults and icon.
pub fn create_drawing_idempotent(path:&Path,title:String,parent:Option<String>,parent_revision:Option<i64>,operation_id:&str)->Result<Value> {
    if parent.is_some()!=parent_revision.is_some() { bail!("invalid drawing parent revision") }
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(id)=parent.as_deref() { require_personal(&tx,id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_drawing_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    reject_creation_collision(&tx,&operation_id,&["native_personal_page_creations_v1","native_personal_document_creations_v1","native_personal_presentation_creations_v1","native_personal_project_creations_v1","native_personal_stream_creations_v1","native_personal_gallery_creations_v1"])?;
    let prior:Option<(String,Option<String>,Option<i64>,String,String)>=tx.query_row("SELECT title,parent_id,parent_revision,page_id,result_json FROM native_personal_drawing_creations_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    if let Some((old_title,old_parent,old_revision,page_id,result))=prior {
        if old_title!=title || old_parent!=parent || old_revision!=parent_revision { bail!("conflict: creation operation input changed") }
        require_personal(&tx,&page_id)?;
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page_id.as_str()) || value.get("kind").and_then(Value::as_str)!=Some("drawing") { bail!("conflict: invalid drawing creation record") }
        tx.commit()?; return Ok(value)
    }
    if let (Some(id),Some(expected))=(parent.as_deref(),parent_revision) {
        let current:i64=tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[id],|r|r.get(0))?;
        if current!=expected { bail!("conflict: parent changed") }
    }
    let metadata=serde_json::json!({});
    let input=store::NewPage { title:Some(title.clone()),icon:Some("pi:paintbrush".into()),parent_id:parent.clone(),kind:Some("drawing".into()),metadata:Some(metadata),..Default::default() };
    let result=serde_json::to_value(store::create_page(&tx,&native_ctx(),input)?)?;
    let page_id=result.get("id").and_then(Value::as_str).ok_or_else(||anyhow::anyhow!("invalid created drawing"))?;
    require_created_personal(&tx,page_id)?;
    tx.execute("INSERT INTO native_personal_drawing_creations_v1(operation_id,title,parent_id,parent_revision,page_id,result_json) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![operation_id,title,parent,parent_revision,page_id,result.to_string()])?;
    tx.commit()?; Ok(result)
}

/// Creates a stream using the source resource defaults and icon.
pub fn create_stream_idempotent(path:&Path,title:String,url:String,parent:Option<String>,parent_revision:Option<i64>,operation_id:&str)->Result<Value> {
    let raw=url.trim();
    if raw.is_empty() || raw.len()>65536 || raw.bytes().any(|b| b.is_ascii_control()) { bail!("invalid stream URL") }
    let parsed=url::Url::parse(raw).map_err(|_|anyhow::anyhow!("invalid stream URL"))?;
    if !matches!(parsed.scheme(),"http" | "https") || parsed.host_str().is_none() { bail!("invalid stream URL") }
    let path_part=raw.split(['?', '#']).next().unwrap_or("").to_lowercase();
    let format=if path_part.ends_with(".m3u8") || path_part.ends_with(".m3u") { "hls" } else if path_part.ends_with(".mpd") { "dash" } else { "progressive" };
    if parent.is_some()!=parent_revision.is_some() { bail!("invalid stream parent revision") }
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(id)=parent.as_deref() { require_personal(&tx,id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_stream_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    reject_creation_collision(&tx,&operation_id,&["native_personal_page_creations_v1","native_personal_document_creations_v1","native_personal_presentation_creations_v1","native_personal_project_creations_v1","native_personal_gallery_creations_v1","native_personal_drawing_creations_v1"])?;
    let prior:Option<(String,String,Option<String>,Option<i64>,String,String)>=tx.query_row("SELECT title,url,parent_id,parent_revision,page_id,result_json FROM native_personal_stream_creations_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional()?;
    if let Some((old_title,old_url,old_parent,old_revision,page_id,result))=prior {
        if old_title!=title || old_url!=raw || old_parent!=parent || old_revision!=parent_revision { bail!("conflict: creation operation input changed") }
        require_personal(&tx,&page_id)?;
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page_id.as_str()) || value.get("kind").and_then(Value::as_str)!=Some("stream") { bail!("conflict: invalid stream creation record") }
        tx.commit()?; return Ok(value)
    }
    if let (Some(id),Some(expected))=(parent.as_deref(),parent_revision) {
        let current:i64=tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[id],|r|r.get(0))?;
        if current!=expected { bail!("conflict: parent changed") }
    }
    let metadata=serde_json::json!({"stream":{"url":raw,"format":format}});
    let input=store::NewPage { title:Some(title.clone()),icon:Some("pi:film".into()),parent_id:parent.clone(),kind:Some("stream".into()),metadata:Some(metadata),..Default::default() };
    let result=serde_json::to_value(store::create_page(&tx,&native_ctx(),input)?)?;
    let page_id=result.get("id").and_then(Value::as_str).ok_or_else(||anyhow::anyhow!("invalid created stream"))?;
    require_created_personal(&tx,page_id)?;
    tx.execute("INSERT INTO native_personal_stream_creations_v1(operation_id,title,url,parent_id,parent_revision,page_id,result_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",rusqlite::params![operation_id,title,raw,parent,parent_revision,page_id,result.to_string()])?;
    tx.commit()?; Ok(result)
}

/// Creates a presentation using the source resource defaults and icon.
pub fn create_presentation_idempotent(path:&Path,title:String,parent:Option<String>,parent_revision:Option<i64>,operation_id:&str)->Result<Value> {
    if parent.is_some()!=parent_revision.is_some() { bail!("invalid presentation parent revision") }
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(id)=parent.as_deref() { require_personal(&tx,id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_presentation_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    reject_creation_collision(&tx,&operation_id,&["native_personal_page_creations_v1","native_personal_document_creations_v1","native_personal_project_creations_v1","native_personal_gallery_creations_v1","native_personal_stream_creations_v1","native_personal_drawing_creations_v1"])?;
    let prior:Option<(String,Option<String>,Option<i64>,String,String)>=tx.query_row("SELECT title,parent_id,parent_revision,page_id,result_json FROM native_personal_presentation_creations_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    if let Some((old_title,old_parent,old_revision,page_id,result))=prior {
        if old_title!=title || old_parent!=parent || old_revision!=parent_revision { bail!("conflict: creation operation input changed") }
        require_personal(&tx,&page_id)?;
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page_id.as_str()) || value.get("kind").and_then(Value::as_str)!=Some("presentation") { bail!("conflict: invalid presentation creation record") }
        tx.commit()?; return Ok(value)
    }
    if let (Some(id),Some(expected))=(parent.as_deref(),parent_revision) {
        let current:i64=tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[id],|r|r.get(0))?;
        if current!=expected { bail!("conflict: parent changed") }
    }
    let metadata=serde_json::json!({"deck":{"aspect":"16:9","theme":"dark"}});
    // Source Deck initializes this title layout on first opening; persist it atomically here.
    let bid=uuid::Uuid::new_v4().simple().to_string()[..26].to_owned();
    let title_id=uuid::Uuid::new_v4().simple().to_string()[..26].to_owned();
    let subtitle_id=uuid::Uuid::new_v4().simple().to_string()[..26].to_owned();
    let slide=serde_json::json!({"type":"slide","attrs":{"bid":bid,"layout":"title","background":{"color":"#16161a"},"notes":"","elements":[
      {"id":title_id,"type":"text","role":"title","x":120,"y":250,"w":1040,"h":140,"text":"","style":{"fontSize":76,"fontWeight":700,"color":"#f4f2ee","align":"center"}},
      {"id":subtitle_id,"type":"text","role":"subtitle","x":200,"y":400,"w":880,"h":70,"text":"","style":{"fontSize":30,"fontWeight":400,"color":"rgba(244, 242, 238, 0.66)","align":"center"}}
    ]}});
    let input=store::NewPage { blocks:Some(vec![slide]),title:Some(title.clone()),icon:Some("pi:presentation".into()),parent_id:parent.clone(),kind:Some("presentation".into()),metadata:Some(metadata),..Default::default() };
    let result=serde_json::to_value(store::create_page(&tx,&native_ctx(),input)?)?;
    let page_id=result.get("id").and_then(Value::as_str).ok_or_else(||anyhow::anyhow!("invalid created presentation"))?;
    require_created_personal(&tx,page_id)?;
    tx.execute("INSERT INTO native_personal_presentation_creations_v1(operation_id,title,parent_id,parent_revision,page_id,result_json) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![operation_id,title,parent,parent_revision,page_id,result.to_string()])?;
    tx.commit()?; Ok(result)
}

/// Moves a wholly personal subtree to trash, failing closed on mixed ownership.
pub fn trash_page(path: &Path, page: &str, base: i64) -> Result<()> {
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    let revision: i64 = tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[page],|r|r.get(0))?;
    if revision != base { bail!("conflict: the page changed since it was loaded") }
    {
        let mut statement = tx.prepare("WITH RECURSIVE subtree(id) AS (SELECT id FROM pages WHERE id=?1 UNION SELECT p.id FROM pages p JOIN subtree s ON p.parent_id=s.id) SELECT id FROM subtree")?;
        let descendants = statement.query_map([page], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let parent: Option<String>=tx.query_row("SELECT parent_id FROM pages WHERE id=?1",[page],|r|r.get(0))?;
        // The original delete implementation traverses with UNION ALL and
        // would not terminate on a parent cycle. Reject before invoking it.
        if parent.as_ref().is_some_and(|id| descendants.contains(id)) { bail!("invalid page hierarchy: cycle") }
        for id in descendants { require_personal(&tx, &id)?; }
    }
    store::delete_page(&tx, &native_ctx(), page)?;
    tx.commit()?;
    Ok(())
}

/// Restores a personal page from Trash with the original restore operation,
/// after comparing the revision and the deletion time the caller listed. Every
/// page that comes back with it (same deletion time) must be personal too.
pub fn restore_page_checked(path: &Path, page: &str, base: i64, deleted_at: i64) -> Result<Value> {
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal_trashed(&tx, page)?;
    let (revision, deleted): (i64, Option<i64>) = tx.query_row("SELECT updated_at,deleted_at FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if revision != base || deleted != Some(deleted_at) { bail!("conflict: the page changed since it was listed in Trash") }
    {
        let mut statement = tx.prepare("WITH RECURSIVE subtree(id) AS (SELECT id FROM pages WHERE id=?1 UNION SELECT p.id FROM pages p JOIN subtree s ON p.parent_id=s.id) SELECT id FROM subtree")?;
        let descendants = statement.query_map([page], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let parent: Option<String> = tx.query_row("SELECT parent_id FROM pages WHERE id=?1", [page], |r| r.get(0))?;
        // The original restore walks the subtree with UNION ALL; refuse a cycle first.
        if parent.as_ref().is_some_and(|id| descendants.contains(id)) { bail!("invalid page hierarchy: cycle") }
        for id in descendants {
            let at: Option<i64> = tx.query_row("SELECT deleted_at FROM pages WHERE id=?1", [&id], |r| r.get(0))?;
            if at == Some(deleted_at) { require_personal_trashed(&tx, &id)?; }
        }
    }
    store::restore_page(&tx, &native_ctx(), page)?;
    require_personal(&tx, page)?;
    let (id, title, parent, revision): (String, String, Option<String>, i64) = tx.query_row("SELECT id,title,parent_id,updated_at FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    tx.commit()?;
    Ok(serde_json::json!({"id": id, "title": title, "parentId": parent, "updatedAt": revision}))
}

/// Keeps the current state of a personal page or document as a named version,
/// after comparing its revision. Nothing else changes, so the revision stays
/// the same and the caller can save against it next. The assistant uses this
/// before its first change to a page in one reply, so the reply can be undone.
pub fn create_version_checked(path: &Path, page: &str, base: i64, label: String) -> Result<Value> {
    let label = label.trim().to_owned();
    if label.is_empty() || label.chars().count() > 200 { bail!("invalid version label") }
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    let (kind, revision): (String, i64) = tx.query_row("SELECT kind,updated_at FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if kind != "page" && kind != "document" { bail!("only page and document versions are supported") }
    if revision != base { bail!("conflict: page revision changed") }
    let id = store::snapshot(&tx, page, "ai", None, Some(label.as_str()))?;
    tx.commit()?;
    Ok(serde_json::json!({"id": id, "pageId": page, "updatedAt": revision}))
}

/// Restores a version of a personal page or document with the original
/// restore operation, which first keeps the current state as a version, so a
/// later edit is never lost. The revision is compared first, the version must
/// belong to the page, and a block with properties the native apps cannot
/// represent is never discarded. The page must still be personal afterwards.
pub fn restore_version_checked(path: &Path, page: &str, base: i64, version: &str) -> Result<Value> {
    use std::collections::HashSet;
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    let (kind, revision): (String, i64) = tx.query_row("SELECT kind,updated_at FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if kind != "page" && kind != "document" { bail!("only page and document versions are supported") }
    if revision != base { bail!("conflict: page revision changed") }
    let owner: Option<String> = tx.query_row("SELECT page_id FROM versions WHERE id=?1", [version], |r| r.get(0)).optional()?;
    if owner.as_deref() != Some(page) { bail!("version unavailable") }
    let (_, snapshot) = store::version_snapshot(&tx, version)?;
    let blocks = snapshot.get("blocks").and_then(Value::as_array).ok_or_else(|| anyhow::anyhow!("invalid version"))?;
    let kept: HashSet<String> = blocks.iter().filter_map(|b| b.pointer("/attrs/bid").and_then(Value::as_str).map(str::to_owned)).collect();
    let current: Vec<(String, Option<String>)> = tx.prepare("SELECT id,properties FROM blocks WHERE page_id=?1")?
        .query_map([page], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    for (id, raw) in &current {
        if kept.contains(id) { continue }
        let properties: Value = raw.as_deref().map(|text| serde_json::from_str(text).unwrap_or(Value::Null)).unwrap_or_else(|| serde_json::json!({}));
        if !properties.as_object().is_some_and(|object| object.is_empty()) {
            bail!("unsupported edit: block has properties that cannot be discarded")
        }
    }
    store::restore_version(&tx, &native_ctx(), version)?;
    require_personal(&tx, page)?;
    let (title, updated): (String, i64) = tx.query_row("SELECT title,updated_at FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?, r.get(1)?)))?;
    tx.commit()?;
    Ok(serde_json::json!({"id": page, "title": title, "updatedAt": updated}))
}

/// Reparent a personal subtree after comparing its source location. The source
/// writer chooses the current end of the destination; it does not restore an
/// earlier sibling order and this operation is not an undo implementation.
pub fn move_page_checked(path:&Path,page:&str,base:i64,expected_parent:Option<String>,expected_sort:f64,destination:Option<String>,destination_revision:Option<i64>,operation_id:&str)->Result<Value> {
    if !expected_sort.is_finite() || destination.is_some()!=destination_revision.is_some() { bail!("invalid move request") }
    let operation_id=uuid::Uuid::parse_str(operation_id)?.to_string();
    let request=serde_json::json!({"page":page,"base":base,"expected_parent":expected_parent,"expected_sort":expected_sort,"destination":destination,"destination_revision":destination_revision}).to_string();
    let mut conn=open_existing(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx,page)?;
    if let Some(id)=destination.as_deref() { require_personal(&tx,id)?; }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS native_personal_page_moves_v1(operation_id TEXT PRIMARY KEY,request_json TEXT NOT NULL,page_id TEXT NOT NULL,result_json TEXT NOT NULL)")?;
    let previous:Option<(String,String,String)>=tx.query_row("SELECT request_json,page_id,result_json FROM native_personal_page_moves_v1 WHERE operation_id=?1",[&operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    if let Some((saved_request,saved_page,result))=previous {
        if saved_request!=request || saved_page!=page { bail!("conflict: move operation input changed") }
        let value:Value=serde_json::from_str(&result)?;
        if value.get("id").and_then(Value::as_str)!=Some(page) { bail!("conflict: invalid move record") }
        tx.commit()?; return Ok(value)
    }
    let (revision,parent,sort):(i64,Option<String>,f64)=tx.query_row("SELECT updated_at,parent_id,sort_key FROM pages WHERE id=?1",[page],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    if revision!=base || parent!=expected_parent || sort!=expected_sort { bail!("conflict: page location changed") }
    if destination==parent { bail!("invalid move request: destination unchanged") }
    if let (Some(id),Some(expected))=(destination.as_deref(),destination_revision) {
        let revision:i64=tx.query_row("SELECT updated_at FROM pages WHERE id=?1",[id],|r|r.get(0))?;
        if revision!=expected { bail!("conflict: destination changed") }
    }
    // Inspect every visible ancestor, not merely the UI snapshot. Missing,
    // shared, deleted, or cyclic ancestry is not a personal root.
    for start in [Some(page),destination.as_deref()].into_iter().flatten() {
        let mut seen=std::collections::HashSet::new(); let mut current=Some(start.to_owned());
        while let Some(id)=current {
            if !seen.insert(id.clone()) || seen.len()>128 { bail!("invalid page hierarchy: cycle or depth") }
            require_personal(&tx,&id)?;
            current=tx.query_row("SELECT parent_id FROM pages WHERE id=?1",[&id],|r|r.get(0))?;
        }
    }
    {
        let mut statement=tx.prepare("WITH RECURSIVE subtree(id) AS (SELECT id FROM pages WHERE id=?1 UNION SELECT p.id FROM pages p JOIN subtree s ON p.parent_id=s.id) SELECT id FROM subtree")?;
        let descendants=statement.query_map([page],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        if destination.as_ref().is_some_and(|id|descendants.contains(id)) { bail!("invalid page hierarchy: destination is in subtree") }
        for id in descendants { require_personal(&tx,&id)?; }
    }
    let value=serde_json::to_value(store::move_page(&tx,&native_ctx(),page,destination.as_deref(),None)?)?;
    tx.execute("INSERT INTO native_personal_page_moves_v1(operation_id,request_json,page_id,result_json) VALUES(?1,?2,?3,?4)",rusqlite::params![operation_id,request,page,value.to_string()])?;
    tx.commit()?; Ok(value)
}
#[derive(serde::Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum Request {
    SqliteInfo,
    #[cfg(any(debug_assertions, feature = "fixture-bundle"))]
    ImportFixtureAttachmentBundle { source: String, private_root: String },
    ImportLocalSnapshot { source: String, private_root: String },
    ValidateDrawingScene { scene: Value },
    LoadPersonalDrawing { path: String, page: String },
    ApplyPersonalDrawing { path: String, page: String, change: Value },
    AutomationDue { path: String },
    AutomationClaim { path: String, automation_id: String, expected_due: i64 },
    AutomationDecline { path: String, action_id: String },
    ReadResource { path: String, page: String },
    ReadPresentation { path: String, page: String },
    DeletedPresentationSlides { path: String, page: String },
    RestorePresentationSlide { path: String, page: String, recovery_id: String, base: i64, expected_metadata: Value, expected: Vec<BlockInput> },
    SavePresentation { path: String, page: String, base: i64, expected_metadata: Value, expected: Vec<BlockInput>, blocks: Vec<BlockInput>, #[serde(default)] deleting: Vec<String> },
    SaveProject { path: String, page: String, base: i64, expected_metadata: Value, metadata: Value },
    SaveStream { path: String, page: String, base: i64, expected_metadata: Value, url: String },
    SaveSpreadsheet { path: String, page: String, base: i64, expected_metadata: Value, metadata: Value },
    SaveGallery { path: String, page: String, base: i64, expected_metadata: Value, metadata: Value, expected: Vec<BlockInput>, blocks: Vec<BlockInput> },
    ImportLocalGalleryFile { path: String, source: String, page: String, base: i64, metadata: Value, expected: Vec<BlockInput>, operation_id: String },
    SaveBlocks { path: String, page: String, base: i64, blocks: Vec<BlockInput> },
    SaveBlocksChecked { path: String, page: String, base: i64, expected: Vec<BlockInput>, blocks: Vec<BlockInput> },
    SaveBlocksCheckedKind { path: String, page: String, base: i64, expected: Vec<BlockInput>, blocks: Vec<BlockInput>, expected_kind: String },
    RenamePage { path: String, page: String, base: i64, title: String },
    RenamePageChecked { path: String, page: String, base: i64, expected_title: String, title: String, operation_id: String },
    MovePageChecked { path: String, page: String, base: i64, expected_parent: Option<String>, expected_sort: f64, destination: Option<String>, destination_revision: Option<i64>, operation_id: String },
    CreatePage { path: String, title: String, parent: Option<String> },
    CreatePageIdempotent { path: String, title: String, parent: Option<String>, operation_id: String },
    CreateDocumentIdempotent { path: String, title: String, parent: Option<String>, parent_revision: Option<i64>, operation_id: String },
    CreateProjectIdempotent { path: String, title: String, parent: Option<String>, parent_revision: Option<i64>, operation_id: String },
    CreatePresentationIdempotent { path: String, title: String, parent: Option<String>, parent_revision: Option<i64>, operation_id: String },
    CreateGalleryIdempotent { path: String, title: String, parent: Option<String>, parent_revision: Option<i64>, operation_id: String },
    CreateDrawingIdempotent { path: String, title: String, parent: Option<String>, parent_revision: Option<i64>, operation_id: String },
    CreateStreamIdempotent { path: String, title: String, url: String, parent: Option<String>, parent_revision: Option<i64>, operation_id: String },
    TrashPage { path: String, page: String, base: i64 },
    RestorePageChecked { path: String, page: String, base: i64, deleted_at: i64 },
    CreateVersionChecked { path: String, page: String, base: i64, label: String },
    RestoreVersionChecked { path: String, page: String, base: i64, version: String },
}

pub struct GalleryCancellation(std::sync::atomic::AtomicU8);
impl GalleryCancellation {
    fn new() -> Self { Self(std::sync::atomic::AtomicU8::new(0)) }
    fn cancel(&self) { let _ = self.0.compare_exchange(0,1,std::sync::atomic::Ordering::AcqRel,std::sync::atomic::Ordering::Acquire); }
    fn check(&self) -> Result<()> { if self.0.load(std::sync::atomic::Ordering::Acquire)==1 { bail!("cancelled: gallery import") } Ok(()) }
    fn commit(&self) -> Result<()> { self.0.compare_exchange(0,2,std::sync::atomic::Ordering::AcqRel,std::sync::atomic::Ordering::Acquire).map(|_|()).map_err(|_|anyhow::anyhow!("cancelled: gallery import")) }
}

#[cfg(test)]
mod gallery_cancellation_tests {
    use super::GalleryCancellation;
    #[test]
    fn cancellation_and_commit_have_single_winner() {
        let cancelled=GalleryCancellation::new(); cancelled.cancel();
        assert!(cancelled.check().is_err()); assert!(cancelled.commit().is_err());
        let committed=GalleryCancellation::new(); committed.commit().unwrap(); committed.cancel();
        assert!(committed.check().is_ok());
    }
}

fn dispatch(bytes: &[u8]) -> Result<Value> { dispatch_inner(bytes,None) }
fn dispatch_inner(bytes: &[u8], cancellation: Option<&GalleryCancellation>) -> Result<Value> {
    let request: Request = serde_json::from_slice(bytes)?;
    match request {
        #[cfg(any(debug_assertions, feature = "fixture-bundle"))]
        Request::ImportFixtureAttachmentBundle { source, private_root } => {
            #[cfg(unix)] {
                let temp=std::env::temp_dir().canonicalize()?;
                let source_path=Path::new(&source); let root_path=Path::new(&private_root);
                let source_resolved=source_path.canonicalize()?; let root_resolved=root_path.canonicalize()?;
                if source_resolved == temp || root_resolved == temp || !source_resolved.starts_with(&temp) || !root_resolved.starts_with(&temp) { bail!("fixture-only temporary paths required") }
                let path=attachment_bundle::unix::prepare(source_path,root_path)?;
                Ok(serde_json::json!({"path":path.to_str().ok_or_else(||anyhow::anyhow!("non-UTF-8 destination"))?}))
            }
            #[cfg(not(unix))] { let _=(source,private_root); bail!("fixture bundle unsupported") }
        },
        Request::ImportLocalSnapshot { source, private_root } => {
            let path = isolated_import::import(Path::new(&source), Path::new(&private_root))?;
            Ok(serde_json::json!({"path": path.to_str().ok_or_else(|| anyhow::anyhow!("non-UTF-8 destination"))?}))
        },
        Request::LoadPersonalDrawing { path, page } => drawing::load_personal(Path::new(&path), &page),
        Request::ApplyPersonalDrawing { path, page, change } => drawing::apply_personal(Path::new(&path), &page, change),
        Request::ValidateDrawingScene { scene } => { drawing::drawing_scene::validate_scene(&scene)?; Ok(Value::Null) }
        Request::SqliteInfo => {
            let connection = Connection::open_in_memory()?;
            let fts5: i64 = connection.query_row("SELECT sqlite_compileoption_used('ENABLE_FTS5')", [], |row| row.get(0))?;
            Ok(serde_json::json!({ "version": rusqlite::version(), "fts5": fts5 == 1 }))
        }
        Request::AutomationDue { path } => automation_ops::due(Path::new(&path), db::now()),
        Request::AutomationClaim { path, automation_id, expected_due } => automation_ops::claim(Path::new(&path), &automation_id, expected_due, db::now()),
        Request::AutomationDecline { path, action_id } => automation_ops::decline(Path::new(&path), &action_id, db::now()),
        Request::ReadResource { path, page } => resource_ops::read_resource(Path::new(&path), &page),
        Request::ReadPresentation { path, page } => resource_ops::read_presentation(Path::new(&path), &page),
        Request::DeletedPresentationSlides { path, page } => resource_ops::deleted_presentation_slides(Path::new(&path), &page),
        Request::RestorePresentationSlide { path, page, recovery_id, base, expected_metadata, expected } => resource_ops::restore_presentation_slide(Path::new(&path), &page, &recovery_id, base, expected_metadata, expected),
        Request::SavePresentation { path, page, base, expected_metadata, expected, blocks, deleting } => resource_ops::save_presentation_deleting(Path::new(&path), &page, base, expected_metadata, expected, blocks, deleting),
        Request::SaveProject { path, page, base, expected_metadata, metadata } => resource_ops::save_project(Path::new(&path), &page, base, expected_metadata, metadata),
        Request::SaveStream { path, page, base, expected_metadata, url } => resource_ops::save_stream(Path::new(&path), &page, base, expected_metadata, &url),
        Request::SaveSpreadsheet { path, page, base, expected_metadata, metadata } => resource_ops::save_spreadsheet(Path::new(&path), &page, base, expected_metadata, metadata),
        Request::SaveGallery { path, page, base, expected_metadata, metadata, expected, blocks } => resource_ops::save_gallery(Path::new(&path), &page, base, expected_metadata, metadata, expected, blocks),
        Request::ImportLocalGalleryFile { path, source, page, base, metadata, expected, operation_id } => {
            #[cfg(unix)] {
                let database=Path::new(&path);
                let root=database.parent().ok_or_else(||anyhow::anyhow!("invalid local copy"))?;
                let name=root.file_name().and_then(|s|s.to_str()).ok_or_else(||anyhow::anyhow!("invalid local copy"))?;
                let suffix=name.strip_prefix("worlds-import-").ok_or_else(||anyhow::anyhow!("invalid local copy"))?;
                if !database.is_absolute() || database.file_name().and_then(|s|s.to_str()) != Some("worlds.db") || uuid::Uuid::parse_str(suffix).is_err() || !Path::new(&source).is_absolute() { bail!("invalid local copy") }
                match std::fs::symlink_metadata(root.join(".incomplete")) {
                    Err(e) if e.kind()==std::io::ErrorKind::NotFound => {},
                    _ => bail!("incomplete or unavailable local copy"),
                }
                if let Some(cancel)=cancellation {
                    gallery_file_import::unix::import_cancellable(root,Path::new(&source),&page,base,metadata,expected,&operation_id,cancel)
                } else {
                    gallery_file_import::unix::import_idempotent(root,Path::new(&source),&page,base,metadata,expected,&operation_id)
                }
            }
            #[cfg(not(unix))] { let _=(path,source,page,base,metadata,expected,operation_id); bail!("local gallery import is unavailable on this platform") }
        },
        Request::SaveBlocks { path, page, base, blocks } => save_blocks(Path::new(&path), &page, base, blocks),
        Request::SaveBlocksChecked { path, page, base, expected, blocks } => save_blocks_checked(Path::new(&path), &page, base, expected, blocks),
        Request::SaveBlocksCheckedKind { path, page, base, expected, blocks, expected_kind } => save_blocks_checked_kind(Path::new(&path), &page, base, expected, blocks, &expected_kind),
        Request::RenamePage { path, page, base, title } => rename_page(Path::new(&path), &page, base, title),
        Request::RenamePageChecked { path, page, base, expected_title, title, operation_id } => rename_page_checked(Path::new(&path), &page, base, expected_title, title, &operation_id),
        Request::MovePageChecked { path, page, base, expected_parent, expected_sort, destination, destination_revision, operation_id } => move_page_checked(Path::new(&path), &page, base, expected_parent, expected_sort, destination, destination_revision, &operation_id),
        Request::CreatePage { path, title, parent } => create_page(Path::new(&path), title, parent),
        Request::CreatePageIdempotent { path, title, parent, operation_id } => create_page_idempotent(Path::new(&path), title, parent, &operation_id),
        Request::CreateDocumentIdempotent { path, title, parent, parent_revision, operation_id } => create_document_idempotent(Path::new(&path), title, parent, parent_revision, &operation_id),
        Request::CreateProjectIdempotent { path, title, parent, parent_revision, operation_id } => create_project_idempotent(Path::new(&path), title, parent, parent_revision, &operation_id),
        Request::CreatePresentationIdempotent { path, title, parent, parent_revision, operation_id } => create_presentation_idempotent(Path::new(&path), title, parent, parent_revision, &operation_id),
        Request::CreateGalleryIdempotent { path, title, parent, parent_revision, operation_id } => create_gallery_idempotent(Path::new(&path), title, parent, parent_revision, &operation_id),
        Request::CreateDrawingIdempotent { path, title, parent, parent_revision, operation_id } => create_drawing_idempotent(Path::new(&path), title, parent, parent_revision, &operation_id),
        Request::CreateStreamIdempotent { path, title, url, parent, parent_revision, operation_id } => create_stream_idempotent(Path::new(&path), title, url, parent, parent_revision, &operation_id),
        Request::TrashPage { path, page, base } => { trash_page(Path::new(&path), &page, base)?; Ok(Value::Null) }
        Request::RestorePageChecked { path, page, base, deleted_at } => restore_page_checked(Path::new(&path), &page, base, deleted_at),
        Request::CreateVersionChecked { path, page, base, label } => create_version_checked(Path::new(&path), &page, base, label),
        Request::RestoreVersionChecked { path, page, base, version } => restore_version_checked(Path::new(&path), &page, base, &version),
    }
}

/// Token must remain alive until the call and concurrent cancellation have returned.
#[no_mangle]
pub extern "C" fn worlds_gallery_cancel_new() -> *mut GalleryCancellation { Box::into_raw(Box::new(GalleryCancellation::new())) }
#[no_mangle]
pub unsafe extern "C" fn worlds_gallery_cancel(token: *const GalleryCancellation) { if let Some(token)=token.as_ref() { token.cancel(); } }
#[no_mangle]
pub unsafe extern "C" fn worlds_gallery_cancel_free(token: *mut GalleryCancellation) { if !token.is_null() { drop(Box::from_raw(token)); } }
#[no_mangle]
pub unsafe extern "C" fn worlds_gallery_call(request: *const u8, length: usize, token: *const GalleryCancellation) -> *mut std::ffi::c_char {
    let result=std::panic::catch_unwind(|| {
        if request.is_null() || token.is_null() || length==0 || length>8*1024*1024 { return serde_json::json!({"ok":false,"error":"invalid request size"}); }
        let bytes=std::slice::from_raw_parts(request,length);
        let operation: Result<Request, _> = serde_json::from_slice(bytes);
        if !matches!(operation,Ok(Request::ImportLocalGalleryFile { .. })) { return serde_json::json!({"ok":false,"error":"invalid gallery request"}); }
        match dispatch_inner(bytes,token.as_ref()) {
            Ok(value)=>serde_json::json!({"ok":true,"value":value}),
            Err(error)=>serde_json::json!({"ok":false,"error":format!("{error:#}")}),
        }
    }).unwrap_or_else(|_|serde_json::json!({"ok":false,"error":"store operation failed"}));
    std::ffi::CString::new(result.to_string()).expect("JSON escapes NUL").into_raw()
}

/// C ABI: request must point to `length` readable bytes for this call. The
/// returned UTF-8 JSON string is owned by Rust and must be freed exactly once
/// with `worlds_store_free`. Concurrent calls use independent connections.
#[no_mangle]
pub unsafe extern "C" fn worlds_store_call(request: *const u8, length: usize) -> *mut std::ffi::c_char {
    let result = std::panic::catch_unwind(|| {
        if request.is_null() || length == 0 || length > 8 * 1024 * 1024 {
            return serde_json::json!({"ok":false,"error":"invalid request size"});
        }
        let bytes = std::slice::from_raw_parts(request, length);
        match dispatch(bytes) {
            Ok(value) => serde_json::json!({"ok":true,"value":value}),
            Err(error) => serde_json::json!({"ok":false,"error":format!("{error:#}")}),
        }
    }).unwrap_or_else(|_| serde_json::json!({"ok":false,"error":"store operation failed"}));
    std::ffi::CString::new(result.to_string()).expect("JSON escapes NUL").into_raw()
}

/// `response` must be null or a live pointer returned by worlds_store_call.
#[no_mangle]
pub unsafe extern "C" fn worlds_store_free(response: *mut std::ffi::c_char) {
    if !response.is_null() { drop(std::ffi::CString::from_raw(response)); }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let original = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db");
        let dir = std::env::temp_dir().canonicalize().unwrap_or_else(|_| std::env::temp_dir());
        let path = dir.join(format!("worlds-isolated-{}.db", uuid::Uuid::new_v4()));
        std::fs::copy(original, &path).unwrap();
        path
    }
    #[test]
    fn rejects_duplicate_metadata_at_any_depth_before_personal_access() {
        let path = fixture();
        let cases = [r#"{"sync":{"shared":true,"shared":false}}"#, r#"{"sync":{"shared":true},"sync":{"shared":false}}"#, r#"{"other":{"x":1,"x":2}}"#];
        for metadata in cases {
            let c = Connection::open(&path).unwrap();
            c.execute("UPDATE pages SET metadata=?1 WHERE id='fixture-page'", [metadata]).unwrap();
            assert!(require_personal(&c, "fixture-page").is_err());
            drop(c);
            assert!(rename_page(&path, "fixture-page", 1700000000001, "Unsafe".into()).is_err());
            let c = Connection::open(&path).unwrap();
            let after: String = c.query_row("SELECT metadata FROM pages WHERE id='fixture-page'", [], |r| r.get(0)).unwrap();
            assert_eq!(after, metadata);
        }
        let c = Connection::open(&path).unwrap();
        let title: String = c.query_row("SELECT title FROM pages WHERE id='fixture-page'", [], |r| r.get(0)).unwrap();
        assert_ne!(title, "Unsafe");
        for metadata in [r#"{}"#, r#"{"sync":{}}"#, r#"{"sync":{"shared":false}}"#] {
            c.execute("UPDATE pages SET metadata=?1 WHERE id='fixture-page'", [metadata]).unwrap();
            assert!(require_personal(&c, "fixture-page").is_ok());
        }
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn save_updates_rust_store_indexes_and_history_and_rejects_conflicts() {
        let path=fixture();
        let result=save_blocks(&path,"fixture-page",1700000000001,vec![BlockInput{id:"fixture-block".into(),content:serde_json::json!({"type":"paragraph","content":[{"type":"text","text":"searchable new text"}]})}]).unwrap();
        assert_eq!(result["changed"],1);
        let c=Connection::open(&path).unwrap();
        let content:String=c.query_row("SELECT text FROM blocks WHERE id='fixture-block'",[],|r|r.get(0)).unwrap();
        assert_eq!(content,"searchable new text");
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='edited'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='fixture-page' AND kind='blocks'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'searchable'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(c);
        assert!(save_blocks(&path,"fixture-page",1700000000001,vec![]).is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn create_rename_and_trash_personal_page_through_store() {
        let path=fixture();
        let created=create_page(&path, "Draft".into(), Some("fixture-page".into())).unwrap();
        let id=created["id"].as_str().unwrap();
        let base=created["updatedAt"].as_i64().unwrap();
        let renamed=rename_page(&path, id, base, "Updated".into()).unwrap();
        assert_eq!(renamed["title"], "Updated");
        trash_page(&path, id, renamed["updatedAt"].as_i64().unwrap()).unwrap();
        let c=Connection::open(&path).unwrap();
        let deleted:Option<i64>=c.query_row("SELECT deleted_at FROM pages WHERE id=?1",[id],|r|r.get(0)).unwrap();
        assert!(deleted.is_some());
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),3);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_rename_retries_without_duplicate_history_and_refuses_same_revision_change() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let (old,base):(String,i64)=db.query_row("SELECT title,updated_at FROM pages WHERE id='fixture-page'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let first=rename_page_checked(&path,"fixture-page",base,old.clone(),"Renamedfixture".into(),&op).unwrap();
        let retry=rename_page_checked(&path,"fixture-page",base,old.clone(),"Renamedfixture".into(),&op).unwrap();
        assert_eq!(retry,first);
        assert!(rename_page_checked(&path,"fixture-page",base,old.clone(),"Different".into(),&op).is_err());
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='renamed'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Renamedfixture'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        // A conflicting name with unchanged updated_at must not be overwritten.
        db.execute("UPDATE pages SET title='Other',updated_at=?1 WHERE id='fixture-page'",[base]).unwrap();
        let another=uuid::Uuid::new_v4().to_string();
        assert!(rename_page_checked(&path,"fixture-page",base,old.clone(),"Overwrite".into(),&another).is_err());
        assert_eq!(db.query_row("SELECT title FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,String>(0)).unwrap(),"Other");
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        assert!(rename_page_checked(&path,"fixture-page",base,old,"Renamedfixture".into(),&op).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_rename_rolls_back_page_history_fts_and_changes() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let (old,base):(String,i64)=db.query_row("SELECT title,updated_at FROM pages WHERE id='fixture-page'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        db.execute_batch("CREATE TABLE native_personal_page_renames_v1(operation_id TEXT PRIMARY KEY,page_id TEXT NOT NULL,base INTEGER NOT NULL,expected_title TEXT NOT NULL,title TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_rename_record BEFORE INSERT ON native_personal_page_renames_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let before:(i64,i64)=db.query_row("SELECT (SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        assert!(rename_page_checked(&path,"fixture-page",base,old.clone(),"Rollbackuniquerename".into(),&op).is_err());
        let after:(i64,i64)=db.query_row("SELECT (SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(before,after);
        assert_eq!(db.query_row("SELECT title FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,String>(0)).unwrap(),old);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Rollbackuniquerename'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_rename_record;").unwrap();
        assert!(rename_page_checked(&path,"fixture-page",base,old,"Rollbackuniquerename".into(),&op).is_ok());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_rename_rejects_canonically_equivalent_but_distinct_utf8() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let base:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let decomposed="e\u{301}"; let composed="\u{e9}";
        db.execute("UPDATE pages SET title=?1 WHERE id='fixture-page'",[decomposed]).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        assert!(rename_page_checked(&path,"fixture-page",base,composed.into(),"Overwrite".into(),&op).is_err());
        let current:String=db.query_row("SELECT title FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        assert_eq!(current.as_bytes(),decomposed.as_bytes());
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='renamed'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_checked_rename_retries_same_operation() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let (old,base):(String,i64)=db.query_row("SELECT title,updated_at FROM pages WHERE id='fixture-page'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        let request=serde_json::json!({"operation":"rename_page_checked","path":path,"page":"fixture-page","base":base,"expected_title":old,"title":"FFIrenamefixture","operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=|| { let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) }; let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap(); unsafe { worlds_store_free(response) }; parsed };
        let first=invoke(); let second=invoke(); assert_eq!(first["ok"],true,"{first}"); assert_eq!(first,second);
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='renamed'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn idempotent_page_create_retries_after_commit_and_refuses_changed_inputs() {
        let path=fixture(); let operation=uuid::Uuid::new_v4().to_string();
        // Simulate losing the successful response after its transaction commits.
        let first=create_page_idempotent(&path,"Distinctive fixture".into(),Some("fixture-page".into()),&operation).unwrap();
        let retried=create_page_idempotent(&path,"Distinctive fixture".into(),Some("fixture-page".into()),&operation).unwrap();
        assert_eq!(retried,first);
        assert!(create_page_idempotent(&path,"Changed".into(),Some("fixture-page".into()),&operation).is_err());
        assert!(create_page_idempotent(&path,"Distinctive fixture".into(),None,&operation).is_err());
        let db=Connection::open(&path).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='Distinctive fixture'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        let id=first["id"].as_str().unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id=?1 AND kind='created'",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM changes WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Distinctive'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id=?1",[id]).unwrap();
        assert!(create_page_idempotent(&path,"Distinctive fixture".into(),Some("fixture-page".into()),&operation).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn idempotent_page_create_rolls_back_page_history_fts_and_changes() {
        let path=fixture(); let operation=uuid::Uuid::new_v4().to_string();
        let db=Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE native_personal_page_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_creation_record BEFORE INSERT ON native_personal_page_creations_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let before: (i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert!(create_page_idempotent(&path,"Rollbackuniquefixture".into(),Some("fixture-page".into()),&operation).is_err());
        let after: (i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(before,after);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Rollbackuniquefixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_creation_record;").unwrap();
        assert!(create_page_idempotent(&path,"Rollbackuniquefixture".into(),Some("fixture-page".into()),&operation).is_ok());
        drop(db); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_idempotent_page_create_retries_same_operation() {
        let path=fixture(); let operation=uuid::Uuid::new_v4().to_string();
        let request=serde_json::json!({"operation":"create_page_idempotent","path":path,"title":"FFI fixture","parent":"fixture-page","operation_id":operation}).to_string();
        let invoke=|| {
            let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };
            let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();
            unsafe { worlds_store_free(response) }; parsed
        };
        let first=invoke(); let second=invoke();
        assert_eq!(first["ok"],true,"{first}"); assert_eq!(second,first);
        let db=Connection::open(&path).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='FFI fixture'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn document_create_matches_source_defaults_and_retries_without_duplicates() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let first=create_document_idempotent(&path,"Fixture document".into(),Some("fixture-page".into()),Some(revision),&op).unwrap();
        let replay=create_document_idempotent(&path,"Fixture document".into(),Some("fixture-page".into()),Some(revision),&op).unwrap();
        assert_eq!(first,replay); assert_eq!(first["kind"],"document");
        let id=first["id"].as_str().unwrap();
        let (icon,metadata):(String,String)=db.query_row("SELECT icon,metadata FROM pages WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(icon,"pi:document");
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(),serde_json::json!({"doc":{"size":"A4","orientation":"portrait","margins":{"top":25,"right":22,"bottom":25,"left":22},"header":"","footer":"","font":"Default","fontSize":12,"lineHeight":1.5}}));
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='Fixture document'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM blocks WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id=?1 AND kind='created'",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(create_document_idempotent(&path,"Other".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        assert!(create_page_idempotent(&path,"Fixture document".into(),Some("fixture-page".into()),&op).is_err());
        let page_op=uuid::Uuid::new_v4().to_string();
        create_page_idempotent(&path,"Fixture page".into(),None,&page_op).unwrap();
        assert!(create_document_idempotent(&path,"Fixture page".into(),None,None,&page_op).is_err());
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        assert!(create_document_idempotent(&path,"Fixture document".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn document_create_rejects_changed_parent_and_rolls_back_all_writes() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        assert!(create_document_idempotent(&path,"Doc".into(),Some("fixture-page".into()),Some(revision+1),&op).is_err());
        assert!(create_document_idempotent(&path,"Doc".into(),Some("fixture-page".into()),None,&op).is_err());
        db.execute_batch("CREATE TABLE native_personal_document_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_document_record BEFORE INSERT ON native_personal_document_creations_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let before:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert!(create_document_idempotent(&path,"Documentrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let after:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(before,after);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Documentrollbackfixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_document_record;").unwrap();
        assert!(create_document_idempotent(&path,"Documentrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_ok());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_document_create_replays_same_operation() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let request=serde_json::json!({"operation":"create_document_idempotent","path":path,"title":"FFI document","parent":"fixture-page","parent_revision":revision,"operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=|| { let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) }; let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap(); unsafe { worlds_store_free(response) };parsed };
        let first=invoke(); let replay=invoke(); assert_eq!(first["ok"],true,"{first}");assert_eq!(first,replay);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='FFI document' AND kind='document'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn project_create_preserves_source_defaults_and_idempotency() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let first=create_project_idempotent(&path,"Fixture project".into(),Some("fixture-page".into()),Some(revision),&op).unwrap();
        assert_eq!(first,create_project_idempotent(&path,"Fixture project".into(),Some("fixture-page".into()),Some(revision),&op).unwrap());
        let id=first["id"].as_str().unwrap();
        let (kind,icon,metadata):(String,String,String)=db.query_row("SELECT kind,icon,metadata FROM pages WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(kind,"project");assert_eq!(icon,"pi:briefcase");
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(),serde_json::json!({"project":{"status":"active","start":null,"due":null,"description":"","links":[]}}));
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id=?1 AND kind='created'",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='Fixture project'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(create_project_idempotent(&path,"Different".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        assert!(create_page_idempotent(&path,"Fixture project".into(),Some("fixture-page".into()),&op).is_err());
        assert!(create_document_idempotent(&path,"Fixture project".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let page_op=uuid::Uuid::new_v4().to_string();create_page_idempotent(&path,"page".into(),None,&page_op).unwrap();
        assert!(create_project_idempotent(&path,"page".into(),None,None,&page_op).is_err());
        let doc_op=uuid::Uuid::new_v4().to_string();create_document_idempotent(&path,"doc".into(),None,None,&doc_op).unwrap();
        assert!(create_project_idempotent(&path,"doc".into(),None,None,&doc_op).is_err());
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        assert!(create_project_idempotent(&path,"Fixture project".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn project_create_checks_parent_and_rolls_back_all_writes() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        assert!(create_project_idempotent(&path,"Project".into(),Some("fixture-page".into()),Some(revision+1),&op).is_err());
        assert!(create_project_idempotent(&path,"Project".into(),Some("fixture-page".into()),None,&op).is_err());
        db.execute_batch("CREATE TABLE native_personal_project_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_project_record BEFORE INSERT ON native_personal_project_creations_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let before:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert!(create_project_idempotent(&path,"Projectrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let after:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();assert_eq!(before,after);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Projectrollbackfixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_project_record;").unwrap();
        assert!(create_project_idempotent(&path,"Projectrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_ok());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_project_create_replays_same_operation() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let request=serde_json::json!({"operation":"create_project_idempotent","path":path,"title":"FFI project","operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=|| { let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();unsafe { worlds_store_free(response) };parsed };
        let first=invoke();let replay=invoke();assert_eq!(first["ok"],true,"{first}");assert_eq!(first,replay);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='FFI project' AND kind='project'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn stream_create_formats_replay_and_collisions() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let rev:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let make=|url:&str| create_stream_idempotent(&path,"Stream".into(),url.into(),Some("fixture-page".into()),Some(rev),&op);
        let first=make("  https://example.test/Live.M3U8?key=fixture  ").unwrap();
        assert_eq!(first,make("https://example.test/Live.M3U8?key=fixture").unwrap());
        assert!(make("https://example.test/other").is_err());
        let id=first["id"].as_str().unwrap();
        let (kind,icon,meta):(String,String,String)=db.query_row("SELECT kind,icon,metadata FROM pages WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(kind,"stream");assert_eq!(icon,"pi:film");assert_eq!(serde_json::from_str::<Value>(&meta).unwrap(),serde_json::json!({"stream":{"url":"https://example.test/Live.M3U8?key=fixture","format":"hls"}}));
        assert!(create_gallery_idempotent(&path,"other".into(),None,None,&op).is_err());
        for (url,format) in [("https://example.test/x.m3u#frag","hls"),("https://example.test/x.MPD?x=1","dash"),("http://example.test/x.mp4","progressive")] {
            let v=create_stream_idempotent(&path,"format".into(),url.into(),None,None,&uuid::Uuid::new_v4().to_string()).unwrap();
            let raw:String=db.query_row("SELECT metadata FROM pages WHERE id=?1",[v["id"].as_str().unwrap()],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["stream"]["format"],format);
        }
        for url in ["file:///secret", "javascript:alert(1)","https://", "https://example.test/\nfoo"] { assert!(create_stream_idempotent(&path,"bad".into(),url.into(),None,None,&uuid::Uuid::new_v4().to_string()).is_err()); }
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();assert!(make("https://example.test/Live.M3U8?key=fixture").is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn stream_create_rolls_back_and_checks_parent() {
        let path=fixture();let db=Connection::open(&path).unwrap();let rev:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();let op=uuid::Uuid::new_v4().to_string();
        let run=|base| create_stream_idempotent(&path,"Streamrollbackfixture".into(),"https://example.test/live".into(),Some("fixture-page".into()),base,&op);
        assert!(run(Some(rev+1)).is_err());assert!(run(None).is_err());
        db.execute_batch("CREATE TABLE native_personal_stream_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_stream_record BEFORE INSERT ON native_personal_stream_creations_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let counts=||db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?))).unwrap();let before=counts();assert!(run(Some(rev)).is_err());assert_eq!(before,counts());assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Streamrollbackfixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_stream_record").unwrap();assert!(run(Some(rev)).is_ok());drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_stream_create_replays() {
        let path=fixture();let request=serde_json::json!({"operation":"create_stream_idempotent","path":path,"title":"FFI stream","url":"https://example.test/video.mpd","operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=||{let p=unsafe{worlds_store_call(request.as_ptr(),request.len())};let v:Value=serde_json::from_str(unsafe{std::ffi::CStr::from_ptr(p)}.to_str().unwrap()).unwrap();unsafe{worlds_store_free(p)};v};let first=invoke();assert_eq!(first["ok"],true,"{first}");assert_eq!(first,invoke());std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn gallery_create_preserves_source_defaults_and_idempotency() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let first=create_gallery_idempotent(&path,"Fixture gallery".into(),Some("fixture-page".into()),Some(revision),&op).unwrap();
        assert_eq!(first,create_gallery_idempotent(&path,"Fixture gallery".into(),Some("fixture-page".into()),Some(revision),&op).unwrap());
        let id=first["id"].as_str().unwrap();
        let (kind,icon,metadata):(String,String,String)=db.query_row("SELECT kind,icon,metadata FROM pages WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(kind,"gallery");assert_eq!(icon,"pi:image");
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(),serde_json::json!({"gallery":{"view":"grid"}}));
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id=?1 AND kind='created'",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='Fixture gallery'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(create_gallery_idempotent(&path,"Different".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        assert!(create_page_idempotent(&path,"Fixture gallery".into(),Some("fixture-page".into()),&op).is_err());
        assert!(create_document_idempotent(&path,"Fixture gallery".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let page_op=uuid::Uuid::new_v4().to_string();create_page_idempotent(&path,"page".into(),None,&page_op).unwrap();
        assert!(create_gallery_idempotent(&path,"page".into(),None,None,&page_op).is_err());
        let doc_op=uuid::Uuid::new_v4().to_string();create_document_idempotent(&path,"doc".into(),None,None,&doc_op).unwrap();
        assert!(create_gallery_idempotent(&path,"doc".into(),None,None,&doc_op).is_err());
        let project_op=uuid::Uuid::new_v4().to_string();create_project_idempotent(&path,"project".into(),None,None,&project_op).unwrap();
        assert!(create_gallery_idempotent(&path,"project".into(),None,None,&project_op).is_err());
        let deck_op=uuid::Uuid::new_v4().to_string();create_presentation_idempotent(&path,"deck".into(),None,None,&deck_op).unwrap();
        assert!(create_gallery_idempotent(&path,"deck".into(),None,None,&deck_op).is_err());
        assert!(create_project_idempotent(&path,"Fixture gallery".into(),None,None,&op).is_err());
        assert!(create_presentation_idempotent(&path,"Fixture gallery".into(),None,None,&op).is_err());
        assert_eq!(db.query_row("SELECT count(*) FROM blocks WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        assert!(create_gallery_idempotent(&path,"Fixture gallery".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn gallery_create_checks_parent_and_rolls_back_all_writes() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        assert!(create_gallery_idempotent(&path,"Gallery".into(),Some("fixture-page".into()),Some(revision+1),&op).is_err());
        assert!(create_gallery_idempotent(&path,"Gallery".into(),Some("fixture-page".into()),None,&op).is_err());
        db.execute_batch("CREATE TABLE native_personal_gallery_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_gallery_record BEFORE INSERT ON native_personal_gallery_creations_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let before:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert!(create_gallery_idempotent(&path,"Galleryrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let after:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();assert_eq!(before,after);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Galleryrollbackfixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_gallery_record;").unwrap();
        assert!(create_gallery_idempotent(&path,"Galleryrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_ok());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_gallery_create_replays_same_operation() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let request=serde_json::json!({"operation":"create_gallery_idempotent","path":path,"title":"FFI gallery","operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=|| { let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();unsafe { worlds_store_free(response) };parsed };
        let first=invoke();let replay=invoke();assert_eq!(first["ok"],true,"{first}");assert_eq!(first,replay);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='FFI gallery' AND kind='gallery'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn drawing_create_preserves_source_defaults_and_idempotency() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let first=create_drawing_idempotent(&path,"Fixture drawing".into(),Some("fixture-page".into()),Some(revision),&op).unwrap();
        assert_eq!(first,create_drawing_idempotent(&path,"Fixture drawing".into(),Some("fixture-page".into()),Some(revision),&op).unwrap());
        let id=first["id"].as_str().unwrap();
        let (kind,icon,metadata):(String,String,String)=db.query_row("SELECT kind,icon,metadata FROM pages WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(kind,"drawing");assert_eq!(icon,"pi:paintbrush");
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(),serde_json::json!({}));
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id=?1 AND kind='created'",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='Fixture drawing'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(create_drawing_idempotent(&path,"Different".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        assert!(create_page_idempotent(&path,"Fixture drawing".into(),Some("fixture-page".into()),&op).is_err());
        assert!(create_document_idempotent(&path,"Fixture drawing".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let page_op=uuid::Uuid::new_v4().to_string();create_page_idempotent(&path,"page".into(),None,&page_op).unwrap();
        assert!(create_drawing_idempotent(&path,"page".into(),None,None,&page_op).is_err());
        let doc_op=uuid::Uuid::new_v4().to_string();create_document_idempotent(&path,"doc".into(),None,None,&doc_op).unwrap();
        assert!(create_drawing_idempotent(&path,"doc".into(),None,None,&doc_op).is_err());
        let gallery_op=uuid::Uuid::new_v4().to_string();create_gallery_idempotent(&path,"gallery".into(),None,None,&gallery_op).unwrap();
        assert!(create_drawing_idempotent(&path,"gallery".into(),None,None,&gallery_op).is_err());
        let project_op=uuid::Uuid::new_v4().to_string();create_project_idempotent(&path,"project".into(),None,None,&project_op).unwrap();
        assert!(create_drawing_idempotent(&path,"project".into(),None,None,&project_op).is_err());
        let deck_op=uuid::Uuid::new_v4().to_string();create_presentation_idempotent(&path,"deck".into(),None,None,&deck_op).unwrap();
        assert!(create_drawing_idempotent(&path,"deck".into(),None,None,&deck_op).is_err());
        assert!(create_project_idempotent(&path,"Fixture drawing".into(),None,None,&op).is_err());
        assert!(create_presentation_idempotent(&path,"Fixture drawing".into(),None,None,&op).is_err());
        assert_eq!(db.query_row("SELECT count(*) FROM blocks WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),0);
        let loaded=drawing::load_personal(&path,id).unwrap();
        assert_eq!(loaded["revision"],0); assert_eq!(loaded["scene"],drawing::drawing_scene::initial_scene(id));
        assert_eq!(loaded["seed"],loaded["scene"]); assert_eq!(loaded["operations"],serde_json::json!([]));
        assert_eq!(db.query_row("SELECT count(*) FROM drawing_documents WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(db.query_row("SELECT count(*) FROM attachments WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),0);
        let actor=store::profile(&db).unwrap().id;
        let layer=loaded["scene"]["layerOrder"][0].as_str().unwrap();
        let edit_op=serde_json::json!({"id":"op-first","actor":actor,"base":0,"at":1,"label":"Rename","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Ink"}}]});
        let changed=drawing::apply_personal(&path,id,edit_op).unwrap();assert_eq!(changed["revision"],1);assert_eq!(changed["scene"]["layers"][layer]["name"],"Ink");assert_eq!(drawing::load_personal(&path,id).unwrap(),changed);
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        assert!(create_drawing_idempotent(&path,"Fixture drawing".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn drawing_create_checks_parent_and_rolls_back_all_writes() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        assert!(create_drawing_idempotent(&path,"Drawing".into(),Some("fixture-page".into()),Some(revision+1),&op).is_err());
        assert!(create_drawing_idempotent(&path,"Drawing".into(),Some("fixture-page".into()),None,&op).is_err());
        db.execute_batch("CREATE TABLE native_personal_drawing_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_drawing_record BEFORE INSERT ON native_personal_drawing_creations_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let before:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert!(create_drawing_idempotent(&path,"Drawingrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let after:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();assert_eq!(before,after);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Drawingrollbackfixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_drawing_record;").unwrap();
        assert!(create_drawing_idempotent(&path,"Drawingrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_ok());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_drawing_create_replays_same_operation() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let request=serde_json::json!({"operation":"create_drawing_idempotent","path":path,"title":"FFI drawing","operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=|| { let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();unsafe { worlds_store_free(response) };parsed };
        let first=invoke();let replay=invoke();assert_eq!(first["ok"],true,"{first}");assert_eq!(first,replay);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='FFI drawing' AND kind='drawing'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn presentation_create_preserves_source_defaults_and_idempotency() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let first=create_presentation_idempotent(&path,"Fixture presentation".into(),Some("fixture-page".into()),Some(revision),&op).unwrap();
        assert_eq!(first,create_presentation_idempotent(&path,"Fixture presentation".into(),Some("fixture-page".into()),Some(revision),&op).unwrap());
        let id=first["id"].as_str().unwrap();
        let (kind,icon,metadata):(String,String,String)=db.query_row("SELECT kind,icon,metadata FROM pages WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(kind,"presentation");assert_eq!(icon,"pi:presentation");
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(),serde_json::json!({"deck":{"aspect":"16:9","theme":"dark"}}));
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id=?1 AND kind='created'",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        let content:String=db.query_row("SELECT content FROM blocks WHERE page_id=?1",[id],|r|r.get(0)).unwrap();
        let slide:Value=serde_json::from_str(&content).unwrap();
        assert_eq!(slide["type"],"slide");assert_eq!(slide["attrs"]["layout"],"title");assert_eq!(slide["attrs"]["background"]["color"],"#16161a");
        assert_eq!(slide["attrs"]["elements"][0]["style"]["fontSize"],76);assert_eq!(slide["attrs"]["elements"][1]["style"]["color"],"rgba(244, 242, 238, 0.66)");
        assert_eq!(db.query_row("SELECT count(*) FROM blocks WHERE page_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='Fixture presentation'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(create_presentation_idempotent(&path,"Different".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        assert!(create_page_idempotent(&path,"Fixture presentation".into(),Some("fixture-page".into()),&op).is_err());
        assert!(create_document_idempotent(&path,"Fixture presentation".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let page_op=uuid::Uuid::new_v4().to_string();create_page_idempotent(&path,"page".into(),None,&page_op).unwrap();
        assert!(create_presentation_idempotent(&path,"page".into(),None,None,&page_op).is_err());
        let doc_op=uuid::Uuid::new_v4().to_string();create_document_idempotent(&path,"doc".into(),None,None,&doc_op).unwrap();
        assert!(create_presentation_idempotent(&path,"doc".into(),None,None,&doc_op).is_err());
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        assert!(create_presentation_idempotent(&path,"Fixture presentation".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn presentation_create_checks_parent_and_rolls_back_all_writes() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let revision:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        assert!(create_presentation_idempotent(&path,"Presentation".into(),Some("fixture-page".into()),Some(revision+1),&op).is_err());
        assert!(create_presentation_idempotent(&path,"Presentation".into(),Some("fixture-page".into()),None,&op).is_err());
        db.execute_batch("CREATE TABLE native_personal_presentation_creations_v1(operation_id TEXT PRIMARY KEY,title TEXT NOT NULL,parent_id TEXT,parent_revision INTEGER,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_presentation_record BEFORE INSERT ON native_personal_presentation_creations_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let before:(i64,i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes),(SELECT count(*) FROM blocks)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert!(create_presentation_idempotent(&path,"Presentationrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_err());
        let after:(i64,i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM history),(SELECT count(*) FROM changes),(SELECT count(*) FROM blocks)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();assert_eq!(before,after);
        assert_eq!(db.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Presentationrollbackfixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_presentation_record;").unwrap();
        assert!(create_presentation_idempotent(&path,"Presentationrollbackfixture".into(),Some("fixture-page".into()),Some(revision),&op).is_ok());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_presentation_create_replays_same_operation() {
        let path=fixture();let db=Connection::open(&path).unwrap();
        let request=serde_json::json!({"operation":"create_presentation_idempotent","path":path,"title":"FFI presentation","operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=|| { let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();unsafe { worlds_store_free(response) };parsed };
        let first=invoke();let replay=invoke();assert_eq!(first["ok"],true,"{first}");assert_eq!(first,replay);
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE title='FFI presentation' AND kind='presentation'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_rename_uses_real_store() {
        let path=fixture();
        let request=serde_json::json!({"operation":"rename_page","path":path,"page":"fixture-page","base":1700000000001_i64,"title":"FFI title"}).to_string();
        let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };
        let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();
        unsafe { worlds_store_free(response) };
        assert_eq!(parsed["ok"],true, "{parsed}");
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT title FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,String>(0)).unwrap(),"FFI title");
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn trash_rejects_subtree_with_shared_child_without_changes() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        let base:i64=c.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        c.execute("INSERT INTO pages(id,title,parent_id,workspace_id,created_at,updated_at) VALUES('child','Child','fixture-page','team',1,2)",[]).unwrap();
        drop(c);
        assert!(trash_page(&path,"fixture-page",base).is_err());
        let c=Connection::open(&path).unwrap();
        let deleted:Option<i64>=c.query_row("SELECT deleted_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        assert!(deleted.is_none());
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn trash_rejects_cyclic_hierarchy_and_wrong_revision_without_changes() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let base:i64=db.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        db.execute("INSERT INTO pages(id,title,parent_id,created_at,updated_at) VALUES('child','Child','fixture-page',1,2)",[]).unwrap();
        db.execute("UPDATE pages SET parent_id='child' WHERE id='fixture-page'",[]).unwrap();
        let err=trash_page(&path,"fixture-page",base).unwrap_err().to_string();
        assert!(err.contains("cycle"),"{err}");
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE id IN ('fixture-page','child') AND deleted_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='deleted'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute("UPDATE pages SET parent_id=NULL WHERE id='fixture-page'",[]).unwrap();
        assert!(trash_page(&path,"fixture-page",base+1).unwrap_err().to_string().contains("conflict"));
        assert_eq!(db.query_row("SELECT count(*) FROM pages WHERE id IN ('fixture-page','child') AND deleted_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        drop(db); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_move_rejects_stale_location_shared_subtree_and_cycles() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let (base,sort):(i64,f64)=db.query_row("SELECT updated_at,sort_key FROM pages WHERE id='fixture-page'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        db.execute_batch("INSERT INTO pages(id,title,created_at,updated_at) VALUES('dest','Destination',1,2); INSERT INTO pages(id,title,parent_id,created_at,updated_at) VALUES('child','Child','fixture-page',1,3);").unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let attempt=|parent:Option<String>,key:f64,dest:Option<String>,rev:Option<i64>|move_page_checked(&path,"fixture-page",base,parent,key,dest,rev,&op);
        assert!(attempt(None,sort+1.0,Some("dest".into()),Some(2)).is_err());
        assert!(attempt(Some("dest".into()),sort,Some("dest".into()),Some(2)).is_err());
        assert!(attempt(None,sort,Some("dest".into()),Some(1)).is_err());
        assert!(attempt(None,sort,Some("child".into()),Some(3)).is_err());
        db.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='child'",[]).unwrap();
        assert!(attempt(None,sort,Some("dest".into()),Some(2)).is_err());
        db.execute("UPDATE pages SET metadata='{}' WHERE id='child'",[]).unwrap();
        db.execute("UPDATE pages SET parent_id='child' WHERE id='fixture-page'",[]).unwrap();
        assert!(attempt(Some("child".into()),sort,Some("dest".into()),Some(2)).is_err());
        assert_eq!(db.query_row("SELECT parent_id FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,String>(0)).unwrap(),"child");
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='moved'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_move_rolls_back_then_retries_without_duplicate_history() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let (base,sort):(i64,f64)=db.query_row("SELECT updated_at,sort_key FROM pages WHERE id='fixture-page'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        db.execute_batch("INSERT INTO pages(id,title,created_at,updated_at) VALUES('dest','Destination',1,2); CREATE TABLE native_personal_page_moves_v1(operation_id TEXT PRIMARY KEY,request_json TEXT NOT NULL,page_id TEXT NOT NULL,result_json TEXT NOT NULL); CREATE TRIGGER fail_move_record BEFORE INSERT ON native_personal_page_moves_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let op=uuid::Uuid::new_v4().to_string();
        let attempt=||move_page_checked(&path,"fixture-page",base,None,sort,Some("dest".into()),Some(2),&op);
        assert!(attempt().is_err());
        assert!(db.query_row("SELECT parent_id FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,Option<String>>(0)).unwrap().is_none());
        assert_eq!(db.query_row("SELECT sort_key FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,f64>(0)).unwrap(),sort);
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='moved'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        db.execute_batch("DROP TRIGGER fail_move_record;").unwrap();
        let first=attempt().unwrap(); let again=attempt().unwrap(); assert_eq!(first,again);
        assert_eq!(db.query_row("SELECT parent_id FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,String>(0)).unwrap(),"dest");
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='moved'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(move_page_checked(&path,"fixture-page",base,None,sort,None,None,&op).is_err());
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_checked_move_retries_same_operation() {
        let path=fixture(); let db=Connection::open(&path).unwrap();
        let (base,sort):(i64,f64)=db.query_row("SELECT updated_at,sort_key FROM pages WHERE id='fixture-page'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        db.execute("INSERT INTO pages(id,title,created_at,updated_at) VALUES('dest','Destination',1,2)",[]).unwrap();
        let request=serde_json::json!({"operation":"move_page_checked","path":path,"page":"fixture-page","base":base,"expected_parent":null,"expected_sort":sort,"destination":"dest","destination_revision":2,"operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
        let invoke=|| { let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();unsafe { worlds_store_free(response) };parsed };
        let first=invoke(); let retry=invoke(); assert_eq!(first["ok"],true,"{first}");assert_eq!(retry,first);
        assert_eq!(db.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page' AND kind='moved'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_shared_flag_and_unknown_schema() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap(); drop(c);
        assert!(rename_page(&path,"fixture-page",i64::MAX,"wrong".into()).is_err());
        let c=Connection::open(&path).unwrap(); c.execute_batch("PRAGMA user_version=12").unwrap(); drop(c);
        assert!(rename_page(&path,"fixture-page",i64::MAX,"wrong".into()).is_err());
        std::fs::remove_file(path).unwrap();
    }
    fn current_blocks(path:&Path) -> Vec<BlockInput> {
        let c=Connection::open(path).unwrap();
        let mut q=c.prepare("SELECT id,content FROM blocks WHERE page_id='fixture-page' ORDER BY sort_key").unwrap();
        q.query_map([],|r| Ok(BlockInput{id:r.get(0)?,content:serde_json::from_str::<Value>(&r.get::<_,String>(1)?).unwrap()})).unwrap().map(|r|r.unwrap()).collect()
    }
    fn with_bid(mut blocks:Vec<BlockInput>) -> Vec<BlockInput> {
        for block in &mut blocks { content::set_block_id(&mut block.content,&block.id); }
        blocks
    }
    #[test]
    fn checked_page_save_preserves_unchanged_noncanonical_block_and_rolls_back() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        let raw=r#"{"type":"future","attrs":{"payload":true,"bid":"opaque"},"content":[{"type":"text","text":"مرحبا"}]}"#;
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) VALUES('opaque','fixture-page','future',1,?1,'مرحبا','ltr',1,7)",[raw]).unwrap();
        c.execute_batch("CREATE TRIGGER fail_change BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap(); drop(c);
        let expected=current_blocks(&path); let mut next=with_bid(expected.clone());
        next[0].content["content"]=serde_json::json!([{"type":"text","text":"changed"}]);
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected.clone(),next.clone()).is_err());
        let c=Connection::open(&path).unwrap();
        let (content,direction,updated):(String,String,i64)=c.query_row("SELECT content,direction,updated_at FROM blocks WHERE id='opaque'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!((content,direction,updated),(raw.to_string(),"ltr".into(),7));
        assert_eq!(c.query_row("SELECT count(*) FROM versions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        c.execute_batch("DROP TRIGGER fail_change").unwrap(); drop(c);
        save_blocks_checked(&path,"fixture-page",1700000000001,expected.clone(),next).unwrap();
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected.clone(),with_bid(expected)).is_err());
        let c=Connection::open(&path).unwrap();
        let (content,direction,updated):(String,String,i64)=c.query_row("SELECT content,direction,updated_at FROM blocks WHERE id='opaque'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!((content,direction,updated),(raw.to_string(),"ltr".into(),7));
        let history:String=c.query_row("SELECT meta FROM history WHERE page_id='fixture-page' ORDER BY id DESC LIMIT 1",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&history).unwrap()["changed"],1);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_delete_snapshots_latest_content_even_with_recent_version() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        store::snapshot(&c,"fixture-page","user",None,Some("Older fixture")).unwrap();
        let latest=serde_json::json!({"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"latest before delete"}]});
        c.execute("UPDATE blocks SET content=?1 WHERE id='fixture-block'",[latest.to_string()]).unwrap();
        c.execute_batch("CREATE TRIGGER fail_block_delete BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap(); drop(c);
        let expected=current_blocks(&path);
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected.clone(),vec![]).is_err());
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM versions WHERE label='Before block deletion'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        c.execute_batch("DROP TRIGGER fail_block_delete").unwrap(); drop(c);
        save_blocks_checked(&path,"fixture-page",1700000000001,expected,vec![]).unwrap();
        let c=Connection::open(&path).unwrap();
        let raw:String=c.query_row("SELECT snapshot FROM versions WHERE label='Before block deletion'",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["blocks"][0],latest);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_save_rejects_equal_timestamp_conflict_without_writes() {
        let path=fixture(); let expected=current_blocks(&path); let submitted=with_bid(current_blocks(&path));
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE blocks SET content=?1 WHERE id='fixture-block'",[r#"{"type":"paragraph","content":[{"type":"text","text":"concurrent"}]}"#]).unwrap();drop(c);
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,submitted).unwrap_err().to_string().contains("conflict"));
        let c=Connection::open(&path).unwrap(); let raw:String=c.query_row("SELECT content FROM blocks WHERE id='fixture-block'",[],|r|r.get(0)).unwrap();
        assert!(raw.contains("concurrent")); assert_eq!(c.query_row("SELECT count(*) FROM versions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_save_rejects_reorder_and_cross_page_id() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'second',page_id,type,1,content,text,direction,created_at,updated_at FROM blocks WHERE id='fixture-block'",[]).unwrap();
        drop(c);let expected=current_blocks(&path);let submitted=with_bid(current_blocks(&path));
        let c=Connection::open(&path).unwrap();c.execute("UPDATE blocks SET sort_key=-1 WHERE id='second'",[]).unwrap();drop(c);
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,submitted).is_err());
        let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO pages(id,title,created_at,updated_at) VALUES('other','Other',1,1)",[]).unwrap();
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'foreign','other',type,1,content,text,direction,created_at,updated_at FROM blocks WHERE id='fixture-block'",[]).unwrap();drop(c);
        let expected=current_blocks(&path);let mut submitted=with_bid(current_blocks(&path));
        submitted.push(BlockInput{id:"foreign".into(),content:serde_json::json!({"type":"paragraph","attrs":{"bid":"foreign"}})});
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,submitted).is_err());
        let c=Connection::open(&path).unwrap();let owner:String=c.query_row("SELECT page_id FROM blocks WHERE id='foreign'",[],|r|r.get(0)).unwrap();assert_eq!(owner,"other");
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_save_with_matching_kind_runs_original_writer() {
        let path=fixture(); let expected=current_blocks(&path); let submitted=with_bid(current_blocks(&path));
        let request=serde_json::json!({"operation":"save_blocks_checked_kind","path":path,"page":"fixture-page","base":1700000000001_i64,"expected":expected,"blocks":submitted,"expected_kind":"page"}).to_string();
        let response=dispatch_inner(request.as_bytes(),None).unwrap();
        assert!(response["updatedAt"].is_number());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_save_rejects_kind_change_with_unchanged_revision() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET kind='document' WHERE id='fixture-page'",[]).unwrap(); drop(c);
        let expected=current_blocks(&path); let submitted=with_bid(current_blocks(&path));
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET kind='page' WHERE id='fixture-page'",[]).unwrap(); drop(c);
        let request=serde_json::json!({"operation":"save_blocks_checked_kind","path":path,"page":"fixture-page","base":1700000000001_i64,"expected":expected,"blocks":submitted,"expected_kind":"document"}).to_string();
        let error=dispatch_inner(request.as_bytes(),None).unwrap_err();
        assert!(error.to_string().contains("conflict: page kind changed"));
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT COUNT(*) FROM versions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("SELECT kind FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,String>(0)).unwrap(),"page");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM changes",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_save_rejects_page_shared_after_snapshot() {
        let path=fixture(); let expected=current_blocks(&path); let submitted=with_bid(current_blocks(&path));
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET workspace_id='team' WHERE id='fixture-page'",[]).unwrap(); drop(c);
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,submitted).is_err());
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM versions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("SELECT count(*) FROM blocks WHERE page_id='fixture-page'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_save_preserves_nonempty_or_malformed_block_properties() {
        for properties in [r#"{"plugin":{"keep":true}}"#, "invalid-json", "[]"] {
            let path=fixture(); let expected=current_blocks(&path);
            let c=Connection::open(&path).unwrap();
            c.execute("UPDATE blocks SET properties=?1 WHERE id='fixture-block'",[properties]).unwrap(); drop(c);
            let error=save_blocks_checked(&path,"fixture-page",1700000000001,expected,vec![]).unwrap_err();
            assert!(error.to_string().contains("properties"));
            let c=Connection::open(&path).unwrap();
            let persisted:String=c.query_row("SELECT properties FROM blocks WHERE id='fixture-block'",[],|r|r.get(0)).unwrap();
            assert_eq!(persisted,properties);
            assert_eq!(c.query_row("SELECT count(*) FROM versions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            drop(c); std::fs::remove_file(path).unwrap();
        }
    }
    #[test]
    fn checked_save_retains_block_properties_when_editing_content() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE blocks SET properties=?1 WHERE id='fixture-block'",[r#"{"plugin":{"keep":true}}"#]).unwrap(); drop(c);
        let expected=current_blocks(&path); let mut next=with_bid(current_blocks(&path));
        next[0].content["content"][0]["text"] = serde_json::json!("Updated");
        save_blocks_checked(&path,"fixture-page",1700000000001,expected,next).unwrap();
        let c=Connection::open(&path).unwrap();
        let properties:String=c.query_row("SELECT properties FROM blocks WHERE id='fixture-block'",[],|r|r.get(0)).unwrap();
        assert_eq!(properties,r#"{"plugin":{"keep":true}}"#);
        drop(c); std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn checked_roundtrip_keeps_rich_nodes_properties_and_reference_index() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        let original=serde_json::json!({"type":"paragraph","attrs":{"bid":"fixture-block","dir":"rtl","plugin":{"k":3}},"content":[
            {"type":"text","text":"مسألة 🌍","marks":[{"type":"bold"},{"type":"link","attrs":{"href":"https://example.org","extra":"keep"}}]},
            {"type":"pageMention","attrs":{"id":"target-page","label":"مثال"}},
            {"type":"customInline","attrs":{"opaque":[1,2,3]}}
        ]});
        c.execute("UPDATE blocks SET content=?1,properties=?2 WHERE id='fixture-block'",rusqlite::params![original.to_string(),r#"{"plugin":{"keep":true}}"#]).unwrap();
        c.execute("INSERT INTO refs(source_page,source_block,target_page,kind) VALUES('fixture-page','fixture-block','target-page','mention')",[]).unwrap(); drop(c);
        let expected=current_blocks(&path); let mut next=with_bid(current_blocks(&path));
        next[0].content["content"][0]["text"]=serde_json::json!("مسألة محلولة 🌍");
        save_blocks_checked(&path,"fixture-page",1700000000001,expected,next).unwrap();
        let c=Connection::open(&path).unwrap();
        let (raw,properties):(String,String)=c.query_row("SELECT content,properties FROM blocks WHERE id='fixture-block'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        let mut wanted=original; wanted["content"][0]["text"]=serde_json::json!("مسألة محلولة 🌍");
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),wanted);
        assert_eq!(properties,r#"{"plugin":{"keep":true}}"#);
        assert_eq!(c.query_row("SELECT count(*) FROM refs WHERE source_block='fixture-block' AND target_page='target-page' AND kind='mention'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(c); std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn checked_save_refuses_ambiguous_content_and_unrecognized_reference_index() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        let ambiguous=r#"{"type":"paragraph","attrs":{"x":1,"x":2},"content":[{"type":"text","text":"keep"}]}"#;
        c.execute("UPDATE blocks SET content=?1 WHERE id='fixture-block'",[ambiguous]).unwrap(); drop(c);
        let expected=current_blocks(&path); let next=with_bid(current_blocks(&path));
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,next).unwrap_err().to_string().contains("ambiguous"));
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT content FROM blocks WHERE id='fixture-block'",[],|r|r.get::<_,String>(0)).unwrap(),ambiguous);
        c.execute("UPDATE blocks SET content=?1 WHERE id='fixture-block'",[r#"{"type":"paragraph","content":[{"type":"text","text":"keep"}]}"#]).unwrap();
        c.execute("INSERT INTO refs(source_page,source_block,target_page,kind) VALUES('fixture-page','fixture-block','plugin-target','plugin')",[]).unwrap(); drop(c);
        let expected=current_blocks(&path); let next=with_bid(current_blocks(&path));
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,next).unwrap_err().to_string().contains("reference index"));
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM refs WHERE kind='plugin'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c); std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn checked_save_rolls_back_if_reference_rebuild_is_blocked() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO refs(source_page,source_block,target_page,kind) VALUES('other','fixture-block','target-page','mention')",[]).unwrap(); drop(c);
        let expected=current_blocks(&path); let original=expected[0].content.clone(); let mut next=with_bid(current_blocks(&path));
        next[0].content["content"]=serde_json::json!([{"type":"pageMention","attrs":{"id":"target-page"}}]);
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,next).unwrap_err().to_string().contains("reference index"));
        let c=Connection::open(&path).unwrap();
        let raw:String=c.query_row("SELECT content FROM blocks WHERE id='fixture-block'",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),original);
        assert_eq!(c.query_row("SELECT count(*) FROM refs WHERE source_page='other'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE page_id='fixture-page'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn checked_save_is_atomic_on_invalid_identity_and_returns_real_revision() {
        let path=fixture();let expected=current_blocks(&path);let mut submitted=with_bid(current_blocks(&path));
        submitted.push(BlockInput{id:"fixture-block".into(),content:serde_json::json!({"type":"paragraph","attrs":{"bid":"fixture-block"}})});
        assert!(save_blocks_checked(&path,"fixture-page",1700000000001,expected,submitted).is_err());
        let result=save_blocks_checked(&path,"fixture-page",1700000000001,current_blocks(&path),with_bid(current_blocks(&path))).unwrap();
        let c=Connection::open(&path).unwrap();let at:i64=c.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();assert_eq!(result["updatedAt"],at);
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_returns_error_for_invalid_request() {
        let bytes = b"invalid json";
        let response = unsafe { worlds_store_call(bytes.as_ptr(), bytes.len()) };
        assert!(!response.is_null());
        let body = unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap();
        let parsed: Value = serde_json::from_str(body).unwrap();
        assert_eq!(parsed["ok"], false);
        unsafe { worlds_store_free(response) };
    }
    #[test]
    fn refuses_shared_and_preserves_content() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET workspace_id='team' WHERE id='fixture-page'",[]).unwrap(); drop(c);
        assert!(rename_page(&path,"fixture-page",i64::MAX,"unsafe".into()).is_err());
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT title FROM pages WHERE id='fixture-page'",[],|r|r.get::<_,String>(0)).unwrap(),"Fixture page");
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn native_writes_record_their_own_change_origin() {
        let path=fixture();
        let created=create_page_idempotent(&path,"Origin fixture".into(),None,&uuid::Uuid::new_v4().to_string()).unwrap();
        let id=created["id"].as_str().unwrap().to_owned();
        let base=created["updatedAt"].as_i64().unwrap();
        rename_page(&path,&id,base,"Origin renamed".into()).unwrap();
        let c=Connection::open(&path).unwrap();
        // The desktop's change watcher skips only "ui" rows, which are its own.
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id=?1 AND origin='ui'",[&id],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert!(c.query_row("SELECT count(*) FROM changes WHERE page_id=?1 AND origin=?2",[id.as_str(),NATIVE_ORIGIN],|r|r.get::<_,i64>(0)).unwrap()>=2);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn top_level_creation_refuses_the_active_team_workspace_and_rolls_back() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        c.execute_batch("INSERT INTO account_workspaces(id,name,role,synced_at) VALUES('team-ws','Team','owner',1); INSERT OR REPLACE INTO settings(key,value) VALUES('account.activeWorkspace','\"team-ws\"');").unwrap();
        drop(c);
        let operation=uuid::Uuid::new_v4().to_string();
        let error=create_page_idempotent(&path,"Team fixture".into(),None,&operation).unwrap_err();
        assert!(format!("{error:#}").starts_with("team workspace:"),"{error:#}");
        assert!(create_document_idempotent(&path,"Team fixture".into(),None,None,&uuid::Uuid::new_v4().to_string()).is_err());
        assert!(create_page(&path,"Team fixture".into(),None).is_err());
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM pages WHERE title='Team fixture'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE summary LIKE '%Team fixture%'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c);
        // A subpage of a personal page stays personal and is still allowed.
        let child=create_page_idempotent(&path,"Personal child".into(),Some("fixture-page".into()),&uuid::Uuid::new_v4().to_string()).unwrap();
        let c=Connection::open(&path).unwrap();
        let workspace:Option<String>=c.query_row("SELECT workspace_id FROM pages WHERE id=?1",[child["id"].as_str().unwrap()],|r|r.get(0)).unwrap();
        assert!(workspace.is_none());
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn restore_from_trash_checks_listing_and_keeps_history() {
        let path=fixture();
        let created=create_page(&path,"Trash fixture".into(),Some("fixture-page".into())).unwrap();
        let id=created["id"].as_str().unwrap().to_owned();
        let child=create_page(&path,"Trash child".into(),Some(id.clone())).unwrap();
        let child_id=child["id"].as_str().unwrap().to_owned();
        let base=created["updatedAt"].as_i64().unwrap();
        trash_page(&path,&id,base).unwrap();
        let c=Connection::open(&path).unwrap();
        let (revision,deleted):(i64,i64)=c.query_row("SELECT updated_at,deleted_at FROM pages WHERE id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        drop(c);
        // A live page is not in Trash, and a stale listing is a conflict.
        assert!(restore_page_checked(&path,"fixture-page",1700000000001,deleted).is_err());
        assert!(restore_page_checked(&path,&id,revision,deleted+1).unwrap_err().to_string().starts_with("conflict:"));
        assert!(restore_page_checked(&path,&id,revision+1,deleted).unwrap_err().to_string().starts_with("conflict:"));
        let restored=restore_page_checked(&path,&id,revision,deleted).unwrap();
        assert_eq!(restored["id"],id.as_str());
        let c=Connection::open(&path).unwrap();
        for page in [&id,&child_id] {
            let at:Option<i64>=c.query_row("SELECT deleted_at FROM pages WHERE id=?1",[page],|r|r.get(0)).unwrap();
            assert!(at.is_none());
        }
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE page_id=?1 AND kind='restored'",[&id],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id=?1 AND kind='tree' AND origin=?2",[id.as_str(),NATIVE_ORIGIN],|r|r.get::<_,i64>(0)).unwrap(),2);
        drop(c);
        // A page that became shared while in Trash is not restored here.
        let current=Connection::open(&path).unwrap().query_row("SELECT updated_at FROM pages WHERE id=?1",[&id],|r|r.get::<_,i64>(0)).unwrap();
        trash_page(&path,&id,current).unwrap();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id=?1",[&id]).unwrap();
        let (revision,deleted):(i64,i64)=c.query_row("SELECT updated_at,deleted_at FROM pages WHERE id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        drop(c);
        assert!(restore_page_checked(&path,&id,revision,deleted).is_err());
        let c=Connection::open(&path).unwrap();
        let at:Option<i64>=c.query_row("SELECT deleted_at FROM pages WHERE id=?1",[&id],|r|r.get(0)).unwrap();
        assert_eq!(at,Some(deleted));
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_restore_request_name_is_accepted() {
        let path=fixture();
        let created=create_page(&path,"FFI trash".into(),Some("fixture-page".into())).unwrap();
        let id=created["id"].as_str().unwrap().to_owned();
        trash_page(&path,&id,created["updatedAt"].as_i64().unwrap()).unwrap();
        let (revision,deleted):(i64,i64)=Connection::open(&path).unwrap().query_row("SELECT updated_at,deleted_at FROM pages WHERE id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        let request=serde_json::json!({"operation":"restore_page_checked","path":path,"page":id,"base":revision,"deleted_at":deleted}).to_string();
        let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };
        let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();
        unsafe { worlds_store_free(response) };
        assert_eq!(parsed["ok"],true,"{parsed}");
        assert_eq!(parsed["value"]["id"],id.as_str());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn assistant_version_restores_page_and_keeps_later_state() {
        let path=fixture();
        let base=1700000000001;
        let version=create_version_checked(&path,"fixture-page",base,"Before assistant changes".into()).unwrap();
        let version_id=version["id"].as_str().unwrap().to_owned();
        assert_eq!(version["updatedAt"].as_i64(),Some(base));
        // A stale revision or an empty label adds nothing.
        assert!(create_version_checked(&path,"fixture-page",base+1,"Late".into()).unwrap_err().to_string().starts_with("conflict:"));
        assert!(create_version_checked(&path,"fixture-page",base,"  ".into()).is_err());
        let expected=current_blocks(&path);
        let replacement=vec![BlockInput{id:"assistant-block".into(),content:serde_json::json!({"type":"paragraph","attrs":{"bid":"assistant-block"},"content":[{"type":"text","text":"Assistant text"}]})}];
        let saved=save_blocks_checked_kind(&path,"fixture-page",base,expected,replacement,"page").unwrap();
        let after=saved["updatedAt"].as_i64().unwrap();
        assert!(restore_version_checked(&path,"fixture-page",base-1,&version_id).unwrap_err().to_string().starts_with("conflict:"));
        assert!(restore_version_checked(&path,"fixture-page",after,"missing-version").is_err());
        let restored=restore_version_checked(&path,"fixture-page",after,&version_id).unwrap();
        assert_eq!(restored["title"],"Fixture page");
        assert!(restored["updatedAt"].as_i64().unwrap()>=after);
        let c=Connection::open(&path).unwrap();
        let texts:Vec<String>=c.prepare("SELECT text FROM blocks WHERE page_id='fixture-page' ORDER BY sort_key").unwrap()
            .query_map([],|r|r.get(0)).unwrap().map(|r|r.unwrap()).collect();
        assert_eq!(texts,vec!["Hello Worlds".to_string()]);
        // The assistant's version stays, and the state before the restore is kept too.
        assert_eq!(c.query_row("SELECT count(*) FROM versions WHERE page_id='fixture-page' AND label='Before assistant changes' AND actor='ai'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        let before:String=c.query_row("SELECT snapshot FROM versions WHERE page_id='fixture-page' AND label='Before restore'",[],|r|r.get(0)).unwrap();
        assert!(before.contains("Assistant text"));
        assert!(c.query_row("SELECT count(*) FROM changes WHERE page_id='fixture-page' AND origin=?1",[NATIVE_ORIGIN],|r|r.get::<_,i64>(0)).unwrap()>=2);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn assistant_version_restore_refuses_other_pages_properties_and_shared_pages() {
        let path=fixture();
        let version=create_version_checked(&path,"fixture-page",1700000000001,"Before assistant changes".into()).unwrap()["id"].as_str().unwrap().to_owned();
        let other=create_page(&path,"Other".into(),Some("fixture-page".into())).unwrap();
        let other_id=other["id"].as_str().unwrap().to_owned();
        let other_revision:i64=Connection::open(&path).unwrap().query_row("SELECT updated_at FROM pages WHERE id=?1",[&other_id],|r|r.get(0)).unwrap();
        // A version of another page is never restored onto this one.
        assert!(restore_version_checked(&path,&other_id,other_revision,&version).is_err());
        let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at,properties) VALUES('with-properties','fixture-page','paragraph',2,'{\"type\":\"paragraph\",\"attrs\":{\"bid\":\"with-properties\"}}','','ltr',1,1,'{\"status\":\"done\"}')",[]).unwrap();
        let revision:i64=c.query_row("SELECT updated_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        drop(c);
        // A block with properties the native apps cannot show is never discarded.
        assert!(restore_version_checked(&path,"fixture-page",revision,&version).unwrap_err().to_string().starts_with("unsupported edit:"));
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM blocks WHERE id='with-properties'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        c.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        drop(c);
        assert!(create_version_checked(&path,"fixture-page",revision,"Before assistant changes".into()).is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_version_request_names_are_accepted() {
        let path=fixture();
        let call=|request:String| -> Value {
            let response=unsafe { worlds_store_call(request.as_ptr(),request.len()) };
            let parsed:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(response) }.to_str().unwrap()).unwrap();
            unsafe { worlds_store_free(response) };
            parsed
        };
        let created=call(serde_json::json!({"operation":"create_version_checked","path":path,"page":"fixture-page","base":1700000000001i64,"label":"Before assistant changes"}).to_string());
        assert_eq!(created["ok"],true,"{created}");
        let version=created["value"]["id"].as_str().unwrap().to_owned();
        let restored=call(serde_json::json!({"operation":"restore_version_checked","path":path,"page":"fixture-page","base":1700000000001i64,"version":version}).to_string());
        assert_eq!(restored["ok"],true,"{restored}");
        assert_eq!(restored["value"]["id"],"fixture-page");
        std::fs::remove_file(path).unwrap();
    }
}
