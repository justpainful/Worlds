use super::*;

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

pub fn kind_for_mime(mime: &str) -> &'static str {
    if mime == "image/gif" {
        "gif"
    } else if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("video/") {
        "video"
    } else {
        "file"
    }
}

/// Largest file accepted as an attachment.
pub const MAX_ATTACHMENT_BYTES: usize = 1024 * 1024 * 1024;

/// A display name that is only a name: no folders, control characters or
/// reserved characters, and not absurdly long.
pub fn clean_file_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let cleaned: String = base.chars().filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')).collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let mut name: String = trimmed.chars().take(180).collect();
    if name.is_empty() {
        name = "file".into();
    }
    name
}

pub fn add_attachment_bytes(conn: &Connection, page_id: Option<&str>, file_name: &str, bytes: &[u8]) -> Result<Attachment> {
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        bail!("the file is larger than 1 GB");
    }
    let file_name = clean_file_name(file_name);
    let file_name = file_name.as_str();
    let id = new_id();
    let mut mime = mime_guess::from_path(file_name).first_or_octet_stream().essence_str().to_string();
    // Stored under a short, plain extension only (the original name is kept for display).
    let ext = std::path::Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.len() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();
    // Something named like a raster image has to actually be one.
    let vector_or_new = matches!(ext.as_str(), ".svg" | ".heic" | ".heif" | ".avif" | ".ico");
    if mime.starts_with("image/") && !vector_or_new && imagesize::blob_size(bytes).is_err() {
        mime = "application/octet-stream".into();
    }
    let month = chrono::Local::now().format("%Y-%m").to_string();
    let rel = format!("{month}/{id}{ext}");
    let abs = db::attachments_dir().join(&rel);
    std::fs::create_dir_all(abs.parent().unwrap())?;
    std::fs::write(&abs, bytes)?;
    let (w, h) = match imagesize::blob_size(bytes) {
        Ok(s) if mime.starts_with("image/") => (Some(s.width as i64), Some(s.height as i64)),
        _ => (None, None),
    };
    let kind = kind_for_mime(&mime);
    conn.execute(
        "INSERT INTO attachments (id, page_id, kind, file_name, mime, size, rel_path, width, height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, page_id, kind, file_name, mime, bytes.len() as i64, rel, w, h, now()],
    )?;
    if let Some(p) = page_id {
        index_page(conn, p).ok();
    }
    get_attachment(conn, &id)?.ok_or_else(|| anyhow!("attachment vanished"))
}

pub fn add_attachment_path(conn: &Connection, page_id: Option<&str>, path: &std::path::Path) -> Result<Attachment> {
    let bytes = std::fs::read(path)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    add_attachment_bytes(conn, page_id, name, &bytes)
}

pub fn get_attachment(conn: &Connection, id: &str) -> Result<Option<Attachment>> {
    Ok(conn.query_row(&format!("SELECT {ATTACHMENT_COLS} FROM attachments WHERE id = ?1"), [id], attachment_row).optional()?)
}

/// Recent images, GIFs and videos across all live pages (and the profile), newest first.
pub fn recent_media(conn: &Connection, limit: i64) -> Result<Vec<Attachment>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ATTACHMENT_COLS} FROM attachments
         WHERE kind IN ('image', 'gif', 'video')
           AND (page_id IS NULL OR page_id IN (SELECT id FROM pages WHERE deleted_at IS NULL))
         ORDER BY created_at DESC LIMIT ?1"
    ))?;
    let rows = stmt.query_map([limit.clamp(1, 200)], attachment_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn attachment_abs_path(a: &Attachment) -> std::path::PathBuf {
    // Stored paths are always plain relative names inside the attachments
    // folder; anything else (.., absolute, drive prefixes) resolves nowhere.
    let rel = std::path::Path::new(&a.rel_path);
    if rel.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
        db::attachments_dir().join(rel)
    } else {
        db::attachments_dir().join("_invalid_")
    }
}
