//! Migration 5, authorship stamping, the permission check and Claude's guard.

use super::permissions::{filter_result, guarded_tool_call, page_level, Level};
use super::secrets::{pkce, refresh_message, sha256_hex, DeviceKey, MemoryStore, SecretStore};
use super::state::{self, Account, Workspace};
use crate::db;
use crate::store::{self, Ctx, NewPage, PagePatch};
use serde_json::{json, Value};
use std::path::PathBuf;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("worlds-account-{name}-{}", db::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh(name: &str) -> rusqlite::Connection {
    let conn = db::open(&temp_dir(name).join("worlds.db")).unwrap();
    store::profile(&conn).unwrap();
    conn
}

fn page(conn: &rusqlite::Connection, title: &str, parent: Option<&str>) -> String {
    store::create_page(
        conn,
        &Ctx::user(),
        NewPage { title: Some(title.into()), parent_id: parent.map(str::to_string), ..Default::default() },
    )
    .unwrap()
    .id
}

fn col(conn: &rusqlite::Connection, id: &str, column: &str) -> Option<String> {
    conn.query_row(&format!("SELECT {column} FROM pages WHERE id = ?1"), [id], |r| r.get(0)).unwrap()
}

fn sign_in(conn: &rusqlite::Connection, user: &str) {
    state::save_account(
        conn,
        &Account {
            user_id: user.into(),
            email: format!("{user}@example.com"),
            display_name: user.into(),
            avatar_url: None,
            device_id: "dev-1".into(),
            device_name: "Test PC".into(),
            server_url: "http://localhost:8787".into(),
            status: "active".into(),
            signed_in_at: db::now(),
            last_sync_at: None,
            last_error: None,
        },
    )
    .unwrap();
}

fn join(conn: &rusqlite::Connection, ws: &str, role: &str, default_level: &str) {
    state::upsert_workspace(
        conn,
        &Workspace {
            id: ws.into(),
            name: "Team".into(),
            role: role.into(),
            owner_id: None,
            default_level: default_level.into(),
            member_count: 2,
        },
    )
    .unwrap();
}

fn table_exists(conn: &rusqlite::Connection, name: &str) -> bool {
    conn.query_row("SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name = ?1)", [name], |r| r.get(0)).unwrap()
}

fn page_columns(conn: &rusqlite::Connection) -> Vec<String> {
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info('pages')").unwrap();
    stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
}

// ---------------------------------------------------------------------------
// Migration 5
// ---------------------------------------------------------------------------

#[test]
fn migration_5_on_a_fresh_database() {
    let conn = fresh("fresh");
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 5);
    assert_eq!(db::schema_version(), 5);
    for t in ["account", "account_workspaces", "account_members", "account_page_access"] {
        assert!(table_exists(&conn, t), "{t} missing");
    }
    let cols = page_columns(&conn);
    for c in ["workspace_id", "created_by", "updated_by"] {
        assert!(cols.contains(&c.to_string()), "pages.{c} missing");
    }
    // No account: pages are Personal and authored by the local profile.
    let profile = store::profile(&conn).unwrap();
    let id = page(&conn, "Notes", None);
    assert_eq!(col(&conn, &id, "workspace_id"), None);
    assert_eq!(col(&conn, &id, "created_by"), Some(profile.id.clone()));
    assert_eq!(col(&conn, &id, "updated_by"), Some(profile.id));
}

#[test]
fn migration_5_upgrades_a_version_4_database_and_keeps_its_pages() {
    let dir = temp_dir("upgrade");
    let path = dir.join("worlds.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        for (i, sql) in db::MIGRATIONS[..4].iter().enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.execute_batch(&format!("PRAGMA user_version = {}", i + 1)).unwrap();
        }
        conn.execute("INSERT INTO profile (id, display_name, created_at, updated_at) VALUES ('local-profile', 'Me', 1, 1)", []).unwrap();
        conn.execute("INSERT INTO pages (id, title, created_at, updated_at) VALUES ('old-page', 'From v4', 1, 1)", []).unwrap();
        conn.execute(
            "INSERT INTO blocks (id, page_id, type, sort_key, content, created_at, updated_at) VALUES ('b1', 'old-page', 'paragraph', 1, '{\"type\":\"paragraph\"}', 1, 1)",
            [],
        )
        .unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 4);
        assert!(!page_columns(&conn).contains(&"workspace_id".to_string()));
    }
    let conn = db::open(&path).unwrap();
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 5);
    // Existing data is untouched: Personal, no invented authorship.
    assert_eq!(col(&conn, "old-page", "title"), Some("From v4".into()));
    assert_eq!(col(&conn, "old-page", "workspace_id"), None);
    assert_eq!(col(&conn, "old-page", "created_by"), None);
    assert_eq!(store::blocks_of(&conn, "old-page").unwrap().len(), 1);
    // Editing it now records the author.
    store::update_page(&conn, &Ctx::user(), "old-page", PagePatch { title: Some("Renamed".into()), ..Default::default() }).unwrap();
    assert_eq!(col(&conn, "old-page", "updated_by"), Some("local-profile".into()));
    // Opening again is a no-op.
    drop(conn);
    let conn = db::open(&path).unwrap();
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 5);
}

#[test]
fn new_pages_join_the_active_team_workspace_and_record_their_author() {
    let conn = fresh("assign");
    let personal = page(&conn, "Personal root", None);
    sign_in(&conn, "user-a");
    join(&conn, "ws-1", "member", "edit");
    state::set_active_workspace(&conn, Some("ws-1")).unwrap();

    let team_root = page(&conn, "Team root", None);
    assert_eq!(col(&conn, &team_root, "workspace_id"), Some("ws-1".into()));
    assert_eq!(col(&conn, &team_root, "created_by"), Some("user-a".into()));
    // Children follow their parent, whatever is active.
    let team_child = page(&conn, "Team child", Some(&team_root));
    assert_eq!(col(&conn, &team_child, "workspace_id"), Some("ws-1".into()));
    let personal_child = page(&conn, "Personal child", Some(&personal));
    assert_eq!(col(&conn, &personal_child, "workspace_id"), None);
    // Templates are never shared by accident.
    let t =
        store::create_page(&conn, &Ctx::user(), NewPage { title: Some("T".into()), kind: Some("template".into()), ..Default::default() })
            .unwrap();
    assert_eq!(col(&conn, &t.id, "workspace_id"), None);

    // Back to Personal: new top-level pages stay local.
    state::set_active_workspace(&conn, None).unwrap();
    let local = page(&conn, "Local again", None);
    assert_eq!(col(&conn, &local, "workspace_id"), None);

    // Claude's writes (origin mcp) stamp updated_by with the signed-in user.
    conn.execute("UPDATE pages SET updated_by = 'someone-else' WHERE id = ?1", [&team_root]).unwrap();
    let ai = Ctx { actor: "ai".into(), op_id: Some("op".into()), origin: "mcp".into() };
    store::update_page(&conn, &ai, &team_root, PagePatch { title: Some("By Claude".into()), ..Default::default() }).unwrap();
    assert_eq!(col(&conn, &team_root, "updated_by"), Some("user-a".into()));
    // Writes from elsewhere (another origin, e.g. sync) keep their own author.
    conn.execute("UPDATE pages SET updated_by = 'user-b' WHERE id = ?1", [&team_root]).unwrap();
    db::mark_change(&conn, Some(&team_root), "page", "sync").unwrap();
    assert_eq!(col(&conn, &team_root, "updated_by"), Some("user-b".into()));
}

#[test]
fn an_unknown_active_workspace_is_ignored() {
    let conn = fresh("stale-active");
    db::set_setting(&conn, state::ACTIVE_WORKSPACE, &json!("gone")).unwrap();
    let id = page(&conn, "Page", None);
    assert_eq!(col(&conn, &id, "workspace_id"), None);
    assert!(state::set_active_workspace(&conn, Some("gone")).is_err());
}

// ---------------------------------------------------------------------------
// The permission check
// ---------------------------------------------------------------------------

fn team_fixture(name: &str, role: &str) -> (rusqlite::Connection, String, String, String) {
    let conn = fresh(name);
    sign_in(&conn, "user-a");
    join(&conn, "ws-1", role, "edit");
    state::set_active_workspace(&conn, Some("ws-1")).unwrap();
    let root = page(&conn, "Handbook", None);
    let child = page(&conn, "Salaries", Some(&root));
    let grandchild = page(&conn, "2026", Some(&child));
    state::set_active_workspace(&conn, None).unwrap();
    (conn, root, child, grandchild)
}

#[test]
fn personal_pages_are_unrestricted() {
    let conn = fresh("personal");
    let id = page(&conn, "Mine", None);
    assert_eq!(page_level(&conn, &id).unwrap(), Level::Full);
    assert_eq!(page_level(&conn, "does-not-exist").unwrap(), Level::Full);
}

#[test]
fn team_pages_follow_cached_rights_with_inheritance_and_role_defaults() {
    let (conn, root, child, grandchild) = team_fixture("levels", "member");
    // Nothing cached yet: the Member default.
    assert_eq!(page_level(&conn, &root).unwrap(), Level::Edit);
    // Cached rights from the server, including an explicit "none".
    state::replace_access(&conn, "ws-1", "member", "edit", &[(root.clone(), "comment".into()), (child.clone(), "none".into())]).unwrap();
    assert_eq!(page_level(&conn, &root).unwrap(), Level::Comment);
    assert_eq!(page_level(&conn, &child).unwrap(), Level::None);
    // Not mirrored yet: the nearest cached ancestor decides.
    assert_eq!(page_level(&conn, &grandchild).unwrap(), Level::None);
    state::replace_access(&conn, "ws-1", "member", "view", &[]).unwrap();
    assert_eq!(page_level(&conn, &grandchild).unwrap(), Level::View);
}

#[test]
fn owners_admins_guests_and_former_members() {
    let (conn, root, _, _) = team_fixture("roles", "guest");
    assert_eq!(page_level(&conn, &root).unwrap(), Level::None);
    state::replace_access(&conn, "ws-1", "guest", "edit", &[(root.clone(), "view".into())]).unwrap();
    assert_eq!(page_level(&conn, &root).unwrap(), Level::View);
    state::replace_access(&conn, "ws-1", "admin", "edit", &[(root.clone(), "view".into())]).unwrap();
    assert_eq!(page_level(&conn, &root).unwrap(), Level::Full);
    // Removed from the workspace: the cache entry is gone, so is access.
    state::replace_workspaces(&conn, &[]).unwrap();
    assert_eq!(page_level(&conn, &root).unwrap(), Level::None);
}

#[test]
fn signed_out_or_expired_means_no_access_to_team_pages() {
    let (conn, root, _, _) = team_fixture("signed-out", "owner");
    assert_eq!(page_level(&conn, &root).unwrap(), Level::Full);
    state::set_status(&conn, "expired", Some("revoked")).unwrap();
    assert_eq!(page_level(&conn, &root).unwrap(), Level::None);
    state::clear(&conn).unwrap();
    assert_eq!(page_level(&conn, &root).unwrap(), Level::None);
}

// ---------------------------------------------------------------------------
// Claude's guard
// ---------------------------------------------------------------------------

#[test]
fn claude_cannot_read_a_page_the_user_cannot_see() {
    let (conn, root, child, _) = team_fixture("claude-read", "member");
    state::replace_access(&conn, "ws-1", "member", "edit", &[(root.clone(), "edit".into()), (child.clone(), "none".into())]).unwrap();
    let mut ran = false;
    let r = guarded_tool_call(&conn, "pages_read", &json!({ "pageId": child }), |_| {
        ran = true;
        Ok(json!({}))
    });
    assert!(r.unwrap_err().to_string().contains("Permission denied"));
    assert!(!ran, "the tool must not run");
    // Block ids resolve to their page.
    let b = store::insert_blocks(
        &conn,
        &Ctx::user(),
        &child,
        None,
        vec![json!({ "type": "paragraph", "content": [{ "type": "text", "text": "secret" }] })],
    )
    .unwrap();
    assert!(guarded_tool_call(&conn, "blocks_read", &json!({ "blockId": b[0] }), |_| Ok(json!({}))).is_err());
    // A page the user can see is fine.
    assert!(guarded_tool_call(&conn, "pages_read", &json!({ "pageId": root }), |_| Ok(json!({ "ok": true }))).is_ok());
}

#[test]
fn claude_cannot_change_a_page_the_user_can_only_view() {
    let (conn, root, _, _) = team_fixture("claude-write", "member");
    state::replace_access(&conn, "ws-1", "member", "edit", &[(root.clone(), "view".into())]).unwrap();
    let err =
        guarded_tool_call(&conn, "pages_rename", &json!({ "pageId": root, "title": "x" }), |_| Ok(json!({}))).unwrap_err().to_string();
    assert!(err.contains("can only view"), "{err}");
    assert!(err.contains("Handbook"), "{err}");
    // Reading it is fine.
    assert!(guarded_tool_call(&conn, "pages_read", &json!({ "pageId": root }), |_| Ok(json!({}))).is_ok());
    // Deleting needs full access even with edit.
    state::replace_access(&conn, "ws-1", "member", "edit", &[(root.clone(), "edit".into())]).unwrap();
    assert!(guarded_tool_call(&conn, "pages_delete", &json!({ "pageId": root }), |_| Ok(json!({}))).is_err());
}

#[test]
fn a_write_that_reaches_a_protected_page_indirectly_is_refused_and_rolled_back() {
    let (conn, root, child, _) = team_fixture("claude-indirect", "member");
    state::replace_access(&conn, "ws-1", "member", "edit", &[(root.clone(), "edit".into()), (child.clone(), "view".into())]).unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    let ai = Ctx { actor: "ai".into(), op_id: Some("op".into()), origin: "mcp".into() };
    // A bulk tool that names no page but renames the protected one.
    let err = guarded_tool_call(&tx, "pages_rename_many", &json!({ "prefix": "x " }), |c| {
        store::update_page(c, &ai, &child, PagePatch { title: Some("x Salaries".into()), ..Default::default() })?;
        Ok(json!({ "renamed": 1 }))
    })
    .unwrap_err()
    .to_string();
    assert!(err.contains("nothing was changed"), "{err}");
    drop(tx); // the MCP server never commits a failed call
    assert_eq!(col(&conn, &child, "title"), Some("Salaries".into()));
}

#[test]
fn guests_cannot_have_claude_add_top_level_pages() {
    let (conn, _, _, _) = team_fixture("claude-guest", "guest");
    state::set_active_workspace(&conn, Some("ws-1")).unwrap();
    assert!(guarded_tool_call(&conn, "pages_create", &json!({ "title": "New" }), |_| Ok(json!({}))).is_err());
    state::set_active_workspace(&conn, None).unwrap();
    assert!(guarded_tool_call(&conn, "pages_create", &json!({ "title": "New" }), |_| Ok(json!({}))).is_ok());
}

#[test]
fn claude_cannot_move_pages_between_workspaces() {
    let (conn, root, _, _) = team_fixture("claude-move", "owner");
    let personal = page(&conn, "Personal", None);
    let err = guarded_tool_call(&conn, "pages_move", &json!({ "pageId": root, "parentId": personal }), |_| Ok(json!({}))).unwrap_err();
    assert!(err.to_string().contains("Share sheet"));
}

#[test]
fn results_never_mention_pages_the_user_cannot_see() {
    let (conn, root, child, grandchild) = team_fixture("claude-filter", "member");
    state::replace_access(&conn, "ws-1", "member", "edit", &[(root.clone(), "view".into()), (child.clone(), "none".into())]).unwrap();
    let personal = page(&conn, "Diary", None);
    let out = guarded_tool_call(&conn, "pages_list", &json!({}), |c| {
        let all = store::list_pages(c, false)?;
        Ok(json!(all.iter().map(|p| json!({ "id": p.id, "title": p.title })).collect::<Vec<_>>()))
    })
    .unwrap();
    let ids: Vec<&str> = out.as_array().unwrap().iter().map(|v| v["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&root.as_str()));
    assert!(ids.contains(&personal.as_str()));
    assert!(!ids.contains(&child.as_str()));
    assert!(!ids.contains(&grandchild.as_str()));
    // Nested lists (search hits, backlinks) too.
    let nested =
        filter_result(&conn, json!({ "pages": [{ "pageId": child, "title": "Salaries" }, { "pageId": personal }], "count": 2 })).unwrap();
    assert_eq!(nested["pages"].as_array().unwrap().len(), 1);
}

// ---------------------------------------------------------------------------
// Device key, PKCE, tree, invite links
// ---------------------------------------------------------------------------

#[test]
fn device_key_signs_refresh_requests_the_server_can_verify() {
    use base64::Engine;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let store = MemoryStore::default();
    let key = DeviceKey::generate().unwrap();
    key.save(&store).unwrap();
    let loaded = DeviceKey::load(&store).unwrap().unwrap();
    assert_eq!(loaded.public_key(), key.public_key());
    let msg = refresh_message("dev-1", 1_700_000_000_000, "wr_token");
    assert_eq!(msg, format!("worlds-refresh.v1:dev-1:1700000000000:{}", sha256_hex("wr_token")));
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let pk: [u8; 32] = b64.decode(key.public_key()).unwrap().try_into().unwrap();
    let sig: [u8; 64] = b64.decode(loaded.sign(&msg)).unwrap().try_into().unwrap();
    assert!(VerifyingKey::from_bytes(&pk).unwrap().verify(msg.as_bytes(), &Signature::from_bytes(&sig)).is_ok());
    store.delete(super::secrets::DEVICE_KEY).unwrap();
    assert!(DeviceKey::load(&store).unwrap().is_none());
}

#[test]
fn pkce_challenge_is_s256_of_the_verifier() {
    use base64::Engine;
    use sha2::Digest;
    let (verifier, challenge) = pkce().unwrap();
    assert!(verifier.len() >= 43);
    assert_eq!(challenge, base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes())));
}

#[test]
fn workspace_tree_lists_parents_first_and_cuts_links_to_other_workspaces() {
    let (conn, root, child, grandchild) = team_fixture("tree", "member");
    let personal = page(&conn, "Personal", None);
    // A team page whose parent is personal must not point outside the workspace.
    state::move_page_tree(&conn, &personal, Some("ws-1")).unwrap();
    let tree = state::workspace_tree(&conn, "ws-1").unwrap();
    let pos = |id: &str| tree.iter().position(|(x, _)| x == id).unwrap();
    assert!(pos(&root) < pos(&child) && pos(&child) < pos(&grandchild));
    assert_eq!(tree[pos(&child)].1.as_deref(), Some(root.as_str()));
    assert_eq!(tree[pos(&personal)].1, None);
    // Moving a branch back to Personal takes its subpages and detaches it.
    let moved = state::move_page_tree(&conn, &child, None).unwrap();
    assert_eq!(moved.len(), 2);
    assert_eq!(col(&conn, &grandchild, "workspace_id"), None);
    assert_eq!(col(&conn, &child, "parent_id"), None);
}

#[test]
fn invite_links_are_parsed_from_urls_or_tokens() {
    use super::commands::invite_token_for_tests as t;
    assert_eq!(t("https://id.example.com/join/wi_abcdefghijkl").unwrap(), "wi_abcdefghijkl");
    assert_eq!(t("wi_abcdefghijkl").unwrap(), "wi_abcdefghijkl");
    assert_eq!(t(" https://id.example.com/join/wi_abc-DEF_123456/ ").unwrap(), "wi_abc-DEF_123456");
    assert!(t("https://example.com/join/nope").is_err());
    assert!(t("wi_short").is_err());
}

#[test]
fn view_reports_signed_out_state_without_network() {
    let conn = fresh("view");
    let v: Value = super::commands::view(&conn).unwrap();
    assert_eq!(v["status"], "signed_out");
    assert_eq!(v["workspaces"], json!([]));
    sign_in(&conn, "user-a");
    join(&conn, "ws-1", "owner", "edit");
    let v = super::commands::view(&conn).unwrap();
    assert_eq!(v["status"], "active");
    assert_eq!(v["workspaces"][0]["role"], "owner");
}
