use anyhow::{bail, Result};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use std::path::Path;
mod resource_ops;
mod automation_ops;

#[path = "../../../src-tauri/src/content.rs"]
mod content;
#[path = "../../../src-tauri/src/store/mod.rs"]
mod store;
#[path = "../../../src-tauri/src/templates.rs"]
mod templates;

// These non-editor dependencies must not silently grant access.
mod account { pub mod permissions {
    use anyhow::{bail, Result}; use rusqlite::Connection;
    pub enum Level { Edit }
    pub fn require(_: &Connection, _: &str, _: Level) -> Result<()> { bail!("workspace authorization unavailable") }
} }
mod drawing_copy {
    use anyhow::{bail, Result}; use rusqlite::Connection;
    pub struct Permit;
    pub fn require_current(_: &Connection, _: &str, _: Option<&Permit>) -> Result<()> { bail!("drawing copy unavailable") }
}
mod drawing;
// Publication validation needs library ownership dependencies which are not
// available in this isolated target; refuse instead of weakening validation.
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

fn open_existing(path: &Path) -> Result<Connection> {
    if !path.is_absolute() || !path.is_file() { bail!("an existing absolute database path is required") }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")?;
    let v: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if v != 11 { bail!("unsupported schema version {v}; migrations are disabled") }
    Ok(conn)
}

fn require_personal(c: &Connection, id: &str) -> Result<()> {
    let row: Option<(Option<String>, String, Option<i64>)> = c.query_row(
        "SELECT workspace_id,metadata,deleted_at FROM pages WHERE id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let (workspace, metadata, deleted) = row.ok_or_else(|| anyhow::anyhow!("page unavailable"))?;
    let value: Value = serde_json::from_str(&metadata)?;
    if !value.is_object() { bail!("invalid metadata") }
    if let Some(sync) = value.get("sync") {
        if !sync.is_object() || sync.get("shared").is_some_and(|shared| shared.as_bool() != Some(false)) { bail!("shared or invalid synchronization metadata") }
    }
    if workspace.is_some() || deleted.is_some() {
        bail!("page is shared, deleted, or unavailable")
    }
    Ok(())
}

/// Uses the current Rust store implementation. No migrations or shared writes.
#[derive(serde::Deserialize)]
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
    let result = store::save_blocks(&tx, &store::Ctx::user(), page, input)?;
    tx.commit()?;
    Ok(serde_json::to_value(result)?)
}

/// Full content and ordering are compared in the same write transaction.
/// Millisecond timestamps alone cannot detect reordered rows or equal-time writes.
pub fn save_blocks_checked(path: &Path, page: &str, base: i64, expected: Vec<BlockInput>, blocks: Vec<BlockInput>) -> Result<Value> {
    use std::collections::HashSet;
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    let (kind, current_at): (String,i64) = tx.query_row("SELECT kind,updated_at FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?,r.get(1)?)))?;
    if kind != "page" && kind != "document" { bail!("only page and document blocks are supported") }
    if current_at != base { bail!("conflict: page revision changed") }
    let current: Vec<(String,String)> = tx.prepare("SELECT id,content FROM blocks WHERE page_id=?1 ORDER BY sort_key")?
        .query_map([page], |r| Ok((r.get(0)?,r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    if current.len() != expected.len() { bail!("conflict: block count changed") }
    for ((id, json), old) in current.iter().zip(expected.iter()) {
        let value: Value = serde_json::from_str(json)?;
        if id != &old.id || value != old.content { bail!("conflict: block content or order changed") }
    }
    let mut ids = HashSet::new();
    for block in &blocks {
        if block.id.is_empty() || !ids.insert(block.id.clone()) || !block.content.is_object() { bail!("invalid block ID or content") }
        if block.content.pointer("/attrs/bid").and_then(Value::as_str) != Some(block.id.as_str()) { bail!("invalid block identity") }
        let owner: Option<String> = tx.query_row("SELECT page_id FROM blocks WHERE id=?1", [&block.id], |r| r.get(0)).optional()?;
        if owner.as_deref().is_some_and(|other| other != page) { bail!("conflict: block ID belongs to another page") }
    }
    store::snapshot_before_user_edit(&tx, page)?;
    let input = blocks.into_iter().map(|block| store::BlockInput { id: block.id, content: block.content }).collect();
    let result = store::save_blocks(&tx, &store::Ctx::user(), page, input)?;
    if !result.remapped.is_empty() { bail!("conflict: block identifiers were remapped") }
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
    let result = store::update_page(&tx, &store::Ctx::user(), page, store::PagePatch { title: Some(title), ..Default::default() })?;
    tx.commit()?;
    Ok(serde_json::to_value(result)?)
}



/// Creates a personal page using the existing Rust store. Restricted to page kind.
pub fn create_page(path: &Path, title: String, parent: Option<String>) -> Result<Value> {
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(parent_id) = parent.as_deref() { require_personal(&tx, parent_id)?; }
    let input = store::NewPage { title: Some(title), parent_id: parent, kind: Some("page".into()), ..Default::default() };
    let result = store::create_page(&tx, &store::Ctx::user(), input)?;
    tx.commit()?;
    Ok(serde_json::to_value(result)?)
}

/// Moves a wholly personal subtree to trash, failing closed on mixed ownership.
pub fn trash_page(path: &Path, page: &str, base: i64) -> Result<()> {
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_personal(&tx, page)?;
    if store::page_changed_since(&tx, page, base)? { bail!("conflict: the page changed since it was loaded") }
    {
        let mut statement = tx.prepare("WITH RECURSIVE subtree(id) AS (SELECT id FROM pages WHERE id=?1 UNION SELECT p.id FROM pages p JOIN subtree s ON p.parent_id=s.id) SELECT id FROM subtree")?;
        let descendants = statement.query_map([page], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for id in descendants { require_personal(&tx, &id)?; }
    }
    store::delete_page(&tx, &store::Ctx::user(), page)?;
    tx.commit()?;
    Ok(())
}
#[derive(serde::Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum Request {
    SqliteInfo,
    ValidateDrawingScene { scene: Value },
    AutomationDue { path: String },
    AutomationClaim { path: String, automation_id: String, expected_due: i64 },
    AutomationDecline { path: String, action_id: String },
    ReadResource { path: String, page: String },
    ReadPresentation { path: String, page: String },
    SavePresentation { path: String, page: String, base: i64, expected_metadata: Value, expected: Vec<BlockInput>, blocks: Vec<BlockInput> },
    SaveProject { path: String, page: String, base: i64, expected_metadata: Value, metadata: Value },
    SaveGallery { path: String, page: String, base: i64, expected_metadata: Value, metadata: Value, expected: Vec<BlockInput>, blocks: Vec<BlockInput> },
    SaveBlocks { path: String, page: String, base: i64, blocks: Vec<BlockInput> },
    SaveBlocksChecked { path: String, page: String, base: i64, expected: Vec<BlockInput>, blocks: Vec<BlockInput> },
    RenamePage { path: String, page: String, base: i64, title: String },
    CreatePage { path: String, title: String, parent: Option<String> },
    TrashPage { path: String, page: String, base: i64 },
}

fn dispatch(bytes: &[u8]) -> Result<Value> {
    let request: Request = serde_json::from_slice(bytes)?;
    match request {
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
        Request::SavePresentation { path, page, base, expected_metadata, expected, blocks } => resource_ops::save_presentation(Path::new(&path), &page, base, expected_metadata, expected, blocks),
        Request::SaveProject { path, page, base, expected_metadata, metadata } => resource_ops::save_project(Path::new(&path), &page, base, expected_metadata, metadata),
        Request::SaveGallery { path, page, base, expected_metadata, metadata, expected, blocks } => resource_ops::save_gallery(Path::new(&path), &page, base, expected_metadata, metadata, expected, blocks),
        Request::SaveBlocks { path, page, base, blocks } => save_blocks(Path::new(&path), &page, base, blocks),
        Request::SaveBlocksChecked { path, page, base, expected, blocks } => save_blocks_checked(Path::new(&path), &page, base, expected, blocks),
        Request::RenamePage { path, page, base, title } => rename_page(Path::new(&path), &page, base, title),
        Request::CreatePage { path, title, parent } => create_page(Path::new(&path), title, parent),
        Request::TrashPage { path, page, base } => { trash_page(Path::new(&path), &page, base)?; Ok(Value::Null) }
    }
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
        let path = std::env::temp_dir().join(format!("worlds-isolated-{}.db", uuid::Uuid::new_v4()));
        std::fs::copy(original, &path).unwrap();
        path
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
        c.execute("INSERT INTO pages(id,title,parent_id,workspace_id,created_at,updated_at) VALUES('child','Child','fixture-page','team',1,2)",[]).unwrap();
        drop(c);
        assert!(trash_page(&path,"fixture-page",i64::MAX).is_err());
        let c=Connection::open(&path).unwrap();
        let deleted:Option<i64>=c.query_row("SELECT deleted_at FROM pages WHERE id='fixture-page'",[],|r|r.get(0)).unwrap();
        assert!(deleted.is_none());
        drop(c); std::fs::remove_file(path).unwrap();
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
}
