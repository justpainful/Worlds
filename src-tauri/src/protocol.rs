//! `wfile://` serves attachments from the local data directory.
//! Supports byte ranges (video seeking) and CORS (so the glass sampler can
//! read image pixels without tainting its canvas).

use crate::{db, store};
use tauri::http::{header, Request, Response, StatusCode};

pub fn serve(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    match serve_inner(request) {
        Ok(r) => r,
        Err(status) => Response::builder()
            .status(status)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Vec::new())
            .unwrap(),
    }
}

fn serve_inner(request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, StatusCode> {
    let path = request.uri().path().trim_start_matches('/');
    // Cached previews: preview/<attachment id>/<file>
    if let Some(rest) = path.strip_prefix("preview/") {
        let mut parts = rest.splitn(2, '/');
        let (id, file) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let (abs, mime) = crate::preview::cached_file(id, file).ok_or(StatusCode::NOT_FOUND)?;
        return serve_file(request, &abs, mime);
    }
    let id: String = percent_encoding::percent_decode_str(path)
        .decode_utf8_lossy()
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let conn = db::open(&db::db_path()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let att = store::get_attachment(&conn, &id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let abs = store::attachment_abs_path(&att);
    serve_file(request, &abs, &att.mime)
}

fn serve_file(request: &Request<Vec<u8>>, abs: &std::path::Path, mime: &str) -> Result<Response<Vec<u8>>, StatusCode> {
    let mut file = std::fs::File::open(abs).map_err(|_| StatusCode::NOT_FOUND)?;
    let total = file.metadata().map_err(|_| StatusCode::NOT_FOUND)?.len();
    let read_range = |file: &mut std::fs::File, start: u64, len: u64| -> Result<Vec<u8>, StatusCode> {
        use std::io::{Read, Seek, SeekFrom};
        file.seek(SeekFrom::Start(start)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut buf = vec![0u8; len as usize];
        file.read_exact(&mut buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(buf)
    };

    let base = || {
        Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "private, max-age=31536000, immutable")
    };

    if let Some(range) = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if let Some(spec) = range.strip_prefix("bytes=") {
            let mut parts = spec.splitn(2, '-');
            let start_s = parts.next().unwrap_or("");
            let end_s = parts.next().unwrap_or("");
            let (start, end) = if start_s.is_empty() {
                let suffix: u64 = end_s.parse().map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
                (total.saturating_sub(suffix), total.saturating_sub(1))
            } else {
                let s: u64 = start_s.parse().map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
                // Cap chunks so large videos stream instead of loading whole.
                let e: u64 = if end_s.is_empty() {
                    (s + 4 * 1024 * 1024).min(total.saturating_sub(1))
                } else {
                    end_s.parse::<u64>().map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?.min(total.saturating_sub(1))
                };
                (s, e)
            };
            if start > end || start >= total {
                return Err(StatusCode::RANGE_NOT_SATISFIABLE);
            }
            let chunk = read_range(&mut file, start, end - start + 1)?;
            return base()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .header(header::CONTENT_LENGTH, chunk.len().to_string())
                .body(chunk)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    let bytes = read_range(&mut file, 0, total)?;
    base()
        .status(StatusCode::OK)
        .header(header::CONTENT_LENGTH, total.to_string())
        .body(bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
