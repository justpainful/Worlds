//! Tauri commands for accounts and workspaces. One command, `account`, with
//! an action name keeps the shared command list in lib.rs short; the UI wraps
//! each action in `src/account/api.ts`.
//!
//! Local actions answer from the cache and never touch the network. Network
//! actions fail fast with a readable message when offline.

use super::client::{self, authed, ApiError};
use super::permissions::{page_level, Level};
use super::secrets::{b64url, pkce, random_bytes, DeviceKey, KeyringStore, SecretStore};
use super::state::{self, Account};
use super::sync;
use crate::AppState;
use anyhow::anyhow;
use reqwest::Method;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, State};

type R = Result<Value, String>;

fn lock(db: &Mutex<Connection>) -> std::sync::MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(|e| e.into_inner())
}

fn s<'a>(a: &'a Value, k: &str) -> Result<&'a str, String> {
    a.get(k).and_then(Value::as_str).filter(|v| !v.trim().is_empty()).ok_or_else(|| format!("missing {k}"))
}

fn local<T>(r: anyhow::Result<T>) -> Result<T, String> {
    r.map_err(|e| format!("{e:#}"))
}

/// Everything the UI needs to draw account state, from the local cache only.
pub fn view(conn: &Connection) -> anyhow::Result<Value> {
    let account = state::account(conn)?;
    let server = state::server_url(conn);
    let status = match &account {
        None => "signed_out",
        Some(a) => a.status.as_str(),
    };
    Ok(json!({
        "configured": server.is_some(),
        "serverUrl": server,
        "status": status,
        "account": account,
        "activeWorkspaceId": state::active_workspace(conn)?,
        "workspaces": state::workspaces(conn)?,
        "offline": account.as_ref().and_then(|a| a.last_error.as_deref()) == Some("offline"),
    }))
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|n| !n.trim().is_empty())
        .map(|n| format!("Worlds on {n}"))
        .unwrap_or_else(|| "Worlds on Windows".into())
}

/// Store the tokens, the device key and the account row after any sign-in.
pub(crate) fn complete_sign_in(
    db: &Mutex<Connection>,
    secrets: &dyn SecretStore,
    base: &str,
    key: &DeviceKey,
    tokens: &Value,
) -> anyhow::Result<()> {
    client::remember(secrets, tokens)?;
    key.save(secrets)?;
    let user = tokens.get("user").cloned().unwrap_or(json!({}));
    let c = lock(db);
    let previous = state::account(&c)?;
    let user_id = tokens.get("userId").and_then(Value::as_str).ok_or_else(|| anyhow!("the server did not return a user"))?.to_string();
    if previous.as_ref().map(|p| p.user_id != user_id).unwrap_or(false) {
        // A different person on this device: drop the other person's cache.
        state::replace_workspaces(&c, &[])?;
    }
    state::save_account(
        &c,
        &Account {
            user_id,
            email: user.get("email").and_then(Value::as_str).unwrap_or("").to_string(),
            display_name: user.get("displayName").and_then(Value::as_str).unwrap_or("").to_string(),
            avatar_url: user.get("avatarUrl").and_then(Value::as_str).map(str::to_string),
            device_id: tokens.get("deviceId").and_then(Value::as_str).unwrap_or("").to_string(),
            device_name: device_name(),
            server_url: base.to_string(),
            status: "active".into(),
            signed_in_at: crate::db::now(),
            last_sync_at: None,
            last_error: None,
        },
    )?;
    Ok(())
}

fn base_url(db: &Mutex<Connection>) -> Result<String, String> {
    state::server_url(&lock(db)).ok_or_else(|| ApiError::NotConfigured.to_string())
}

pub(crate) fn device_body(key: &DeviceKey) -> Value {
    json!({ "name": device_name(), "platform": "windows", "publicKey": key.public_key() })
}

/// Workspace of a page, or an error for Personal pages.
fn team_of(db: &Mutex<Connection>, page_id: &str) -> Result<String, String> {
    let ws: Option<String> = lock(db)
        .query_row("SELECT workspace_id FROM pages WHERE id = ?1", [page_id], |r| r.get(0))
        .map_err(|_| "Page not found.".to_string())?;
    ws.ok_or_else(|| "This page is in your Personal workspace. Move it to a Team workspace to share it.".to_string())
}

/// Wait for the browser to come back to the loopback address with ?code&state.
async fn loopback_code(listener: tokio::net::TcpListener, expected_state: &str) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(300);
    loop {
        let (mut sock, _) = tokio::time::timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| "Sign-in timed out. Try again.".to_string())?
            .map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = sock.read(&mut buf).await.unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]).to_string();
        let target = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("").to_string();
        if !target.starts_with("/callback?") {
            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        let query = &target["/callback?".len()..];
        let mut code = None;
        let mut st = None;
        for pair in query.split('&') {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            let v = percent_encoding::percent_decode_str(v).decode_utf8_lossy().to_string();
            match k {
                "code" => code = Some(v),
                "state" => st = Some(v),
                _ => {}
            }
        }
        let ok = st.as_deref() == Some(expected_state) && code.is_some();
        let page = if ok {
            "<!doctype html><meta charset=utf-8><title>Worlds</title><body style=\"font:15px system-ui;display:grid;place-items:center;height:90vh\"><p>You are signed in. Return to Worlds.</p>"
        } else {
            "<!doctype html><meta charset=utf-8><title>Worlds</title><body style=\"font:15px system-ui;display:grid;place-items:center;height:90vh\"><p>This sign-in link did not match. Start again from Worlds.</p>"
        };
        let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{page}", page.len());
        let _ = sock.write_all(resp.as_bytes()).await;
        let _ = sock.shutdown().await;
        if ok {
            return Ok(code.unwrap_or_default());
        }
    }
}

fn invite_token(link: &str) -> Result<String, String> {
    let t = link.trim().trim_end_matches('/');
    let token = t.rsplit('/').next().unwrap_or(t).split(['?', '#']).next().unwrap_or("");
    if token.starts_with("wi_") && token.len() > 10 && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        Ok(token.to_string())
    } else {
        Err("That does not look like a Worlds invite link.".into())
    }
}

#[cfg(test)]
pub fn invite_token_for_tests(link: &str) -> Result<String, String> {
    invite_token(link)
}

async fn refresh_workspaces(db: &Mutex<Connection>, secrets: &dyn SecretStore) -> Result<(), ApiError> {
    let list = authed(db, secrets, Method::GET, "/workspaces", None, None).await?;
    let ws: Vec<state::Workspace> = list.as_array().map(|l| l.iter().filter_map(sync::parse_workspace).collect()).unwrap_or_default();
    state::replace_workspaces(&lock(db), &ws).map_err(|e| ApiError::Offline(e.to_string()))
}

#[tauri::command]
pub async fn account(app: tauri::AppHandle, state: State<'_, AppState>, action: String, args: Option<Value>) -> R {
    let a = args.unwrap_or(json!({}));
    let db = &state.db;
    let secrets = &KeyringStore;
    let out = run(&app, db, secrets, &action, &a).await;
    if !matches!(action.as_str(), "state" | "pageLevel" | "pageWorkspaces") {
        let _ = app.emit("worlds://account", ());
    }
    out
}

async fn run(app: &tauri::AppHandle, db: &Mutex<Connection>, secrets: &dyn SecretStore, action: &str, a: &Value) -> R {
    match action {
        // ---- local, instant
        "state" => local(view(&lock(db))),
        "pageLevel" => Ok(json!(local(page_level(&lock(db), s(a, "pageId")?))?.as_str())),
        "pageWorkspaces" => Ok(Value::Object(local(state::page_workspaces(&lock(db)))?)),
        "setActiveWorkspace" => {
            let c = lock(db);
            local(state::set_active_workspace(&c, a.get("workspaceId").and_then(Value::as_str)))?;
            local(view(&c))
        }
        "setServer" => {
            let url = a.get("url").and_then(Value::as_str).unwrap_or("").trim().trim_end_matches('/').to_string();
            if !url.is_empty() && !(url.starts_with("https://") || url.starts_with("http://localhost")) {
                return Err("The server address must start with https://".into());
            }
            let c = lock(db);
            if state::account(&c).ok().flatten().is_some() {
                return Err("Sign out before changing the server.".into());
            }
            local(crate::db::set_setting(&c, state::SERVER_URL, &json!(url)))?;
            local(view(&c))
        }

        // ---- sign-in
        "emailStart" => {
            let base = base_url(db)?;
            let email = s(a, "email")?.trim().to_lowercase();
            Ok(client::send(&base, Method::POST, "/auth/email/start", Some(&json!({ "email": email })), None, None).await?)
        }
        "emailVerify" => {
            let base = base_url(db)?;
            let key = local(DeviceKey::generate())?;
            let body = json!({
                "challengeId": s(a, "challengeId")?, "code": s(a, "code")?,
                "displayName": a.get("displayName"), "device": device_body(&key),
            });
            let tokens = client::send(&base, Method::POST, "/auth/email/verify", Some(&body), None, None).await?;
            local(complete_sign_in(db, secrets, &base, &key, &tokens))?;
            let _ = sync::sync_all(db, secrets).await;
            let mut v = local(view(&lock(db)))?;
            v["created"] = tokens.get("created").cloned().unwrap_or(json!(false));
            Ok(v)
        }
        "passkeySignIn" => {
            use tauri_plugin_opener::OpenerExt;
            let base = base_url(db)?;
            let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.map_err(|e| e.to_string())?;
            let addr = listener.local_addr().map_err(|e| e.to_string())?;
            let redirect = format!("http://{addr}/callback");
            let st = b64url(&local(random_bytes::<16>())?);
            let (verifier, challenge) = local(pkce())?;
            let enc = |x: &str| percent_encoding::utf8_percent_encode(x, percent_encoding::NON_ALPHANUMERIC).to_string();
            let url =
                format!("{base}/passkey?mode=signin&redirect_uri={}&state={}&code_challenge={}", enc(&redirect), enc(&st), enc(&challenge));
            app.opener().open_url(url, None::<&str>).map_err(|e| format!("Could not open the browser: {e}"))?;
            let code = loopback_code(listener, &st).await?;
            let key = local(DeviceKey::generate())?;
            let body = json!({ "code": code, "codeVerifier": verifier, "device": device_body(&key) });
            let tokens = client::send(&base, Method::POST, "/auth/token", Some(&body), None, None).await?;
            local(complete_sign_in(db, secrets, &base, &key, &tokens))?;
            let _ = sync::sync_all(db, secrets).await;
            local(view(&lock(db)))
        }
        "passkeyAdd" => {
            use tauri_plugin_opener::OpenerExt;
            let t = authed(db, secrets, Method::POST, "/auth/passkey/ticket", None, None).await?;
            let url = t.get("url").and_then(Value::as_str).ok_or("The server did not return a link.")?;
            app.opener().open_url(url, None::<&str>).map_err(|e| format!("Could not open the browser: {e}"))?;
            Ok(json!({ "opened": true }))
        }
        "signOut" => {
            // Tell the server when we can; sign out locally regardless.
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), authed(db, secrets, Method::POST, "/auth/logout", None, None))
                .await;
            client::forget(secrets);
            let c = lock(db);
            local(state::clear(&c))?;
            local(view(&c))
        }
        "sync" => {
            let r = sync::sync_all(db, secrets).await;
            let mut v = local(view(&lock(db)))?;
            if let Err(e) = r {
                v["error"] = json!(e.to_string());
                v["errorCode"] = json!(e.code());
            }
            Ok(v)
        }

        // ---- profile, devices, passkeys
        "me" => Ok(authed(db, secrets, Method::GET, "/me", None, None).await?),
        "updateProfile" => {
            let v = authed(db, secrets, Method::PATCH, "/me", Some(&json!({ "displayName": s(a, "displayName")? })), None).await?;
            let c = lock(db);
            if let Ok(Some(mut acc)) = state::account(&c) {
                acc.display_name = v.get("displayName").and_then(Value::as_str).unwrap_or("").to_string();
                let _ = state::save_account(&c, &acc);
            }
            Ok(v)
        }
        "devices" => Ok(authed(db, secrets, Method::GET, "/me/devices", None, None).await?),
        "revokeDevice" => Ok(authed(db, secrets, Method::DELETE, &format!("/me/devices/{}", s(a, "deviceId")?), None, None).await?),
        "renameDevice" => Ok(authed(
            db,
            secrets,
            Method::PATCH,
            &format!("/me/devices/{}", s(a, "deviceId")?),
            Some(&json!({ "name": s(a, "name")? })),
            None,
        )
        .await?),
        "passkeys" => Ok(authed(db, secrets, Method::GET, "/me/passkeys", None, None).await?),
        "removePasskey" => Ok(authed(db, secrets, Method::DELETE, &format!("/me/passkeys/{}", s(a, "passkeyId")?), None, None).await?),

        // ---- workspaces
        "createWorkspace" => {
            let w = authed(db, secrets, Method::POST, "/workspaces", Some(&json!({ "name": s(a, "name")? })), None).await?;
            let ws = sync::parse_workspace(&w).ok_or("The server returned an unexpected answer.")?;
            let c = lock(db);
            local(state::upsert_workspace(&c, &ws))?;
            local(state::set_active_workspace(&c, Some(&ws.id)))?;
            local(view(&c))
        }
        "renameWorkspace" => {
            let id = s(a, "workspaceId")?;
            authed(db, secrets, Method::PATCH, &format!("/workspaces/{id}"), Some(&json!({ "name": s(a, "name")? })), None).await?;
            refresh_workspaces(db, secrets).await?;
            local(view(&lock(db)))
        }
        "deleteWorkspace" => {
            let id = s(a, "workspaceId")?;
            authed(db, secrets, Method::DELETE, &format!("/workspaces/{id}"), None, None).await?;
            refresh_workspaces(db, secrets).await?;
            local(view(&lock(db)))
        }
        "invitePreview" => {
            let base = base_url(db)?;
            Ok(client::send(&base, Method::GET, &format!("/invites/{}", invite_token(s(a, "link")?)?), None, None, None).await?)
        }
        "join" => {
            let token = invite_token(s(a, "link")?)?;
            let r = authed(db, secrets, Method::POST, &format!("/invites/{token}/accept"), None, None).await?;
            let ws = r.get("workspace").and_then(sync::parse_workspace).ok_or("The server returned an unexpected answer.")?;
            {
                let c = lock(db);
                local(state::upsert_workspace(&c, &ws))?;
                local(state::set_active_workspace(&c, Some(&ws.id)))?;
            }
            let _ = sync::pull_access(db, secrets, &ws.id).await;
            let _ = sync::pull_members(db, secrets, &ws.id).await;
            local(view(&lock(db)))
        }
        "members" => {
            let id = s(a, "workspaceId")?;
            match sync::pull_members(db, secrets, id).await {
                Ok(m) => Ok(json!({ "members": m, "offline": false })),
                Err(ApiError::Offline(_)) => Ok(json!({ "members": local(state::members(&lock(db), id))?, "offline": true })),
                Err(e) => Err(e.into()),
            }
        }
        "setRole" => {
            let (id, user) = (s(a, "workspaceId")?, s(a, "userId")?);
            authed(db, secrets, Method::PATCH, &format!("/workspaces/{id}/members/{user}"), Some(&json!({ "role": s(a, "role")? })), None)
                .await?;
            Ok(json!({ "members": sync::pull_members(db, secrets, id).await? }))
        }
        "removeMember" => {
            let (id, user) = (s(a, "workspaceId")?, s(a, "userId")?);
            authed(db, secrets, Method::DELETE, &format!("/workspaces/{id}/members/{user}"), None, None).await?;
            Ok(json!({ "members": sync::pull_members(db, secrets, id).await? }))
        }
        "leave" => {
            let id = s(a, "workspaceId")?;
            authed(db, secrets, Method::POST, &format!("/workspaces/{id}/leave"), None, None).await?;
            refresh_workspaces(db, secrets).await?;
            local(view(&lock(db)))
        }
        "transfer" => {
            let id = s(a, "workspaceId")?;
            authed(db, secrets, Method::POST, &format!("/workspaces/{id}/transfer"), Some(&json!({ "userId": s(a, "userId")? })), None)
                .await?;
            refresh_workspaces(db, secrets).await?;
            Ok(json!({ "members": sync::pull_members(db, secrets, id).await? }))
        }
        "groups" => Ok(authed(db, secrets, Method::GET, &format!("/workspaces/{}/groups", s(a, "workspaceId")?), None, None).await?),
        "createGroup" => Ok(authed(
            db,
            secrets,
            Method::POST,
            &format!("/workspaces/{}/groups", s(a, "workspaceId")?),
            Some(&json!({ "name": s(a, "name")? })),
            None,
        )
        .await?),
        "deleteGroup" => Ok(authed(
            db,
            secrets,
            Method::DELETE,
            &format!("/workspaces/{}/groups/{}", s(a, "workspaceId")?, s(a, "groupId")?),
            None,
            None,
        )
        .await?),
        "setGroupMembers" => {
            let body = json!({ "userIds": a.get("userIds").cloned().unwrap_or(json!([])) });
            Ok(authed(
                db,
                secrets,
                Method::PUT,
                &format!("/workspaces/{}/groups/{}/members", s(a, "workspaceId")?, s(a, "groupId")?),
                Some(&body),
                None,
            )
            .await?)
        }
        "invites" => {
            let query = a.get("pageId").and_then(Value::as_str).map(|p| format!("?pageId={p}")).unwrap_or_default();
            Ok(authed(db, secrets, Method::GET, &format!("/workspaces/{}/invites{query}", s(a, "workspaceId")?), None, None).await?)
        }
        "createInvite" => {
            let body = json!({
                "role": s(a, "role")?, "expiresInHours": a.get("expiresInHours"), "maxUses": a.get("maxUses"),
                "pageId": a.get("pageId"), "level": a.get("level"),
            });
            Ok(authed(db, secrets, Method::POST, &format!("/workspaces/{}/invites", s(a, "workspaceId")?), Some(&body), None).await?)
        }
        "revokeInvite" => Ok(authed(
            db,
            secrets,
            Method::DELETE,
            &format!("/workspaces/{}/invites/{}", s(a, "workspaceId")?, s(a, "inviteId")?),
            None,
            None,
        )
        .await?),
        "audit" => {
            Ok(authed(db, secrets, Method::GET, &format!("/workspaces/{}/audit?limit=100", s(a, "workspaceId")?), None, None).await?)
        }

        // ---- pages
        "pageSharing" => {
            let page = s(a, "pageId")?;
            let ws: Option<String> =
                lock(db).query_row("SELECT workspace_id FROM pages WHERE id = ?1", [page], |r| r.get(0)).map_err(|_| "Page not found.")?;
            let level = local(page_level(&lock(db), page))?;
            let Some(ws) = ws else {
                return Ok(json!({ "workspace": null, "level": level.as_str() }));
            };
            let workspace = local(state::workspaces(&lock(db)))?.into_iter().find(|w| w.id == ws);
            let cached_members = local(state::members(&lock(db), &ws))?;
            let remote = async {
                sync::push_tree(db, secrets, &ws, &[], false).await?;
                let perms = authed(db, secrets, Method::GET, &format!("/workspaces/{ws}/pages/{page}/permissions"), None, None).await?;
                let members = sync::pull_members(db, secrets, &ws).await?;
                let groups = authed(db, secrets, Method::GET, &format!("/workspaces/{ws}/groups"), None, None).await?;
                Ok::<_, ApiError>((perms, members, groups))
            }
            .await;
            match remote {
                Ok((perms, members, groups)) => Ok(
                    json!({ "workspace": workspace, "level": level.as_str(), "permissions": perms, "members": members, "groups": groups }),
                ),
                Err(e) => Ok(
                    json!({ "workspace": workspace, "level": level.as_str(), "members": cached_members, "error": e.to_string(), "errorCode": e.code() }),
                ),
            }
        }
        "setPagePermission" => {
            let page = s(a, "pageId")?;
            let ws = team_of(db, page)?;
            let body = json!({ "principalType": s(a, "principalType")?, "principalId": s(a, "principalId")?, "level": s(a, "level")? });
            authed(db, secrets, Method::PUT, &format!("/workspaces/{ws}/pages/{page}/permissions"), Some(&body), None).await?;
            let _ = sync::pull_access(db, secrets, &ws).await;
            Ok(authed(db, secrets, Method::GET, &format!("/workspaces/{ws}/pages/{page}/permissions"), None, None).await?)
        }
        "removePagePermission" => {
            let page = s(a, "pageId")?;
            let ws = team_of(db, page)?;
            let path = format!(
                "/workspaces/{ws}/pages/{page}/permissions/{}/{}",
                s(a, "principalType")?,
                percent_encoding::utf8_percent_encode(s(a, "principalId")?, percent_encoding::NON_ALPHANUMERIC)
            );
            authed(db, secrets, Method::DELETE, &path, None, None).await?;
            let _ = sync::pull_access(db, secrets, &ws).await;
            Ok(authed(db, secrets, Method::GET, &format!("/workspaces/{ws}/pages/{page}/permissions"), None, None).await?)
        }
        "setPageInherit" => {
            let page = s(a, "pageId")?;
            let ws = team_of(db, page)?;
            let inherit = a.get("inherit").and_then(Value::as_bool).ok_or("missing inherit")?;
            authed(db, secrets, Method::PATCH, &format!("/workspaces/{ws}/pages/{page}"), Some(&json!({ "inherit": inherit })), None)
                .await?;
            let _ = sync::pull_access(db, secrets, &ws).await;
            Ok(authed(db, secrets, Method::GET, &format!("/workspaces/{ws}/pages/{page}/permissions"), None, None).await?)
        }
        "movePage" => {
            let page = s(a, "pageId")?;
            let target = a.get("workspaceId").and_then(Value::as_str).map(str::to_string);
            let (from, level) = {
                let c = lock(db);
                let from: Option<String> =
                    c.query_row("SELECT workspace_id FROM pages WHERE id = ?1", [page], |r| r.get(0)).map_err(|_| "Page not found.")?;
                (from, local(page_level(&c, page))?)
            };
            if from == target {
                return local(view(&lock(db)));
            }
            if from.is_some() && level < Level::Full {
                return Err("You need full access to move this page out of its workspace.".into());
            }
            if let Some(t) = &target {
                let role: Option<String> = lock(db).query_row("SELECT role FROM account_workspaces WHERE id = ?1", [t], |r| r.get(0)).ok();
                match role.as_deref() {
                    None => return Err("That workspace is not available on this device.".into()),
                    Some("guest") => return Err("Guests cannot add pages to this workspace.".into()),
                    _ => {}
                }
            }
            // Leaving a Team workspace removes the page there first, so nothing is left behind.
            if let Some(f) = &from {
                sync::push_tree(db, secrets, f, &[page.to_string()], true).await?;
            }
            local(state::move_page_tree(&lock(db), page, target.as_deref()))?;
            if let Some(t) = &target {
                let _ = sync::push_tree(db, secrets, t, &[], true).await;
                let _ = sync::pull_access(db, secrets, t).await;
            }
            let _ = app.emit("worlds://changed", json!([{ "pageId": page, "kind": "tree", "origin": "account" }]));
            local(view(&lock(db)))
        }
        other => Err(format!("unknown account action {other}")),
    }
}
