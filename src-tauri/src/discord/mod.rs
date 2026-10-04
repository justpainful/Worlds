//! Discord through the bridge: render, preview, destinations, send/edit, approvals.

pub mod bidi;
pub mod bridge;
pub mod render;

use crate::commands::CmdResult;
use crate::db::{self, new_id, now};
use crate::store::{self, Ctx};
use crate::AppState;
use anyhow::{anyhow, Result};
use base64::Engine;
use render::{RenderOptions, Rendered, Resolver};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

pub struct DbResolver<'a>(pub &'a Connection);

impl Resolver for DbResolver<'_> {
    fn attachment(&self, id: &str) -> Option<(String, String, i64)> {
        store::get_attachment(self.0, id).ok().flatten().map(|a| (a.file_name, a.mime, a.size))
    }
    fn page_title(&self, id: &str) -> Option<String> {
        store::page_meta_by_id(self.0, id).ok().flatten().map(|p| p.title)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    /// "channel" | "thread" | "dm" | "edit"
    pub kind: String,
    /// channel / thread / user id
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub guild_id: Option<String>,
    /// for kind = "edit"
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
}

pub fn bridge_config(conn: &Connection) -> bridge::BridgeConfig {
    let saved = db::get_setting(conn, "discord.bridge").ok().flatten().or_else(|| {
        let legacy = bridge::legacy_setting_key()?;
        db::get_setting(conn, &legacy).ok().flatten()
    });
    saved.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

pub fn default_options(conn: &Connection) -> RenderOptions {
    let mut o: RenderOptions = db::get_setting(conn, "discord.renderDefaults")
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    if o.accent_color.is_none() {
        if let Ok(p) = store::profile(conn) {
            o.accent_color = p.accent.as_deref().and_then(|a| u32::from_str_radix(a.trim_start_matches('#'), 16).ok());
        }
    }
    o
}

fn merge_options(base: RenderOptions, over: Option<RenderOptions>) -> RenderOptions {
    let Some(o) = over else { return base };
    RenderOptions {
        container: o.container.or(base.container),
        accent_color: o.accent_color.or(base.accent_color),
        no_accent: o.no_accent.or(base.no_accent),
        include_title: o.include_title.or(base.include_title),
        hide_completed: o.hide_completed.or(base.hide_completed),
    }
}

pub fn render_for_page(conn: &Connection, page_id: &str, blocks: Option<Vec<Value>>, opts: Option<RenderOptions>) -> Result<Rendered> {
    let page = store::get_page(conn, page_id)?.ok_or_else(|| anyhow!("page not found"))?;
    let nodes = blocks.unwrap_or_else(|| page.blocks.iter().map(|b| b.content.clone()).collect());
    // Precedence: explicit options > the page's saved embed colour > profile accent.
    let mut base = default_options(conn);
    if let Some(c) = page.metadata.get("discordColor") {
        if c.get("noAccent").and_then(Value::as_bool).unwrap_or(false) {
            base.no_accent = Some(true);
        } else if let Some(n) = c.get("accentColor").and_then(Value::as_u64) {
            base.accent_color = Some(n as u32);
        }
    }
    let options = merge_options(base, opts);
    Ok(render::render_page(&page.meta.title, &nodes, &options, &DbResolver(conn)))
}

/// Collect file bytes for upload (base64); runs with the DB lock held briefly.
pub fn file_payloads(conn: &Connection, rendered: &Rendered) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for f in &rendered.files {
        let a = store::get_attachment(conn, &f.attachment_id)?.ok_or_else(|| anyhow!("attachment missing"))?;
        let bytes = std::fs::read(store::attachment_abs_path(&a))?;
        out.push(json!({ "name": f.name, "data": base64::engine::general_purpose::STANDARD.encode(bytes) }));
    }
    Ok(out)
}

/// Send (or edit) a rendered message through the bridge and log it.
pub async fn deliver(app_db: &std::sync::Mutex<Connection>, cfg: &bridge::BridgeConfig, rendered: &Rendered, files: Vec<Value>,
                     dest: &Destination, page_id: Option<&str>, automation_id: Option<&str>) -> Result<Value> {
    if rendered.warnings.iter().any(|w| w.level == "error") {
        let msgs: Vec<String> = rendered.warnings.iter().filter(|w| w.level == "error").map(|w| w.message.clone()).collect();
        return Err(anyhow!("cannot send: {}", msgs.join(" ")));
    }
    let result = if dest.kind == "edit" {
        bridge::call(cfg, "edit", json!({
            "channelId": dest.channel_id,
            "messageId": dest.message_id,
            "payload": rendered.payload,
            "files": files,
        })).await?
    } else {
        bridge::call(cfg, "send", json!({
            "destination": { "kind": dest.kind, "id": dest.id, "guildId": dest.guild_id },
            "payload": rendered.payload,
            "files": files,
        })).await?
    };
    let conn = app_db.lock().unwrap_or_else(|e| e.into_inner());
    let t = now();
    if dest.kind == "edit" {
        conn.execute(
            "UPDATE discord_messages SET payload = ?1, edited_at = ?2 WHERE message_id = ?3",
            params![rendered.payload.to_string(), t, dest.message_id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO discord_messages (id, page_id, automation_id, destination, channel_id, message_id, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                new_id(),
                page_id,
                automation_id,
                serde_json::to_string(dest)?,
                result.get("channelId").and_then(Value::as_str),
                result.get("messageId").and_then(Value::as_str),
                rendered.payload.to_string(),
                t
            ],
        )?;
    }
    if let Some(pid) = page_id {
        let actor = if automation_id.is_some() { "automation" } else { "user" };
        let ctx = Ctx { actor: actor.into(), op_id: None, origin: if automation_id.is_some() { "runner".into() } else { "ui".into() } };
        let label = dest.label.clone().unwrap_or_else(|| dest.id.clone());
        let summary = if dest.kind == "edit" { "Updated the Discord message".to_string() } else { format!("Sent to Discord · {label}") };
        store::record(&conn, &ctx, Some(pid), "discord_sent", &summary, None, None, None, json!({ "destination": dest, "result": result }))?;
        db::mark_change(&conn, Some(pid), "history", &ctx.origin)?;
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn discord_render(state: State<'_, AppState>, page_id: String, blocks: Option<Vec<Value>>, options: Option<RenderOptions>) -> CmdResult<Rendered> {
    let c = state.conn();
    render_for_page(&c, &page_id, blocks, options).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn discord_status(state: State<'_, AppState>, probe: Option<bool>) -> CmdResult<Value> {
    let cfg = bridge_config(&state.conn());
    if !probe.unwrap_or(true) {
        return Ok(json!({ "state": "unknown", "config": cfg }));
    }
    match bridge::call(&cfg, "inspect", json!({ "light": true })).await {
        Ok(v) => Ok(json!({ "state": "connected", "bot": v.get("bot"), "config": cfg })),
        Err(e) => Ok(json!({ "state": bridge::classify(&e), "error": format!("{e:#}"), "config": cfg })),
    }
}

#[tauri::command]
pub async fn discord_destinations(state: State<'_, AppState>, refresh: Option<bool>) -> CmdResult<Value> {
    let (cfg, cached) = {
        let c = state.conn();
        (bridge_config(&c), db::get_setting(&c, "discord.cache").ok().flatten())
    };
    if !refresh.unwrap_or(false) {
        if let Some(c) = cached.clone() {
            return Ok(c);
        }
    }
    match bridge::call(&cfg, "inspect", json!({})).await {
        Ok(mut v) => {
            v["fetchedAt"] = json!(now());
            let c = state.conn();
            db::set_setting(&c, "discord.cache", &v).map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => match cached {
            Some(mut c) => {
                c["stale"] = json!(true);
                c["error"] = json!(bridge::classify(&e));
                Ok(c)
            }
            None => Err(format!("{}: {e:#}", bridge::classify(&e))),
        },
    }
}

#[tauri::command]
pub async fn discord_send(state: State<'_, AppState>, page_id: String, destination: Destination, options: Option<RenderOptions>, blocks: Option<Vec<Value>>) -> CmdResult<Value> {
    let (cfg, rendered, files) = {
        let c = state.conn();
        let r = render_for_page(&c, &page_id, blocks, options).map_err(|e| format!("{e:#}"))?;
        let f = file_payloads(&c, &r).map_err(|e| format!("{e:#}"))?;
        (bridge_config(&c), r, f)
    };
    deliver(&state.db, &cfg, &rendered, files, &destination, Some(&page_id), None)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction {
    pub id: String,
    pub kind: String,
    pub payload: Value,
    pub requested_by: String,
    pub op_id: Option<String>,
    pub status: String,
    pub created_at: i64,
}

#[tauri::command]
pub async fn pending_actions(state: State<'_, AppState>) -> CmdResult<Vec<PendingAction>> {
    let c = state.conn();
    let mut stmt = c
        .prepare("SELECT id, kind, payload, requested_by, op_id, status, created_at FROM pending_actions WHERE status = 'pending' ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let p: String = r.get(2)?;
            Ok(PendingAction {
                id: r.get(0)?,
                kind: r.get(1)?,
                payload: serde_json::from_str(&p).unwrap_or(Value::Null),
                requested_by: r.get(3)?,
                op_id: r.get(4)?,
                status: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Approve or decline an action Claude or an automation asked for.
#[tauri::command]
pub async fn pending_resolve(state: State<'_, AppState>, id: String, approve: bool) -> CmdResult<Value> {
    let (kind, payload): (String, Value) = {
        let c = state.conn();
        let row: Option<(String, String)> = c
            .query_row("SELECT kind, payload FROM pending_actions WHERE id = ?1 AND status = 'pending'", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(|e| e.to_string())?;
        let (k, p) = row.ok_or("This request was already handled.")?;
        (k, serde_json::from_str(&p).unwrap_or(Value::Null))
    };
    let finish = |status: &str, result: Value| -> CmdResult<()> {
        let c = state.conn();
        c.execute(
            "UPDATE pending_actions SET status = ?1, result = ?2, resolved_at = ?3 WHERE id = ?4",
            params![status, result.to_string(), now(), id],
        ).map_err(|e| e.to_string())?;
        db::mark_change(&c, None, "pending", "ui").map_err(|e| e.to_string())?;
        Ok(())
    };
    if !approve {
        finish("declined", json!({}))?;
        // An automation run waiting on this approval becomes Cancelled.
        if let Some(run) = payload.get("runId").and_then(Value::as_str) {
            let c = state.conn();
            let _ = crate::automations::finish_run(&c, run, "cancelled", None, Some("Declined"));
        }
        return Ok(json!({ "status": "declined" }));
    }
    match kind.as_str() {
        "discord.send" => {
            let page_id = payload["pageId"].as_str().unwrap_or("").to_string();
            let dest: Destination = serde_json::from_value(payload["destination"].clone()).map_err(|e| e.to_string())?;
            let opts: Option<RenderOptions> = serde_json::from_value(payload["options"].clone()).ok();
            let blocks: Option<Vec<Value>> = serde_json::from_value(payload["blocks"].clone()).ok();
            let automation_id = payload.get("automationId").and_then(Value::as_str).map(str::to_string);
            let (cfg, rendered, files) = {
                let c = state.conn();
                let r = render_for_page(&c, &page_id, blocks, opts).map_err(|e| format!("{e:#}"))?;
                let f = file_payloads(&c, &r).map_err(|e| format!("{e:#}"))?;
                (bridge_config(&c), r, f)
            };
            let res = deliver(&state.db, &cfg, &rendered, files, &dest, Some(&page_id), automation_id.as_deref()).await;
            let run = payload.get("runId").and_then(Value::as_str).map(str::to_string);
            match res {
                Ok(v) => {
                    finish("approved", v.clone())?;
                    if let Some(run) = run {
                        let c = state.conn();
                        let _ = crate::automations::finish_run(&c, &run, "succeeded", Some(json!({ "payload": rendered.payload, "result": v })), None);
                    }
                    Ok(v)
                }
                Err(e) => {
                    let msg = format!("{e:#}");
                    finish("failed", json!({ "error": msg }))?;
                    if let Some(run) = run {
                        let c = state.conn();
                        let _ = crate::automations::finish_run(&c, &run, "failed", None, Some(&msg));
                    }
                    Err(msg)
                }
            }
        }
        other => Err(format!("unknown action {other}")),
    }
}

/// Queue an external action for explicit approval (used by MCP + runner).
pub fn queue_action(conn: &Connection, kind: &str, payload: Value, requested_by: &str, op_id: Option<&str>) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO pending_actions (id, kind, payload, requested_by, op_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, kind, payload.to_string(), requested_by, op_id, now()],
    )?;
    db::mark_change(conn, payload.get("pageId").and_then(Value::as_str), "pending", requested_by)?;
    Ok(id)
}
