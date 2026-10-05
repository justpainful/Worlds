//! Storage guarantees: migrations, saving, history, versions and undo.
//! Each test runs against its own fresh database file.

use crate::db;
use crate::store::{self, BlockInput, Ctx, NewPage, PagePatch};
use serde_json::{json, Value};
use std::path::PathBuf;

fn temp_db(name: &str) -> (PathBuf, rusqlite::Connection) {
    let dir = std::env::temp_dir().join(format!("worlds-store-{name}-{}", db::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("worlds.db")).unwrap();
    (dir, conn)
}

fn para(text: &str) -> Value {
    json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })
}

fn input(blocks: &[(&str, &str)]) -> Vec<BlockInput> {
    blocks.iter().map(|(id, text)| BlockInput { id: id.to_string(), content: para(text) }).collect()
}

fn texts(conn: &rusqlite::Connection, page: &str) -> Vec<String> {
    store::blocks_of(conn, page).unwrap().iter().map(|b| crate::content::plain_text(&b.content)).collect()
}

fn new_page(conn: &rusqlite::Connection, title: &str) -> String {
    store::create_page(conn, &Ctx::user(), NewPage { title: Some(title.into()), ..Default::default() }).unwrap().id
}

fn user_save(conn: &rusqlite::Connection, page: &str, blocks: &[(&str, &str)]) -> store::SaveResult {
    store::snapshot_before_user_edit(conn, page).unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    let r = store::save_blocks(&tx, &Ctx::user(), page, input(blocks)).unwrap();
    tx.commit().unwrap();
    r
}

#[test]
fn migrations_reach_latest_and_reopen_cleanly() {
    let (dir, conn) = temp_db("migrate");
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, db::schema_version());
    drop(conn);
    // Opening again must not re-run or fail any migration.
    let conn = db::open(&dir.join("worlds.db")).unwrap();
    let v2: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v2, v);
    let ok: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(ok, "ok");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn save_roundtrip_keeps_order_and_content() {
    let (dir, conn) = temp_db("save");
    let page = new_page(&conn, "Notes");
    user_save(&conn, &page, &[("a", "first"), ("b", "second"), ("c", "third")]);
    assert_eq!(texts(&conn, &page), ["first", "second", "third"]);
    // Reorder and edit in one save.
    let r = user_save(&conn, &page, &[("c", "third"), ("a", "first!"), ("b", "second")]);
    assert_eq!(r.added, 0);
    assert_eq!(r.removed, 0);
    assert_eq!(r.changed, 1);
    assert_eq!(texts(&conn, &page), ["third", "first!", "second"]);
    // Saving the same thing again changes nothing.
    let r = user_save(&conn, &page, &[("c", "third"), ("a", "first!"), ("b", "second")]);
    assert_eq!(r.added + r.changed + r.removed, 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn duplicate_block_ids_never_duplicate_or_steal() {
    let (dir, conn) = temp_db("dupes");
    let one = new_page(&conn, "One");
    let two = new_page(&conn, "Two");
    user_save(&conn, &one, &[("x", "on page one")]);
    // The same id twice in one save (a paste) gets a fresh id for the copy.
    let r = user_save(&conn, &two, &[("y", "a"), ("y", "b")]);
    assert_eq!(r.added, 2);
    assert_eq!(r.remapped.len(), 1);
    // An id that belongs to another page is never moved off that page.
    user_save(&conn, &two, &[("x", "copied block")]);
    assert_eq!(texts(&conn, &one), ["on page one"]);
    assert_eq!(texts(&conn, &two), ["copied block"]);
    let ids: i64 = conn.query_row("SELECT COUNT(DISTINCT id) - COUNT(*) FROM blocks", [], |r| r.get(0)).unwrap();
    assert_eq!(ids, 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn user_edits_are_recorded_and_versions_restore() {
    let (dir, conn) = temp_db("versions");
    let page = new_page(&conn, "Draft");
    user_save(&conn, &page, &[("a", "v1")]);
    let v = store::snapshot(&conn, &page, "user", None, Some("checkpoint")).unwrap();
    store::update_page(&conn, &Ctx::user(), &page, PagePatch { title: Some("Renamed".into()), ..Default::default() }).unwrap();
    user_save(&conn, &page, &[("a", "v2"), ("b", "more")]);
    assert!(!store::list_history(&conn, Some(&page), None, 50).unwrap().is_empty());

    store::restore_version(&conn, &Ctx::user(), &v).unwrap();
    assert_eq!(texts(&conn, &page), ["v1"]);
    assert_eq!(store::page_meta_by_id(&conn, &page).unwrap().unwrap().title, "Draft");
    // Restoring keeps what it replaced as a version of its own.
    let versions = store::list_versions(&conn, &page).unwrap();
    assert!(versions.iter().any(|v| v.label.as_deref() == Some("Before restore")));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn claude_changes_undo_as_one_operation() {
    let (dir, conn) = temp_db("undo");
    let page = new_page(&conn, "Plan");
    user_save(&conn, &page, &[("a", "mine")]);
    let ai = Ctx { actor: "ai".into(), op_id: Some("op-1".into()), origin: "mcp".into() };
    store::insert_blocks(&conn, &ai, &page, None, vec![para("from claude"), para("and more")]).unwrap();
    store::insert_blocks(&conn, &ai, &page, Some(&store::blocks_of(&conn, &page).unwrap()[0].id), vec![para("in between")]).unwrap();
    assert_eq!(texts(&conn, &page).len(), 4);
    store::undo_op(&conn, &Ctx::user(), "op-1").unwrap();
    assert_eq!(texts(&conn, &page), ["mine"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn delete_restore_and_archive_keep_content() {
    let (dir, conn) = temp_db("trash");
    let page = new_page(&conn, "Keep me");
    user_save(&conn, &page, &[("a", "body")]);
    store::delete_page(&conn, &Ctx::user(), &page).unwrap();
    store::restore_page(&conn, &Ctx::user(), &page).unwrap();
    assert_eq!(texts(&conn, &page), ["body"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn saves_based_on_an_old_sync_are_detected() {
    let (dir, conn) = temp_db("conflict");
    let page = new_page(&conn, "Shared");
    let synced = user_save(&conn, &page, &[("a", "mine")]).updated_at;
    assert!(!store::page_changed_since(&conn, &page, synced).unwrap());
    std::thread::sleep(std::time::Duration::from_millis(5));
    // Claude adds a block after the editor synced.
    let ai = Ctx { actor: "ai".into(), op_id: Some("op-c".into()), origin: "mcp".into() };
    store::insert_blocks(&conn, &ai, &page, None, vec![para("claude")]).unwrap();
    // A full-list save from the editor would now delete Claude's block: it must be refused.
    assert!(store::page_changed_since(&conn, &page, synced).unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn attachment_names_are_plain_names() {
    assert_eq!(store::clean_file_name(r"C:\Users\me\Desktop\photo.png"), "photo.png");
    assert_eq!(store::clean_file_name("../../etc/passwd"), "passwd");
    assert_eq!(store::clean_file_name("a<b>c:d?.txt"), "abcd.txt");
    assert_eq!(store::clean_file_name("   "), "file");
    assert_eq!(store::clean_file_name("\u{0}\u{7}x.pdf"), "x.pdf");
}

#[test]
fn resource_kinds_are_validated_and_searchable() {
    let (dir, conn) = temp_db("kinds");
    // Unknown kinds are refused; every known kind is accepted.
    assert!(store::create_page(&conn, &Ctx::user(), NewPage { kind: Some("spreadsheet".into()), ..Default::default() }).is_err());
    for k in ["document", "presentation", "project", "gallery", "file", "stream"] {
        let p =
            store::create_page(&conn, &Ctx::user(), NewPage { title: Some(format!("A {k}")), kind: Some(k.into()), ..Default::default() })
                .unwrap();
        assert_eq!(p.kind, k);
        assert!(store::is_resource(&p.kind));
    }
    assert!(!store::is_resource("template"));

    // Slide text is indexed like block text.
    let deck = store::create_page(
        &conn,
        &Ctx::user(),
        NewPage { title: Some("Deck".into()), kind: Some("presentation".into()), ..Default::default() },
    )
    .unwrap();
    let slide = json!({ "type": "slide", "attrs": { "layout": "title", "notes": "remember the zebra", "elements": [{ "id": "e1", "type": "text", "text": "Quarterly kiwi numbers" }] } });
    store::insert_blocks(&conn, &Ctx::user(), &deck.id, None, vec![slide]).unwrap();
    store::index_page(&conn, &deck.id).unwrap();
    assert!(store::search(&conn, "kiwi", 10, false).unwrap().iter().any(|h| h.page_id == deck.id));
    assert!(store::search(&conn, "zebra", 10, false).unwrap().iter().any(|h| h.page_id == deck.id));

    // A stream's link is searchable through its metadata.
    let stream =
        store::create_page(&conn, &Ctx::user(), NewPage { title: Some("Live".into()), kind: Some("stream".into()), ..Default::default() })
            .unwrap();
    store::set_page_meta(
        &conn,
        &Ctx::user(),
        &stream.id,
        "stream",
        json!({ "url": "https://cdn.example.com/channel-forty/index.m3u8", "format": "hls" }),
    )
    .unwrap();
    assert!(store::search(&conn, "channel-forty", 10, false).unwrap().iter().any(|h| h.page_id == stream.id));
    // Metadata keys are written one at a time and never clobber each other.
    store::set_page_meta(&conn, &Ctx::user(), &stream.id, "look", json!({ "full": true })).unwrap();
    let meta: String = conn.query_row("SELECT metadata FROM pages WHERE id = ?1", [&stream.id], |r| r.get(0)).unwrap();
    let meta: Value = serde_json::from_str(&meta).unwrap();
    assert_eq!(meta["stream"]["format"], "hls");
    assert_eq!(meta["look"]["full"], true);
    let _ = std::fs::remove_dir_all(&dir);
}
