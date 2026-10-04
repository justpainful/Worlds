use super::*;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug)]
pub struct BlockInput {
    pub id: String,
    pub content: Value,
}

/// Whether the page was written after `base` (ms), by anyone.
pub fn page_changed_since(conn: &Connection, page_id: &str, base: i64) -> Result<bool> {
    let at: i64 = conn.query_row("SELECT updated_at FROM pages WHERE id = ?1", [page_id], |r| r.get(0))?;
    Ok(at > base)
}

/// Save the full ordered block list for a page (editor autosave path).
pub fn save_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, input: Vec<BlockInput>) -> Result<SaveResult> {
    require_page(conn, page_id)?;
    let nodes: Vec<Value> = input
        .into_iter()
        .map(|b| {
            let mut c = b.content;
            content::set_block_id(&mut c, &b.id);
            c
        })
        .collect();
    let res = write_blocks(conn, ctx, page_id, nodes, true)?;
    index_page(conn, page_id)?;
    mark_change(conn, Some(page_id), "blocks", &ctx.origin)?;
    Ok(res)
}

/// Diff `nodes` against stored blocks; insert/update/delete/reorder.
pub(crate) fn write_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, nodes: Vec<Value>, record_history: bool) -> Result<SaveResult> {
    let t = now();
    let existing: HashMap<String, (String, f64)> = conn
        .prepare("SELECT id, content, sort_key FROM blocks WHERE page_id = ?1")?
        .query_map([page_id], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, String>(1)?, r.get::<_, f64>(2)?))))?
        .collect::<rusqlite::Result<_>>()?;

    let mut res = SaveResult::default();
    let mut seen: HashSet<String> = HashSet::new();
    let mut changes: Vec<(String, &'static str, Option<Value>, Option<Value>)> = Vec::new();

    if record_history && !ctx.is_user() {
        ensure_op_snapshot(conn, ctx, page_id)?;
    }

    for (i, mut node) in nodes.into_iter().enumerate() {
        let mut id = content::attr_str(&node, "bid").map(str::to_string).unwrap_or_default();
        if id.is_empty() || seen.contains(&id) {
            let fresh = new_id();
            if !id.is_empty() {
                res.remapped.push((id.clone(), fresh.clone()));
            }
            id = fresh;
            content::set_block_id(&mut node, &id);
        } else if !existing.contains_key(&id) {
            // id already used on another page? never steal it.
            let other: Option<String> = conn.query_row("SELECT page_id FROM blocks WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            if other.is_some() {
                let fresh = new_id();
                res.remapped.push((id.clone(), fresh.clone()));
                id = fresh;
                content::set_block_id(&mut node, &id);
            }
        }
        seen.insert(id.clone());
        let sort = i as f64;
        let block_type = content::node_type(&node).to_string();
        let text = content::plain_text(&node);
        let direction = match content::attr_str(&node, "dir") {
            Some(d @ ("ltr" | "rtl")) => d.to_string(),
            _ => content::detect_direction(&text).to_string(),
        };
        let serialized = node.to_string();
        match existing.get(&id) {
            Some((old, old_sort)) => {
                if *old != serialized {
                    conn.execute(
                        "UPDATE blocks SET type = ?1, sort_key = ?2, content = ?3, text = ?4, direction = ?5, updated_at = ?6 WHERE id = ?7",
                        params![block_type, sort, serialized, text, direction, t, id],
                    )?;
                    res.changed += 1;
                    changes.push((id.clone(), "block_changed", serde_json::from_str(old).ok(), Some(node.clone())));
                } else if (*old_sort - sort).abs() > f64::EPSILON {
                    conn.execute("UPDATE blocks SET sort_key = ?1 WHERE id = ?2", params![sort, id])?;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO blocks (id, page_id, type, sort_key, content, text, direction, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![id, page_id, block_type, sort, serialized, text, direction, t],
                )?;
                res.added += 1;
                changes.push((id.clone(), "block_added", None, Some(node.clone())));
            }
        }
    }
    for (id, (old, _)) in &existing {
        if !seen.contains(id) {
            conn.execute("DELETE FROM blocks WHERE id = ?1", [id])?;
            conn.execute("DELETE FROM refs WHERE source_block = ?1", [id])?;
            res.removed += 1;
            changes.push((id.clone(), "block_removed", serde_json::from_str(old).ok(), None));
        }
    }
    if res.added + res.changed + res.removed > 0 {
        conn.execute("UPDATE pages SET updated_at = ?1 WHERE id = ?2", params![t, page_id])?;
        if record_history {
            if ctx.is_user() {
                record_user_edit(conn, page_id, &res)?;
            } else {
                for (bid, kind, before, after) in changes {
                    let summary = match kind {
                        "block_added" => "Added a block",
                        "block_removed" => "Removed a block",
                        _ => "Changed a block",
                    };
                    record(conn, ctx, Some(page_id), kind, summary, Some(&bid), before, after, json!({}))?;
                }
            }
        }
    }
    res.updated_at = t;
    rebuild_refs(conn, page_id)?;
    Ok(res)
}

pub(crate) fn rebuild_refs(conn: &Connection, page_id: &str) -> Result<()> {
    conn.execute("DELETE FROM refs WHERE source_page = ?1", [page_id])?;
    let mut stmt = conn.prepare("SELECT id, content FROM blocks WHERE page_id = ?1")?;
    let rows: Vec<(String, String)> = stmt.query_map([page_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    for (bid, c) in rows {
        let node: Value = serde_json::from_str(&c).unwrap_or(Value::Null);
        let mut refs = Vec::new();
        content::collect_refs(&node, &mut refs);
        for (target, kind) in refs {
            conn.execute(
                "INSERT OR IGNORE INTO refs (source_page, source_block, target_page, kind) VALUES (?1, ?2, ?3, ?4)",
                params![page_id, bid, target, kind],
            )?;
        }
    }
    Ok(())
}

/// Coalesce continuous user editing into one quiet history line per window,
/// with a restorable version captured at the start of each window.
pub(crate) fn record_user_edit(conn: &Connection, page_id: &str, res: &SaveResult) -> Result<()> {
    const WINDOW: i64 = 10 * 60 * 1000;
    let t = now();
    let last: Option<(i64, i64, String)> = conn
        .query_row("SELECT id, created_at, meta FROM history WHERE page_id = ?1 ORDER BY id DESC LIMIT 1", [page_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    if let Some((hid, at, meta)) = &last {
        let m: Value = serde_json::from_str(meta).unwrap_or(json!({}));
        if t - at < WINDOW && m.get("edit").is_some() {
            let add = m["added"].as_u64().unwrap_or(0) + res.added as u64;
            let chg = m["changed"].as_u64().unwrap_or(0) + res.changed as u64;
            let rem = m["removed"].as_u64().unwrap_or(0) + res.removed as u64;
            conn.execute(
                "UPDATE history SET meta = ?1, summary = ?2 WHERE id = ?3",
                params![
                    json!({ "edit": true, "added": add, "changed": chg, "removed": rem, "until": t }).to_string(),
                    edit_summary(add, chg, rem),
                    hid
                ],
            )?;
            return Ok(());
        }
    }
    // New editing session: keep a restorable version of the state *before* it.
    // (The diff above already applied, so reconstruct from the previous version
    // is not possible here; the version is taken lazily on the next save via
    // `snapshot_before_user_edit`, called by the command layer pre-save.)
    conn.execute(
        "INSERT INTO history (page_id, actor, kind, summary, meta, created_at) VALUES (?1, 'user', 'edited', ?2, ?3, ?4)",
        params![
            page_id,
            edit_summary(res.added as u64, res.changed as u64, res.removed as u64),
            json!({ "edit": true, "added": res.added, "changed": res.changed, "removed": res.removed, "until": t }).to_string(),
            t
        ],
    )?;
    Ok(())
}

pub(crate) fn edit_summary(add: u64, chg: u64, rem: u64) -> String {
    let mut parts = Vec::new();
    if add > 0 {
        parts.push(format!("{add} added"));
    }
    if chg > 0 {
        parts.push(format!("{chg} changed"));
    }
    if rem > 0 {
        parts.push(format!("{rem} removed"));
    }
    if parts.is_empty() {
        "Edited".into()
    } else {
        format!("Edited · {}", parts.join(", "))
    }
}

/// Called before applying a user save: if no version exists within the
/// editing window, capture one so the prior state stays restorable.
pub fn snapshot_before_user_edit(conn: &Connection, page_id: &str) -> Result<()> {
    const WINDOW: i64 = 10 * 60 * 1000;
    let last: Option<i64> =
        conn.query_row("SELECT MAX(created_at) FROM versions WHERE page_id = ?1", [page_id], |r| r.get(0)).optional()?.flatten();
    let last_edit: Option<i64> = conn
        .query_row("SELECT MAX(created_at) FROM history WHERE page_id = ?1 AND kind = 'edited'", [page_id], |r| r.get(0))
        .optional()?
        .flatten();
    let t = now();
    let stale = last.map(|l| t - l > WINDOW).unwrap_or(true);
    let new_session = last_edit.map(|l| t - l > WINDOW).unwrap_or(true);
    if stale && new_session {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM blocks WHERE page_id = ?1", [page_id], |r| r.get(0))?;
        if count > 0 {
            snapshot(conn, page_id, "user", None, None)?;
        }
    }
    Ok(())
}

pub(crate) fn ensure_op_snapshot(conn: &Connection, ctx: &Ctx, page_id: &str) -> Result<()> {
    let Some(op) = &ctx.op_id else {
        snapshot(conn, page_id, &ctx.actor, None, Some("Before automated change"))?;
        return Ok(());
    };
    let exists: bool = conn
        .query_row("SELECT 1 FROM versions WHERE page_id = ?1 AND op_id = ?2", params![page_id, op], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !exists {
        let label = if ctx.actor == "ai" { "Before Claude’s changes" } else { "Before automation" };
        snapshot(conn, page_id, &ctx.actor, Some(op), Some(label))?;
    }
    Ok(())
}

pub fn snapshot(conn: &Connection, page_id: &str, actor: &str, op_id: Option<&str>, label: Option<&str>) -> Result<String> {
    let page = get_page(conn, page_id)?.ok_or_else(|| anyhow!("page not found"))?;
    let snap = json!({
        "title": page.meta.title,
        "icon": page.meta.icon,
        "cover": page.meta.cover,
        "instructions": page.instructions,
        "metadata": page.metadata,
        "blocks": page.blocks.iter().map(|b| b.content.clone()).collect::<Vec<_>>(),
    });
    let id = new_id();
    conn.execute(
        "INSERT INTO versions (id, page_id, created_at, actor, op_id, label, snapshot) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, page_id, now(), actor, op_id, label, snap.to_string()],
    )?;
    Ok(id)
}

pub fn version_snapshot(conn: &Connection, version_id: &str) -> Result<(String, Value)> {
    let (page_id, snap): (String, String) =
        conn.query_row("SELECT page_id, snapshot FROM versions WHERE id = ?1", [version_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok((page_id, serde_json::from_str(&snap)?))
}

pub fn list_versions(conn: &Connection, page_id: &str) -> Result<Vec<Version>> {
    let mut stmt = conn.prepare(
        "SELECT id, page_id, created_at, actor, op_id, label, json_array_length(snapshot, '$.blocks')
         FROM versions WHERE page_id = ?1 ORDER BY created_at DESC LIMIT 200",
    )?;
    let rows = stmt
        .query_map([page_id], |r| {
            Ok(Version {
                id: r.get(0)?,
                page_id: r.get(1)?,
                created_at: r.get(2)?,
                actor: r.get(3)?,
                op_id: r.get(4)?,
                label: r.get(5)?,
                block_count: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn restore_version(conn: &Connection, ctx: &Ctx, version_id: &str) -> Result<PageMeta> {
    let (page_id, snap) = version_snapshot(conn, version_id)?;
    snapshot(conn, &page_id, &ctx.actor, None, Some("Before restore"))?;
    let blocks: Vec<Value> = snap["blocks"].as_array().cloned().unwrap_or_default();
    let quiet = Ctx { actor: ctx.actor.clone(), op_id: None, origin: ctx.origin.clone() };
    write_blocks(conn, &quiet, &page_id, blocks, false)?;
    let t = now();
    conn.execute(
        "UPDATE pages SET title = ?1, icon = ?2, instructions = ?3, updated_at = ?4 WHERE id = ?5",
        params![snap["title"].as_str().unwrap_or(""), snap["icon"].as_str(), snap["instructions"].to_string(), t, page_id],
    )?;
    // Cover and metadata (properties, look) are part of the page too. Older
    // snapshots may lack them; leave the current values in that case.
    if let Some(cover) = snap.get("cover") {
        conn.execute("UPDATE pages SET cover = ?1 WHERE id = ?2", params![cover.as_str(), page_id])?;
    }
    if let Some(meta) = snap.get("metadata").filter(|m| m.is_object()) {
        conn.execute("UPDATE pages SET metadata = ?1 WHERE id = ?2", params![meta.to_string(), page_id])?;
    }
    record(
        conn,
        ctx,
        Some(&page_id),
        "restored_version",
        "Restored an earlier version",
        None,
        None,
        None,
        json!({ "version": version_id }),
    )?;
    index_page(conn, &page_id)?;
    mark_change(conn, Some(&page_id), "blocks", &ctx.origin)?;
    require_page(conn, &page_id)
}

/// Undo every page change made by one AI / automation operation.
pub fn undo_op(conn: &Connection, ctx: &Ctx, op_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id, page_id FROM versions WHERE op_id = ?1")?;
    let rows: Vec<(String, String)> = stmt.query_map([op_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut pages = Vec::new();
    for (vid, pid) in rows {
        restore_version(conn, ctx, &vid)?;
        pages.push(pid);
    }
    conn.execute("UPDATE history SET meta = json_set(meta, '$.undone', 1) WHERE op_id = ?1", [op_id])?;
    Ok(pages)
}

/// Insert blocks (AI / tools). `after` = block id to insert after; None = end.
pub fn insert_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, after: Option<&str>, nodes: Vec<Value>) -> Result<Vec<String>> {
    let current = blocks_of(conn, page_id)?;
    let mut list: Vec<Value> = current.iter().map(|b| b.content.clone()).collect();
    let pos = match after {
        Some(a) => current.iter().position(|b| b.id == a).map(|p| p + 1).ok_or_else(|| anyhow!("block not found: {a}"))?,
        None => list.len(),
    };
    let mut ids = Vec::new();
    for (k, mut n) in nodes.into_iter().enumerate() {
        let id = new_id();
        content::set_block_id(&mut n, &id);
        ids.push(id);
        list.insert(pos + k, n);
    }
    write_blocks(conn, ctx, page_id, list, true)?;
    index_page(conn, page_id)?;
    mark_change(conn, Some(page_id), "blocks", &ctx.origin)?;
    Ok(ids)
}

/// Replace a page's whole content (snapshotted first for non-user actors, so it stays undoable).
pub fn replace_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, nodes: Vec<Value>) -> Result<SaveResult> {
    require_page(conn, page_id)?;
    let r = write_blocks(conn, ctx, page_id, nodes, true)?;
    index_page(conn, page_id)?;
    mark_change(conn, Some(page_id), "blocks", &ctx.origin)?;
    Ok(r)
}

pub fn update_block(conn: &Connection, ctx: &Ctx, block_id: &str, mut node: Value) -> Result<()> {
    let b = block_by_id(conn, block_id)?.ok_or_else(|| anyhow!("block not found: {block_id}"))?;
    content::set_block_id(&mut node, block_id);
    let list: Vec<Value> =
        blocks_of(conn, &b.page_id)?.into_iter().map(|x| if x.id == block_id { node.clone() } else { x.content }).collect();
    write_blocks(conn, ctx, &b.page_id, list, true)?;
    index_page(conn, &b.page_id)?;
    mark_change(conn, Some(&b.page_id), "blocks", &ctx.origin)?;
    Ok(())
}

pub fn delete_block(conn: &Connection, ctx: &Ctx, block_id: &str) -> Result<()> {
    let b = block_by_id(conn, block_id)?.ok_or_else(|| anyhow!("block not found: {block_id}"))?;
    let list: Vec<Value> = blocks_of(conn, &b.page_id)?.into_iter().filter(|x| x.id != block_id).map(|x| x.content).collect();
    write_blocks(conn, ctx, &b.page_id, list, true)?;
    index_page(conn, &b.page_id)?;
    mark_change(conn, Some(&b.page_id), "blocks", &ctx.origin)?;
    Ok(())
}

pub fn move_block(conn: &Connection, ctx: &Ctx, block_id: &str, after: Option<&str>) -> Result<()> {
    let b = block_by_id(conn, block_id)?.ok_or_else(|| anyhow!("block not found: {block_id}"))?;
    let mut list = blocks_of(conn, &b.page_id)?;
    let idx = list.iter().position(|x| x.id == block_id).unwrap();
    let moved = list.remove(idx);
    let pos = match after {
        Some(a) => list.iter().position(|x| x.id == a).map(|p| p + 1).ok_or_else(|| anyhow!("block not found: {a}"))?,
        None => 0,
    };
    list.insert(pos, moved);
    write_blocks(conn, ctx, &b.page_id, list.into_iter().map(|x| x.content).collect(), true)?;
    mark_change(conn, Some(&b.page_id), "blocks", &ctx.origin)?;
    Ok(())
}
