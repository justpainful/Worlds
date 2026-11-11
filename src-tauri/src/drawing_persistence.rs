//! Shared original drawing persistence path. Platform authorization and sync
//! remain supplied by the containing crate and must fail closed when unavailable.
use super::{apply_changes, check_pixel_guard, initial_scene, require_drawing, safe_id, text, validate_scene};
use crate::account::permissions::Level;
use crate::{db, store};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn load(conn: &Connection, page: &str) -> Result<Value> {
    require_drawing(conn, page, Level::View)?;
    let row: Option<(i64, String, String)> = conn
        .query_row("SELECT revision, seed, scene FROM drawing_documents WHERE page_id = ?1", [page], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let (revision, seed, scene) = if let Some((r, a, b)) = row {
        (r, serde_json::from_str::<Value>(&a)?, serde_json::from_str::<Value>(&b)?)
    } else {
        let s = initial_scene(page);
        (0, s.clone(), s)
    };
    let mut stmt = conn.prepare("SELECT payload FROM drawing_operations WHERE page_id = ?1 ORDER BY revision")?;
    let raw: Vec<String> = stmt.query_map([page], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let operations: Vec<Value> = raw.iter().map(|s| serde_json::from_str(s)).collect::<serde_json::Result<_>>()?;
    let metadata: String = conn.query_row("SELECT metadata FROM pages WHERE id = ?1", [page], |r| r.get(0))?;
    let metadata: Value = serde_json::from_str(&metadata)?;
    Ok(json!({ "revision": revision, "seed": seed, "scene": scene, "operations": operations, "experiment": metadata.get("experiment") }))
}
pub fn apply(conn: &Connection, ctx: &store::Ctx, page: &str, op: Value) -> Result<Value> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = apply(&tx, ctx, page, op)?;
        tx.commit()?;
        return Ok(result);
    }
    require_drawing(conn, page, Level::Edit)?;
    let actor = store::profile(conn)?.id;
    if text(&op, "actor")? != actor || !safe_id(text(&op, "id")?) || text(&op, "label")?.trim().is_empty() || op["at"].as_f64().is_none() {
        bail!("invalid drawing author or operation");
    }
    if op.get("requiresBase").is_some_and(|flag| flag.as_bool() != Some(true) || op["type"] != "edit") {
        bail!("Invalid strict drawing base");
    }
    if !op["versionRestore"].is_null()
        && (!op["versionRestore"].is_object()
            || op["versionRestore"]["backupId"] != op["id"]
            || op["versionRestore"]["expectedRevision"] != op["base"]
            || !op["versionRestore"]["versionId"].as_str().is_some_and(safe_id))
    {
        bail!("Invalid version restore receipt");
    }
    if op.to_string().len() > 8 * 1024 * 1024 {
        bail!("drawing operation is too large; split the stroke into segments");
    }
    let tx = conn;
    let doc = load(tx, page)?;
    let mut ops = doc["operations"].as_array().unwrap().clone();
    if let Some(old) = ops.iter().find(|p| p["id"] == op["id"]) {
        if old != &op {
            bail!("operation identifier was reused");
        }
        return Ok(doc);
    }
    let revision = doc["revision"].as_i64().unwrap();
    if op["base"].as_i64() != Some(revision) {
        bail!("conflict: the drawing changed; retain this edit in a recovered copy");
    }
    if op["type"] == "edit" && !op["pixelGuard"].is_null() {
        check_pixel_guard(&doc["scene"], &op["pixelGuard"])?;
    }
    let mut scene = doc["scene"].clone();
    match text(&op, "type")? {
        "edit" => apply_changes(&mut scene, &op["changes"], false)?,
        "toggle" => {
            let target = ops.iter().find(|p| p["id"] == op["target"]).ok_or_else(|| anyhow!("missing undo target"))?;
            if target["type"] != "edit" || target["actor"] != op["actor"] || !op["enabled"].is_boolean() {
                bail!("only the author can undo this operation");
            }
            scene = doc["seed"].clone();
            let mut enabled = std::collections::HashMap::<String, bool>::new();
            for p in ops.iter().chain(std::iter::once(&op)) {
                if p["type"] == "edit" {
                    enabled.insert(text(p, "id")?.into(), true);
                } else {
                    enabled.insert(text(p, "target")?.into(), p["enabled"].as_bool().unwrap_or(true));
                }
            }
            for p in &ops {
                if p["type"] == "edit" && enabled.get(text(p, "id")?) == Some(&true) {
                    apply_changes(&mut scene, &p["changes"], true)?;
                }
            }
        }
        _ => bail!("unknown drawing operation"),
    }
    validate_scene(&scene)?;
    for asset in scene["assets"].as_object().unwrap().values() {
        let a = store::get_attachment(tx, text(asset, "attachmentId")?)?.ok_or_else(|| anyhow!("missing original attachment"))?;
        if let Some(source_page) = a.page_id {
            super::require_asset_read(tx, page, &source_page)?;
        }
    }
    let search = search_text(&scene);
    tx.execute(
        "INSERT INTO drawing_documents(page_id, revision, seed, scene, search_text, \
        updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(page_id) DO UPDATE SET revision = \
        excluded.revision, scene = excluded.scene, search_text = excluded.search_text, updated_at = \
        excluded.updated_at",
        params![page, revision + 1, doc["seed"].to_string(), scene.to_string(), search, db::now()],
    )?;
    tx.execute(
        "INSERT INTO drawing_operations(page_id, id, revision, actor, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![page, text(&op, "id")?, revision + 1, actor, op.to_string(), db::now()],
    )?;
    crate::drawing_sync::queue_local(tx, page, &doc["scene"], &op)?;
    tx.execute("UPDATE pages SET updated_at = ?1 WHERE id = ?2", params![db::now(), page])?;
    store::index_page(tx, page)?;
    rebuild_links(tx, page, &scene)?;
    store::record(
        tx,
        ctx,
        Some(page),
        "drawing",
        text(&op, "label")?,
        None,
        None,
        None,
        json!({ "drawingOperationId": op["id"], "revision": revision + 1 }),
    )?;
    db::mark_change(tx, Some(page), "drawing", &ctx.origin)?;
    ops.push(op);
    Ok(json!({ "revision": revision + 1, "seed": doc["seed"], "scene": scene, "operations": ops, "experiment": doc.get("experiment") }))
}

pub fn search_text(scene: &Value) -> String {
    let mut out = Vec::new();
    for map in ["frames", "nodes", "steps"] {
        if let Some(entities) = scene[map].as_object() {
            for value in entities.values() {
                for key in ["name", "text", "title", "body"] {
                    if let Some(s) = value[key].as_str() {
                        out.push(s.to_string());
                    }
                }
                if value["sourceMode"] == "snapshot" {
                    for key in ["title", "excerpt"] {
                        if let Some(s) = value["referenceSnapshot"][key].as_str() {
                            out.push(s.to_string());
                        }
                    }
                }
            }
        }
    }
    out.join("\n")
}
pub fn rebuild_links(conn: &Connection, page: &str, scene: &Value) -> Result<()> {
    conn.execute("DELETE FROM refs WHERE source_page = ?1 AND kind = 'drawing_link'", [page])?;
    for node in scene["nodes"].as_object().unwrap().values() {
        if let Some(source) = node["sourceId"].as_str() {
            conn.execute(
                "INSERT OR IGNORE INTO refs(source_page, source_block, target_page, kind) VALUES (?1, ?2, ?3, 'drawing_link')",
                params![page, node["id"].as_str(), source],
            )?;
        }
    }
    Ok(())
}
