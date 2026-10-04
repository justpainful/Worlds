//! Local AI bridge → Claude Code.
//!
//! Worlds never talks to a model provider itself. It runs the user's local
//! Claude Code (`claude -p`) with:
//!   * a light model and low effort by default (`--model haiku --effort low`),
//!   * every built-in tool disabled (`--tools ""`),
//!   * only the Worlds MCP server (`--strict-mcp-config`), which is this
//!     same executable in `--mcp` mode, tagged with the run's op id so all
//!     changes are grouped for review and one-step undo.

use crate::commands::CmdResult;
use crate::db::{self, now};
use crate::store;
use crate::AppState;
use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

static RUNNING: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

pub fn claude_path(conn: &rusqlite::Connection) -> Option<PathBuf> {
    if let Some(p) = db::get_setting(conn, "ai.claudePath").ok().flatten().and_then(|v| v.as_str().map(PathBuf::from)) {
        if p.exists() {
            return Some(p);
        }
    }
    let exe = if cfg!(windows) { "claude.exe" } else { "claude" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let c = dir.join(exe);
            if c.exists() {
                return Some(c);
            }
        }
    }
    let home = dirs::home_dir()?;
    [home.join(".local").join("bin").join(exe), home.join(".claude").join("local").join(exe)].into_iter().find(|p| p.exists())
}

fn setting_str(conn: &rusqlite::Connection, key: &str, default: &str) -> String {
    db::get_setting(conn, key).ok().flatten().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| default.to_string())
}

pub fn global_instructions(conn: &rusqlite::Connection) -> Vec<String> {
    db::get_setting(conn, "ai.instructions")
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect()
}

/// Prepare a `claude` child process: no console window, and none of the
/// environment a *parent* Claude Code session leaks into us (when Worlds is
/// started from inside Claude Code Desktop, e.g. during development). Those
/// variables point the child at the parent's short-lived host auth, which
/// fails with "OAuth session expired". Worlds must use the user's own
/// standalone Claude Code login.
fn prepare_claude(cmd: &mut tokio::process::Command) {
    let inherited_host = std::env::var_os("CLAUDECODE").is_some() || std::env::var_os("CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH").is_some();
    for (key, _) in std::env::vars_os() {
        let k = key.to_string_lossy();
        if k.starts_with("CLAUDE_CODE_")
            || k == "CLAUDECODE"
            || k == "CLAUDE_PID"
            || k == "CLAUDE_AGENT_SDK_VERSION"
            || k.starts_with("CLAUDE_PREVIEW_")
        {
            cmd.env_remove(&key);
        }
    }
    if inherited_host {
        // Only the host session sets these; a user's own config lives in settings files.
        cmd.env_remove("ANTHROPIC_BASE_URL");
    }
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
}

const DIALECT: &str = "Block content uses Worlds Markdown: `# `/`## `/`### ` headings, `- ` bullets, `1. ` numbered, \
`- [ ] `/`- [x] ` checklist, `> ` quote, `> [!note] text` callout (tones: note, highlight, warning, success), \
`> [!prompt] text` prompt, ``` fenced code, `---` divider, pipe tables, inline **bold** *italic* ~~strike~~ ==highlight== `code` \
[label](url), and page mentions `@[Title](page:ID)`. Do not use HTML.";

fn system_prompt(conn: &rusqlite::Connection, page_id: Option<&str>) -> Result<String> {
    let profile = store::profile(conn)?;
    let mut s = String::new();
    s.push_str(&format!(
        "You are the assistant inside Worlds, {}’s private local workspace. You can act ONLY through the mcp__worlds tools; \
you have no file system or shell. Pages are trees of blocks with stable ids.\n\n\
Rules:\n\
- Read before writing (pages_read / blocks_read). Change the smallest set of blocks that does the job: prefer blocks_update on one block over rewriting a page.\n\
- Assistant instructions (global and page-level) are binding.\n\
- Keep the user’s language. Arabic and English are both first-class; never transliterate.\n\
- Anything that leaves Worlds (Discord) goes through discord_send, which queues a preview for the user to approve. Say so.\n\
- Images, PDFs and text files the user attaches are included in their message; describe or use them directly.\n\
- You can also manage the user's profile, assistant instructions, templates, Trash and automations. Deleting moves pages to Trash; only delete, or change instructions or the profile, when the user asks.\n\
- Tool map: workspace_overview and time_now for orientation and dates; pages_query, pages_tree and search_everything to find things; pages_export_markdown and pages_outline to read; tasks_* for checklists; tables_* for tables and CSV; blocks_insert_layout for columns, toggles and collections (boards, tables, galleries); pages_set_properties, pages_bulk and properties_* for status, tags and fields; pages_find_text and pages_replace_text for wording; pages_merge, pages_split_by_headings, pages_sort_children for structure; pages_set_cover, pages_set_style and pages_set_icon for looks (icons may be pi:<name> product icons); profile_blocks_* and profile_set_image for the profile; versions_*, history_undo and activity_summary for history. When the user's message ends with a line naming Worlds tools, prefer those tools.
\n- This is an ongoing conversation: earlier messages in this chat still apply. Other conversations are reachable with chats_search and chats_read; when the user names or mentions an earlier chat, look it up.\n\
- Finish with one or two short sentences saying what you changed. No preamble.\n\n{DIALECT}\n",
        if profile.display_name.is_empty() { "the user".into() } else { profile.display_name.clone() }
    ));
    let global = global_instructions(conn);
    if !global.is_empty() {
        s.push_str("\nGlobal assistant instructions:\n");
        for g in global {
            s.push_str(&format!("- {g}\n"));
        }
    }
    if let Some(pid) = page_id {
        if let Some(p) = store::get_page(conn, pid)? {
            s.push_str(&format!("\nThe user is looking at the page “{}” (id {}).\n", p.meta.title, pid));
            if !p.instructions.is_empty() {
                s.push_str("Assistant instructions for this page:\n");
                for i in &p.instructions {
                    s.push_str(&format!("- {i}\n"));
                }
            }
        }
    }
    s.push_str(&format!("\nNow: {}\n", chrono::Local::now().format("%A %Y-%m-%d %H:%M")));
    Ok(s)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub prompt: String,
    pub page_id: Option<String>,
    pub block_ids: Option<Vec<String>>,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// Continue this conversation; None starts a new one.
    pub chat_id: Option<String>,
    /// Worlds attachment ids to show Claude with this message.
    pub attachments: Option<Vec<String>>,
}

const MAX_IMAGE_BYTES: i64 = 3_700_000; // base64 must stay under the API's 5 MB image limit
const MAX_PDF_BYTES: i64 = 24_000_000;
const MAX_TEXT_BYTES: i64 = 200_000;

/// Message content for Claude: the text, then each attachment as native
/// content (image / PDF document / inline text) where possible.
/// Turns tool tokens "@[Label](tool:a,b)" into "@Label" and returns the tool names they carry.
fn expand_tool_tokens(text: &str) -> (String, Vec<String>) {
    let mut out = String::with_capacity(text.len());
    let mut tools: Vec<String> = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("@[") {
        let after = &rest[start + 2..];
        let parsed = after.find("](tool:").and_then(|mid| {
            let label = &after[..mid];
            let tail = &after[mid + 7..];
            tail.find(')').map(|end| (label, &tail[..end], mid + 7 + end + 1))
        });
        match parsed {
            Some((label, names, used)) if !label.contains(']') => {
                out.push_str(&rest[..start]);
                out.push('@');
                out.push_str(label);
                for n in names.split(',').map(str::trim).filter(|n| !n.is_empty()) {
                    if !tools.iter().any(|t| t == n) {
                        tools.push(n.to_string());
                    }
                }
                rest = &after[used..];
            }
            _ => {
                out.push_str(&rest[..start + 2]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    (out, tools)
}

fn build_content(text: &str, atts: &[store::Attachment]) -> Value {
    use base64::Engine;
    let mut blocks: Vec<Value> = Vec::new();
    let mut body = text.to_string();
    if !atts.is_empty() {
        body.push_str("\n\nAttached files (Worlds attachment ids; attachments_insert can place them in a page):");
        for a in atts {
            body.push_str(&format!("\n- {} ({}, {}, id {})", a.file_name, a.mime, crate::ui_bytes(a.size), a.id));
        }
    }
    blocks.push(json!({ "type": "text", "text": body }));
    for a in atts {
        let path = store::attachment_abs_path(a);
        let kind = crate::preview::kind_for(&a.file_name, &a.mime);
        let image = matches!(a.mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp");
        let note = |why: &str| json!({ "type": "text", "text": format!("[{} was attached but {}]", a.file_name, why) });
        if image {
            if a.size > MAX_IMAGE_BYTES {
                blocks.push(note("is too large to view"));
            } else if let Ok(bytes) = std::fs::read(&path) {
                blocks.push(json!({ "type": "image", "source": { "type": "base64", "media_type": a.mime, "data": base64::engine::general_purpose::STANDARD.encode(bytes) } }));
            }
        } else if a.mime == "application/pdf" || kind == "pdf" {
            if a.size > MAX_PDF_BYTES {
                blocks.push(note("is too large to read"));
            } else if let Ok(bytes) = std::fs::read(&path) {
                blocks.push(json!({ "type": "document", "source": { "type": "base64", "media_type": "application/pdf", "data": base64::engine::general_purpose::STANDARD.encode(bytes) }, "title": a.file_name }));
            }
        } else if kind == "text" || a.file_name.to_lowercase().ends_with(".csv") || a.file_name.to_lowercase().ends_with(".tsv") {
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let cut = &bytes[..bytes.len().min(MAX_TEXT_BYTES as usize)];
                    let txt = String::from_utf8_lossy(cut);
                    let more = if a.size > MAX_TEXT_BYTES { "\n[truncated]" } else { "" };
                    blocks.push(json!({ "type": "text", "text": format!("File {}:\n```\n{}\n```{}", a.file_name, txt, more) }));
                }
                Err(_) => blocks.push(note("could not be read")),
            }
        } else {
            blocks.push(note("its contents cannot be read here (ask the user to export it as PDF or text)"));
        }
    }
    Value::Array(blocks)
}

fn emit(app: &tauri::AppHandle, run_id: &str, kind: &str, data: Value) {
    let mut v = json!({ "runId": run_id, "kind": kind, "at": now() });
    if let (Some(o), Some(d)) = (v.as_object_mut(), data.as_object()) {
        for (k, val) in d {
            o.insert(k.clone(), val.clone());
        }
    }
    let _ = app.emit("worlds://ai", v);
}

// ---------------------------------------------------------------------------
// Conversations. One chat = one persistent Claude Code session, resumed on
// every follow-up, so Claude remembers the conversation. Messages are also
// kept in Worlds so the history is browsable without Claude.
// ---------------------------------------------------------------------------

fn chat_title(prompt: &str) -> String {
    let (clean, _) = expand_tool_tokens(prompt);
    let line = clean.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let mut t: String = line.chars().take(60).collect();
    if line.chars().count() > 60 {
        t.push('\u{2026}');
    }
    if t.is_empty() {
        "New chat".into()
    } else {
        t
    }
}

/// Returns (chat_id, session_id, resume).
fn open_chat(conn: &rusqlite::Connection, chat_id: Option<&str>, page_id: Option<&str>, prompt: &str) -> Result<(String, String, bool)> {
    use rusqlite::OptionalExtension;
    if let Some(id) = chat_id {
        let row: Option<String> = conn.query_row("SELECT session_id FROM ai_chats WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        if let Some(session) = row {
            // Only resume once Claude has actually created the session.
            let started: i64 = conn.query_row(
                "SELECT COUNT(*) FROM ai_messages WHERE chat_id = ?1 AND role = 'assistant' AND json_extract(meta, '$.sessionOk') = 1",
                [id],
                |r| r.get(0),
            )?;
            return Ok((id.to_string(), session, started > 0));
        }
    }
    let id = db::new_id();
    let session = uuid::Uuid::new_v4().to_string();
    let t = now();
    conn.execute(
        "INSERT INTO ai_chats (id, title, page_id, session_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, chat_title(prompt), page_id, session, t],
    )?;
    Ok((id, session, false))
}

/// Plain transcript of a conversation, newest messages kept when it is long.
pub fn chat_transcript(conn: &rusqlite::Connection, chat_id: &str, max_chars: usize) -> Result<(String, String)> {
    let title: String = conn.query_row("SELECT title FROM ai_chats WHERE id = ?1", [chat_id], |r| r.get(0))?;
    let mut stmt = conn.prepare("SELECT role, content FROM ai_messages WHERE chat_id = ?1 ORDER BY created_at, rowid")?;
    let rows: Vec<(String, String)> = stmt.query_map([chat_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut lines: Vec<String> = rows
        .into_iter()
        .map(|(role, content)| {
            let who = if role == "user" { "User" } else { "Claude" };
            let body: String = content.chars().take(1500).collect();
            format!("{who}: {body}")
        })
        .collect();
    // Keep the most recent part within budget.
    let mut total: usize = lines.iter().map(|l| l.chars().count() + 1).sum();
    while total > max_chars && lines.len() > 1 {
        total -= lines[0].chars().count() + 1;
        lines.remove(0);
    }
    Ok((title, lines.join("\n")))
}

/// `#[Title](chat:ID)` tokens in a prompt → transcripts appended as context.
fn referenced_chats(conn: &rusqlite::Connection, prompt: &str, current: &str) -> String {
    let mut out = String::new();
    let mut seen: Vec<String> = Vec::new();
    let mut rest = prompt;
    while let Some(i) = rest.find("](chat:") {
        let after = &rest[i + 7..];
        let Some(end) = after.find(')') else { break };
        let id = after[..end].trim().to_string();
        rest = &after[end..];
        if id.is_empty() || id == current || seen.contains(&id) || seen.len() >= 5 {
            continue;
        }
        if let Ok((title, text)) = chat_transcript(conn, &id, 12_000) {
            out.push_str(&format!("\n### Conversation \u{201c}{title}\u{201d} (chat id {id})\n{text}\n"));
            seen.push(id);
        }
    }
    if out.is_empty() {
        out
    } else {
        format!("\n\n---\nThe user referenced these earlier conversations. Use them as context:\n{out}")
    }
}

fn add_message(
    conn: &rusqlite::Connection,
    chat_id: &str,
    role: &str,
    content: &str,
    steps: &Value,
    op_id: Option<&str>,
    meta: &Value,
) -> Result<()> {
    let t = now();
    conn.execute(
        "INSERT INTO ai_messages (id, chat_id, role, content, steps, op_id, meta, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![db::new_id(), chat_id, role, content, steps.to_string(), op_id, meta.to_string(), t],
    )?;
    conn.execute("UPDATE ai_chats SET updated_at = ?1 WHERE id = ?2", rusqlite::params![t, chat_id])?;
    Ok(())
}

#[tauri::command]
pub async fn ai_run(app: tauri::AppHandle, state: State<'_, AppState>, request: AiRequest) -> CmdResult<Value> {
    let run_id = db::new_id();
    let (claude, system, model, effort, chat_id, session, resume, refs, atts) = {
        let c = state.conn();
        let claude = claude_path(&c).ok_or("Claude Code is not installed or not on PATH.")?;
        let system = system_prompt(&c, request.page_id.as_deref()).map_err(|e| e.to_string())?;
        let model = request.model.clone().unwrap_or_else(|| setting_str(&c, "ai.model", "haiku"));
        let effort = request.effort.clone().unwrap_or_else(|| setting_str(&c, "ai.effort", "low"));
        let (chat_id, session, resume) =
            open_chat(&c, request.chat_id.as_deref(), request.page_id.as_deref(), &request.prompt).map_err(|e| e.to_string())?;
        let atts: Vec<store::Attachment> = request
            .attachments
            .clone()
            .unwrap_or_default()
            .iter()
            .take(10)
            .filter_map(|id| store::get_attachment(&c, id).ok().flatten())
            .collect();
        let att_meta: Vec<Value> =
            atts.iter().map(|a| json!({ "id": a.id, "name": a.file_name, "mime": a.mime, "kind": a.kind, "size": a.size })).collect();
        add_message(
            &c,
            &chat_id,
            "user",
            &request.prompt,
            &json!([]),
            None,
            &json!({ "pageId": request.page_id, "attachments": att_meta }),
        )
        .map_err(|e| e.to_string())?;
        let refs = referenced_chats(&c, &request.prompt, &chat_id);
        (claude, system, model, effort, chat_id, session, resume, refs, atts)
    };
    // "@[Pages](tool:pages_create,...)" shows as a short chip to the user; Claude gets the tool names.
    let (mut prompt, tools) = expand_tool_tokens(&request.prompt);
    if !tools.is_empty() {
        prompt.push_str(&format!(
            "

(The user picked these Worlds tools for this request; prefer them: {}.)",
            tools.join(", ")
        ));
    }
    prompt.push_str(&refs);
    if let Some(ids) = &request.block_ids {
        if !ids.is_empty() {
            prompt.push_str(&format!("\n\n(Selected block ids: {})", ids.join(", ")));
        }
    }
    if let Some(pid) = &request.page_id {
        // The page in view can change between messages of one chat.
        prompt.push_str(&format!("\n\n(Current page id: {pid})"));
    }
    let app2 = app.clone();
    let rid = run_id.clone();
    let cid = chat_id.clone();
    tauri::async_runtime::spawn(async move {
        emit(&app2, &rid, "start", json!({ "model": model, "pageId": request.page_id, "chatId": cid }));
        let content = build_content(&prompt, &atts);
        let outcome = run_claude(&app2, &rid, &claude, &system, &content, &model, &effort, &session, resume).await;
        let state = app2.state::<AppState>();
        match outcome {
            Ok((summary, steps)) => {
                let text = summary.get("text").and_then(Value::as_str).unwrap_or("").to_string();
                let is_error = summary.get("isError").and_then(Value::as_bool).unwrap_or(false);
                let meta = json!({
                    "sessionOk": !is_error,
                    "isError": is_error,
                    "changeCount": summary.get("changeCount"),
                    "pages": summary.get("pages"),
                    "durationMs": summary.get("durationMs"),
                });
                let _ = add_message(&state.conn(), &cid, "assistant", &text, &steps, Some(&rid), &meta);
                let mut done = summary;
                done["chatId"] = json!(cid);
                emit(&app2, &rid, "done", done);
            }
            Err(e) => {
                let msg = format!("{e:#}");
                let _ = add_message(&state.conn(), &cid, "assistant", &msg, &json!([]), Some(&rid), &json!({ "isError": true }));
                emit(&app2, &rid, "error", json!({ "message": msg, "chatId": cid }));
            }
        }
        RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).remove(&rid);
    });
    Ok(json!({ "runId": run_id, "chatId": chat_id }))
}

#[allow(clippy::too_many_arguments)]
async fn run_claude(
    app: &tauri::AppHandle,
    run_id: &str,
    claude: &PathBuf,
    system: &str,
    content: &Value,
    model: &str,
    effort: &str,
    session: &str,
    resume: bool,
) -> Result<(Value, Value)> {
    let exe = std::env::current_exe()?;
    let dir = db::data_dir().join("ai");
    std::fs::create_dir_all(&dir)?;
    let mcp_path = dir.join(format!("mcp-{run_id}.json"));
    std::fs::write(
        &mcp_path,
        json!({
            "mcpServers": {
                "worlds": {
                    "type": "stdio",
                    "command": exe.to_string_lossy(),
                    "args": ["--mcp", "--actor", "ai", "--op", run_id],
                }
            }
        })
        .to_string(),
    )?;

    let mut cmd = tokio::process::Command::new(claude);
    cmd.args([
        "-p",
        "--model",
        model,
        "--effort",
        effort,
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--strict-mcp-config",
        "--mcp-config",
    ])
    .arg(&mcp_path)
    .args(["--tools", ""])
    .args(["--allowedTools", "mcp__worlds"])
    .args(["--system-prompt", system]);
    if resume {
        cmd.args(["--resume", session]);
    } else {
        cmd.args(["--session-id", session]);
    }
    cmd.current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    prepare_claude(&mut cmd);
    let mut child = cmd.spawn().context("start Claude Code")?;
    crate::jobs::adopt_tokio(&child);
    if let Some(pid) = child.id() {
        RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).insert(run_id.to_string(), pid);
    }
    {
        // One user message (text + images/documents) in stream-json form, then EOF.
        let mut stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let line = json!({ "type": "user", "message": { "role": "user", "content": content } }).to_string() + "\n";
        stdin.write_all(line.as_bytes()).await?;
        stdin.shutdown().await?;
    }
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let stderr = child.stderr.take();
    let mut lines = BufReader::new(stdout).lines();
    let mut final_text = String::new();
    let mut result: Value = json!({});
    let mut steps: Vec<Value> = Vec::new();
    while let Some(line) = lines.next_line().await? {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        match v.get("type").and_then(Value::as_str) {
            Some("assistant") => {
                for c in v["message"]["content"].as_array().cloned().unwrap_or_default() {
                    match c.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            let t = c["text"].as_str().unwrap_or("");
                            final_text.push_str(t);
                            emit(app, run_id, "text", json!({ "text": t }));
                        }
                        Some("tool_use") => {
                            let name = c["name"].as_str().unwrap_or("").trim_start_matches("mcp__worlds__").to_string();
                            steps.push(json!({ "tool": name, "ok": null }));
                            emit(app, run_id, "tool", json!({ "tool": name, "input": c["input"] }));
                        }
                        _ => {}
                    }
                }
            }
            Some("user") => {
                for c in v["message"]["content"].as_array().cloned().unwrap_or_default() {
                    if c.get("type").and_then(Value::as_str) == Some("tool_result") {
                        let is_err = c.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                        if let Some(s) = steps.iter_mut().rev().find(|s| s["ok"].is_null()) {
                            s["ok"] = json!(!is_err);
                        }
                        emit(app, run_id, "tool_result", json!({ "error": is_err }));
                    }
                }
            }
            Some("result") => {
                result = json!({
                    "text": v.get("result").and_then(Value::as_str).unwrap_or(&final_text),
                    "isError": v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                    "costUsd": v.get("total_cost_usd"),
                    "durationMs": v.get("duration_ms"),
                    "turns": v.get("num_turns"),
                });
            }
            _ => {}
        }
    }
    let status = child.wait().await?;
    let _ = std::fs::remove_file(&mcp_path);
    if result.get("text").is_none() {
        let mut err = String::new();
        if let Some(mut e) = stderr {
            use tokio::io::AsyncReadExt;
            let _ = e.read_to_string(&mut err).await;
        }
        if !status.success() {
            bail!("Claude Code exited ({}): {}", status, err.trim().lines().last().unwrap_or("no output"));
        }
        result = json!({ "text": final_text });
    }
    // What did this run change?
    let state = app.state::<AppState>();
    let changes = store::list_history(&state.conn(), None, Some(run_id), 500).unwrap_or_default();
    let mut pages: Vec<Value> = Vec::new();
    for h in &changes {
        if let Some(pid) = &h.page_id {
            if !pages.iter().any(|p| p["id"] == *pid) {
                pages.push(json!({ "id": pid, "title": h.page_title }));
            }
        }
    }
    result["opId"] = json!(run_id);
    result["changeCount"] = json!(changes.len());
    result["pages"] = json!(pages);
    Ok((result, Value::Array(steps)))
}

#[tauri::command]
pub async fn ai_chats(state: State<'_, AppState>, limit: Option<i64>) -> CmdResult<Vec<Value>> {
    let c = state.conn();
    let mut stmt = c
        .prepare(
            "SELECT c.id, c.title, c.page_id, c.created_at, c.updated_at, (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = c.id)
             FROM ai_chats c ORDER BY c.updated_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit.unwrap_or(100)], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "pageId": r.get::<_, Option<String>>(2)?,
                "createdAt": r.get::<_, i64>(3)?,
                "updatedAt": r.get::<_, i64>(4)?,
                "messageCount": r.get::<_, i64>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub async fn ai_chat(state: State<'_, AppState>, id: String) -> CmdResult<Value> {
    let c = state.conn();
    let mut stmt = c
        .prepare("SELECT id, role, content, steps, op_id, meta, created_at FROM ai_messages WHERE chat_id = ?1 ORDER BY created_at, rowid")
        .map_err(|e| e.to_string())?;
    let messages = stmt
        .query_map([&id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "role": r.get::<_, String>(1)?,
                "content": r.get::<_, String>(2)?,
                "steps": serde_json::from_str::<Value>(&r.get::<_, String>(3)?).unwrap_or(json!([])),
                "opId": r.get::<_, Option<String>>(4)?,
                "meta": serde_json::from_str::<Value>(&r.get::<_, String>(5)?).unwrap_or(json!({})),
                "createdAt": r.get::<_, i64>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "messages": messages }))
}

#[tauri::command]
pub async fn ai_chat_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let c = state.conn();
    c.execute("DELETE FROM ai_messages WHERE chat_id = ?1", [&id]).map_err(|e| e.to_string())?;
    c.execute("DELETE FROM ai_chats WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_rename(state: State<'_, AppState>, id: String, title: String) -> CmdResult<()> {
    let t: String = title.trim().chars().take(80).collect();
    state.conn().execute("UPDATE ai_chats SET title = ?1 WHERE id = ?2", rusqlite::params![t, id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ai_cancel(run_id: String) -> CmdResult<()> {
    let pid = RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).remove(&run_id);
    if let Some(pid) = pid {
        let mut k = std::process::Command::new("taskkill");
        k.args(["/PID", &pid.to_string(), "/T", "/F"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            k.creation_flags(0x0800_0000);
        }
        let _ = k.status();
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_status(state: State<'_, AppState>) -> CmdResult<Value> {
    let path = claude_path(&state.conn());
    let Some(path) = path else {
        return Ok(json!({ "available": false }));
    };
    let mut cmd = tokio::process::Command::new(&path);
    cmd.arg("--version").stdout(Stdio::piped()).stderr(Stdio::null());
    prepare_claude(&mut cmd);
    let out = cmd.output().await.map_err(|e| e.to_string())?;
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let registered = {
        let mut c = tokio::process::Command::new(&path);
        c.args(["mcp", "get", "worlds"]).stdout(Stdio::piped()).stderr(Stdio::null());
        prepare_claude(&mut c);
        c.output().await.map(|o| o.status.success()).unwrap_or(false)
    };
    Ok(json!({ "available": out.status.success(), "version": version, "path": path, "mcpRegistered": registered }))
}

/// Make the Worlds tools available to Claude Code sessions (user scope).
/// Only ever called from an explicit button in Settings.
#[tauri::command]
pub async fn ai_register_mcp(state: State<'_, AppState>) -> CmdResult<String> {
    let path = claude_path(&state.conn()).ok_or("Claude Code not found")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut rm = tokio::process::Command::new(&path);
    rm.args(["mcp", "remove", "--scope", "user", "worlds"]).stdout(Stdio::null()).stderr(Stdio::null());
    prepare_claude(&mut rm);
    let _ = rm.status().await;
    let mut add = tokio::process::Command::new(&path);
    add.args(["mcp", "add", "--scope", "user", "worlds", "--"])
        .arg(exe)
        .args(["--mcp", "--actor", "ai"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_claude(&mut add);
    let out = add.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Automation transform: rewrite a page snapshot as Markdown. No tools.
pub async fn transform_markdown(app: &tauri::AppHandle, page_md: &str, instructions: &str, model: Option<String>) -> Result<String> {
    let (claude, model, effort, global) = {
        let state = app.state::<AppState>();
        let c = state.conn();
        let claude = claude_path(&c).ok_or_else(|| anyhow!("Claude Code not found"))?;
        (
            claude,
            model.unwrap_or_else(|| setting_str(&c, "ai.model", "haiku")),
            setting_str(&c, "ai.effort", "low"),
            global_instructions(&c),
        )
    };
    let system = format!(
        "You transform a snapshot of a page from Worlds before it is delivered. Output ONLY the resulting page, with no commentary, \
no code fences around it. Preserve the language(s) and structure unless told otherwise. Today is {}.\n\n{DIALECT}\n{}",
        chrono::Local::now().format("%A %Y-%m-%d"),
        if global.is_empty() { String::new() } else { format!("Global instructions:\n- {}", global.join("\n- ")) }
    );
    let prompt = format!("Instructions:\n{instructions}\n\n---- PAGE SNAPSHOT ----\n{page_md}");
    let empty_mcp = db::data_dir().join("ai").join("mcp-none.json");
    std::fs::create_dir_all(empty_mcp.parent().unwrap())?;
    std::fs::write(&empty_mcp, r#"{"mcpServers":{}}"#)?;
    let mut cmd = tokio::process::Command::new(claude);
    cmd.args([
        "-p",
        "--model",
        &model,
        "--effort",
        &effort,
        "--output-format",
        "json",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--mcp-config",
    ])
    .arg(&empty_mcp)
    .args(["--tools", ""])
    .args(["--system-prompt", &system])
    .current_dir(db::data_dir())
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
    prepare_claude(&mut cmd);
    let mut child = cmd.spawn()?;
    crate::jobs::adopt_tokio(&child);
    {
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(prompt.as_bytes()).await?;
        stdin.shutdown().await?;
    }
    let out = tokio::time::timeout(std::time::Duration::from_secs(180), child.wait_with_output()).await??;
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|_| anyhow!("{}", String::from_utf8_lossy(&out.stderr).trim()))?;
    if v.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
        bail!("{}", v.get("result").and_then(Value::as_str).unwrap_or("Claude returned an error"));
    }
    let text = v.get("result").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let text = text.trim_start_matches("```markdown").trim_start_matches("```").trim_end_matches("```").trim().to_string();
    if text.is_empty() {
        bail!("Claude returned nothing");
    }
    Ok(text)
}
