//! In-page previews for attachments.
//!
//! Everything renders inside Worlds:
//!   pdf                         → the WebView's own PDF viewer
//!   pptx / ppt / pps / odp      → slide images, exported by PowerPoint in the
//!                                 background (no window), cached
//!   docx                        → rendered in the page (docx-preview); Word is
//!                                 not used because it can stall on hidden dialogs
//!   xlsx / xls / ods / csv      → parsed in the page (interactive grid)
//!   text / code / audio         → native viewers
//!
//! PowerPoint is driven over COM from a hidden PowerShell process. If the
//! user already has PowerPoint open, Worlds borrows that instance and never
//! quits it.

use crate::commands::CmdResult;
use crate::db;
use crate::store;
use crate::AppState;
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::State;

static BUSY: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn previews_dir() -> PathBuf {
    db::data_dir().join("previews")
}

fn ext_of(name: &str) -> String {
    Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

/// What kind of viewer a file gets.
pub fn kind_for(name: &str, mime: &str) -> &'static str {
    let ext = ext_of(name);
    match ext.as_str() {
        "pdf" => "pdf",
        "pptx" | "ppt" | "pps" | "ppsx" | "pptm" | "odp" => "slides",
        "docx" | "docm" => "docx",
        "xlsx" | "xls" | "xlsm" | "xlsb" | "ods" | "csv" | "tsv" => "sheet",
        "txt" | "md" | "markdown" | "json" | "jsonc" | "log" | "ini" | "toml" | "yaml" | "yml" | "xml" | "html" | "css"
        | "js" | "ts" | "tsx" | "jsx" | "py" | "rs" | "cs" | "lua" | "sql" | "sh" | "ps1" | "bat" | "go" | "java"
        | "c" | "h" | "cpp" | "hpp" | "kt" | "swift" | "php" | "rb" | "env" => "text",
        _ if mime.starts_with("audio/") => "audio",
        _ if mime.starts_with("text/") => "text",
        _ => "none",
    }
}

fn url_of(att_id: &str, file: &str) -> String {
    format!("http://wfile.localhost/preview/{att_id}/{file}")
}

#[cfg(windows)]
fn no_window(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn no_window(_: &mut tokio::process::Command) {}

const PPT_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$in = $env:WORLDS_IN; $out = $env:WORLDS_OUT
$wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
$app = New-Object -ComObject PowerPoint.Application
try {
  # ReadOnly, Untitled, WithWindow = false
  $p = $app.Presentations.Open($in, -1, 0, 0)
  try {
    $w = 1920
    $h = [int][Math]::Round($w * $p.PageSetup.SlideHeight / $p.PageSetup.SlideWidth)
    $n = $p.Slides.Count
    for ($i = 1; $i -le $n; $i++) { $p.Slides.Item($i).Export((Join-Path $out "slide-$i.png"), 'PNG', $w, $h) }
    Set-Content -Path (Join-Path $out 'meta.json') -Value ("{""slides"":$n,""width"":$w,""height"":$h}") -Encoding ASCII
  } finally { $p.Close() }
} finally {
  if (-not $wasRunning) { $app.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
"#;

async fn run_office(script: &str, input: &Path, out: &Path) -> Result<()> {
    let mut cmd = tokio::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env("WORLDS_IN", input)
        .env("WORLDS_OUT", out)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    no_window(&mut cmd);
    let child = cmd.spawn().context("start PowerShell")?;
    crate::jobs::adopt_tokio(&child);
    let output = tokio::time::timeout(std::time::Duration::from_secs(120), child.wait_with_output())
        .await
        .map_err(|_| anyhow!("Office took too long to render this file"))??;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let line = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("unknown error").trim().to_string();
        if line.contains("80040154") || line.contains("Class not registered") || line.contains("Cannot create") {
            bail!("office-missing");
        }
        bail!("{line}");
    }
    Ok(())
}

/// Prepare (or reuse) a preview. Returns what the viewer needs.
pub async fn prepare(att: &store::Attachment) -> Result<Value> {
    let kind = kind_for(&att.file_name, &att.mime);
    let original = format!("http://wfile.localhost/{}", att.id);
    match kind {
        "pdf" | "sheet" | "text" | "audio" | "docx" => {
            return Ok(json!({ "kind": kind, "url": original, "name": att.file_name, "size": att.size }));
        }
        "none" => return Ok(json!({ "kind": "none" })),
        _ => {}
    }
    let dir = previews_dir().join(&att.id);
    let meta_path = dir.join("meta.json");
    if !meta_path.exists() {
        {
            let mut busy = BUSY.lock().unwrap();
            let set = busy.get_or_insert_with(HashSet::new);
            if !set.insert(att.id.clone()) {
                return Ok(json!({ "kind": kind, "pending": true }));
            }
        }
        let result = async {
            std::fs::create_dir_all(&dir)?;
            let src = store::attachment_abs_path(att);
            // Office needs a real extension it recognises.
            let ext = ext_of(&att.file_name);
            let input = dir.join(format!("source.{ext}"));
            std::fs::copy(&src, &input).context("copy file for rendering")?;
            let r = run_office(PPT_SCRIPT, &input, &dir).await;
            let _ = std::fs::remove_file(&input);
            r
        }
        .await;
        BUSY.lock().unwrap().get_or_insert_with(HashSet::new).remove(&att.id);
        if let Err(e) = result {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(e);
        }
    }
    let meta: Value = serde_json::from_str(std::fs::read_to_string(&meta_path)?.trim_start_matches('\u{feff}')).unwrap_or(json!({}));
    let n = meta.get("slides").and_then(Value::as_u64).unwrap_or(0);
    let slides: Vec<String> = (1..=n).map(|i| url_of(&att.id, &format!("slide-{i}.png"))).collect();
    Ok(json!({
        "kind": "slides",
        "slides": slides,
        "width": meta.get("width"),
        "height": meta.get("height"),
        "original": original,
    }))
}

#[tauri::command]
pub async fn preview_prepare(state: State<'_, AppState>, attachment_id: String) -> CmdResult<Value> {
    let att = {
        let c = state.conn();
        store::get_attachment(&c, &attachment_id).map_err(|e| e.to_string())?.ok_or("attachment not found")?
    };
    prepare(&att).await.map_err(|e| {
        let s = format!("{e:#}");
        if s.contains("office-missing") {
            "PowerPoint is needed to show presentations inside Worlds.".to_string()
        } else {
            s
        }
    })
}

/// Serve a cached preview file: `preview/<attachment id>/<file>`.
pub fn cached_file(att_id: &str, file: &str) -> Option<(PathBuf, &'static str)> {
    let safe = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') && !s.contains("..");
    if !safe(att_id) || !safe(file) {
        return None;
    }
    let mime = match ext_of(file).as_str() {
        "png" => "image/png",
        "pdf" => "application/pdf",
        "json" => "application/json",
        _ => return None,
    };
    let path = previews_dir().join(att_id).join(file);
    path.exists().then_some((path, mime))
}
