//! Migration 6, the local replica, the outbox and the block mirror.

use super::*;
use crate::db;
use crate::store::{BlockInput, NewPage};
use serde_json::json;
use std::path::PathBuf;

const SYNC_TABLES: [&str; 5] = ["sync_docs", "sync_updates", "sync_outbox", "sync_cursors", "sync_attachment_queue"];

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("worlds-sync-{name}-{}", db::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh(name: &str) -> Connection {
    db::open(&temp_dir(name).join("worlds.db")).unwrap()
}

fn page(conn: &Connection, title: &str) -> String {
    store::create_page(conn, &Ctx::user(), NewPage { title: Some(title.into()), ..Default::default() }).unwrap().id
}

fn para(id: &str, text: &str) -> BlockInput {
    BlockInput {
        id: id.into(),
        content: json!({ "type": "paragraph", "attrs": { "bid": id }, "content": [{ "type": "text", "text": text }] }),
    }
}

fn user_version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
}

fn tables(conn: &Connection) -> Vec<String> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").unwrap();
    stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
}

#[test]
fn migration_6_on_a_fresh_database() {
    let conn = fresh("fresh");
    assert_eq!(user_version(&conn), db::schema_version());
    assert!(db::schema_version() >= 6);
    let names = tables(&conn);
    for t in SYNC_TABLES {
        assert!(names.iter().any(|n| n == t), "missing {t}");
    }
    // Migration 5's columns are there for the mode check.
    assert!(has_column(&conn, "pages", "workspace_id").unwrap());
}

#[test]
fn migration_6_upgrades_a_version_5_database_and_keeps_data() {
    let dir = temp_dir("upgrade");
    let path = dir.join("worlds.db");
    let id;
    {
        let conn = db::open(&path).unwrap();
        id = page(&conn, "Kept");
        let tx = conn.unchecked_transaction().unwrap();
        store::save_blocks(&tx, &Ctx::user(), &id, vec![para("b1", "hello")]).unwrap();
        tx.commit().unwrap();
        conn.execute("UPDATE pages SET workspace_id = 'team' WHERE id = ?1", [&id]).unwrap();
        // Roll the schema back to exactly what version 5 had.
        for t in SYNC_TABLES {
            conn.execute_batch(&format!("DROP TABLE {t}")).unwrap();
        }
        conn.execute_batch("PRAGMA user_version = 5").unwrap();
    }
    let conn = db::open(&path).unwrap();
    assert_eq!(user_version(&conn), db::schema_version());
    let names = tables(&conn);
    for t in SYNC_TABLES {
        assert!(names.iter().any(|n| n == t), "missing {t} after upgrade");
    }
    let blocks = store::blocks_of(&conn, &id).unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(crate::content::plain_text(&blocks[0].content), "hello");
    let mode = page_mode(&conn, &id).unwrap();
    assert_eq!(mode, PageMode { shared: true, workspace_id: Some("team".into()), flagged: false });
    // And the new tables work against the upgraded data.
    append(&conn, &id, CHANNEL_CONTENT, b"u1", "local", true).unwrap();
    assert_eq!(outbox_list(&conn, Some(&id), 10).unwrap().len(), 1);
}

#[test]
fn shared_flag_switches_mode() {
    let conn = fresh("flag");
    let id = page(&conn, "Flag");
    assert!(!page_mode(&conn, &id).unwrap().shared);
    let on = set_shared(&conn, &id, true).unwrap();
    assert!(on.shared && on.flagged && on.workspace_id.is_none());
    assert!(!set_shared(&conn, &id, false).unwrap().shared);
}

#[test]
fn update_log_loads_in_order_and_compacts() {
    let conn = fresh("log");
    let id = page(&conn, "Log");
    for (i, d) in [b"a".as_slice(), b"b", b"c"].iter().enumerate() {
        let r = append(&conn, &id, CHANNEL_CONTENT, d, "local", false).unwrap();
        assert_eq!(r.log_len, i as i64 + 1);
        assert!(r.outbox_id.is_none());
    }
    append(&conn, &id, CHANNEL_COMMENTS, b"x", "remote", false).unwrap();
    let l = load(&conn, &id, CHANNEL_CONTENT).unwrap();
    assert_eq!(l.updates, vec![b64(b"a"), b64(b"b"), b64(b"c")]);
    assert!(l.snapshot.is_none());

    // Compact the first two; the third (written after) stays in the log.
    let second = conn.query_row("SELECT id FROM sync_updates WHERE data = ?1", [b"b".as_slice()], |r| r.get::<_, i64>(0)).unwrap();
    compact(&conn, &id, CHANNEL_CONTENT, b"AB", second).unwrap();
    let l = load(&conn, &id, CHANNEL_CONTENT).unwrap();
    assert_eq!(l.snapshot, Some(b64(b"AB")));
    assert_eq!(l.updates, vec![b64(b"c")]);
    // Channels are independent.
    assert_eq!(load(&conn, &id, CHANNEL_COMMENTS).unwrap().updates, vec![b64(b"x")]);
    assert!(load(&conn, &id, 7).is_err());
}

#[test]
fn outbox_survives_until_acknowledged() {
    let conn = fresh("outbox");
    let id = page(&conn, "Outbox");
    let other = page(&conn, "Other");
    let a = append(&conn, &id, CHANNEL_CONTENT, b"1", "local", true).unwrap().outbox_id.unwrap();
    let b = append(&conn, &id, CHANNEL_COMMENTS, b"2", "local", true).unwrap().outbox_id.unwrap();
    let c = append(&conn, &id, CHANNEL_CONTENT, b"3", "local", true).unwrap().outbox_id.unwrap();
    append(&conn, &other, CHANNEL_CONTENT, b"9", "local", true).unwrap();
    append(&conn, &id, CHANNEL_CONTENT, b"r", "remote", false).unwrap();

    assert_eq!(outbox_list(&conn, None, 100).unwrap().len(), 4);
    let mine = outbox_list(&conn, Some(&id), 100).unwrap();
    assert_eq!(mine.iter().map(|o| o.id).collect::<Vec<_>>(), vec![a, b, c]);
    assert_eq!(mine[0].data, b64(b"1"));

    // A network failure keeps entries pending and counts attempts.
    outbox_fail(&conn, &[a], "offline").unwrap();
    let again = outbox_list(&conn, Some(&id), 100).unwrap();
    assert_eq!(again[0].attempts, 1);

    // Reopening the database (a restart) keeps the queue.
    let st = page_status(&conn, &id).unwrap();
    assert_eq!(st.pending, 3);

    outbox_ack(&conn, &[b]).unwrap();
    // A full-state handshake covers everything up to a point, per channel.
    assert_eq!(outbox_max_id(&conn, &id, CHANNEL_CONTENT).unwrap(), c);
    assert_eq!(outbox_ack_upto(&conn, &id, CHANNEL_CONTENT, a).unwrap(), 1);
    assert_eq!(outbox_list(&conn, Some(&id), 100).unwrap().iter().map(|o| o.id).collect::<Vec<_>>(), vec![c]);

    // A refusal is kept aside, not dropped.
    outbox_reject(&conn, &[c], "view access cannot edit the page").unwrap();
    assert!(outbox_list(&conn, Some(&id), 100).unwrap().is_empty());
    let st = page_status(&conn, &id).unwrap();
    assert_eq!((st.pending, st.rejected), (0, 1));

    let all = status(&conn).unwrap();
    assert_eq!(all.pending, 1); // the other page
    assert_eq!(all.rejected, 1);

    purge(&conn, &id).unwrap();
    assert_eq!(page_status(&conn, &id).unwrap().rejected, 0);
    assert!(load(&conn, &id, CHANNEL_CONTENT).unwrap().updates.is_empty());
}

#[test]
fn outbox_persists_across_restart() {
    let dir = temp_dir("restart");
    let path = dir.join("worlds.db");
    let id;
    {
        let conn = db::open(&path).unwrap();
        id = page(&conn, "Restart");
        append(&conn, &id, CHANNEL_CONTENT, b"typed offline", "local", true).unwrap();
    }
    let conn = db::open(&path).unwrap();
    let items = outbox_list(&conn, Some(&id), 10).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(unb64(&items[0].data).unwrap(), b"typed offline");
}

#[test]
fn cursors_record_sync_state() {
    let conn = fresh("cursor");
    let id = page(&conn, "Cursor");
    cursor_set(
        &conn,
        &id,
        CHANNEL_CONTENT,
        &CursorInput { server_vector: Some(b64(b"sv")), level: Some("edit".into()), synced: true, error: None },
    )
    .unwrap();
    let st = page_status(&conn, &id).unwrap();
    assert_eq!(st.level.as_deref(), Some("edit"));
    assert!(st.synced_at.is_some());
    cursor_set(&conn, &id, CHANNEL_CONTENT, &CursorInput { error: Some("offline".into()), ..Default::default() }).unwrap();
    let st = page_status(&conn, &id).unwrap();
    assert_eq!(st.last_error.as_deref(), Some("offline"));
    assert_eq!(st.level.as_deref(), Some("edit"), "level kept when not given");
}

#[test]
fn mirror_refuses_to_overwrite_unseen_block_changes() {
    let conn = fresh("mirror");
    let id = page(&conn, "Mirror");
    let start = mirror_check(&conn, &id).unwrap();
    assert!(start.mirror_rev.is_none());

    // The editor mirrors its Yjs document into the rows.
    let w = mirror_write(&conn, &id, vec![para("b1", "one"), para("b2", "two")], &start.current_rev, b"state-1").unwrap();
    let MirrorOutcome::Written { rev, .. } = w else { panic!("expected a write") };
    // Nothing to keep yet: the page was empty before its first mirror.
    assert!(store::list_versions(&conn, &id).unwrap().iter().all(|v| v.label.as_deref() != Some("Before live sync")));
    let ok = mirror_check(&conn, &id).unwrap();
    assert_eq!(ok.mirror_rev.as_deref(), Some(rev.as_str()));
    assert_eq!(ok.current_rev, rev);
    assert!(ok.current.is_none());
    assert_eq!(ok.mirror_state, Some(b64(b"state-1")));

    // Claude edits a block through the store (MCP path).
    let ai = Ctx { actor: "ai".into(), op_id: Some("op".into()), origin: "mcp".into() };
    store::update_block(&conn, &ai, "b2", json!({ "type": "paragraph", "content": [{ "type": "text", "text": "two, by Claude" }] }))
        .unwrap();

    // The next mirror write from the editor must not overwrite it.
    let refused = mirror_write(&conn, &id, vec![para("b1", "one!"), para("b2", "two")], &rev, b"state-2").unwrap();
    let MirrorOutcome::Conflict { current_rev, current } = refused else { panic!("expected a conflict") };
    assert_eq!(crate::content::plain_text(&current[1]), "two, by Claude");
    let check = mirror_check(&conn, &id).unwrap();
    assert_eq!(check.current.as_ref().map(|c| c.len()), Some(2));
    assert_eq!(check.mirror_state, Some(b64(b"state-1")), "fold base is the last mirrored state");

    // After folding, the editor writes against the revision it saw.
    let merged = mirror_write(&conn, &id, vec![para("b1", "one!"), para("b2", "two, by Claude")], &current_rev, b"state-3").unwrap();
    assert!(matches!(merged, MirrorOutcome::Written { .. }));
    let texts: Vec<String> = store::blocks_of(&conn, &id).unwrap().iter().map(|b| crate::content::plain_text(&b.content)).collect();
    assert_eq!(texts, vec!["one!", "two, by Claude"]);
    // Search sees the mirrored text.
    let hits = store::search(&conn, "Claude", 10, false).unwrap();
    assert!(hits.iter().any(|h| h.page_id == id));
}

#[test]
fn mirror_adopt_records_a_seed_without_writing() {
    let conn = fresh("adopt");
    let id = page(&conn, "Adopt");
    let tx = conn.unchecked_transaction().unwrap();
    store::save_blocks(&tx, &Ctx::user(), &id, vec![para("b1", "seed")]).unwrap();
    tx.commit().unwrap();
    let c = mirror_check(&conn, &id).unwrap();
    assert!(c.current.is_some());
    assert!(matches!(mirror_adopt(&conn, &id, &c.current_rev, b"seeded").unwrap(), MirrorOutcome::Written { .. }));
    let after = mirror_check(&conn, &id).unwrap();
    assert!(after.current.is_none());
    // A first mirror over existing rows keeps them as a version.
    let other = page(&conn, "Adopted from server");
    let tx = conn.unchecked_transaction().unwrap();
    store::save_blocks(&tx, &Ctx::user(), &other, vec![para("old", "local only")]).unwrap();
    tx.commit().unwrap();
    let c = mirror_check(&conn, &other).unwrap();
    mirror_write(&conn, &other, vec![para("srv", "from the server")], &c.current_rev, b"s").unwrap();
    let versions = store::list_versions(&conn, &other).unwrap();
    assert!(versions.iter().any(|v| v.label.as_deref() == Some("Before live sync")));
    assert!(matches!(mirror_adopt(&conn, &id, "stale", b"x").unwrap(), MirrorOutcome::Conflict { .. }));
}

#[test]
fn attachment_queue_tracks_resumable_uploads() {
    let conn = fresh("attach");
    let id = page(&conn, "Files");
    let t = db::now();
    conn.execute(
        "INSERT INTO attachments (id, page_id, kind, file_name, mime, size, rel_path, created_at) VALUES ('a1', ?1, 'file', 'f.bin', 'application/octet-stream', 10, 'x/f.bin', ?2)",
        rusqlite::params![id, t],
    )
    .unwrap();
    attachment_enqueue(&conn, "a1", Some(&id), Some("team")).unwrap();
    attachment_enqueue(&conn, "a1", None, None).unwrap(); // idempotent
    let q = attachment_queue(&conn, 3).unwrap();
    assert_eq!(q.len(), 1);
    assert_eq!(q[0].workspace_id.as_deref(), Some("team"));
    assert_eq!(q[0].rel_path, "x/f.bin");

    attachment_update(
        &conn,
        "a1",
        &AttachmentProgress {
            status: "uploading".into(),
            sha256: Some("ab".into()),
            size: Some(10),
            parts_done: Some(vec![1]),
            error: None,
        },
    )
    .unwrap();
    let q = attachment_queue(&conn, 3).unwrap();
    assert_eq!(q[0].parts_done, vec![1]);
    for _ in 0..3 {
        attachment_update(
            &conn,
            "a1",
            &AttachmentProgress { status: "failed".into(), error: Some("offline".into()), ..Default::default() },
        )
        .unwrap();
    }
    assert!(attachment_queue(&conn, 3).unwrap().is_empty(), "gives up after max attempts");
    assert_eq!(status(&conn).unwrap().attachments_failed, 1);
    attachment_update(&conn, "a1", &AttachmentProgress { status: "done".into(), ..Default::default() }).unwrap();
    attachment_enqueue(&conn, "a1", None, None).unwrap();
    assert!(attachment_queue(&conn, 3).unwrap().is_empty(), "done stays done");
    assert!(attachment_update(&conn, "a1", &AttachmentProgress { status: "weird".into(), ..Default::default() }).is_err());
}
