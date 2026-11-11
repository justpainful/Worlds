//! Model providers: Claude Code and Codex as runners, and API providers
//! (Anthropic, OpenAI compatible clouds, local servers) driven by Worlds' own
//! tool loop over the same tools the MCP server offers.
//!
//! Presets come from `src/ai/providers.json`, the shape Android and Apple
//! share. API keys live in Windows Credential Manager (`ai.key.<provider>`);
//! the database only keeps custom base URLs. Keys are never returned to the
//! UI, logged, or written anywhere else.

pub mod agent;
pub mod codex;
pub mod models;
pub mod wire;

#[cfg(test)]
mod tests;

use crate::account::secrets::{KeyringStore, SecretStore};
use crate::commands::CmdResult;
use crate::db;
use crate::AppState;
use agent::{BoxFuture, Endpoint, LoopEvent, ToolHost};
use anyhow::{anyhow, bail, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{Manager, State};
use wire::{Dialect, Msg, ToolDef};

pub const CLAUDE_CODE: &str = "claude-code";
pub const CODEX: &str = "codex";
const BASES_KEY: &str = "ai.providers";

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub api: String,
    pub kind: String,
    #[serde(default)]
    pub base_url: String,
    pub key: String,
    #[serde(default)]
    pub editable_base_url: bool,
    #[serde(default)]
    pub max_tools: Option<usize>,
    #[serde(default)]
    pub note: Option<String>,
}

impl Preset {
    pub fn dialect(&self) -> Dialect {
        if self.api == "anthropic" {
            Dialect::Anthropic
        } else {
            Dialect::OpenAi
        }
    }
    pub fn is_runner(&self) -> bool {
        self.kind == "runner"
    }
    pub fn is_local(&self) -> bool {
        self.kind == "local"
    }
    pub fn key_required(&self) -> bool {
        self.key == "required"
    }
}

pub fn presets() -> &'static [Preset] {
    static P: OnceLock<Vec<Preset>> = OnceLock::new();
    P.get_or_init(|| {
        let v: Value = serde_json::from_str(include_str!("../../../src/ai/providers.json")).expect("providers.json");
        serde_json::from_value(v["providers"].clone()).expect("providers.json shape")
    })
}

pub fn preset(id: &str) -> Result<&'static Preset> {
    presets().iter().find(|p| p.id == id).ok_or_else(|| anyhow!("Unknown provider {id}"))
}

fn key_name(id: &str) -> String {
    format!("ai.key.{id}")
}

/// Checks and stores an API key. Claude subscription (OAuth) tokens are
/// refused: Anthropic allows them only in Claude Code itself.
pub fn save_key(store: &dyn SecretStore, id: &str, key: &str) -> Result<()> {
    let p = preset(id)?;
    if p.is_runner() {
        bail!("{} signs in with its own login, not an API key.", p.name);
    }
    let key = key.trim();
    if key.is_empty() {
        return store.delete(&key_name(id));
    }
    if key.chars().any(char::is_whitespace) || key.len() > 4096 {
        bail!("That does not look like an API key.");
    }
    if key.starts_with("sk-ant-oat") {
        bail!("That is a Claude subscription sign-in token. Worlds cannot use those; create an API key in the Claude Console, or use Claude Code.");
    }
    store.set(&key_name(id), key)
}

pub fn load_key(store: &dyn SecretStore, id: &str) -> Option<String> {
    store.get(&key_name(id)).ok().flatten().filter(|k| !k.is_empty())
}

/// Custom base URLs by provider id.
fn custom_bases(conn: &rusqlite::Connection) -> HashMap<String, String> {
    db::get_setting(conn, BASES_KEY)
        .ok()
        .flatten()
        .and_then(|v| v.as_object().cloned())
        .map(|o| o.into_iter().filter_map(|(k, v)| v["baseUrl"].as_str().map(|b| (k, b.to_string()))).collect())
        .unwrap_or_default()
}

pub fn base_url(conn: &rusqlite::Connection, p: &Preset) -> String {
    custom_bases(conn).get(&p.id).filter(|b| !b.trim().is_empty()).cloned().unwrap_or_else(|| p.base_url.clone())
}

pub fn check_base_url(url: &str) -> Result<String> {
    let u = agent::trim_base(url);
    if u.is_empty() {
        return Ok(u);
    }
    let parsed = reqwest::Url::parse(&u).map_err(|_| anyhow!("That address is not a URL. It should look like https://host/v1."))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        bail!("The address must start with http:// or https://.");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        bail!("Put the API key in the key field, not in the address.");
    }
    Ok(u)
}

fn client() -> reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().connect_timeout(Duration::from_secs(15)).build().unwrap_or_default()).clone()
}

/// Tool support learned from model lists and from requests, per provider and model.
fn tool_support() -> &'static Mutex<HashMap<String, Option<bool>>> {
    static M: OnceLock<Mutex<HashMap<String, Option<bool>>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

fn provider_json(conn: &rusqlite::Connection, p: &Preset, store: &dyn SecretStore) -> Value {
    json!({
        "id": p.id,
        "name": p.name,
        "api": p.api,
        "kind": p.kind,
        "baseUrl": if p.is_runner() { String::new() } else { base_url(conn, p) },
        "defaultBaseUrl": p.base_url,
        "editableBaseUrl": p.editable_base_url,
        "key": p.key,
        "hasKey": !p.is_runner() && p.key != "none" && load_key(store, &p.id).is_some(),
        "note": p.note,
    })
}

#[tauri::command]
pub async fn ai_providers(state: State<'_, AppState>) -> CmdResult<Vec<Value>> {
    let c = state.conn();
    Ok(presets().iter().map(|p| provider_json(&c, p, &KeyringStore)).collect())
}

/// Saves a provider's base URL and/or API key. An empty key removes it; an
/// absent key leaves it as it is. The key is never sent back.
#[tauri::command]
pub async fn ai_provider_save(
    state: State<'_, AppState>,
    id: String,
    base_url: Option<String>,
    api_key: Option<String>,
) -> CmdResult<Value> {
    let p = preset(&id).map_err(|e| e.to_string())?;
    if let Some(url) = base_url {
        if !p.editable_base_url {
            return Err(format!("{} has a fixed address.", p.name));
        }
        let url = check_base_url(&url).map_err(|e| e.to_string())?;
        let c = state.conn();
        let mut all = db::get_setting(&c, BASES_KEY).ok().flatten().filter(Value::is_object).unwrap_or_else(|| json!({}));
        if url.is_empty() || url == p.base_url {
            if let Some(o) = all.as_object_mut() {
                o.remove(&id);
            }
        } else {
            all[&id] = json!({ "baseUrl": url });
        }
        db::set_setting(&c, BASES_KEY, &all).map_err(|e| e.to_string())?;
    }
    if let Some(key) = api_key {
        save_key(&KeyringStore, &id, &key).map_err(|e| e.to_string())?;
    }
    tool_support().lock().unwrap_or_else(|e| e.into_inner()).retain(|k, _| !k.starts_with(&format!("{id}/")));
    Ok(provider_json(&state.conn(), p, &KeyringStore))
}

#[tauri::command]
pub async fn ai_provider_models(state: State<'_, AppState>, id: String) -> CmdResult<Vec<models::ModelInfo>> {
    let p = preset(&id).map_err(|e| e.to_string())?;
    if p.is_runner() {
        return Ok(vec![]);
    }
    let base = base_url(&state.conn(), p);
    if base.is_empty() {
        return Err(format!("Set the address of your {} server first.", p.name));
    }
    let key = load_key(&KeyringStore, &id);
    if key.is_none() && p.key_required() {
        return Err(format!("Add your {} API key first.", p.name));
    }
    let list = models::list(&client(), p, &base, key, Duration::from_secs(if p.is_local() { 5 } else { 20 }))
        .await
        .map_err(|e| format!("{e:#}"))?;
    let mut caps = tool_support().lock().unwrap_or_else(|e| e.into_inner());
    for m in &list {
        caps.insert(format!("{id}/{}", m.id), m.tools);
    }
    Ok(list)
}

/// Which local model servers are running, with their models. Works offline.
#[tauri::command]
pub async fn ai_local_detect(state: State<'_, AppState>) -> CmdResult<Vec<Value>> {
    let locals: Vec<(&Preset, String)> = {
        let c = state.conn();
        presets().iter().filter(|p| p.is_local()).map(|p| (p, base_url(&c, p))).collect()
    };
    let http = client();
    let mut tasks = Vec::new();
    for (p, base) in locals {
        let http = http.clone();
        tasks.push(tokio::spawn(async move {
            let found = models::list(&http, p, &base, None, Duration::from_millis(1500)).await;
            (p, base, found)
        }));
    }
    let mut out = Vec::new();
    for t in tasks {
        let Ok((p, base, found)) = t.await else { continue };
        if let Ok(list) = &found {
            let mut caps = tool_support().lock().unwrap_or_else(|e| e.into_inner());
            for m in list {
                caps.insert(format!("{}/{}", p.id, m.id), m.tools);
            }
        }
        out.push(json!({
            "id": p.id,
            "name": p.name,
            "baseUrl": base,
            "running": found.is_ok(),
            "models": found.unwrap_or_default(),
        }));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Running a request through an API provider
// ---------------------------------------------------------------------------

/// One tool call for the tools thread: name, input, and where the (output, failed) answer goes.
type ToolJob = (String, Value, tokio::sync::oneshot::Sender<(String, bool)>);

/// Runs Worlds tools on a thread of its own with its own database
/// connection, exactly like the MCP server process does (copy checks, one
/// transaction per call, the signed-in user's rights, history under the
/// run's op id so the run can be undone in one step).
pub struct WorldsTools {
    tx: std::sync::mpsc::Sender<ToolJob>,
}

impl WorldsTools {
    pub fn spawn(run_id: &str) -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<ToolJob>();
        let ctx = crate::store::Ctx { actor: "ai".into(), op_id: Some(run_id.to_string()), origin: "mcp".into() };
        std::thread::spawn(move || {
            let conn = db::open(&db::db_path());
            for (name, input, reply) in rx {
                let out = match &conn {
                    Ok(c) => match crate::mcp::execute_tool(c, &ctx, &name, &input) {
                        Ok(v) => (crate::mcp::result_text(&v), false),
                        Err(e) => (format!("Error: {e:#}"), true),
                    },
                    Err(e) => (format!("Error: the workspace could not be opened: {e:#}"), true),
                };
                let _ = reply.send(out);
            }
        });
        WorldsTools { tx }
    }
}

impl ToolHost for WorldsTools {
    fn call<'a>(&'a mut self, name: &'a str, input: &'a Value) -> BoxFuture<'a, (String, bool)> {
        let (reply, rx) = tokio::sync::oneshot::channel();
        let sent = self.tx.send((name.to_string(), input.clone(), reply)).is_ok();
        Box::pin(async move {
            if !sent {
                return ("Error: Worlds tools are not available".to_string(), true);
            }
            rx.await.unwrap_or_else(|_| ("Error: the tool stopped".to_string(), true))
        })
    }
}

/// Cancel signals for API runs, by run id.
fn stops() -> &'static Mutex<HashMap<String, Arc<tokio::sync::Notify>>> {
    static M: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Notify>>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

/// Makes an API run stoppable before it starts (Stop may come first).
pub fn register_run(run_id: &str) -> Arc<tokio::sync::Notify> {
    stops().lock().unwrap_or_else(|e| e.into_inner()).entry(run_id.to_string()).or_default().clone()
}

/// Stops an API run; false when no such run is going. The signal is kept
/// until the run ends, so a run that has not reached its loop yet still stops.
pub fn cancel(run_id: &str) -> bool {
    match stops().lock().unwrap_or_else(|e| e.into_inner()).get(run_id) {
        Some(n) => {
            n.notify_one();
            true
        }
        None => false,
    }
}

/// Forgets a run's stop signal when the run ends, however it ends.
struct StopGuard(String);

impl Drop for StopGuard {
    fn drop(&mut self) {
        stops().lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
    }
}

pub struct ApiRun<'a> {
    pub run_id: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub system: &'a str,
    pub messages: Vec<Msg>,
    /// Tools the user picked with @ in the message.
    pub picked: &'a [String],
}

/// Runs one request through an API provider; returns (summary, steps) like
/// the Claude Code runner does.
pub async fn run_api(app: &tauri::AppHandle, r: ApiRun<'_>) -> Result<(Value, Value)> {
    let stop = register_run(r.run_id);
    let _guard = StopGuard(r.run_id.to_string());
    tokio::select! {
        out = run_api_inner(app, r) => out,
        _ = stop.notified() => Err(anyhow!("Stopped.")),
    }
}

async fn run_api_inner(app: &tauri::AppHandle, r: ApiRun<'_>) -> Result<(Value, Value)> {
    let started = std::time::Instant::now();
    let p = preset(r.provider)?;
    if p.is_runner() {
        bail!("{} is not an API provider", p.name);
    }
    if r.model.trim().is_empty() {
        bail!("Pick a {} model in the model menu first.", p.name);
    }
    let base = {
        let state = app.state::<AppState>();
        let c = state.conn();
        base_url(&c, p)
    };
    if base.is_empty() {
        bail!("Set the address of your {} server in Settings, Providers.", p.name);
    }
    let key = load_key(&KeyringStore, &p.id);
    if key.is_none() && p.key_required() {
        bail!("provider_auth: Add your {} API key in Settings, Providers.", p.name);
    }
    let ep = Endpoint {
        dialect: p.dialect(),
        base: base.clone(),
        key,
        model: r.model.to_string(),
        provider: p.id.clone(),
        label: p.name.clone(),
    };
    let http = client();
    let cache_key = format!("{}/{}", p.id, r.model);
    let mut supported = tool_support().lock().unwrap_or_else(|e| e.into_inner()).get(&cache_key).copied().flatten();
    if supported.is_none() && p.id == "ollama" {
        supported = models::ollama_tools(&http, &base, r.model).await;
    }
    let all: Vec<ToolDef> = crate::mcp::tool_definitions().iter().filter_map(ToolDef::from_mcp).collect();
    let tools = agent::select_tools(&all, r.picked, p.max_tools.unwrap_or(usize::MAX));
    let system = r.system.replace("mcp__worlds tools", "Worlds tools");
    let mut host = WorldsTools::spawn(r.run_id);
    let run_id = r.run_id.to_string();
    let app2 = app.clone();
    let mut sink = move |e: LoopEvent| match e {
        LoopEvent::Delta(t) => crate::ai::emit(&app2, &run_id, "delta", json!({ "text": t })),
        LoopEvent::Tool { name, input } => crate::ai::emit(&app2, &run_id, "tool", json!({ "tool": name, "input": input })),
        LoopEvent::ToolResult { error, .. } => crate::ai::emit(&app2, &run_id, "tool_result", json!({ "error": error })),
        LoopEvent::Note(t) => crate::ai::emit(&app2, &run_id, "note", json!({ "text": t })),
    };
    let job = agent::Job { system: &system, messages: r.messages, tools: &tools, tools_supported: supported };
    let outcome = agent::run(&http, &ep, job, &mut host, &mut sink).await?;
    if outcome.chat_only {
        tool_support().lock().unwrap_or_else(|e| e.into_inner()).insert(cache_key, Some(false));
    }
    let mut summary = json!({
        "text": outcome.text,
        "isError": false,
        "turns": outcome.turns,
        "durationMs": started.elapsed().as_millis() as u64,
        "provider": p.id,
        "model": r.model,
        "chatOnly": outcome.chat_only,
    });
    crate::ai::attach_changes(app, r.run_id, &mut summary);
    Ok((summary, Value::Array(outcome.steps)))
}

/// One-shot text (no tools), used by automations when an API provider is selected.
pub async fn complete_text(provider: &str, model: &str, base: &str, system: &str, prompt: &str) -> Result<String> {
    let p = preset(provider)?;
    let ep = Endpoint {
        dialect: p.dialect(),
        base: base.to_string(),
        key: load_key(&KeyringStore, &p.id),
        model: model.to_string(),
        provider: p.id.clone(),
        label: p.name.clone(),
    };
    struct NoTools;
    impl ToolHost for NoTools {
        fn call<'a>(&'a mut self, _: &'a str, _: &'a Value) -> BoxFuture<'a, (String, bool)> {
            Box::pin(async { ("Error: no tools here".to_string(), true) })
        }
    }
    let job = agent::Job { system, messages: vec![Msg::user_text(prompt)], tools: &[], tools_supported: Some(false) };
    let out = agent::run(&client(), &ep, job, &mut NoTools, &mut |_| {}).await?;
    Ok(out.text)
}

// ---------------------------------------------------------------------------
// Runners and sign-in (each provider's own official login)
// ---------------------------------------------------------------------------

/// Opens a console window running a command (official logins open the browser from there).
fn open_console(title: &str, exe: &std::path::Path, args: &[&str]) -> Result<()> {
    #[cfg(windows)]
    {
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "start", title, "cmd", "/k"]).arg(exe).args(args);
        for (key, _) in std::env::vars_os() {
            let k = key.to_string_lossy();
            if k.starts_with("CLAUDE_CODE_") || k == "CLAUDECODE" || k == "CLAUDE_PID" {
                c.env_remove(&key);
            }
        }
        c.spawn().map_err(|e| anyhow!("Could not open the sign-in window: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (title, exe, args);
        bail!("Run the sign-in command in a terminal.")
    }
}

#[tauri::command]
pub async fn ai_codex_status() -> CmdResult<Value> {
    let Some(exe) = codex::codex_path() else {
        return Ok(json!({ "installed": false, "signedIn": false }));
    };
    let version = codex::version(&exe).await;
    let (signed_in, method) = codex::login_status(&exe).await;
    Ok(json!({ "installed": true, "version": version, "signedIn": signed_in, "method": method }))
}

/// "Sign in with ChatGPT": Codex's own `codex login`, which opens the browser.
#[tauri::command]
pub async fn ai_codex_login() -> CmdResult<()> {
    let exe = codex::codex_path().ok_or("Codex is not installed. Install it from the OpenAI Codex page first.")?;
    open_console("Codex sign-in", &exe, &["login"]).map_err(|e| e.to_string())
}

/// Claude Code's own login (`claude auth login`) in a console window.
#[tauri::command]
pub async fn ai_claude_login(state: State<'_, AppState>) -> CmdResult<()> {
    let exe = crate::ai::claude_path(&state.conn()).ok_or("Claude Code is not installed.")?;
    open_console("Claude sign-in", &exe, &["auth", "login"]).map_err(|e| e.to_string())
}

/// Whether Claude Code is signed in (reads only the yes/no and the method,
/// never the account details).
#[tauri::command]
pub async fn ai_claude_auth_status(state: State<'_, AppState>) -> CmdResult<Value> {
    let Some(exe) = crate::ai::claude_path(&state.conn()) else {
        return Ok(json!({ "installed": false, "signedIn": false }));
    };
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(["auth", "status", "--json"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    crate::ai::prepare_claude_cmd(&mut cmd);
    let out = tokio::time::timeout(Duration::from_secs(20), cmd.output()).await.ok().and_then(Result::ok);
    let v: Value = out.and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or_else(|| json!({}));
    let token = crate::ai::has_saved_token();
    Ok(json!({
        "installed": true,
        "signedIn": v["loggedIn"].as_bool().unwrap_or(false) || token,
        "method": if token { "token" } else { v["authMethod"].as_str().unwrap_or("") },
    }))
}
