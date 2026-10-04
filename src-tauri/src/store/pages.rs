use super::*;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

pub fn list_pages(conn: &Connection, include_deleted: bool) -> Result<Vec<PageMeta>> {
    let filter = if include_deleted { "" } else { "WHERE deleted_at IS NULL" };
    let mut stmt = conn.prepare(&format!("SELECT {PAGE_COLS} FROM pages {filter} ORDER BY sort_key, created_at"))?;
    let rows = stmt.query_map([], page_meta)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn page_meta_by_id(conn: &Connection, id: &str) -> Result<Option<PageMeta>> {
    Ok(conn.query_row(&format!("SELECT {PAGE_COLS} FROM pages WHERE id = ?1"), [id], page_meta).optional()?)
}

pub(crate) fn require_page(conn: &Connection, id: &str) -> Result<PageMeta> {
    page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page not found: {id}"))
}

pub fn blocks_of(conn: &Connection, page_id: &str) -> Result<Vec<Block>> {
    let mut stmt = conn.prepare(&format!("SELECT {BLOCK_COLS} FROM blocks WHERE page_id = ?1 ORDER BY sort_key"))?;
    let rows = stmt.query_map([page_id], block_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn block_by_id(conn: &Connection, id: &str) -> Result<Option<Block>> {
    Ok(conn.query_row(&format!("SELECT {BLOCK_COLS} FROM blocks WHERE id = ?1"), [id], block_row).optional()?)
}

pub fn get_page(conn: &Connection, id: &str) -> Result<Option<Page>> {
    let Some(meta) = page_meta_by_id(conn, id)? else { return Ok(None) };
    let (metadata, instructions): (String, String) =
        conn.query_row("SELECT metadata, instructions FROM pages WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let blocks = blocks_of(conn, id)?;
    let backlinks = backlinks(conn, id)?;
    let attachments = {
        let mut stmt = conn.prepare(&format!("SELECT {ATTACHMENT_COLS} FROM attachments WHERE page_id = ?1 ORDER BY created_at"))?;
        let rows = stmt.query_map([id], attachment_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let breadcrumbs = breadcrumbs(conn, meta.parent_id.as_deref())?;
    Ok(Some(Page {
        meta,
        metadata: serde_json::from_str(&metadata).unwrap_or(json!({})),
        instructions: serde_json::from_str(&instructions).unwrap_or_default(),
        blocks,
        backlinks,
        attachments,
        breadcrumbs,
    }))
}

pub(crate) fn breadcrumbs(conn: &Connection, parent: Option<&str>) -> Result<Vec<Crumb>> {
    let mut out = Vec::new();
    let mut cur = parent.map(str::to_string);
    while let Some(pid) = cur {
        if out.len() > 64 {
            break;
        }
        let row: Option<(String, Option<String>, Option<String>)> = conn
            .query_row("SELECT title, icon, parent_id FROM pages WHERE id = ?1", [&pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?;
        let Some((title, icon, next)) = row else { break };
        out.push(Crumb { id: pid, title, icon });
        cur = next;
    }
    out.reverse();
    Ok(out)
}

pub fn backlinks(conn: &Connection, page_id: &str) -> Result<Vec<Backlink>> {
    let mut stmt = conn.prepare(
        "SELECT r.source_page, p.title, p.icon, r.source_block, r.kind, COALESCE(b.text, '')
         FROM refs r JOIN pages p ON p.id = r.source_page
         LEFT JOIN blocks b ON b.id = r.source_block
         WHERE r.target_page = ?1 AND r.source_page != ?1 AND p.deleted_at IS NULL
         ORDER BY p.updated_at DESC",
    )?;
    let rows = stmt
        .query_map([page_id], |r| {
            let excerpt: String = r.get(5)?;
            Ok(Backlink {
                page_id: r.get(0)?,
                title: r.get(1)?,
                icon: r.get(2)?,
                block_id: r.get(3)?,
                kind: r.get(4)?,
                excerpt: excerpt.chars().take(160).collect(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub(crate) fn next_sort_key(conn: &Connection, parent: Option<&str>, after: Option<&str>) -> Result<f64> {
    if let Some(after_id) = after {
        let k: Option<f64> = conn.query_row("SELECT sort_key FROM pages WHERE id = ?1", [after_id], |r| r.get(0)).optional()?;
        if let Some(k) = k {
            let next: Option<f64> = conn
                .query_row(
                    "SELECT MIN(sort_key) FROM pages WHERE parent_id IS ?1 AND sort_key > ?2 AND deleted_at IS NULL",
                    params![parent, k],
                    |r| r.get(0),
                )
                .optional()?
                .flatten();
            return Ok(match next {
                Some(n) => (k + n) / 2.0,
                None => k + 1.0,
            });
        }
    }
    let max: Option<f64> =
        conn.query_row("SELECT MAX(sort_key) FROM pages WHERE parent_id IS ?1", params![parent], |r| r.get(0)).optional()?.flatten();
    Ok(max.map(|m| m + 1.0).unwrap_or(0.0))
}

pub fn create_page(conn: &Connection, ctx: &Ctx, new: NewPage) -> Result<PageMeta> {
    let owner = profile(conn)?.id;
    if let Some(parent) = &new.parent_id {
        require_page(conn, parent)?;
    }
    let id = new_id();
    let t = now();
    let sort = next_sort_key(conn, new.parent_id.as_deref(), new.after_id.as_deref())?;
    let kind = new.kind.clone().unwrap_or_else(|| "page".into());
    conn.execute(
        "INSERT INTO pages (id, title, icon, parent_id, sort_key, owner_id, kind, template_category,
                            metadata, instructions, created_at, updated_at, opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?11)",
        params![
            id,
            new.title.clone().unwrap_or_default(),
            new.icon,
            new.parent_id,
            sort,
            owner,
            kind,
            new.template_category,
            new.metadata.clone().unwrap_or(json!({})).to_string(),
            serde_json::to_string(&new.instructions.clone().unwrap_or_default())?,
            t
        ],
    )?;
    record(conn, ctx, Some(&id), "created", &format!("Created “{}”", new.title.clone().unwrap_or_default()), None, None, None, json!({}))?;
    let nodes = match (&new.blocks, &new.markdown) {
        (Some(b), _) => b.clone(),
        (None, Some(md)) => content::from_markdown(md),
        _ => Vec::new(),
    };
    if !nodes.is_empty() {
        let quiet = Ctx { actor: ctx.actor.clone(), op_id: ctx.op_id.clone(), origin: ctx.origin.clone() };
        write_blocks(conn, &quiet, &id, nodes, false)?;
    }
    index_page(conn, &id)?;
    mark_change(conn, Some(&id), "page", &ctx.origin)?;
    require_page(conn, &id)
}

pub fn update_page(conn: &Connection, ctx: &Ctx, id: &str, patch: PagePatch) -> Result<PageMeta> {
    let before = require_page(conn, id)?;
    let t = now();
    if let Some(title) = &patch.title {
        if *title != before.title {
            conn.execute("UPDATE pages SET title = ?1, updated_at = ?2 WHERE id = ?3", params![title, t, id])?;
            record(
                conn,
                ctx,
                Some(id),
                "renamed",
                &format!("Renamed to “{title}”"),
                None,
                Some(json!(before.title)),
                Some(json!(title)),
                json!({}),
            )?;
            // keep mention labels pointing here fresh is the renderer's job; labels resolve live.
        }
    }
    if let Some(icon) = &patch.icon {
        conn.execute("UPDATE pages SET icon = ?1, updated_at = ?2 WHERE id = ?3", params![icon, t, id])?;
    }
    if let Some(cover) = &patch.cover {
        conn.execute("UPDATE pages SET cover = ?1, updated_at = ?2 WHERE id = ?3", params![cover, t, id])?;
    }
    if let Some(p) = patch.pinned {
        let order: Option<f64> = if p {
            let max: Option<f64> = conn.query_row("SELECT MAX(pin_order) FROM pages", [], |r| r.get(0))?;
            Some(max.unwrap_or(0.0) + 1.0)
        } else {
            None
        };
        conn.execute("UPDATE pages SET pinned = ?1, pin_order = ?2 WHERE id = ?3", params![p as i64, order, id])?;
    }
    if let Some(f) = patch.favorite {
        conn.execute("UPDATE pages SET favorite = ?1 WHERE id = ?2", params![f as i64, id])?;
    }
    if let Some(a) = patch.archived {
        conn.execute("UPDATE pages SET archived = ?1, updated_at = ?2 WHERE id = ?3", params![a as i64, t, id])?;
        record(
            conn,
            ctx,
            Some(id),
            if a { "archived" } else { "unarchived" },
            if a { "Archived" } else { "Restored from archive" },
            None,
            None,
            None,
            json!({}),
        )?;
    }
    if let Some(m) = &patch.metadata {
        conn.execute("UPDATE pages SET metadata = ?1, updated_at = ?2 WHERE id = ?3", params![m.to_string(), t, id])?;
    }
    if let Some(ins) = &patch.instructions {
        let old: String = conn.query_row("SELECT instructions FROM pages WHERE id = ?1", [id], |r| r.get(0))?;
        let new_s = serde_json::to_string(ins)?;
        if old != new_s {
            conn.execute("UPDATE pages SET instructions = ?1, updated_at = ?2 WHERE id = ?3", params![new_s, t, id])?;
            record(
                conn,
                ctx,
                Some(id),
                "instructions",
                "Updated assistant instructions",
                None,
                serde_json::from_str(&old).ok(),
                Some(json!(ins)),
                json!({}),
            )?;
        }
    }
    if let Some(cat) = &patch.template_category {
        conn.execute("UPDATE pages SET template_category = ?1 WHERE id = ?2", params![cat, id])?;
    }
    index_page(conn, id)?;
    mark_change(conn, Some(id), "page", &ctx.origin)?;
    require_page(conn, id)
}

pub fn touch_opened(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("UPDATE pages SET opened_at = ?1 WHERE id = ?2", params![now(), id])?;
    Ok(())
}

pub(crate) fn is_descendant(conn: &Connection, candidate: &str, ancestor: &str) -> Result<bool> {
    let mut cur = Some(candidate.to_string());
    let mut guard = 0;
    while let Some(c) = cur {
        if c == ancestor {
            return Ok(true);
        }
        guard += 1;
        if guard > 256 {
            return Ok(true);
        }
        cur = conn.query_row("SELECT parent_id FROM pages WHERE id = ?1", [&c], |r| r.get::<_, Option<String>>(0)).optional()?.flatten();
    }
    Ok(false)
}

/// Re-parent and/or reorder. `before_id` places the page directly before that sibling.
pub fn move_page(conn: &Connection, ctx: &Ctx, id: &str, parent_id: Option<&str>, before_id: Option<&str>) -> Result<PageMeta> {
    let page = require_page(conn, id)?;
    if let Some(p) = parent_id {
        if is_descendant(conn, p, id)? {
            bail!("a page cannot be moved inside itself");
        }
    }
    let sort = if let Some(b) = before_id {
        let k: f64 = conn.query_row("SELECT sort_key FROM pages WHERE id = ?1", [b], |r| r.get(0))?;
        let prev: Option<f64> = conn
            .query_row(
                "SELECT MAX(sort_key) FROM pages WHERE parent_id IS ?1 AND sort_key < ?2 AND id != ?3 AND deleted_at IS NULL",
                params![parent_id, k, id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        match prev {
            Some(p) => (p + k) / 2.0,
            None => k - 1.0,
        }
    } else {
        let max: Option<f64> = conn
            .query_row("SELECT MAX(sort_key) FROM pages WHERE parent_id IS ?1 AND id != ?2", params![parent_id, id], |r| r.get(0))
            .optional()?
            .flatten();
        max.map(|m| m + 1.0).unwrap_or(0.0)
    };
    conn.execute("UPDATE pages SET parent_id = ?1, sort_key = ?2 WHERE id = ?3", params![parent_id, sort, id])?;
    if page.parent_id.as_deref() != parent_id {
        let dest = match parent_id {
            Some(p) => require_page(conn, p)?.title,
            None => "top level".into(),
        };
        record(
            conn,
            ctx,
            Some(id),
            "moved",
            &format!("Moved to {dest}"),
            None,
            Some(json!(page.parent_id)),
            Some(json!(parent_id)),
            json!({}),
        )?;
    }
    mark_change(conn, Some(id), "tree", &ctx.origin)?;
    require_page(conn, id)
}

/// Soft delete (to Trash): the page and its subtree.
pub fn delete_page(conn: &Connection, ctx: &Ctx, id: &str) -> Result<()> {
    require_page(conn, id)?;
    let t = now();
    for pid in subtree_ids(conn, id)? {
        conn.execute("UPDATE pages SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL", params![t, pid])?;
    }
    record(conn, ctx, Some(id), "deleted", "Moved to Trash", None, None, None, json!({}))?;
    mark_change(conn, Some(id), "tree", &ctx.origin)?;
    Ok(())
}

pub fn restore_page(conn: &Connection, ctx: &Ctx, id: &str) -> Result<()> {
    let deleted_at: Option<i64> = conn.query_row("SELECT deleted_at FROM pages WHERE id = ?1", [id], |r| r.get(0))?;
    if let Some(t) = deleted_at {
        for pid in subtree_ids(conn, id)? {
            conn.execute("UPDATE pages SET deleted_at = NULL WHERE id = ?1 AND deleted_at = ?2", params![pid, t])?;
        }
        // If the parent is still in the trash, lift to top level.
        conn.execute(
            "UPDATE pages SET parent_id = NULL WHERE id = ?1 AND parent_id IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL)",
            [id],
        )?;
        record(conn, ctx, Some(id), "restored", "Restored from Trash", None, None, None, json!({}))?;
        mark_change(conn, Some(id), "tree", &ctx.origin)?;
    }
    Ok(())
}

/// Permanently remove a trashed page (user-initiated from Trash only).
pub fn purge_page(conn: &Connection, id: &str) -> Result<()> {
    let deleted: Option<i64> = conn.query_row("SELECT deleted_at FROM pages WHERE id = ?1", [id], |r| r.get(0))?;
    if deleted.is_none() {
        bail!("only pages in Trash can be permanently deleted");
    }
    for pid in subtree_ids(conn, id)?.into_iter().rev() {
        conn.execute("DELETE FROM pages_fts WHERE page_id = ?1", [&pid])?;
        conn.execute("DELETE FROM refs WHERE source_page = ?1", [&pid])?;
        conn.execute("DELETE FROM versions WHERE page_id = ?1", [&pid])?;
        conn.execute("DELETE FROM pages WHERE id = ?1", [&pid])?;
    }
    mark_change(conn, Some(id), "tree", "ui")?;
    Ok(())
}

pub fn subtree_ids(conn: &Connection, root: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE t(id) AS (SELECT ?1 UNION ALL SELECT p.id FROM pages p JOIN t ON p.parent_id = t.id)
         SELECT id FROM t",
    )?;
    let ids = stmt.query_map([root], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(ids)
}

/// Duplicate a page (optionally with its subpages). Block ids are regenerated.
pub fn duplicate_page(
    conn: &Connection,
    ctx: &Ctx,
    id: &str,
    deep: bool,
    as_kind: Option<&str>,
    new_parent: Option<Option<&str>>,
) -> Result<PageMeta> {
    let src = get_page(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
    let parent = match new_parent {
        Some(p) => p.map(str::to_string),
        None => src.meta.parent_id.clone(),
    };
    let kind = as_kind.unwrap_or(&src.meta.kind).to_string();
    let title = if as_kind.is_none() && kind == src.meta.kind && new_parent.is_none() {
        format!("{} (copy)", src.meta.title)
    } else {
        src.meta.title.clone()
    };
    let nodes: Vec<Value> = src.blocks.iter().map(|b| strip_bid(b.content.clone())).collect();
    let created = create_page(
        conn,
        ctx,
        NewPage {
            title: Some(title),
            icon: src.meta.icon.clone(),
            parent_id: parent,
            after_id: if new_parent.is_none() { Some(id.to_string()) } else { None },
            kind: Some(kind.clone()),
            template_category: src.meta.template_category.clone(),
            blocks: Some(nodes),
            instructions: Some(src.instructions.clone()),
            metadata: Some(src.metadata.clone()),
            ..Default::default()
        },
    )?;
    if deep {
        let kids: Vec<String> = conn
            .prepare("SELECT id FROM pages WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY sort_key")?
            .query_map([id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        for kid in kids {
            duplicate_page(conn, ctx, &kid, true, Some(&kind), Some(Some(&created.id)))?;
        }
    }
    Ok(created)
}

pub(crate) fn strip_bid(mut node: Value) -> Value {
    if let Some(a) = node.get_mut("attrs").and_then(Value::as_object_mut) {
        a.remove("bid");
    }
    node
}
