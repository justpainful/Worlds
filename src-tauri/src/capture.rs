//! Getting things into Worlds from outside:
//!
//! - `fetch_article`: the HTML of a web article, fetched by the app (the page
//!   cannot, because of the browser's cross-origin rules), for the reader.
//! - A small capture server on 127.0.0.1 for the Worlds browser extension. A
//!   request must carry the capture token shown in Settings; what it sends
//!   reaches the window as a `capture:received` event, and the window decides
//!   where it goes.

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
