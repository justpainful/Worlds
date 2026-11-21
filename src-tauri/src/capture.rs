//! Getting things into Worlds from outside:
//!
//! - `fetch_article`: the HTML of a web article, fetched by the app (the page
//!   cannot, because of the browser's cross-origin rules), for the reader.
//! - A small capture server on 127.0.0.1 for the Worlds browser extension. A
//!   request must carry the capture token shown in Settings; what it sends
//!   reaches the window as a `capture:received` event, and the window decides
//!   where it goes.
//! - The local API on the same server, with the same token: list pages, read
//!   one as Markdown, create one; and /calendar.ics, the calendar feed the
//!   window keeps in settings ("calendar.ics").
//! - `webhook_post`: Worlds tells the addresses in Settings when pages change.

use crate::commands::CmdResult;
use crate::db;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub const CAPTURE_PORT: u16 = 47321;
const MAX_BODY: usize = 2 * 1024 * 1024;

/// The HTML of a web page, for the article reader. Only http(s), up to 4 MB.
#[tauri::command]
pub async fn fetch_article(url: String) -> CmdResult<String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be read".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Worlds/1.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("The page answered {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("The page is larger than 4 MB".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// The capture token, made the first time it is asked for.
pub fn capture_token() -> String {
    let Ok(conn) = db::open(&db::db_path()) else { return String::new() };
    if let Ok(Some(Value::String(t))) = db::get_setting(&conn, "capture.token") {
        if t.len() >= 16 {
            return t;
        }
    }
    let mut raw = [0u8; 16];
    let _ = getrandom::fill(&mut raw);
    let token: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    let _ = db::set_setting(&conn, "capture.token", &json!(token));
    token
}

#[tauri::command]
pub async fn capture_info() -> CmdResult<Value> {
    Ok(json!({ "port": CAPTURE_PORT, "token": capture_token() }))
}

fn page_markdown(id: &str) -> Option<String> {
    let conn = db::open(&db::db_path()).ok()?;
    let page = crate::store::get_page(&conn, id).ok()??;
    let body: Vec<String> = page.blocks.iter().map(|b| crate::content::to_markdown(&b.content)).filter(|m| !m.trim().is_empty()).collect();
    Some(format!("# {}\n\n{}\n", page.meta.title, body.join("\n\n")))
}

fn api_get(path: &str) -> Option<(String, String)> {
    let conn = db::open(&db::db_path()).ok()?;
    if path == "/api/pages" {
        let pages: Vec<Value> = crate::store::list_pages(&conn, false)
            .ok()?
            .into_iter()
            .map(|p| json!({ "id": p.id, "title": p.title, "parentId": p.parent_id, "kind": p.kind, "updatedAt": p.updated_at }))
            .collect();
        return Some(("application/json".into(), json!({ "pages": pages }).to_string()));
    }
    if let Some(id) = path.strip_prefix("/api/pages/") {
        return page_markdown(id).map(|md| ("text/markdown; charset=utf-8".into(), md));
    }
    if path == "/calendar.ics" {
        let ics = db::get_setting(&conn, "calendar.ics").ok().flatten().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
        return Some(("text/calendar; charset=utf-8".into(), ics));
    }
    None
}

fn api_create(body: &Value) -> Result<Value, String> {
    let conn = db::open(&db::db_path()).map_err(|e| e.to_string())?;
    let new = crate::store::NewPage {
        title: body.get("title").and_then(Value::as_str).map(|s| s.chars().take(200).collect()),
        parent_id: body.get("parentId").and_then(Value::as_str).map(str::to_string),
        markdown: body.get("markdown").and_then(Value::as_str).map(str::to_string),
        ..Default::default()
    };
    let meta = crate::store::create_page(&conn, &crate::store::Ctx::user(), new).map_err(|e| e.to_string())?;
    Ok(json!({ "id": meta.id, "title": meta.title }))
}

/// Post a JSON event to a webhook address from Settings.
#[tauri::command]
pub async fn webhook_post(url: String, body: Value) -> CmdResult<u16> {
    if !url.starts_with("https://") && !url.starts_with("http://127.0.0.1") && !url.starts_with("http://localhost") {
        return Err("Webhooks need an https address".into());
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    let res = client.post(&url).json(&body).send().await.map_err(|e| e.to_string())?;
    Ok(res.status().as_u16())
}

fn response(status: &str, body: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type, x-worlds-token\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

async fn handle(mut stream: tokio::net::TcpStream, app: AppHandle, token: String) {
    let mut buf = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    // Read the head, then the body by Content-Length.
    let head_end = loop {
        let Ok(n) = stream.read(&mut chunk).await else { return };
        if n == 0 {
            return;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > 64 * 1024 {
            return;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split(' ');
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let mut length = 0usize;
    let mut given = String::new();
    // Calendar apps cannot send headers, so the feed also takes ?token=.
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    if let Some(t) = query.split('&').find_map(|p| p.strip_prefix("token=")) {
        given = t.to_string();
    }
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            match k.trim().to_ascii_lowercase().as_str() {
                "content-length" => length = v.trim().parse().unwrap_or(0),
                "x-worlds-token" => given = v.trim().to_string(),
                _ => {}
            }
        }
    }
    let out = match (method, path) {
        ("OPTIONS", _) => response("204 No Content", ""),
        ("GET", "/ping") => response("200 OK", r#"{"app":"Worlds","ok":true}"#),
        ("GET", p) if p.starts_with("/api/") || p == "/calendar.ics" => {
            if given.is_empty() || given != token {
                response("401 Unauthorized", r#"{"error":"Send the token from Worlds › Settings in x-worlds-token"}"#)
            } else {
                match api_get(p) {
                    Some((kind, body)) => typed(&kind, &body),
                    None => response("404 Not Found", r#"{"error":"Not found"}"#),
                }
            }
        }
        ("POST", "/api/pages") => {
            if given.is_empty() || given != token {
                response("401 Unauthorized", r#"{"error":"Send the token from Worlds › Settings in x-worlds-token"}"#)
            } else {
                while buf.len() < head_end + length.min(MAX_BODY) {
                    let Ok(n) = stream.read(&mut chunk).await else { return };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                match serde_json::from_slice::<Value>(&buf[head_end..(head_end + length).min(buf.len())])
                    .map_err(|e| e.to_string())
                    .and_then(|v| api_create(&v))
                {
                    Ok(v) => {
                        let _ = app.emit("pages:changed", v.clone());
                        response("200 OK", &v.to_string())
                    }
                    Err(e) => response("400 Bad Request", &json!({ "error": e }).to_string()),
                }
            }
        }
        ("POST", "/capture") => {
            if given.is_empty() || given != token {
                response("401 Unauthorized", r#"{"error":"Copy the capture token from Worlds › Settings › Editor"}"#)
            } else if length > MAX_BODY {
                response("413 Payload Too Large", r#"{"error":"Too large"}"#)
            } else {
                while buf.len() < head_end + length {
                    let Ok(n) = stream.read(&mut chunk).await else { return };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                match serde_json::from_slice::<Value>(&buf[head_end..(head_end + length).min(buf.len())]) {
                    Ok(v) if v.is_object() => {
                        let _ = app.emit("capture:received", v);
                        response("200 OK", r#"{"ok":true}"#)
                    }
                    _ => response("400 Bad Request", r#"{"error":"Send JSON"}"#),
                }
            }
        }
        _ => response("404 Not Found", r#"{"error":"Not found"}"#),
    };
    let _ = stream.write_all(&out).await;
    fn typed(kind: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }
    let _ = stream.shutdown().await;
}

/// Listen on 127.0.0.1 for the browser extension. Quietly does nothing if the port is taken.
pub fn start_capture_server(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let token = capture_token();
        let Ok(listener) = TcpListener::bind(("127.0.0.1", CAPTURE_PORT)).await else { return };
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            tokio::spawn(handle(stream, app.clone(), token.clone()));
        }
    });
}
