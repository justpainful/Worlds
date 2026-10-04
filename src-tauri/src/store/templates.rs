use super::*;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/// Create a new page from a template (deep: includes template subpages).
pub fn instantiate_template(
    conn: &Connection,
    ctx: &Ctx,
    template_id: &str,
    parent_id: Option<&str>,
    title: Option<&str>,
) -> Result<PageMeta> {
    let t = require_page(conn, template_id)?;
    if t.kind != "template" {
        bail!("not a template");
    }
    let page = duplicate_page(conn, ctx, template_id, true, Some("page"), Some(parent_id))?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let final_title = title.map(str::to_string).unwrap_or_else(|| t.title.replace("{{date}}", &today));
    // Fill {{date}} tokens in blocks.
    let blocks = blocks_of(conn, &page.id)?;
    let nodes: Vec<Value> = blocks
        .into_iter()
        .map(|b| {
            let s = b.content.to_string().replace("{{date}}", &today);
            serde_json::from_str(&s).unwrap_or(b.content)
        })
        .collect();
    let quiet = Ctx { actor: ctx.actor.clone(), op_id: ctx.op_id.clone(), origin: ctx.origin.clone() };
    write_blocks(conn, &quiet, &page.id, nodes, false)?;
    conn.execute(
        "UPDATE pages SET title = ?1, template_category = NULL, metadata = json_set(metadata, '$.fromTemplate', ?2) WHERE id = ?3",
        params![final_title, template_id, page.id],
    )?;
    index_page(conn, &page.id)?;
    mark_change(conn, Some(&page.id), "tree", &ctx.origin)?;
    require_page(conn, &page.id)
}

pub fn save_as_template(conn: &Connection, ctx: &Ctx, page_id: &str) -> Result<PageMeta> {
    let t = duplicate_page(conn, ctx, page_id, true, Some("template"), Some(None))?;
    conn.execute("UPDATE pages SET template_category = 'Custom' WHERE id = ?1", [&t.id])?;
    require_page(conn, &t.id)
}

pub fn ensure_builtin_templates(conn: &Connection) -> Result<()> {
    let seeded: Option<String> = conn.query_row("SELECT value FROM meta WHERE key = 'templates_v1'", [], |r| r.get(0)).optional()?;
    if seeded.is_some() {
        return Ok(());
    }
    let ctx = Ctx { actor: "system".into(), op_id: None, origin: "ui".into() };
    for t in crate::templates::BUILTIN {
        create_page(
            conn,
            &ctx,
            NewPage {
                title: Some(t.title.to_string()),
                icon: Some(t.icon.to_string()),
                kind: Some("template".into()),
                template_category: Some(t.category.to_string()),
                markdown: Some(t.markdown.to_string()),
                metadata: Some(json!({ "builtin": t.key, "description": t.description })),
                ..Default::default()
            },
        )?;
    }
    conn.execute("INSERT INTO meta (key, value) VALUES ('templates_v1', '1')", [])?;
    // seeding is not user activity
    conn.execute("DELETE FROM history WHERE actor = 'system'", [])?;
    Ok(())
}
