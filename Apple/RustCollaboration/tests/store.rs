use rusqlite::Connection;
use worlds_collaboration::store::{StoreError,SyncStore};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);
struct FixturePath { directory: std::path::PathBuf, path: std::path::PathBuf }
impl AsRef<std::path::Path> for FixturePath { fn as_ref(&self) -> &std::path::Path { &self.path } }
impl std::ops::Deref for FixturePath { type Target = std::path::Path; fn deref(&self) -> &Self::Target { &self.path } }
impl Drop for FixturePath { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.directory); } }
fn isolated_path() -> FixturePath {
    loop {
        let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!("worlds-collab-fixture-{}-{sequence}",std::process::id()));
        match std::fs::create_dir(&directory) {
            Ok(()) => return FixturePath { path: directory.join("worlds.db"), directory },
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => panic!("could not create isolated fixture directory: {error}"),
        }
    }
}

fn fixture() -> FixturePath {
    let path = isolated_path();
    let db=Connection::open(&path).unwrap();
    db.execute_batch("PRAGMA user_version=11;
CREATE TABLE pages(id TEXT PRIMARY KEY,workspace_id TEXT,parent_id TEXT,deleted_at INTEGER);
CREATE TABLE account(id INTEGER PRIMARY KEY,user_id TEXT,status TEXT);
CREATE TABLE account_workspaces(id TEXT PRIMARY KEY,role TEXT,default_level TEXT);
CREATE TABLE account_page_access(workspace_id TEXT,page_id TEXT,level TEXT);
CREATE TABLE drawing_sync_state(page_id TEXT,user_id TEXT);
CREATE TABLE sync_docs(page_id TEXT,channel INTEGER,snapshot BLOB,snapshot_upto INTEGER DEFAULT 0,created_at INTEGER,updated_at INTEGER,PRIMARY KEY(page_id,channel));
CREATE TABLE sync_updates(id INTEGER PRIMARY KEY AUTOINCREMENT,page_id TEXT,channel INTEGER,data BLOB,origin TEXT,created_at INTEGER);
CREATE TABLE sync_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,page_id TEXT,channel INTEGER,data BLOB,created_at INTEGER,attempts INTEGER DEFAULT 0,state TEXT DEFAULT 'pending',last_error TEXT);
CREATE TABLE sync_rejected_snapshots(id TEXT PRIMARY KEY,page_id TEXT,channel INTEGER,owner_id TEXT,data BLOB,reason TEXT,created_at INTEGER);
INSERT INTO pages VALUES('p','w',NULL,NULL); INSERT INTO account VALUES(1,'u','active');
INSERT INTO account_workspaces VALUES('w','member','edit');").unwrap();
    path
}

#[test]
fn parallel_fixtures_have_distinct_databases_and_survive_peer_cleanup() {
    let workers: Vec<_> = (0..24).map(|_| std::thread::spawn(fixture)).collect();
    let mut paths: Vec<_> = workers.into_iter().map(|worker| worker.join().unwrap()).collect();
    let unique: std::collections::HashSet<_> = paths.iter().map(|item| item.path.clone()).collect();
    assert_eq!(unique.len(), paths.len());
    let survivor = paths.pop().unwrap();
    let store = SyncStore::open(&survivor, "p", "u", "w").unwrap();
    drop(paths);
    assert!(store.load(0).unwrap().is_empty());
    drop(store);
}

#[test]
fn atomic_append_ack_watermark_and_reopen() {
    let path=fixture();
    let mut s=SyncStore::open(&path,"p","u","w").unwrap();
    s.append(0,b"a",true).unwrap();
    let first=s.max_pending(0).unwrap().unwrap();
    s.append(0,b"b",true).unwrap();
    s.append(1,b"c",true).unwrap();
    s.acknowledge(0,first).unwrap();
    drop(s);
    let s=SyncStore::open(&path,"p","u","w").unwrap();
    assert_eq!(s.load(0).unwrap(),vec![b"a".to_vec(),b"b".to_vec()]);
    assert!(s.max_pending(0).unwrap().unwrap()>first);
    assert!(s.max_pending(1).unwrap().is_some());
    drop(s); std::fs::remove_file(path).unwrap();
}

#[test]
fn rejection_preserves_owner_snapshot_and_marks_only_channel() {
    let path=fixture();
    let mut s=SyncStore::open(&path,"p","u","w").unwrap();
    let base = include_bytes!("fixtures/plain-editor.bin");
    s.append(0,base,true).unwrap(); s.append(1,&[0,0],true).unwrap();
    s.reject(0,"f1f468d2-3b01-4fe0-a2de-df352089d21d",base,"denied").unwrap();
    assert_eq!(s.load(0).unwrap(),vec![vec![0,0]]);
    assert_eq!(s.max_pending(0).unwrap(),None);
    assert!(s.max_pending(1).unwrap().is_some());
    drop(s);
    let db=Connection::open(&path).unwrap();
    let (owner,state):(String,Vec<u8>)=db.query_row("SELECT owner_id,data FROM sync_rejected_snapshots",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(owner,"u");
    let restored = worlds_collaboration::CollaborationDoc::default();
    restored.apply(&state).unwrap();
    let original = worlds_collaboration::CollaborationDoc::default();
    original.apply(base).unwrap();
    assert_eq!(restored.state_vector().unwrap(),original.state_vector().unwrap());
    let rejected:i64=db.query_row("SELECT count(*) FROM sync_outbox WHERE state='rejected'",[],|r|r.get(0)).unwrap(); assert_eq!(rejected,1);
    drop(db); std::fs::remove_file(path).unwrap();
}

#[test]
fn rejection_merges_durable_edits_missing_from_memory_snapshot() {
    let path=fixture();
    let mut store=SyncStore::open(&path,"p","u","w").unwrap();
    let base=include_bytes!("fixtures/plain-editor.bin");
    store.append(0,base,false).unwrap();
    let later=store.insert_plain_checked(base,0,"block-1","Hello 🌍",6,"Alice ").unwrap();
    // Model the Swift race: its snapshot is older than the committed outbox.
    store.reject(0,"f1f468d2-3b01-4fe0-a2de-df352089d21d",base,"denied").unwrap();
    let db=Connection::open(&path).unwrap();
    let archived:Vec<u8>=db.query_row("SELECT data FROM sync_rejected_snapshots",[],|r|r.get(0)).unwrap();
    let restored=worlds_collaboration::CollaborationDoc::default(); restored.apply(&archived).unwrap();
    let expected=worlds_collaboration::CollaborationDoc::default(); expected.apply(base).unwrap(); expected.apply(&later).unwrap();
    assert_eq!(restored.state_vector().unwrap(),expected.state_vector().unwrap());
    assert_eq!(restored.diff(&expected.state_vector().unwrap()).unwrap(),[0,0]);
    assert_eq!(expected.diff(&restored.state_vector().unwrap()).unwrap(),[0,0]);
    assert_eq!(store.max_pending(0).unwrap(),None);
    assert_eq!(db.query_row("SELECT count(*) FROM sync_outbox WHERE state='rejected'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    drop(db);
    // Retrying the same archive with a stale/empty snapshot must not replace
    // the previously captured edit after the live log has been cleared.
    store.reject(0,"f1f468d2-3b01-4fe0-a2de-df352089d21d",&[0,0],"retry").unwrap();
    let db=Connection::open(&path).unwrap();
    let retried:Vec<u8>=db.query_row("SELECT data FROM sync_rejected_snapshots",[],|r|r.get(0)).unwrap();
    let recovered=worlds_collaboration::CollaborationDoc::default(); recovered.apply(&retried).unwrap();
    assert_eq!(recovered.state_vector().unwrap(),expected.state_vector().unwrap());
    drop(db); drop(store); std::fs::remove_file(path).unwrap();
}

#[test]
fn rejection_with_corrupt_update_keeps_live_log_and_pending_outbox() {
    let path=fixture();
    let mut store=SyncStore::open(&path,"p","u","w").unwrap();
    store.append(0,&[255],true).unwrap();
    assert!(matches!(store.reject(0,"f1f468d2-3b01-4fe0-a2de-df352089d21d",&[0,0],"denied"),Err(StoreError::Invalid)));
    assert_eq!(store.load(0).unwrap(),vec![vec![255]]);
    assert!(store.max_pending(0).unwrap().is_some());
    let db=Connection::open(&path).unwrap();
    assert_eq!(db.query_row("SELECT count(*) FROM sync_rejected_snapshots",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    drop(db); drop(store); std::fs::remove_file(path).unwrap();
}

#[test]
fn rejection_reset_failure_rolls_back_archive_and_preserves_outbox() {
    let path=fixture(); let mut store=SyncStore::open(&path,"p","u","w").unwrap();
    let base=include_bytes!("fixtures/plain-editor.bin"); store.append(0,base,true).unwrap();
    let db=Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_reject_reset BEFORE UPDATE ON sync_docs BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(store.reject(0,"f1f468d2-3b01-4fe0-a2de-df352089d21d",base,"denied").is_err());
    assert_eq!(store.load(0).unwrap(),vec![base.to_vec()]);
    assert!(store.max_pending(0).unwrap().is_some());
    assert_eq!(db.query_row("SELECT count(*) FROM sync_rejected_snapshots",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(db.query_row("SELECT count(*) FROM sync_outbox WHERE state='rejected'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    drop(db); drop(store); std::fs::remove_file(path).unwrap();
}

#[test]
fn rejection_retains_pending_causal_updates_without_their_base() {
    use yrs::updates::decoder::Decode;
    let base = [1,6,233,7,0,4,1,6,115,104,97,114,101,100,10,72,101,108,108,111,32,240,159,140,141,7,1,7,100,101,102,97,117,108,116,3,9,112,97,114,97,103,114,97,112,104,7,0,233,7,8,6,6,0,233,7,9,4,98,111,108,100,4,116,114,117,101,132,233,7,10,13,89,106,115,32,114,105,99,104,32,116,101,120,116,134,233,7,23,4,98,111,108,100,4,110,117,108,108,0];
    let pending = [1,1,209,15,0,196,233,7,5,233,7,6,6,65,108,105,99,101,32,0];
    // Validate the synthetic Yjs update encoding before using it.
    yrs::Update::decode_v1(&base).unwrap(); yrs::Update::decode_v1(&pending).unwrap();
    let path=fixture(); let mut store=SyncStore::open(&path,"p","u","w").unwrap();
    store.append(0,&pending,true).unwrap();
    store.reject(0,"f1f468d2-3b01-4fe0-a2de-df352089d21d",&[0,0],"denied").unwrap();
    let db=Connection::open(&path).unwrap();
    let archived:Vec<u8>=db.query_row("SELECT data FROM sync_rejected_snapshots",[],|r|r.get(0)).unwrap();
    let restored=worlds_collaboration::CollaborationDoc::default(); restored.apply(&archived).unwrap(); restored.apply(&base).unwrap();
    let expected=worlds_collaboration::CollaborationDoc::default(); expected.apply(&base).unwrap(); expected.apply(&pending).unwrap();
    assert_eq!(restored.state_vector().unwrap(),expected.state_vector().unwrap());
    assert_eq!(restored.diff(&expected.state_vector().unwrap()).unwrap(),[0,0]);
    drop(db); drop(store); std::fs::remove_file(path).unwrap();
}

#[test]
fn rollback_on_outbox_failure_and_deny_changed_identity() {
    let path=fixture();
    let mut s=SyncStore::open(&path,"p","u","w").unwrap();
    let db=Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'disk failure'); END;").unwrap();
    assert!(s.append(0,b"lost",true).is_err());
    assert!(s.load(0).unwrap().is_empty());
    db.execute("UPDATE account SET user_id='other' WHERE id=1",[]).unwrap();
    assert!(matches!(s.append(0,b"bad",true),Err(StoreError::Denied)));
    drop(db);drop(s); std::fs::remove_file(path).unwrap();
}

#[test]
fn cached_rights_limit_content_and_allow_comments() {
    let path=fixture();
    let db=Connection::open(&path).unwrap();
    db.execute("INSERT INTO account_page_access VALUES('w','p','comment')",[]).unwrap();
    let mut s=SyncStore::open(&path,"p","u","w").unwrap();
    assert!(matches!(s.append(0,b"x",true),Err(StoreError::Denied)));
    s.append(1,b"x",true).unwrap();
    assert!(SyncStore::open(&path,"p","u","other").is_err());
    drop(db);drop(s);std::fs::remove_file(path).unwrap();
}


#[test]
fn ffi_original_schema_and_revoked_access_archive() {
    use std::ffi::CString;
    use worlds_collaboration::*;
    let src=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../WorldsCore/Tests/WorldsCollaborationTests/worlds-collab-v11.db");
    let path=isolated_path();
    std::fs::copy(src,&path).unwrap();
    let path_s=CString::new(path.to_str().unwrap()).unwrap();
    let page=CString::new("fixture-page").unwrap(); let user=CString::new("fixture-user").unwrap(); let workspace=CString::new("fixture-workspace").unwrap();
    let id=CString::new("f1f468d2-3b01-4fe0-a2de-df352089d21d").unwrap(); let reason=CString::new("denied").unwrap();
    let mut store=std::ptr::null_mut();
    unsafe {
        assert_eq!(worlds_store_open(path_s.as_ptr(),page.as_ptr(),user.as_ptr(),workspace.as_ptr(),&mut store),0);
        assert_eq!(worlds_store_append(store,0,[0u8,0].as_ptr(),2,1),0);
        let mut vector=WorldsBuffer{data:std::ptr::null_mut(),len:0};
        assert_eq!(worlds_store_load(store,0,&mut vector),0);
        assert_eq!(&std::slice::from_raw_parts(vector.data,vector.len)[..8],&1u64.to_le_bytes());
        worlds_buffer_free(vector);
        let db=Connection::open(&path).unwrap();
        db.execute("DELETE FROM account_workspaces WHERE id='fixture-workspace'",[]).unwrap();
        assert_eq!(worlds_store_reject(store,0,id.as_ptr(),[0u8,0].as_ptr(),2,reason.as_ptr()),0);
        let state:String=db.query_row("SELECT state FROM sync_outbox",[],|r|r.get(0)).unwrap(); assert_eq!(state,"rejected");
        db.execute("UPDATE account SET user_id='other'",[]).unwrap();
        assert_eq!(worlds_store_reject(store,0,id.as_ptr(),[0u8,0].as_ptr(),2,reason.as_ptr()),3);
        drop(db);worlds_store_free(store);
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn editor_transaction_rejects_stale_and_rolls_back_outbox_failure() {
    let path = fixture();
    let base = include_bytes!("fixtures/plain-editor.bin");
    let mut store = SyncStore::open(&path, "p", "u", "w").unwrap();
    store.append(0, base, false).unwrap();
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_editor BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'failure'); END;").unwrap();
    assert!(store.insert_plain_checked(base, 0, "block-1", "Hello 🌍", 6, "Alice ").is_err());
    assert_eq!(store.load(0).unwrap().len(), 1);
    assert_eq!(store.max_pending(0).unwrap(), None);
    db.execute_batch("DROP TRIGGER fail_editor;").unwrap();
    let update = store.insert_plain_checked(base, 0, "block-1", "Hello 🌍", 6, "Alice ").unwrap();
    assert!(!update.is_empty());
    assert_eq!(store.load(0).unwrap().len(), 2);
    assert!(store.max_pending(0).unwrap().is_some());
    assert!(matches!(store.insert_plain_checked(base, 0, "block-1", "Hello 🌍", 6, "Bob "), Err(StoreError::Conflict)));
    drop(store);
    let mut reopened = SyncStore::open(&path, "p", "u", "w").unwrap();
    assert_eq!(reopened.load(0).unwrap().len(), 2);
    db.execute("UPDATE account_workspaces SET default_level='view' WHERE id='w'", []).unwrap();
    assert!(matches!(reopened.insert_plain_checked(base, 0, "block-1", "Hello 🌍", 6, "x"), Err(StoreError::Denied)));
    drop(db); drop(reopened); std::fs::remove_file(path).unwrap();
}

#[test]
fn editor_ffi_commits_and_reports_stale_base() {
    use std::ffi::CString;
    use worlds_collaboration::*;
    let path = fixture(); let base = include_bytes!("fixtures/plain-editor.bin");
    let mut setup = SyncStore::open(&path, "p", "u", "w").unwrap();
    setup.append(0, base, false).unwrap(); drop(setup);
    let strings: Vec<CString> = [path.to_str().unwrap(), "p", "u", "w", "block-1", "Hello 🌍", "Alice "].iter().map(|s| CString::new(*s).unwrap()).collect();
    let mut handle = std::ptr::null_mut();
    unsafe {
        assert_eq!(worlds_store_open(strings[0].as_ptr(), strings[1].as_ptr(), strings[2].as_ptr(), strings[3].as_ptr(), &mut handle), 0);
        let mut out = WorldsBuffer { data: std::ptr::null_mut(), len: 0 };
        assert_eq!(worlds_store_insert_plain_checked(handle, base.as_ptr(), base.len(), 0, strings[4].as_ptr(), strings[5].as_ptr(), 6, strings[6].as_ptr(), &mut out), 0);
        assert!(out.len > 0); worlds_buffer_free(out);
        let mut stale = WorldsBuffer { data: std::ptr::null_mut(), len: 0 };
        assert_eq!(worlds_store_insert_plain_checked(handle, base.as_ptr(), base.len(), 0, strings[4].as_ptr(), strings[5].as_ptr(), 6, strings[6].as_ptr(), &mut stale), 5);
        assert!(stale.data.is_null()); worlds_store_free(handle);
    }
    std::fs::remove_file(path).unwrap();
}
