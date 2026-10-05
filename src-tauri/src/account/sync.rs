//! Keeps the local cache in step with the identity service: the account,
//! workspaces, members and this user's page rights come down; the page tree
//! of each Team workspace goes up. Runs in the background and on demand;
//! never on the startup path, and failures only mark the account offline.

use super::client::{authed, ApiError};
use super::secrets::{sha256_hex, SecretStore};
use super::state::{self, Member, Workspace};
use reqwest::Method;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;

fn lock(db: &Mutex<Connection>) -> std::sync::MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn parse_workspace(v: &Value) -> Option<Workspace> {
    Some(Workspace {
        id: v.get("id")?.as_str()?.to_string(),
        name: v.get("name")?.as_str()?.to_string(),
        role: v.get("role")?.as_str()?.to_string(),
        owner_id: v.get("ownerId").and_then(Value::as_str).map(str::to_string),
        default_level: v.get("defaultLevel").and_then(Value::as_str).unwrap_or("edit").to_string(),
        member_count: v.get("memberCount").and_then(Value::as_i64).unwrap_or(1),
    })
}

pub fn parse_members(v: &Value) -> Vec<Member> {
    v.as_array()
        .map(|list| {
            list.iter()
                .filter_map(|m| {
                    Some(Member {
                        user_id: m.get("userId")?.as_str()?.to_string(),
                        display_name: m.get("displayName").and_then(Value::as_str).unwrap_or("").to_string(),
                        email: m.get("email").and_then(Value::as_str).map(str::to_string),
                        role: m.get("role")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Push one workspace's page tree when it changed since the last push.
pub async fn push_tree(
    db: &Mutex<Connection>,
    secrets: &dyn SecretStore,
    workspace_id: &str,
    removed: &[String],
    force: bool,
) -> Result<Value, ApiError> {
    let (nodes, key, last) = {
        let c = lock(db);
        let tree = state::workspace_tree(&c, workspace_id).map_err(|e| ApiError::Offline(e.to_string()))?;
        let key = format!("account.treeHash.{workspace_id}");
        let last = crate::db::get_setting(&c, &key).ok().flatten().and_then(|v| v.as_str().map(str::to_string));
        (tree, key, last)
    };
    let body = json!({
        "nodes": nodes.iter().map(|(id, parent)| json!({ "id": id, "parentId": parent })).collect::<Vec<_>>(),
        "removed": removed,
    });
    let hash = sha256_hex(&body.to_string());
    if !force && removed.is_empty() && last.as_deref() == Some(hash.as_str()) {
        return Ok(json!({ "applied": false, "rejected": [] }));
    }
    let res = authed(db, secrets, Method::PUT, &format!("/workspaces/{workspace_id}/tree"), Some(&body), None).await?;
    if res.get("rejected").and_then(Value::as_array).map(|r| r.is_empty()).unwrap_or(true) {
        let _ = crate::db::set_setting(&lock(db), &key, &json!(hash));
    }
    Ok(res)
}

/// Pull this user's rights for one workspace into the cache.
pub async fn pull_access(db: &Mutex<Connection>, secrets: &dyn SecretStore, workspace_id: &str) -> Result<(), ApiError> {
    let access = authed(db, secrets, Method::GET, &format!("/workspaces/{workspace_id}/access"), None, None).await?;
    let docs: Vec<(String, String)> = access
        .get("docs")
        .and_then(Value::as_array)
        .map(|d| d.iter().filter_map(|x| Some((x.get("docId")?.as_str()?.to_string(), x.get("level")?.as_str()?.to_string()))).collect())
        .unwrap_or_default();
    let role = access.get("role").and_then(Value::as_str).unwrap_or("guest");
    let default_level = access.get("defaultLevel").and_then(Value::as_str).unwrap_or("edit");
    state::replace_access(&lock(db), workspace_id, role, default_level, &docs).map_err(|e| ApiError::Offline(e.to_string()))
}

pub async fn pull_members(db: &Mutex<Connection>, secrets: &dyn SecretStore, workspace_id: &str) -> Result<Vec<Member>, ApiError> {
    let v = authed(db, secrets, Method::GET, &format!("/workspaces/{workspace_id}/members"), None, None).await?;
    let members = parse_members(&v);
    let _ = state::replace_members(&lock(db), workspace_id, &members);
    Ok(members)
}

/// Bring everything up to date. Errors are recorded on the account row.
pub async fn sync_all(db: &Mutex<Connection>, secrets: &dyn SecretStore) -> Result<(), ApiError> {
    let r = sync_inner(db, secrets).await;
    let c = lock(db);
    match &r {
        Ok(()) => {
            let _ = state::set_sync_result(&c, None);
        }
        Err(ApiError::Offline(_)) => {
            let _ = state::set_sync_result(&c, Some("offline"));
        }
        Err(e) => {
            let _ = state::set_sync_result(&c, Some(&e.to_string()));
        }
    }
    let _ = crate::db::mark_change(&c, None, "account", "ui");
    r
}

async fn sync_inner(db: &Mutex<Connection>, secrets: &dyn SecretStore) -> Result<(), ApiError> {
    let me = authed(db, secrets, Method::GET, "/me", None, None).await?;
    {
        let c = lock(db);
        if let Ok(Some(mut a)) = state::account(&c) {
            a.display_name = me.get("displayName").and_then(Value::as_str).unwrap_or(&a.display_name).to_string();
            a.email = me.get("email").and_then(Value::as_str).unwrap_or(&a.email).to_string();
            a.avatar_url = me.get("avatarUrl").and_then(Value::as_str).map(str::to_string);
            let _ = state::save_account(&c, &a);
        }
    }
    let list = authed(db, secrets, Method::GET, "/workspaces", None, None).await?;
    let workspaces: Vec<Workspace> = list.as_array().map(|l| l.iter().filter_map(parse_workspace).collect()).unwrap_or_default();
    state::replace_workspaces(&lock(db), &workspaces).map_err(|e| ApiError::Offline(e.to_string()))?;
    for w in &workspaces {
        // Rights first would hide brand-new local pages until the next pass; push the tree first.
        push_tree(db, secrets, &w.id, &[], false).await?;
        pull_access(db, secrets, &w.id).await?;
        pull_members(db, secrets, &w.id).await?;
    }
    Ok(())
}

/// Background loop: shortly after launch, then every few minutes, and
/// whenever a page tree changes (debounced by the interval).
pub fn spawn(app: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(4)).await;
        loop {
            let signed_in = {
                let st = app.state::<crate::AppState>();
                let c = st.conn();
                state::account(&c).ok().flatten().map(|a| a.status == "active").unwrap_or(false)
            };
            if signed_in {
                let st = app.state::<crate::AppState>();
                let _ = sync_all(&st.db, &super::secrets::KeyringStore).await;
                let _ = app.emit("worlds://account", ());
            }
            tokio::time::sleep(Duration::from_secs(180)).await;
        }
    });
}
