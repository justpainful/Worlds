//! The local account cache (migration 5 tables). No network here.

use crate::db;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const ACTIVE_WORKSPACE: &str = "account.activeWorkspace";
pub const SERVER_URL: &str = "account.serverUrl";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub user_id: String,
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub device_id: String,
    pub device_name: String,
    pub server_url: String,
    /// "active", or "expired" when the server ended this sign-in (device revoked, session expired).
    pub status: String,
    pub signed_in_at: i64,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub role: String,
    pub owner_id: Option<String>,
    pub default_level: String,
    pub member_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub user_id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub role: String,
}

pub fn account(conn: &Connection) -> Result<Option<Account>> {
    Ok(conn
        .query_row(
            "SELECT user_id, email, display_name, avatar_url, device_id, device_name, server_url, status, signed_in_at, last_sync_at, last_error FROM account WHERE id = 1",
            [],
            |r| {
                Ok(Account {
                    user_id: r.get(0)?,
                    email: r.get(1)?,
                    display_name: r.get(2)?,
                    avatar_url: r.get(3)?,
                    device_id: r.get(4)?,
                    device_name: r.get(5)?,
                    server_url: r.get(6)?,
                    status: r.get(7)?,
                    signed_in_at: r.get(8)?,
                    last_sync_at: r.get(9)?,
                    last_error: r.get(10)?,
                })
            },
        )
        .optional()?)
}

pub fn save_account(conn: &Connection, a: &Account) -> Result<()> {
    conn.execute(
        "INSERT INTO account (id, user_id, email, display_name, avatar_url, device_id, device_name, server_url, status, signed_in_at, last_sync_at, last_error)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, email = excluded.email, display_name = excluded.display_name,
           avatar_url = excluded.avatar_url, device_id = excluded.device_id, device_name = excluded.device_name, server_url = excluded.server_url,
           status = excluded.status, signed_in_at = excluded.signed_in_at, last_sync_at = excluded.last_sync_at, last_error = excluded.last_error",
        params![
            a.user_id,
            a.email,
            a.display_name,
            a.avatar_url,
            a.device_id,
            a.device_name,
            a.server_url,
            a.status,
            a.signed_in_at,
            a.last_sync_at,
            a.last_error
        ],
    )?;
    db::mark_change(conn, None, "account", "ui")?;
    Ok(())
}

pub fn set_status(conn: &Connection, status: &str, error: Option<&str>) -> Result<()> {
    conn.execute("UPDATE account SET status = ?1, last_error = ?2 WHERE id = 1", params![status, error])?;
    Ok(())
}

pub fn set_sync_result(conn: &Connection, error: Option<&str>) -> Result<()> {
    match error {
        None => conn.execute("UPDATE account SET last_sync_at = ?1, last_error = NULL WHERE id = 1", [db::now()])?,
        Some(e) => conn.execute("UPDATE account SET last_error = ?1 WHERE id = 1", [e])?,
    };
    Ok(())
}

/// Forget the account and everything cached for it. Pages stay on disk;
/// Team pages are simply hidden until the same person signs in again.
pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM account; DELETE FROM account_workspaces;")?;
    db::set_setting(conn, ACTIVE_WORKSPACE, &Value::Null)?;
    db::mark_change(conn, None, "account", "ui")?;
    Ok(())
}

pub fn workspaces(conn: &Connection) -> Result<Vec<Workspace>> {
    let mut stmt =
        conn.prepare("SELECT id, name, role, owner_id, default_level, member_count FROM account_workspaces ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| {
        Ok(Workspace {
            id: r.get(0)?,
            name: r.get(1)?,
            role: r.get(2)?,
            owner_id: r.get(3)?,
            default_level: r.get(4)?,
            member_count: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Replace the cached workspace list. Workspaces that disappeared (left,
/// removed, deleted) lose their cached members and rights at once.
pub fn replace_workspaces(conn: &Connection, list: &[Workspace]) -> Result<()> {
    let t = db::now();
    let keep: Vec<&str> = list.iter().map(|w| w.id.as_str()).collect();
    for old in workspaces(conn)? {
        if !keep.contains(&old.id.as_str()) {
            conn.execute("DELETE FROM account_workspaces WHERE id = ?1", [&old.id])?;
        }
    }
    for w in list {
        conn.execute(
            "INSERT INTO account_workspaces (id, name, role, owner_id, default_level, member_count, synced_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, owner_id = excluded.owner_id,
               default_level = excluded.default_level, member_count = excluded.member_count, synced_at = excluded.synced_at",
            params![w.id, w.name, w.role, w.owner_id, w.default_level, w.member_count, t],
        )?;
    }
    if let Some(active) = active_workspace(conn)? {
        if !keep.contains(&active.as_str()) {
            db::set_setting(conn, ACTIVE_WORKSPACE, &Value::Null)?;
        }
    }
    db::mark_change(conn, None, "account", "ui")?;
    Ok(())
}

pub fn upsert_workspace(conn: &Connection, w: &Workspace) -> Result<()> {
    let mut all = workspaces(conn)?;
    all.retain(|x| x.id != w.id);
    all.push(w.clone());
    replace_workspaces(conn, &all)
}

pub fn replace_members(conn: &Connection, workspace_id: &str, members: &[Member]) -> Result<()> {
    conn.execute("DELETE FROM account_members WHERE workspace_id = ?1", [workspace_id])?;
    for m in members {
        conn.execute(
            "INSERT OR REPLACE INTO account_members (workspace_id, user_id, display_name, email, role) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![workspace_id, m.user_id, m.display_name, m.email, m.role],
        )?;
    }
    Ok(())
}

pub fn members(conn: &Connection, workspace_id: &str) -> Result<Vec<Member>> {
    let mut stmt = conn.prepare(
        "SELECT user_id, display_name, email, role FROM account_members WHERE workspace_id = ?1
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, display_name COLLATE NOCASE",
    )?;
    let rows =
        stmt.query_map([workspace_id], |r| Ok(Member { user_id: r.get(0)?, display_name: r.get(1)?, email: r.get(2)?, role: r.get(3)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Replace the cached rights for one workspace (every mirrored page, including "none").
pub fn replace_access(conn: &Connection, workspace_id: &str, role: &str, default_level: &str, docs: &[(String, String)]) -> Result<()> {
    conn.execute("UPDATE account_workspaces SET role = ?1, default_level = ?2 WHERE id = ?3", params![role, default_level, workspace_id])?;
    conn.execute("DELETE FROM account_page_access WHERE workspace_id = ?1", [workspace_id])?;
    let mut stmt = conn.prepare("INSERT OR REPLACE INTO account_page_access (workspace_id, page_id, level) VALUES (?1, ?2, ?3)")?;
    for (doc, level) in docs {
        stmt.execute(params![workspace_id, doc, level])?;
    }
    db::mark_change(conn, None, "account", "ui")?;
    Ok(())
}

pub fn active_workspace(conn: &Connection) -> Result<Option<String>> {
    Ok(db::get_setting(conn, ACTIVE_WORKSPACE)?.and_then(|v| v.as_str().map(str::to_string)))
}

pub fn set_active_workspace(conn: &Connection, id: Option<&str>) -> Result<()> {
    if let Some(id) = id {
        let known: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM account_workspaces WHERE id = ?1)", [id], |r| r.get(0))?;
        if !known {
            anyhow::bail!("That workspace is not available on this device.");
        }
    }
    db::set_setting(conn, ACTIVE_WORKSPACE, &id.map(|s| json!(s)).unwrap_or(Value::Null))?;
    db::mark_change(conn, None, "account", "ui")?;
    Ok(())
}

/// The server base URL: the setting, else the build default, else the local development server.
pub fn server_url(conn: &Connection) -> Option<String> {
    let set =
        db::get_setting(conn, SERVER_URL).ok().flatten().and_then(|v| v.as_str().map(str::to_string)).filter(|s| !s.trim().is_empty());
    set.or_else(|| option_env!("WORLDS_IDENTITY_URL").map(str::to_string))
        .or_else(|| if cfg!(debug_assertions) { Some("http://localhost:8787".to_string()) } else { None })
        .map(|s| s.trim().trim_end_matches('/').to_string())
}

/// Which workspace each non-personal page belongs to (for the sidebar filter).
pub fn page_workspaces(conn: &Connection) -> Result<serde_json::Map<String, Value>> {
    let mut stmt = conn.prepare("SELECT id, workspace_id FROM pages WHERE workspace_id IS NOT NULL")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = serde_json::Map::new();
    for r in rows {
        let (id, ws) = r?;
        out.insert(id, json!(ws));
    }
    Ok(out)
}

/// Move a page and its subpages into a workspace (None: Personal).
pub fn move_page_tree(conn: &Connection, page_id: &str, workspace_id: Option<&str>) -> Result<Vec<String>> {
    let mut ids = vec![page_id.to_string()];
    let mut i = 0;
    while i < ids.len() {
        let mut stmt = conn.prepare("SELECT id FROM pages WHERE parent_id = ?1")?;
        let kids: Vec<String> = stmt.query_map([&ids[i]], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        for k in kids {
            if !ids.contains(&k) {
                ids.push(k);
            }
        }
        i += 1;
    }
    for id in &ids {
        conn.execute("UPDATE pages SET workspace_id = ?1 WHERE id = ?2", params![workspace_id, id])?;
    }
    // The page leaves its old parent when it changes workspace.
    let parent_ws: Option<Option<String>> = conn
        .query_row("SELECT p.workspace_id FROM pages c JOIN pages p ON p.id = c.parent_id WHERE c.id = ?1", [page_id], |r| r.get(0))
        .optional()?;
    if let Some(pw) = parent_ws {
        if pw.as_deref() != workspace_id {
            conn.execute("UPDATE pages SET parent_id = NULL WHERE id = ?1", [page_id])?;
        }
    }
    db::mark_change(conn, Some(page_id), "tree", "ui")?;
    Ok(ids)
}

/// The tree of one workspace as the server mirrors it: (page id, parent id within the workspace).
pub fn workspace_tree(conn: &Connection, workspace_id: &str) -> Result<Vec<(String, Option<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, CASE WHEN p.workspace_id = c.workspace_id THEN c.parent_id END
         FROM pages c LEFT JOIN pages p ON p.id = c.parent_id
         WHERE c.workspace_id = ?1 AND c.kind <> 'template'
         ORDER BY c.created_at",
    )?;
    let rows = stmt.query_map([workspace_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut list: Vec<(String, Option<String>)> = rows.collect::<rusqlite::Result<_>>()?;
    // Parents before children, so a new branch is accepted in one request.
    let ids: std::collections::HashSet<String> = list.iter().map(|(id, _)| id.clone()).collect();
    let mut ordered = Vec::with_capacity(list.len());
    let mut placed = std::collections::HashSet::new();
    loop {
        let before = list.len();
        list.retain(|(id, parent)| {
            let ready = match parent {
                None => true,
                Some(p) => placed.contains(p) || !ids.contains(p),
            };
            if ready {
                placed.insert(id.clone());
                ordered.push((id.clone(), parent.clone()));
            }
            !ready
        });
        if list.is_empty() {
            break;
        }
        if list.len() == before {
            // A cycle: send the rest as they are and let the server refuse it.
            ordered.append(&mut list);
            break;
        }
    }
    Ok(ordered)
}
