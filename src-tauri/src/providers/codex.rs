//! Codex CLI as a runner next to Claude Code.
//!
//! Worlds runs the user's installed `codex exec --json` headless, connected
//! to the Worlds tools through MCP exactly like Claude Code is (this same
//! executable in `--mcp` mode, tagged with the run's op id). Its shell and
//! other built-in tools are turned off, it ignores the user's own Codex
//! config (so no other MCP servers), and it runs in an empty folder.
//! Sign-in is Codex's own `codex login`; Worlds never reads Codex's tokens.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub fn codex_path() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["codex.exe", "codex.cmd"] } else { &["codex"] };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join("AppData").join("Roaming").join("npm"));
    }
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.exists())
}

/// A string or list of strings as a TOML value for `-c key=value` (JSON
/// string escapes are valid TOML basic strings).
fn toml_str(s: &str) -> String {
    Value::String(s.to_string()).to_string()
}

pub struct CodexRun<'a> {
    pub exe: &'a Path,
    pub worlds_exe: &'a Path,
    pub run_id: &'a str,
    pub dir: &'a Path,
    pub model: Option<&'a str>,
    /// Resume this Codex thread (a follow-up in the same conversation).
    pub thread: Option<&'a str>,
    pub images: &'a [PathBuf],
}

/// Command line arguments (tested without running Codex).
pub fn args(r: &CodexRun<'_>) -> Vec<String> {
    let mut a: Vec<String> = vec!["exec".into()];
    if let Some(t) = r.thread {
        a.extend(["resume".into(), t.to_string()]);
    }
    // `exec resume` takes the same flags except --sandbox and -C, so both
    // runs set the sandbox through config and the folder as the process cwd.
    a.extend(["--json".into(), "--skip-git-repo-check".into(), "--ignore-user-config".into()]);
    a.extend(["-c".into(), "sandbox_mode=\"read-only\"".into()]);
    // Only the Worlds tools: no shell, browser, apps, plugins, hooks, sub-agents or memories.
    for f in ["shell_tool", "browser_use", "computer_use", "in_app_browser", "image_generation", "apps", "plugins", "hooks", "multi_agent", "memories"] {
        a.extend(["--disable".into(), f.into()]);
    }
    let worlds_args = json!(["--mcp", "--actor", "ai", "--op", r.run_id]).to_string();
    a.extend([
        "-c".into(),
        "approval_policy=\"never\"".into(),
        "-c".into(),
        format!("mcp_servers.worlds.command={}", toml_str(&r.worlds_exe.to_string_lossy())),
        "-c".into(),
        format!("mcp_servers.worlds.args={worlds_args}"),
        "-c".into(),
        "mcp_servers.worlds.startup_timeout_sec=30".into(),
    ]);
    if let Some(m) = r.model.filter(|m| !m.is_empty()) {
        a.extend(["-m".into(), m.to_string()]);
    }
    for img in r.images {
        a.extend(["-i".into(), img.to_string_lossy().to_string()]);
    }
    // The prompt comes from stdin.
    a.push("-".into());
    a
}

#[derive(Clone, Debug, PartialEq)]
pub enum CodexEvent {
    Thread(String),
    Text(String),
    Tool { name: String, input: Value },
    ToolResult { error: bool },
    Failed(String),
}

/// Reads `codex exec --json` lines.
#[derive(Default)]
pub struct CodexParser {
    started: Vec<String>,
}

impl CodexParser {
    pub fn feed(&mut self, line: &str) -> Vec<CodexEvent> {
        let Ok(v) = serde_json::from_str::<Value>(line) else { return vec![] };
        let item = &v["item"];
        let item_id = item["id"].as_str().unwrap_or("").to_string();
        let is_tool = matches!(item["type"].as_str(), Some("mcp_tool_call") | Some("command_execution") | Some("web_search"));
        match v["type"].as_str().unwrap_or("") {
            "thread.started" => v["thread_id"].as_str().map(|t| vec![CodexEvent::Thread(t.to_string())]).unwrap_or_default(),
            "item.started" if is_tool => {
                self.started.push(item_id);
                vec![tool_event(item)]
            }
            "item.completed" if is_tool => {
                let mut out = Vec::new();
                if !self.started.contains(&item_id) {
                    out.push(tool_event(item));
                }
                let error = item["status"].as_str() == Some("failed") || !item["error"].is_null() || item["result"]["isError"] == true;
                out.push(CodexEvent::ToolResult { error });
                out
            }
            "item.completed" if item["type"] == "agent_message" => {
                let t = item["text"].as_str().unwrap_or("").to_string();
                if t.is_empty() {
                    vec![]
                } else {
                    vec![CodexEvent::Text(t)]
                }
            }
            "turn.failed" => vec![CodexEvent::Failed(v["error"]["message"].as_str().unwrap_or("Codex stopped").to_string())],
            "error" => vec![CodexEvent::Failed(v["message"].as_str().unwrap_or("Codex reported an error").to_string())],
            _ => vec![],
        }
    }
}

fn tool_event(item: &Value) -> CodexEvent {
    match item["type"].as_str() {
        Some("mcp_tool_call") => CodexEvent::Tool { name: item["tool"].as_str().unwrap_or("").to_string(), input: item["arguments"].clone() },
        Some("command_execution") => CodexEvent::Tool { name: "shell".into(), input: json!({ "command": item["command"] }) },
        _ => CodexEvent::Tool { name: item["type"].as_str().unwrap_or("tool").to_string(), input: json!({}) },
    }
}

/// Messages Codex prints when it is not signed in.
pub fn is_signed_out(text: &str) -> bool {
    let t = text.to_lowercase();
    ["not logged in", "codex login", "unauthorized", "401", "please sign in", "authentication"].iter().any(|k| t.contains(k))
}

pub struct CodexResult {
    pub text: String,
    pub thread: Option<String>,
    pub steps: Vec<Value>,
}

/// Runs Codex once. `on` gets each event as it arrives; `on_pid` the
/// process id so the run can be cancelled.
pub async fn run(
    r: &CodexRun<'_>,
    prompt: &str,
    on: &mut (dyn FnMut(&CodexEvent) + Send),
    on_pid: &mut (dyn FnMut(u32) + Send),
) -> Result<CodexResult> {
    std::fs::create_dir_all(r.dir)?;
    let mut cmd = tokio::process::Command::new(r.exe);
    cmd.args(args(r)).current_dir(r.dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let mut child = cmd.spawn().context("start Codex")?;
    crate::jobs::adopt_tokio(&child);
    if let Some(pid) = child.id() {
        on_pid(pid);
    }
    {
        let mut stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        stdin.write_all(prompt.as_bytes()).await?;
        stdin.shutdown().await?;
    }
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let stderr = child.stderr.take();
    let mut lines = BufReader::new(stdout).lines();
    let mut parser = CodexParser::default();
    let mut texts: Vec<String> = Vec::new();
    let mut thread = None;
    let mut steps: Vec<Value> = Vec::new();
    let mut failure: Option<String> = None;
    while let Some(line) = lines.next_line().await? {
        for ev in parser.feed(&line) {
            match &ev {
                CodexEvent::Thread(t) => thread = Some(t.clone()),
                CodexEvent::Text(t) => texts.push(t.clone()),
                CodexEvent::Tool { name, .. } => steps.push(json!({ "tool": name, "ok": null })),
                CodexEvent::ToolResult { error } => {
                    if let Some(s) = steps.iter_mut().rev().find(|s| s["ok"].is_null()) {
                        s["ok"] = json!(!error);
                    }
                }
                CodexEvent::Failed(m) => failure = Some(m.clone()),
            }
            on(&ev);
        }
    }
    let status = child.wait().await?;
    let mut err = String::new();
    if let Some(mut e) = stderr {
        use tokio::io::AsyncReadExt;
        let _ = e.read_to_string(&mut err).await;
    }
    if let Some(f) = failure.filter(|_| texts.is_empty()) {
        if is_signed_out(&f) {
            bail!("codex_signed_out: Codex is not signed in. Open Settings, Providers, and choose Sign in with ChatGPT.");
        }
        bail!("Codex: {f}");
    }
    if !status.success() && texts.is_empty() {
        if is_signed_out(&err) {
            bail!("codex_signed_out: Codex is not signed in. Open Settings, Providers, and choose Sign in with ChatGPT.");
        }
        bail!("Codex exited ({}): {}", status, err.trim().lines().last().unwrap_or("no output"));
    }
    Ok(CodexResult { text: texts.last().cloned().unwrap_or_default(), thread, steps })
}

/// `codex login status`: (signed in, how).
pub async fn login_status(exe: &Path) -> (bool, String) {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(["login", "status"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let Ok(Ok(out)) = tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await else {
        return (false, String::new());
    };
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").to_string();
    let signed_in = out.status.success() && line.to_lowercase().contains("logged in") && !line.to_lowercase().contains("not logged in");
    let method = if line.contains("ChatGPT") {
        "chatgpt"
    } else if line.to_lowercase().contains("api key") {
        "apiKey"
    } else {
        ""
    };
    (signed_in, method.to_string())
}

pub async fn version(exe: &Path) -> Option<String> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await.ok()?.ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}
