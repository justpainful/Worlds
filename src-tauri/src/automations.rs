//! Automations: Trigger → Source → Transform → Action → Destination → Policy → Result.
//!
//! The scheduler is a Rust task inside the Worlds process (not a UI timer),
//! so it keeps running when the window is closed to the tray. If the PC is
//! off, runs are missed; on wake they are either run (within the grace
//! window) or recorded as Skipped.

use crate::commands::CmdResult;
use crate::db::{self, new_id, now};
use crate::discord::{self, Destination};
use crate::store::{self, Ctx};
use crate::AppState;
use anyhow::{anyhow, Result};
use chrono::{Datelike, Duration, Local, NaiveTime, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Trigger {
    Once { at: i64 },
    Daily { time: String },
    Weekly { days: Vec<u32>, time: String },
    Monthly { day: u32, time: String },
    Manual,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Policy {
    /// Send without asking. Off → each run waits for approval in Worlds.
    pub unattended: bool,
    /// How late a missed run may still execute.
    pub grace_minutes: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    pub trigger: Trigger,
    pub source: Value, // { pageId }
    #[serde(default)]
    pub transform: Value, // { kind: "none" } | { kind: "claude", instructions, model? }
    #[serde(default)]
    pub action: Value, // { kind: "discord.send", options?, mode?: "send" | "editLast" }
    pub destination: Option<Destination>,
    #[serde(default)]
    pub policy: Policy,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub spec: Value,
    pub next_run_at: Option<i64>,
    pub last_run_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_status: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub automation_id: String,
    pub status: String,
    pub trigger: String,
    pub scheduled_for: Option<i64>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub version_id: Option<String>,
    pub output: Option<Value>,
    pub error: Option<String>,
}

fn parse_time(t: &str) -> NaiveTime {
    NaiveTime::parse_from_str(t, "%H:%M").unwrap_or_else(|_| NaiveTime::from_hms_opt(9, 0, 0).unwrap())
}

/// Next fire time strictly after `after` (ms, local calendar semantics).
pub fn next_run(trigger: &Trigger, after: i64) -> Option<i64> {
    let after_dt = Local.timestamp_millis_opt(after).single()?;
    let at_local = |date: chrono::NaiveDate, time: NaiveTime| -> Option<i64> {
        Local.from_local_datetime(&date.and_time(time)).earliest().map(|d| d.timestamp_millis())
    };
    match trigger {
        Trigger::Once { at } => (*at > after).then_some(*at),
        Trigger::Manual => None,
        Trigger::Daily { time } => {
            let t = parse_time(time);
            (0..3).filter_map(|d| at_local(after_dt.date_naive() + Duration::days(d), t)).find(|&ms| ms > after)
        }
        Trigger::Weekly { days, time } => {
            let t = parse_time(time);
            if days.is_empty() {
                return None;
            }
            (0..15)
                .filter_map(|d| {
                    let date = after_dt.date_naive() + Duration::days(d);
                    days.contains(&date.weekday().num_days_from_sunday()).then(|| at_local(date, t)).flatten()
                })
                .find(|&ms| ms > after)
        }
        Trigger::Monthly { day, time } => {
            let t = parse_time(time);
            let mut y = after_dt.year();
            let mut m = after_dt.month();
            for _ in 0..14 {
                // clamp to the month's last day (e.g. 31 → 30 / 28)
                let last = (28..=31).rev().find(|d| chrono::NaiveDate::from_ymd_opt(y, m, *d).is_some()).unwrap_or(28);
                if let Some(date) = chrono::NaiveDate::from_ymd_opt(y, m, (*day).clamp(1, last)) {
                    if let Some(ms) = at_local(date, t) {
                        if ms > after {
                            return Some(ms);
                        }
                    }
                }
                m += 1;
                if m > 12 {
                    m = 1;
                    y += 1;
                }
            }
            None
        }
    }
}

fn automation_row(r: &rusqlite::Row) -> rusqlite::Result<Automation> {
    let spec: String = r.get(3)?;
    Ok(Automation {
        id: r.get(0)?,
        name: r.get(1)?,
        enabled: r.get::<_, i64>(2)? != 0,
        spec: serde_json::from_str(&spec).unwrap_or(Value::Null),
        next_run_at: r.get(4)?,
        last_run_at: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        last_status: r.get(8)?,
    })
}

const AUTO_SQL: &str = "SELECT a.id, a.name, a.enabled, a.spec, a.next_run_at, a.last_run_at, a.created_at, a.updated_at,
    (SELECT status FROM runs r WHERE r.automation_id = a.id ORDER BY COALESCE(r.started_at, r.scheduled_for) DESC LIMIT 1)
    FROM automations a";

pub fn list(conn: &Connection) -> Result<Vec<Automation>> {
    let mut stmt = conn.prepare(&format!("{AUTO_SQL} ORDER BY a.created_at DESC"))?;
    let rows = stmt.query_map([], automation_row)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Automation>> {
    Ok(conn.query_row(&format!("{AUTO_SQL} WHERE a.id = ?1"), [id], automation_row).optional()?)
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutomationInput {
    pub id: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub spec: Value,
}

pub fn save(conn: &Connection, ctx: &Ctx, input: AutomationInput) -> Result<Automation> {
    let spec: Spec = serde_json::from_value(input.spec.clone()).map_err(|e| anyhow!("invalid automation: {e}"))?;
    let next = if input.enabled { next_run(&spec.trigger, now()) } else { None };
    let t = now();
    let id = match input.id {
        Some(id) => {
            conn.execute(
                "UPDATE automations SET name = ?1, enabled = ?2, spec = ?3, next_run_at = ?4, updated_at = ?5 WHERE id = ?6",
                params![input.name, input.enabled as i64, input.spec.to_string(), next, t, id],
            )?;
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO automations (id, name, enabled, spec, next_run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, input.name, input.enabled as i64, input.spec.to_string(), next, t],
            )?;
            id
        }
    };
    if let Some(pid) = spec.source.get("pageId").and_then(Value::as_str) {
        store::record(
            conn,
            ctx,
            Some(pid),
            "automation",
            &format!("Automation “{}” saved", input.name),
            None,
            None,
            None,
            json!({ "automationId": id }),
        )?;
    }
    db::mark_change(conn, None, "automation", &ctx.origin)?;
    get(conn, &id)?.ok_or_else(|| anyhow!("automation vanished"))
}

pub fn runs(conn: &Connection, automation_id: Option<&str>, limit: i64) -> Result<Vec<Run>> {
    let filter = if automation_id.is_some() { "WHERE automation_id = ?1" } else { "WHERE ?1 IS NULL" };
    let mut stmt = conn.prepare(&format!(
        "SELECT id, automation_id, status, trigger, scheduled_for, started_at, finished_at, version_id, output, error
         FROM runs {filter} ORDER BY COALESCE(started_at, scheduled_for) DESC LIMIT {}",
        limit.clamp(1, 500)
    ))?;
    let rows = stmt
        .query_map(params![automation_id], |r| {
            let out: Option<String> = r.get(8)?;
            Ok(Run {
                id: r.get(0)?,
                automation_id: r.get(1)?,
                status: r.get(2)?,
                trigger: r.get(3)?,
                scheduled_for: r.get(4)?,
                started_at: r.get(5)?,
                finished_at: r.get(6)?,
                version_id: r.get(7)?,
                output: out.and_then(|s| serde_json::from_str(&s).ok()),
                error: r.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn finish_run(conn: &Connection, run_id: &str, status: &str, output: Option<Value>, error: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE runs SET status = ?1, finished_at = ?2, output = COALESCE(?3, output), error = ?4 WHERE id = ?5",
        params![status, now(), output.map(|o| o.to_string()), error, run_id],
    )?;
    db::mark_change(conn, None, "automation", "runner")?;
    Ok(())
}

/// Execute one run end-to-end.
pub async fn execute(
    app: &tauri::AppHandle,
    automation_id: &str,
    trigger: &str,
    scheduled_for: Option<i64>,
    authorized: bool,
) -> Result<String> {
    let state = app.state::<AppState>();
    let run_id = new_id();

    // 1. Snapshot the source page (controlled input for the whole run)
    let (auto, spec, page_id, page_md, version_id) = {
        let c = state.conn();
        let a = get(&c, automation_id)?.ok_or_else(|| anyhow!("automation not found"))?;
        let spec: Spec = serde_json::from_value(a.spec.clone())?;
        let page_id =
            spec.source.get("pageId").and_then(Value::as_str).ok_or_else(|| anyhow!("automation has no source page"))?.to_string();
        c.execute(
            "INSERT INTO runs (id, automation_id, status, trigger, scheduled_for, started_at) VALUES (?1, ?2, 'running', ?3, ?4, ?5)",
            params![run_id, automation_id, trigger, scheduled_for, now()],
        )?;
        db::mark_change(&c, None, "automation", "runner")?;
        let page = store::get_page(&c, &page_id)?;
        let Some(page) = page.filter(|p| p.meta.deleted_at.is_none()) else {
            finish_run(&c, &run_id, "failed", None, Some("The source page no longer exists."))?;
            return Ok(run_id);
        };
        let version = store::snapshot(&c, &page_id, "automation", Some(&run_id), Some(&format!("Snapshot for “{}”", a.name)))?;
        c.execute("UPDATE runs SET version_id = ?1 WHERE id = ?2", params![version, run_id])?;
        let md = page.blocks.iter().map(|b| crate::content::to_markdown(&b.content)).collect::<Vec<_>>().join("\n\n");
        (a, spec, page_id, md, version)
    };
    let _ = version_id;

    // 2. Optional Claude transform against the snapshot (no tool access)
    let mut blocks_override: Option<Vec<Value>> = None;
    if spec.transform.get("kind").and_then(Value::as_str) == Some("claude") {
        let instructions = spec.transform.get("instructions").and_then(Value::as_str).unwrap_or("").to_string();
        let model = spec.transform.get("model").and_then(Value::as_str).map(str::to_string);
        match crate::ai::transform_markdown(app, &page_md, &instructions, model).await {
            Ok(md) => {
                let nodes = crate::content::from_markdown(&md);
                let c = state.conn();
                c.execute("UPDATE runs SET output = ?1 WHERE id = ?2", params![json!({ "transformed": md }).to_string(), run_id])?;
                blocks_override = Some(nodes);
            }
            Err(e) => {
                let c = state.conn();
                finish_run(&c, &run_id, "failed", None, Some(&format!("Claude transform failed: {e:#}")))?;
                return Ok(run_id);
            }
        }
    }

    // 3. Action
    let action_kind = spec.action.get("kind").and_then(Value::as_str).unwrap_or("discord.send");
    if action_kind != "discord.send" {
        let c = state.conn();
        finish_run(&c, &run_id, "failed", None, Some("Unsupported action"))?;
        return Ok(run_id);
    }
    let Some(mut dest) = spec.destination.clone() else {
        let c = state.conn();
        finish_run(&c, &run_id, "failed", None, Some("No destination set"))?;
        return Ok(run_id);
    };
    let options = spec.action.get("options").cloned().and_then(|o| serde_json::from_value(o).ok());
    if spec.action.get("mode").and_then(Value::as_str) == Some("editLast") {
        let c = state.conn();
        let last: Option<(Option<String>, Option<String>)> = c
            .query_row(
                "SELECT channel_id, message_id FROM discord_messages WHERE automation_id = ?1 AND message_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
                [automation_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((ch, msg)) = last {
            dest = Destination { kind: "edit".into(), channel_id: ch, message_id: msg, ..dest };
        }
    }

    if !(spec.policy.unattended || authorized) {
        let c = state.conn();
        discord::queue_action(
            &c,
            "discord.send",
            json!({
                "pageId": page_id,
                "destination": dest,
                "options": options,
                "blocks": blocks_override,
                "automationId": automation_id,
                "automationName": auto.name,
                "runId": run_id,
            }),
            "automation",
            Some(&run_id),
        )?;
        c.execute("UPDATE runs SET status = 'waiting' WHERE id = ?1", [&run_id])?;
        db::mark_change(&c, Some(&page_id), "pending", "runner")?;
        let _ = app.emit("worlds://approval", json!({ "runId": run_id, "automation": auto.name }));
        return Ok(run_id);
    }

    let (cfg, rendered, files) = {
        let c = state.conn();
        let r = discord::render_for_page(&c, &page_id, blocks_override, options)?;
        let f = discord::file_payloads(&c, &r)?;
        (discord::bridge_config(&c), r, f)
    };
    let res = discord::deliver(&state.db, &cfg, &rendered, files, &dest, Some(&page_id), Some(automation_id)).await;
    let c = state.conn();
    match res {
        Ok(v) => finish_run(
            &c,
            &run_id,
            "succeeded",
            Some(json!({ "payload": rendered.payload, "result": v, "warnings": rendered.warnings })),
            None,
        )?,
        Err(e) => finish_run(&c, &run_id, "failed", Some(json!({ "payload": rendered.payload })), Some(&format!("{e:#}")))?,
    }
    Ok(run_id)
}

fn advance(conn: &Connection, a: &Automation) -> Result<()> {
    let spec: Spec = serde_json::from_value(a.spec.clone())?;
    let next = next_run(&spec.trigger, now());
    // A one-time trigger that has fired switches itself off.
    let enabled = match spec.trigger {
        Trigger::Manual => a.enabled,
        _ => a.enabled && next.is_some(),
    };
    conn.execute(
        "UPDATE automations SET last_run_at = ?1, next_run_at = ?2, enabled = ?3 WHERE id = ?4",
        params![now(), next, enabled as i64, a.id],
    )?;
    db::mark_change(conn, None, "automation", "runner")?;
    Ok(())
}

pub fn spawn_scheduler(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // settle after launch
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        loop {
            let due: Vec<Automation> = {
                let state = app.state::<AppState>();
                let c = state.conn();
                list(&c)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|a| a.enabled && a.next_run_at.map(|t| t <= now()).unwrap_or(false))
                    .collect()
            };
            for a in due {
                let scheduled = a.next_run_at.unwrap_or_else(now);
                let grace = serde_json::from_value::<Spec>(a.spec.clone()).ok().and_then(|s| s.policy.grace_minutes).unwrap_or(30);
                {
                    let state = app.state::<AppState>();
                    let c = state.conn();
                    let _ = advance(&c, &a);
                    if now() - scheduled > grace * 60_000 {
                        let _ = c.execute(
                            "INSERT INTO runs (id, automation_id, status, trigger, scheduled_for, started_at, finished_at, error)
                             VALUES (?1, ?2, 'skipped', 'schedule', ?3, ?4, ?4, 'Missed while Worlds was not running')",
                            params![new_id(), a.id, scheduled, now()],
                        );
                        let _ = db::mark_change(&c, None, "automation", "runner");
                        continue;
                    }
                }
                let app2 = app.clone();
                let id = a.id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = execute(&app2, &id, "schedule", Some(scheduled), false).await {
                        eprintln!("automation {id} failed: {e:#}");
                    }
                });
            }
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn automations_list(state: State<'_, AppState>) -> CmdResult<Vec<Automation>> {
    list(&state.conn()).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn automation_get(state: State<'_, AppState>, id: String) -> CmdResult<Option<Automation>> {
    get(&state.conn(), &id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn automation_save(state: State<'_, AppState>, automation: AutomationInput) -> CmdResult<Automation> {
    save(&state.conn(), &Ctx::user(), automation).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn automation_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let c = state.conn();
    c.execute("DELETE FROM automations WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;
    db::mark_change(&c, None, "automation", "ui").map_err(|e| e.to_string())?;
    Ok(())
}

/// Run now: the user pressed the button after seeing the preview, which is
/// the authorisation for this one run.
#[tauri::command]
pub async fn automation_run_now(app: tauri::AppHandle, id: String) -> CmdResult<String> {
    execute(&app, &id, "manual", Some(now()), true).await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn automation_runs(state: State<'_, AppState>, automation_id: Option<String>, limit: Option<i64>) -> CmdResult<Vec<Run>> {
    runs(&state.conn(), automation_id.as_deref(), limit.unwrap_or(50)).map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_next() {
        let base = Local.with_ymd_and_hms(2026, 10, 3, 20, 0, 0).unwrap().timestamp_millis();
        let n = next_run(&Trigger::Daily { time: "19:40".into() }, base).unwrap();
        let d = Local.timestamp_millis_opt(n).unwrap();
        assert_eq!((d.day(), d.format("%H:%M").to_string()), (4, "19:40".to_string()));
    }

    #[test]
    fn monthly_clamps() {
        let base = Local.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap().timestamp_millis();
        let n = next_run(&Trigger::Monthly { day: 31, time: "08:00".into() }, base).unwrap();
        let d = Local.timestamp_millis_opt(n).unwrap();
        assert_eq!((d.month(), d.day()), (2, 28));
    }
}
