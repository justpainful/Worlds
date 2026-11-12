use super::*;

// ---------------------------------------------------------------------------
// Search (FTS5 trigram: substring matching that works for Arabic)
// ---------------------------------------------------------------------------

pub fn index_page(conn: &Connection, page_id: &str) -> Result<()> {
    let (title, deleted, metadata): (String, Option<i64>, String) =
        conn.query_row("SELECT title, deleted_at, metadata FROM pages WHERE id = ?1", [page_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
    let meta_text = metadata_text(&serde_json::from_str(&metadata).unwrap_or(Value::Null));
    let drawing_text: String = conn
        .query_row("SELECT search_text FROM drawing_documents WHERE page_id = ?1", [page_id], |r| r.get(0))
        .optional()?
        .unwrap_or_default();
    let library_tags: String = conn
        .query_row("SELECT tags FROM drawing_library_items WHERE page_id = ?1", [page_id], |r| r.get(0))
        .optional()?
        .unwrap_or_default();
    let texts: Vec<(String, String)> = conn
        .prepare("SELECT type, text FROM blocks WHERE page_id = ?1 ORDER BY sort_key")?
        .query_map([page_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let att: Vec<String> = conn
        .prepare("SELECT file_name FROM attachments WHERE page_id = ?1")?
        .query_map([page_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut body: Vec<&str> = texts.iter().map(|(_, t)| t.as_str()).collect();
    body.extend(att.iter().map(String::as_str));
    if !drawing_text.is_empty() {
        body.push(&drawing_text);
    }
    if !library_tags.is_empty() {
        body.push(&library_tags);
    }
    if !meta_text.is_empty() {
        body.push(&meta_text);
    }
    let body = body.join("\n");
    let mut preview: String = texts
        .iter()
        .filter(|(ty, t)| ty != "heading" && !t.is_empty())
        .map(|(_, t)| t.replace('\n', " "))
        .collect::<Vec<_>>()
        .join(" · ")
        .chars()
        .take(220)
        .collect();
    if preview.is_empty() {
        preview = drawing_text.replace('\n', " · ").chars().take(220).collect();
    }
    conn.execute("UPDATE pages SET preview = ?1 WHERE id = ?2", params![preview, page_id])?;
    conn.execute("DELETE FROM pages_fts WHERE page_id = ?1", [page_id])?;
    if deleted.is_none() {
        conn.execute("INSERT INTO pages_fts (page_id, title, body) VALUES (?1, ?2, ?3)", params![page_id, title, body])?;
    }
    Ok(())
}

pub fn search(conn: &Connection, query: &str, limit: i64, include_templates: bool) -> Result<Vec<SearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let kind_filter = if include_templates { "" } else { "AND p.kind != 'template'" };
    let mut hits: Vec<SearchHit> = Vec::new();
    let map = |r: &Row| -> rusqlite::Result<SearchHit> {
        Ok(SearchHit {
            page_id: r.get(0)?,
            title: r.get(1)?,
            icon: r.get(2)?,
            kind: r.get(3)?,
            snippet: r.get(4)?,
            parent_title: r.get(5)?,
            updated_at: r.get(6)?,
        })
    };
    if q.chars().count() >= 3 {
        // Each whitespace-separated term must appear (trigram substring match),
        // in any of the spellings Arabic readers treat as the same word.
        let fts_q = q
            .split_whitespace()
            .filter(|t| t.chars().count() >= 3)
            .map(|t| {
                let spellings: Vec<String> = arabic_spellings(t).iter().map(|s| format!("\"{}\"", s.replace('"', "\"\""))).collect();
                if spellings.len() == 1 {
                    spellings.join("")
                } else {
                    format!("({})", spellings.join(" OR "))
                }
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        if !fts_q.is_empty() {
            let sql = format!(
                "SELECT p.id, p.title, p.icon, p.kind,
                        snippet(pages_fts, 2, '\u{E000}', '\u{E001}', '…', 12),
                        (SELECT title FROM pages pp WHERE pp.id = p.parent_id), p.updated_at
                 FROM pages_fts f JOIN pages p ON p.id = f.page_id
                 WHERE pages_fts MATCH ?1 AND p.deleted_at IS NULL {kind_filter}
                 ORDER BY bm25(pages_fts, 0.0, 8.0, 1.0) LIMIT ?2"
            );
            let mut stmt = conn.prepare(&sql)?;
            hits = stmt.query_map(params![fts_q, limit], map)?.collect::<rusqlite::Result<_>>()?;
        }
    }
    if hits.len() < limit as usize {
        // Short queries / fallback: title substring.
        let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
        let sql = format!(
            "SELECT p.id, p.title, p.icon, p.kind, p.preview,
                    (SELECT title FROM pages pp WHERE pp.id = p.parent_id), p.updated_at
             FROM pages p WHERE p.title LIKE ?1 ESCAPE '\\' AND p.deleted_at IS NULL {kind_filter}
             ORDER BY p.updated_at DESC LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let extra: Vec<SearchHit> = stmt.query_map(params![like, limit], map)?.collect::<rusqlite::Result<_>>()?;
        for h in extra {
            if !hits.iter().any(|x| x.page_id == h.page_id) {
                hits.push(h);
            }
        }
    }
    hits.truncate(limit as usize);
    Ok(hits)
}

/// The spellings of a search term that Arabic readers treat as one word: any
/// alef form (ا أ إ آ), and a final taa marbuta or alef maqsura typed as haa or
/// yaa, or the other way round. Capped so a long term cannot blow up the query.
pub fn arabic_spellings(term: &str) -> Vec<String> {
    const ALEFS: [char; 4] = ['ا', 'أ', 'إ', 'آ'];
    const LIMIT: usize = 32;
    let chars: Vec<char> = term.chars().collect();
    let last = chars.len().saturating_sub(1);
    let mut out = vec![String::new()];
    for (i, &c) in chars.iter().enumerate() {
        let options: Vec<char> = if ALEFS.contains(&c) {
            ALEFS.to_vec()
        } else if i == last && (c == 'ه' || c == 'ة') {
            vec![c, if c == 'ه' { 'ة' } else { 'ه' }]
        } else if i == last && (c == 'ي' || c == 'ى') {
            vec![c, if c == 'ي' { 'ى' } else { 'ي' }]
        } else {
            vec![c]
        };
        if out.len() * options.len() > LIMIT {
            // Too many spellings already: keep the rest as typed.
            out.iter_mut().for_each(|s| s.push(c));
            continue;
        }
        out = out
            .iter()
            .flat_map(|s| {
                options.iter().map(move |&o| {
                    let mut next = s.clone();
                    next.push(o);
                    next
                })
            })
            .collect();
    }
    // The term as typed comes first.
    if let Some(pos) = out.iter().position(|s| s == term) {
        out.swap(0, pos);
    }
    out
}
