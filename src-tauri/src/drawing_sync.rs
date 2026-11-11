//! Durable shared drawing replica. A canonical checkpoint replaces neither unseen
//! local writes nor conflicting offline edits. Originals arrive before references.
use crate::account::permissions::{page_level, require, Level};
use crate::{db, drawing, store, AppState};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use tauri::State;
const MAPS: &[&str] = &["frames", "layers", "nodes", "assets", "masks", "steps"];
fn str_at<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().ok_or_else(|| anyhow!("Invalid drawing {key}"))
}
fn list_map(list: &str) -> Result<&'static str> {
    match list {
        "frameOrder" => Ok("frames"),
        "layerOrder" => Ok("layers"),
        "nodeOrder" => Ok("nodes"),
        "stepOrder" => Ok("steps"),
        _ => bail!("Invalid drawing order"),
    }
}

fn preconditions(scene: &Value, op: &Value) -> Result<Value> {
    if op["type"] != "edit" {
        return Ok(json!([]));
    }
    let mut out = Vec::new();
    for c in op["changes"].as_array().ok_or_else(|| anyhow!("Invalid drawing changes"))? {
        match str_at(c, "type")? {
            "defaultFrame" => out.push(json!({ "type": "defaultFrame", "id": scene["defaultFrameId"] })),
            "order" => out.push(json!({ "type": "order", "list": c["list"], "ids": scene[str_at(c, "list")?] })),
            "put" | "patch" | "remove" => {
                let map = str_at(c, "collection")?;
                let id = str_at(c, "id")?;
                if !MAPS.contains(&map) {
                    bail!("Invalid drawing collection");
                }
                let old = scene[map].get(id);
                if c["type"] == "patch" {
                    let mut fields = serde_json::Map::new();
                    for key in c["fields"].as_object().ok_or_else(|| anyhow!("Invalid drawing fields"))?.keys() {
                        fields.insert(
                            key.clone(),
                            match old.and_then(|n| n.get(key)) {
                                Some(value) => json!({ "present": true, "value": value }),
                                None => json!({ "present": false }),
                            },
                        );
                    }
                    out.push(json!({ "type": "fields", "collection": map, "id": id, "fields": fields }));
                } else {
                    let mut p = json!({ "type": "entity", "collection": map, "id": id, "present": old.is_some() });
                    if let Some(value) = old {
                        p["value"] = value.clone();
                    }
                    out.push(p);
                }
            }
            _ => bail!("Invalid drawing change"),
        }
    }
    Ok(json!(out))
}
pub fn queue_local(conn: &Connection, page: &str, before: &Value, op: &Value) -> Result<()> {
    let enabled: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM drawing_sync_state WHERE page_id = ?1)", [page], |r| r.get(0))?;
    if enabled {
        conn.execute(
            "INSERT INTO drawing_sync_outbox(page_id,operation_id,payload,preconditions) VALUES (?1,?2,?3,?4)",
            params![page, str_at(op, "id")?, op.to_string(), preconditions(before, op)?.to_string()],
        )?;
        conn.execute("UPDATE drawing_sync_state SET status = CASE WHEN status IN ('conflict','denied') THEN status ELSE 'pending' END, updated_at = ?2 WHERE page_id = ?1", params![page, db::now()])?;
    }
    Ok(())
}
fn check_identity(conn: &Connection, user: &str) -> Result<()> {
    if user.is_empty() || user.len() > 160 {
        bail!("Invalid drawing sync identity");
    }
    let account: Option<String> =
        conn.query_row("SELECT user_id FROM account WHERE id = 1 AND status = 'active'", [], |r| r.get(0)).optional()?;
    if account.as_deref().is_some_and(|id| id != user) {
        bail!("Drawing sync belongs to another signed-in account");
    }
    Ok(())
}
pub fn check_bound_identity(conn: &Connection, page: &str) -> Result<()> {
    let user: Option<String> =
        conn.query_row("SELECT user_id FROM drawing_sync_state WHERE page_id=?1", [page], |r| r.get(0)).optional()?;
    if let Some(user) = user {
        check_identity(conn, &user)?;
    }
    Ok(())
}
pub fn pending_pages(conn: &Connection) -> Result<Vec<String>> {
    let rows: Vec<(String, String)> = conn.prepare(
        "SELECT s.page_id,s.user_id FROM drawing_sync_state s JOIN pages p ON p.id=s.page_id WHERE p.deleted_at IS NULL AND (s.status != 'synced' OR EXISTS(SELECT 1 FROM drawing_sync_outbox o WHERE o.page_id=s.page_id))"
    )?.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut pages = Vec::new();
    for (page, user) in rows {
        if check_identity(conn, &user).is_ok() && page_level(conn, &page)? >= Level::View && crate::sync::page_mode(conn, &page)?.shared {
            pages.push(page);
        }
    }
    Ok(pages)
}
pub fn open(conn: &Connection, page: &str, server: &str, workspace: &str, user: &str) -> Result<Value> {
    require(conn, page, Level::View)?;
    check_identity(conn, user)?;
    let mode = crate::sync::page_mode(conn, page)?;
    if !mode.shared || mode.workspace_id.as_deref().is_some_and(|id| id != workspace) {
        bail!("This drawing is not shared in the requested workspace");
    }
    let parsed = reqwest::Url::parse(server)?;
    if !matches!(parsed.scheme(), "http" | "https") || !parsed.username().is_empty() || parsed.password().is_some() {
        bail!("Invalid drawing sync server");
    }
    let existing: Option<(String, String, String)> = conn
        .query_row("SELECT server_url,workspace_id,user_id FROM drawing_sync_state WHERE page_id = ?1", [page], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    if let Some((old_server, old_workspace, old_user)) = existing {
        if old_server != server.trim_end_matches('/') || old_workspace != workspace || old_user != user {
            bail!("conflict: recover the drawing before switching its sync identity or server");
        }
    } else {
        let document = drawing::load(conn, page)?;
        conn.execute(
            "INSERT INTO drawing_sync_state(page_id,server_url,workspace_id,user_id,basis,updated_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![page, server.trim_end_matches('/'), workspace, user, document.to_string(), db::now()],
        )?;
    }
    snapshot(conn, page)
}
fn pending(conn: &Connection, page: &str) -> Result<Vec<Value>> {
    let rows: Vec<(String, String)> = conn
        .prepare("SELECT payload,preconditions FROM drawing_sync_outbox WHERE page_id = ?1 ORDER BY sequence")?
        .query_map([page], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    rows.into_iter()
        .map(|(op, before)| {
            Ok(json!({ "operation": serde_json::from_str::<Value>(&op)?, "preconditions": serde_json::from_str::<Value>(&before)? }))
        })
        .collect()
}
fn original_ids(value: &Value, ids: &mut HashSet<String>) {
    if let Some(assets) = value["assets"].as_object() {
        for a in assets.values() {
            if let Some(id) = a["attachmentId"].as_str() {
                ids.insert(id.into());
            }
        }
    }
    if !value["seed"].is_null() {
        original_ids(&value["seed"], ids);
        original_ids(&value["scene"], ids);
        if let Some(ops) = value["operations"].as_array() {
            for op in ops {
                if op["type"] == "edit" {
                    if let Some(changes) = op["changes"].as_array() {
                        for c in changes {
                            if c["collection"] == "assets" {
                                let a = if c["type"] == "put" { &c["value"] } else { &c["fields"] };
                                if let Some(id) = a["attachmentId"].as_str() {
                                    ids.insert(id.into());
                                }
                            }
                        }
                    }
                }
            }
        }
    } else if value["schema"].is_null() {
        if let Some(map) = value.as_object() {
            for v in map.values() {
                if !v["scene"].is_null() {
                    original_ids(&v["scene"], ids);
                }
            }
        }
    }
}
pub fn snapshot(conn: &Connection, page: &str) -> Result<Value> {
    require(conn, page, Level::View)?;
    crate::drawing_library::prepare_sync_versions(conn, page)?;
    let (server, workspace, user, basis, remote, status, error): (String, String, String, String, Option<String>, String, Option<String>) =
        conn.query_row(
            "SELECT server_url,workspace_id,user_id,basis,remote,status,last_error FROM drawing_sync_state WHERE page_id = ?1",
            [page],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )?;
    check_identity(conn, &user)?;
    let mode = crate::sync::page_mode(conn, page)?;
    if !mode.shared || mode.workspace_id.as_deref().is_some_and(|id| id != workspace) {
        bail!("Drawing sharing mode or workspace changed");
    }
    let document = drawing::load(conn, page)?;
    let basis: Value = serde_json::from_str(&basis)?;
    let mut originals = HashSet::new();
    original_ids(&document, &mut originals);
    original_ids(&basis, &mut originals);
    let mut versions = serde_json::Map::new();
    let raw_versions: Vec<(String, String, String, i64, i64, String)> = conn
        .prepare("SELECT id,label,author,revision,created_at,scene FROM drawing_versions WHERE page_id = ?1")?
        .query_map([page], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (id, label, author, revision, at, raw) in raw_versions {
        let scene: Value = serde_json::from_str(&raw)?;
        original_ids(&scene, &mut originals);
        versions.insert(id, json!({ "label": label, "author": author, "revision": revision, "createdAt": at, "scene": scene }));
    }
    Ok(
        json!({ "pageId": page, "document": document, "basis": basis, "remote": remote.map(|s| serde_json::from_str::<Value>(&s)).transpose()?, "pending": pending(conn, page)?, "versions": versions, "attachmentIds": originals, "localActor": store::profile(conn)?.id, "userId": user, "workspaceId": workspace, "serverUrl": server, "level": page_level(conn, page)?.as_str(), "status": status, "error": error, "exportPolicy":crate::drawing_export::initial_policy(conn,page)?.rules }),
    )
}
fn validate_document(doc: &Value) -> Result<()> {
    drawing::validate_scene(&doc["seed"])?;
    drawing::validate_scene(&doc["scene"])?;
    let ops = doc["operations"].as_array().ok_or_else(|| anyhow!("Invalid shared drawing journal"))?;
    if doc["revision"].as_u64() != Some(ops.len() as u64) || ops.len() > 100000 {
        bail!("Invalid shared drawing revision");
    }
    let mut seen = HashMap::new();
    let mut enabled = HashMap::new();
    for (i, op) in ops.iter().enumerate() {
        let id = str_at(op, "id")?;
        let actor = str_at(op, "actor")?;
        if id.is_empty()
            || id.len() > 160
            || actor.is_empty()
            || op["base"].as_u64() != Some(i as u64)
            || op["at"].as_f64().is_none()
            || seen.insert(id, op).is_some()
        {
            bail!("Invalid shared drawing operation");
        }
        if op.get("requiresBase").is_some_and(|flag| flag.as_bool() != Some(true) || op["type"] != "edit") {
            bail!("Invalid strict drawing base");
        }
        match str_at(op, "type")? {
            "edit" => {
                if !op["changes"].is_array() {
                    bail!("Invalid shared drawing changes");
                }
                enabled.insert(id, true);
            }
            "toggle" => {
                let target = str_at(op, "target")?;
                let previous = seen.get(target).ok_or_else(|| anyhow!("Missing shared undo target"))?;
                if previous["type"] != "edit" || previous["actor"] != op["actor"] || !op["enabled"].is_boolean() {
                    bail!("Invalid shared undo author");
                }
                enabled.insert(target, op["enabled"].as_bool().unwrap());
            }
            _ => bail!("Invalid shared drawing operation type"),
        }
    }
    let mut scene = doc["seed"].clone();
    for op in ops {
        if op["type"] == "edit" && enabled.get(str_at(op, "id")?) == Some(&true) {
            drawing::apply_changes(&mut scene, &op["changes"], true)?;
        }
    }
    drawing::validate_scene(&scene)?;
    if scene != doc["scene"] {
        bail!("Shared drawing history does not match its scene");
    }
    Ok(())
}
fn validate_wire(incoming: &Value, previous: &Value) -> Result<()> {
    validate_document(&incoming["document"])?;
    if !incoming["generation"].as_str().is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
        || incoming["revision"] != incoming["document"]["revision"]
        || incoming["dependencyRevision"].as_u64().is_none()
    {
        bail!("Invalid canonical drawing checkpoint");
    }
    let attachments = incoming["attachments"].as_object().ok_or_else(|| anyhow!("Invalid shared original directory"))?;
    let versions = incoming["versions"].as_object().ok_or_else(|| anyhow!("Invalid shared version directory"))?;
    if attachments.len() > 100000 || versions.len() > 500 {
        bail!("Drawing dependency directory exceeds its limit");
    }
    for (id, info) in attachments {
        if id.is_empty()
            || id.len() > 64
            || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            || matches!(id.as_str(), "__proto__" | "prototype" | "constructor")
            || !info["sha256"]
                .as_str()
                .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
            || !info["size"].as_u64().is_some_and(|n| n > 0 && n <= 256 * 1024 * 1024)
            || !info["mime"].as_str().is_some_and(|s| s.encode_utf16().count() <= 255)
            || !info["fileName"]
                .as_str()
                .is_some_and(|s| s.encode_utf16().count() <= 255 && !s.chars().any(|c| c.is_control() || c == '/' || c == '\\'))
        {
            bail!("Invalid shared original metadata");
        }
    }
    for (id, version) in versions {
        uuid::Uuid::parse_str(id)?;
        drawing::validate_scene(&version["scene"])?;
        if version["revision"].as_u64().is_none()
            || !version["label"].as_str().is_some_and(|s| s.chars().count() <= 200)
            || !version["author"].is_string()
            || !version["createdAt"].as_f64().is_some_and(f64::is_finite)
        {
            bail!("Invalid shared version metadata");
        }
    }
    if !previous.is_null() {
        if previous["generation"] != incoming["generation"]
            || previous["document"]["seed"] != incoming["document"]["seed"]
            || previous["revision"].as_u64().unwrap_or(0) > incoming["revision"].as_u64().unwrap_or(0)
            || previous["dependencyRevision"].as_u64().unwrap_or(0) > incoming["dependencyRevision"].as_u64().unwrap_or(0)
            || !incoming["document"]["operations"]
                .as_array()
                .unwrap()
                .starts_with(previous["document"]["operations"].as_array().unwrap_or(&EMPTY))
        {
            bail!("conflict: shared drawing generation or immutable history changed");
        }
        for map in ["attachments", "versions"] {
            if previous[map].as_object().is_some_and(|m| m.iter().any(|(id, value)| incoming[map].get(id) != Some(value))) {
                bail!("conflict: immutable drawing dependency changed or disappeared");
            }
            if previous["dependencyRevision"] == incoming["dependencyRevision"] && previous[map] != incoming[map] {
                bail!("conflict: drawing dependency changed without a new revision");
            }
        }
    }
    Ok(())
}
fn local_document(wire: &Value, user: &str, local: &str) -> Value {
    let mut doc = wire.clone();
    if let Some(ops) = doc["operations"].as_array_mut() {
        for op in ops {
            if let Some(actor) = op["actor"].as_str() {
                op["actor"] = json!(if actor == user { local.to_string() } else { format!("remote:{actor}") });
            }
        }
    }
    doc
}
fn equivalent_operation(old: &Value, canonical: &Value, before: &Value) -> bool {
    let mut normalized = old.clone();
    normalized["base"] = canonical["base"].clone();
    if old["type"] == "edit" {
        let Some(changes) = old["changes"].as_array() else {
            return false;
        };
        let Some(next) = canonical["changes"].as_array() else {
            return false;
        };
        if changes.len() != next.len() {
            return false;
        }
        for (i, c) in changes.iter().enumerate() {
            if c["type"] == "order" && next[i]["type"] == "order" && c["list"] == next[i]["list"] {
                let old_ids = c["ids"].as_array().unwrap_or(&EMPTY);
                let expected = before[i]["ids"].as_array().unwrap_or(&EMPTY);
                let new_ids = next[i]["ids"].as_array().unwrap_or(&EMPTY);
                let map = list_map(c["list"].as_str().unwrap_or("")).unwrap_or("");
                let added = old_ids.get(expected.len()..).unwrap_or(&[]);
                if old_ids.starts_with(expected)
                    && added.iter().all(|id| changes.iter().any(|p| p["type"] == "put" && p["collection"] == map && &p["id"] == id))
                    && new_ids.ends_with(added)
                {
                    normalized["changes"][i]["ids"] = next[i]["ids"].clone();
                }
            }
        }
    }
    normalized == *canonical
}
static EMPTY: Vec<Value> = Vec::new();
fn append_pending(doc: &mut Value, op: &Value, before: &Value) -> Result<Value> {
    if let Some(flag) = op.get("requiresBase") {
        if flag.as_bool() != Some(true) || op["type"] != "edit" {
            bail!("Invalid strict drawing base");
        }
        if op["base"] != doc["revision"] {
            bail!("conflict: the drawing changed after this source was captured");
        }
    }
    if op["type"] == "edit" && !op["pixelGuard"].is_null() {
        drawing::check_pixel_guard(&doc["scene"], &op["pixelGuard"])?;
    }
    if !op["versionRestore"].is_null() && op["base"] != doc["revision"] {
        bail!("conflict: the drawing changed after the version restore preview");
    }
    let mut next = op.clone();
    next["base"] = doc["revision"].clone();
    if op["type"] == "edit" {
        let changes = op["changes"].as_array().ok_or_else(|| anyhow!("Invalid pending drawing changes"))?;
        if before.as_array().map(Vec::len) != Some(changes.len()) {
            bail!("conflict: pending drawing preconditions are missing");
        }
        for (i, c) in changes.iter().enumerate() {
            let p = &before[i];
            let matches = match c["type"].as_str() {
                Some("order") => {
                    let list = str_at(c, "list")?;
                    let map = list_map(list)?;
                    let ids = c["ids"].as_array().ok_or_else(|| anyhow!("Invalid pending order"))?;
                    let prior = p["ids"].as_array().ok_or_else(|| anyhow!("Invalid order precondition"))?;
                    let added = ids.get(prior.len()..).unwrap_or(&[]);
                    if p["type"] == "order"
                        && p["list"] == c["list"]
                        && ids.starts_with(prior)
                        && added
                            .iter()
                            .all(|id| changes.iter().any(|put| put["type"] == "put" && put["collection"] == map && &put["id"] == id))
                    {
                        let mut merged = doc["scene"][list].as_array().unwrap().clone();
                        merged.extend_from_slice(added);
                        next["changes"][i]["ids"] = json!(merged);
                        true
                    } else {
                        p["type"] == "order" && doc["scene"][list] == p["ids"]
                    }
                }
                Some("defaultFrame") => p["type"] == "defaultFrame" && doc["scene"]["defaultFrameId"] == p["id"],
                Some("put" | "patch" | "remove") => {
                    let map = str_at(c, "collection")?;
                    let id = str_at(c, "id")?;
                    let entity = doc["scene"][map].get(id);
                    if p["collection"] != c["collection"] || p["id"] != c["id"] {
                        false
                    } else if c["type"] == "put" {
                        p["type"] == "entity" && p["present"] == false && entity.is_none()
                    } else if c["type"] == "remove" {
                        p["type"] == "entity" && p["present"].as_bool() == Some(entity.is_some()) && entity.is_none_or(|v| *v == p["value"])
                    } else if let (Some(entity), Some(fields), Some(expected)) = (entity, c["fields"].as_object(), p["fields"].as_object())
                    {
                        p["type"] == "fields"
                            && fields.len() == expected.len()
                            && fields.keys().all(|k| {
                                expected.get(k).is_some_and(|e| {
                                    e["present"].as_bool() == Some(entity.get(k).is_some())
                                        && entity.get(k).is_none_or(|v| *v == e["value"])
                                })
                            })
                    } else {
                        false
                    }
                }
                _ => false,
            };
            if !matches {
                bail!("conflict: a property used by an offline drawing edit changed elsewhere");
            }
        }
        drawing::apply_changes(&mut doc["scene"], &next["changes"], false)?;
    }
    doc["operations"].as_array_mut().unwrap().push(next.clone());
    doc["revision"] = json!(doc["revision"].as_i64().unwrap() + 1);
    if op["type"] == "toggle" {
        let mut check = doc.clone();
        let mut enabled = HashMap::new();
        for p in check["operations"].as_array().unwrap() {
            if p["type"] == "edit" {
                enabled.insert(str_at(p, "id")?.to_string(), true);
            } else {
                enabled.insert(str_at(p, "target")?.to_string(), p["enabled"].as_bool().unwrap_or(true));
            }
        }
        let mut s = check["seed"].clone();
        for p in check["operations"].as_array().unwrap() {
            if p["type"] == "edit" && enabled.get(str_at(p, "id")?) == Some(&true) {
                drawing::apply_changes(&mut s, &p["changes"], true)?;
            }
        }
        check["scene"] = s;
        validate_document(&check)?;
        *doc = check;
    }
    drawing::validate_scene(&doc["scene"])?;
    Ok(next)
}
fn install(conn: &Connection, page: &str, doc: &Value) -> Result<()> {
    validate_document(doc)?;
    conn.execute("DELETE FROM drawing_operations WHERE page_id = ?1", [page])?;
    conn.execute("INSERT INTO drawing_documents(page_id,revision,seed,scene,search_text,updated_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(page_id) DO UPDATE SET revision=excluded.revision,seed=excluded.seed,scene=excluded.scene,search_text=excluded.search_text,updated_at=excluded.updated_at", params![page,doc["revision"].as_i64(),doc["seed"].to_string(),doc["scene"].to_string(),drawing::search_text(&doc["scene"]),db::now()])?;
    for op in doc["operations"].as_array().unwrap() {
        conn.execute(
            "INSERT INTO drawing_operations(page_id,id,revision,actor,payload,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                page,
                str_at(op, "id")?,
                op["base"].as_i64().unwrap() + 1,
                str_at(op, "actor")?,
                op.to_string(),
                op["at"].as_i64().unwrap_or_else(db::now)
            ],
        )?;
    }
    store::index_page(conn, page)?;
    drawing::rebuild_links(conn, page, &doc["scene"])?;
    db::mark_change(conn, Some(page), "drawing", "sync")?;
    Ok(())
}
pub fn accept(conn: &Connection, page: &str, expected_revision: i64, incoming: Value) -> Result<Value> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = accept(&tx, page, expected_revision, incoming)?;
        tx.commit()?;
        return Ok(result);
    }
    require(conn, page, Level::View)?;
    let current = snapshot(conn, page)?;
    if current["document"]["revision"].as_i64() != Some(expected_revision) {
        return Ok(json!({ "status": "retry" }));
    }
    let remote = &incoming["document"];
    validate_wire(&incoming, &current["remote"])?;
    let local_actor = str_at(&current, "localActor")?;
    let user = str_at(&current, "userId")?;
    let local = local_document(remote, user, local_actor);
    if current["remote"].is_null() {
        let basis = &current["basis"];
        let blank = basis["operations"].as_array().is_some_and(Vec::is_empty)
            && basis["scene"]["nodes"].as_object().is_some_and(|m| m.is_empty())
            && basis["scene"]["assets"].as_object().is_some_and(|m| m.is_empty())
            && basis["scene"]["steps"].as_object().is_some_and(|m| m.is_empty());
        let mut imported_basis = basis.clone();
        if let Some(ops) = imported_basis["operations"].as_array_mut() {
            for op in ops {
                if let Some(actor) = op["actor"].as_str() {
                    if actor != local_actor {
                        op["actor"] = json!(format!("remote:imported:{actor}"));
                    }
                }
            }
        }
        let prefix = basis["seed"] == local["seed"]
            && local["operations"].as_array().unwrap().starts_with(imported_basis["operations"].as_array().unwrap_or(&EMPTY));
        if !blank && !prefix {
            conn.execute("UPDATE drawing_sync_state SET incoming=?2,status='conflict',last_error='Local drawing differs from the shared drawing; create a recovery copy first' WHERE page_id=?1",params![page,incoming.to_string()])?;
            return Ok(json!({ "status": "conflict" }));
        }
    }
    // Download and integrity verification happen before this transaction. Refuse
    // an alias owned by a different local page, even if its identifier matches.
    let mut originals = HashSet::new();
    original_ids(remote, &mut originals);
    original_ids(&incoming["versions"], &mut originals);
    for id in originals {
        let a = store::get_attachment(conn, &id)?.ok_or_else(|| anyhow!("Missing shared drawing original"))?;
        if a.page_id.as_deref() != Some(page) {
            bail!("Shared original identifier belongs to another local page");
        }
        let verified: Option<(String, i64)> = conn
            .query_row("SELECT sha256,size FROM drawing_sync_originals WHERE attachment_id=?1 AND page_id=?2", params![id, page], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        if !verified.is_some_and(|(hash, size)| {
            incoming["attachments"][&id]["sha256"] == hash && incoming["attachments"][&id]["size"].as_i64() == Some(size)
        }) {
            bail!("Verify the original checksum before accepting its shared reference");
        }
    }
    let mut projected = local;
    let mut rewritten = Vec::new();
    let mut acknowledged = Vec::new();
    for p in current["pending"].as_array().unwrap() {
        let op = &p["operation"];
        let id = str_at(op, "id")?;
        if let Some(canonical) = projected["operations"].as_array().unwrap().iter().find(|v| v["id"] == op["id"]) {
            if canonical["actor"] != local_actor || !equivalent_operation(op, canonical, &p["preconditions"]) {
                bail!("conflict: pending operation identifier belongs to a different shared edit");
            }
            acknowledged.push(id.to_string());
            continue;
        }
        let before = preconditions(&projected["scene"], op)?;
        match append_pending(&mut projected, op, &p["preconditions"]) {
            Ok(next) => rewritten.push((id.to_string(), next, before)),
            Err(error) => {
                conn.execute(
                    "UPDATE drawing_sync_state SET incoming=?2,status='conflict',last_error=?3 WHERE page_id=?1",
                    params![page, incoming.to_string(), error.to_string()],
                )?;
                return Ok(json!({ "status": "conflict" }));
            }
        }
    }
    for (id, version) in incoming["versions"].as_object().ok_or_else(|| anyhow!("Invalid shared versions"))? {
        uuid::Uuid::parse_str(id)?;
        drawing::validate_scene(&version["scene"])?;
        let existing: Option<(String, String)> =
            conn.query_row("SELECT page_id,scene FROM drawing_versions WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        if let Some((owner, scene)) = existing {
            if owner != page || serde_json::from_str::<Value>(&scene)? != version["scene"] {
                bail!("Shared version identifier was reused");
            }
        } else {
            conn.execute(
                "INSERT INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    id,
                    page,
                    version["revision"].as_i64().unwrap_or(0),
                    version["label"].as_str().unwrap_or("Version"),
                    version["author"].as_str().unwrap_or("remote"),
                    version["scene"].to_string(),
                    version["createdAt"].as_i64().unwrap_or_else(db::now)
                ],
            )?;
        }
    }
    crate::drawing_library::install_sync_versions(conn, page, &incoming["versions"])?;
    install(conn, page, &projected)?;
    for id in acknowledged {
        conn.execute("DELETE FROM drawing_sync_outbox WHERE page_id=?1 AND operation_id=?2", params![page, id])?;
    }
    for (id, op, before) in rewritten {
        conn.execute(
            "UPDATE drawing_sync_outbox SET payload=?3,preconditions=?4 WHERE page_id=?1 AND operation_id=?2",
            params![page, id, op.to_string(), before.to_string()],
        )?;
    }
    let remains: i64 = conn.query_row("SELECT COUNT(*) FROM drawing_sync_outbox WHERE page_id=?1", [page], |r| r.get(0))?;
    conn.execute(
        "UPDATE drawing_sync_state SET remote=?2,incoming=NULL,status=?3,last_error=NULL,updated_at=?4 WHERE page_id=?1",
        params![page, incoming.to_string(), if remains == 0 { "synced" } else { "pending" }, db::now()],
    )?;
    Ok(json!({ "status": "accepted", "document": projected }))
}
pub fn recover(
    conn: &Connection,
    page: &str,
    expected_revision: i64,
    recovery_id: &str,
    renderer: Value,
    record: Value,
    incoming: Value,
    title: &str,
) -> Result<Value> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = recover(&tx, page, expected_revision, recovery_id, renderer, record, incoming, title)?;
        tx.commit()?;
        return Ok(result);
    }
    require(conn, page, Level::View)?;
    check_bound_identity(conn, page)?;
    uuid::Uuid::parse_str(recovery_id)?;
    if title.trim().is_empty()
        || title.chars().count() > 200
        || renderer.to_string().len() > 64 * 1024 * 1024
        || record.to_string().len() > 64 * 1024 * 1024
    {
        bail!("Invalid drawing recovery input");
    }
    validate_document(&renderer)?;
    validate_document(&record["acknowledged"])?;
    let mut history = record["acknowledged"]["operations"].as_array().unwrap().clone();
    history.extend(record["pending"].as_array().ok_or_else(|| anyhow!("Missing renderer recovery queue"))?.iter().cloned());
    if renderer["seed"] != record["acknowledged"]["seed"] || renderer["operations"] != json!(history) {
        bail!("Renderer recovery document does not match its durable queue");
    }
    // A committed copy survives an IPC response loss. The same nonce can only
    // acknowledge the same renderer document, never archive different artwork.
    let previous: Option<(String, String)> = conn
        .query_row("SELECT page_id,document FROM drawing_sync_recoveries WHERE id=?1", [recovery_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    if let Some((source, raw)) = previous {
        let archived: Value = serde_json::from_str(&raw)?;
        if source != page || archived["renderer"] != renderer {
            bail!("Recovery identifier belongs to a different drawing copy");
        }
        let copy: String = conn.query_row(
            "SELECT id FROM pages WHERE deleted_at IS NULL AND json_extract(metadata,'$.drawingRecovery.id')=?1",
            [recovery_id],
            |r| r.get(0),
        )?;
        require(conn, &copy, Level::View)?;
        return Ok(json!({"copy": store::page_meta_by_id(conn, &copy)?, "document": drawing::load(conn, page)?}));
    }
    let current = snapshot(conn, page)?;
    if current["document"]["revision"].as_i64() != Some(expected_revision) {
        bail!("conflict: drawing changed during recovery; retry without discarding your copy");
    }
    validate_document(&incoming["document"])?;
    let copy = store::create_page(
        conn,
        &store::Ctx::user(),
        store::NewPage {
            title: Some(title.trim().into()),
            kind: Some("drawing".into()),
            icon: Some("pi:paintbrush".into()),
            metadata: Some(json!({"drawingRecovery":{"id":recovery_id,"sourceId":page,"createdAt":db::now()},"sync":{"shared":false}})),
            ..Default::default()
        },
    )?;
    // Recovery artwork stays on this computer, including while a Team is active.
    conn.execute("UPDATE pages SET workspace_id=NULL WHERE id=?1", [&copy.id])?;
    let mut scene = drawing::materialize_scene_dependencies(conn, page, &copy.id, renderer["scene"].clone())?;
    for map in ["nodes", "layers", "frames", "steps"] {
        if let Some(entities) = scene[map].as_object_mut() {
            for entity in entities.values_mut() {
                if let Some(fields) = entity.as_object_mut() {
                    fields.retain(|key, _| !key.starts_with("library"));
                }
            }
        }
    }
    install(conn, &copy.id, &json!({"revision":0,"seed":scene,"scene":scene,"operations":[]}))?;
    {
        let native_scene = drawing::materialize_scene_dependencies(conn, page, &copy.id, current["document"]["scene"].clone())?;
        conn.execute("INSERT INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES (?1,?2,?3,'Native state before recovery',?4,?5,?6)", params![db::new_id(),copy.id,current["document"]["revision"].as_i64().unwrap_or(0),store::profile(conn)?.id,native_scene.to_string(),db::now()])?;
    }
    conn.execute("INSERT INTO drawing_sync_recoveries(id,page_id,document,pending,reason,created_at) VALUES (?1,?2,?3,?4,'Preserved local copy before adopting shared changes',?5)", params![recovery_id,page,json!({"native":current["document"],"renderer":renderer,"incoming":incoming}).to_string(),json!({"native":current["pending"],"renderer":record}).to_string(),db::now()])?;
    conn.execute("DELETE FROM drawing_sync_outbox WHERE page_id=?1", [page])?;
    if current["remote"].is_null() {
        let seed = &incoming["document"]["seed"];
        conn.execute(
            "UPDATE drawing_sync_state SET basis=?2 WHERE page_id=?1",
            params![page, json!({"revision":0,"seed":seed,"scene":seed,"operations":[]}).to_string()],
        )?;
    }
    let accepted = accept(conn, page, expected_revision, incoming)?;
    if accepted["status"] != "accepted" {
        bail!("Shared checkpoint could not be adopted; recovery transaction was rolled back");
    }
    db::mark_change(conn, Some(&copy.id), "page", "ui")?;
    Ok(json!({"copy":store::page_meta_by_id(conn,&copy.id)?,"document":accepted["document"]}))
}
pub fn set_error(conn: &Connection, page: &str, status: &str, error: &str) -> Result<()> {
    if !["offline", "conflict", "denied", "pending", "synced"].contains(&status) {
        bail!("Invalid drawing sync state");
    }
    conn.execute(
        "UPDATE drawing_sync_state SET status=?2,last_error=?3,updated_at=?4 WHERE page_id=?1",
        params![page, status, error, db::now()],
    )?;
    Ok(())
}
pub fn store_original(
    conn: &Connection,
    page: &str,
    id: &str,
    name: &str,
    mime: &str,
    sha: &str,
    bytes: &[u8],
) -> Result<store::Attachment> {
    store_original_in(conn, &db::attachments_dir(), page, id, name, mime, sha, bytes)
}
fn store_original_in(
    conn: &Connection,
    dir: &std::path::Path,
    page: &str,
    id: &str,
    name: &str,
    mime: &str,
    sha: &str,
    bytes: &[u8],
) -> Result<store::Attachment> {
    require(conn, page, Level::View)?;
    check_bound_identity(conn, page)?;
    let hash = format!("{:x}", Sha256::digest(bytes));
    if hash != sha {
        bail!("Shared drawing original checksum does not match");
    }
    if let Some(a) = store::get_attachment(conn, id)? {
        if a.page_id.as_deref() != Some(page) || a.size != bytes.len() as i64 {
            bail!("Original identifier belongs to another page or content");
        }
        let local = std::fs::read(dir.join(&a.rel_path))?;
        if format!("{:x}", Sha256::digest(local)) != sha {
            bail!("Stored original identifier has different content");
        }
        conn.execute("INSERT INTO drawing_sync_originals(attachment_id,page_id,sha256,size,verified_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(attachment_id) DO UPDATE SET sha256=excluded.sha256,size=excluded.size,verified_at=excluded.verified_at",params![id,page,sha,bytes.len() as i64,db::now()])?;
        return Ok(a);
    }
    let a = crate::sync::store_attachment_in(conn, dir, id, Some(page), name, mime, bytes)?;
    conn.execute(
        "INSERT INTO drawing_sync_originals(attachment_id,page_id,sha256,size,verified_at) VALUES (?1,?2,?3,?4,?5)",
        params![id, page, sha, bytes.len() as i64, db::now()],
    )?;
    Ok(a)
}
#[tauri::command]
pub async fn drawing_sync_recover(
    state: State<'_, AppState>,
    page_id: String,
    expected_revision: i64,
    recovery_id: String,
    document: Value,
    record: Value,
    remote: Value,
    title: String,
) -> Result<Value, String> {
    recover(&state.conn(), &page_id, expected_revision, &recovery_id, document, record, remote, &title).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_sync_pending_pages(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    pending_pages(&state.conn()).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_sync_open(
    state: State<'_, AppState>,
    page_id: String,
    server_url: String,
    workspace_id: String,
    user_id: String,
) -> Result<Value, String> {
    open(&state.conn(), &page_id, &server_url, &workspace_id, &user_id).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_sync_snapshot(state: State<'_, AppState>, page_id: String) -> Result<Value, String> {
    snapshot(&state.conn(), &page_id).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_sync_accept(
    state: State<'_, AppState>,
    page_id: String,
    expected_revision: i64,
    remote: Value,
) -> Result<Value, String> {
    accept(&state.conn(), &page_id, expected_revision, remote).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_sync_error(state: State<'_, AppState>, page_id: String, status: String, error: String) -> Result<(), String> {
    set_error(&state.conn(), &page_id, &status, &error).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_sync_store_original(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<store::Attachment, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Expected original bytes".into()) };
    let header = |key: &str| {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .map(|s| percent_encoding::percent_decode_str(s).decode_utf8_lossy().to_string())
            .unwrap_or_default()
    };
    store_original(
        &state.conn(),
        &header("x-worlds-page"),
        &header("x-worlds-id"),
        &header("x-worlds-name"),
        &header("x-worlds-mime"),
        &header("x-worlds-sha256"),
        bytes,
    )
    .map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_source_edit_never_rebases_over_foreign_optional_fields() {
        let scene = drawing::initial_scene("strict-source");
        let layer = scene["layerOrder"][0].as_str().unwrap();
        let mut doc = json!({"revision":0,"seed":scene,"scene":scene,"operations":[]});
        let mut captured = op("alice", 0, "captured", json!([]));
        captured["requiresBase"] = json!(true);
        let before = preconditions(&scene, &captured).unwrap();
        assert!(append_pending(&mut doc.clone(), &captured, &before).is_ok());
        append(&mut doc, op("bob", 0, "foreign", json!([{"type":"patch","collection":"layers","id":layer,"fields":{"alphaLocked":true}}])));
        let original = doc.clone();
        assert!(append_pending(&mut doc, &captured, &before).unwrap_err().to_string().contains("source was captured"));
        assert_eq!(doc, original);
        captured["requiresBase"] = json!(false);
        assert!(append_pending(&mut doc, &captured, &before).is_err());
    }
    #[test]
    fn nested_pixel_receipts_require_unchanged_ancestor_metadata() {
        let mut scene = drawing::initial_scene("nested-pixels");
        let frame = scene["defaultFrameId"].as_str().unwrap().to_owned();
        let child = scene["layerOrder"][0].as_str().unwrap().to_owned();
        let mut parent = scene["layers"][&child].clone();
        parent["id"] = json!("group");
        scene["layers"]["group"] = parent.clone();
        scene["layers"][&child]["parentId"] = json!("group");
        scene["layerOrder"] = json!(["group", child]);
        let guard = json!({"frameId":frame,"layerId":child,"source":"current","expected":{"frame":scene["frames"][&frame],"layers":[scene["layers"][&child]],"ancestors":[parent],"nodes":[],"targets":{},"masks":{},"assets":{}}});
        drawing::check_pixel_guard(&scene, &guard).unwrap();
        let mut legacy = guard.clone();
        legacy["expected"].as_object_mut().unwrap().remove("ancestors");
        assert!(drawing::check_pixel_guard(&scene, &legacy).is_err());
        scene["layers"]["group"]["opacity"] = json!(0.5);
        assert!(drawing::check_pixel_guard(&scene, &guard).is_err());
    }
    #[test]
    fn pending_pixel_source_guard_refuses_new_source_nodes_and_accepts_other_layers() {
        let scene = drawing::initial_scene("pixels");
        let frame = scene["defaultFrameId"].as_str().unwrap();
        let layer = scene["layerOrder"][0].as_str().unwrap();
        let mut guarded = op("alice", 0, "guarded", json!([]));
        guarded["pixelGuard"] = json!({"frameId":frame,"layerId":layer,"source":"current","expected":{"frame":scene["frames"][frame],"layers":[scene["layers"][layer]],"nodes":[],"targets":{},"masks":{},"assets":{}}});
        guarded["pixelGuard"]["expected"]["layers"][0]["opacity"] = json!(1);
        drawing::check_pixel_guard(&scene, &guarded["pixelGuard"]).unwrap();
        let before = preconditions(&scene, &guarded).unwrap();
        let mut doc = json!({"revision":0,"seed":scene,"scene":scene,"operations":[]});
        let mut independent = scene["layers"][layer].clone();
        independent["id"] = json!("other");
        append(
            &mut doc,
            op(
                "bob",
                0,
                "other-layer",
                json!([{"type":"put","collection":"layers","id":"other","value":independent},{"type":"order","list":"layerOrder","ids":[layer,"other"]}]),
            ),
        );
        assert!(append_pending(&mut doc.clone(), &guarded, &before).is_ok());
        let node = shape(&scene, "new-source");
        append(
            &mut doc,
            op(
                "bob",
                1,
                "source",
                json!([{"type":"put","collection":"nodes","id":"new-source","value":node},{"type":"order","list":"nodeOrder","ids":["new-source"]}]),
            ),
        );
        let prior = doc.clone();
        assert!(append_pending(&mut doc, &guarded, &before).unwrap_err().to_string().contains("sampled pixel source changed"));
        assert_eq!(doc, prior);
    }
    #[test]
    fn pending_restore_cannot_be_rebased_over_even_an_independent_change() {
        let scene = drawing::initial_scene("restore");
        let layer = scene["layerOrder"][0].as_str().unwrap();
        let mut doc = json!({"revision":0,"seed":scene,"scene":scene,"operations":[]});
        let mut restore =
            op("alice", 0, "restore", json!([{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Restored"}}]));
        restore["versionRestore"] = json!({"versionId":"saved","expectedRevision":0,"backupId":"restore"});
        let before = preconditions(&doc["scene"], &restore).unwrap();
        append(&mut doc, op("bob", 0, "opacity", json!([{"type":"patch","collection":"layers","id":layer,"fields":{"opacity":0.4}}])));
        let current = doc.clone();
        assert!(append_pending(&mut doc, &restore, &before).unwrap_err().to_string().contains("after the version restore preview"));
        assert_eq!(doc, current);
    }
    fn shape(scene: &Value, id: &str) -> Value {
        json!({"id":id,"kind":"shape","shape":"rect","name":id,"layerId":scene["layerOrder"][0],"frameId":scene["defaultFrameId"],"groupId":null,"visible":true,"locked":false,"rotation":0,"opacity":1,"flipX":false,"flipY":false,"x":0,"y":0,"w":100,"h":100,"paint":{"fill":"transparent","stroke":"#202023","strokeWidth":3,"dash":[],"cap":"round","radius":16},"textStyle":{"font":"IBM Plex Sans Arabic","size":28,"weight":400,"italic":false,"align":"start","direction":"auto","leading":1.7,"background":"transparent","color":"#202023","border":"transparent"},"effects":[]})
    }
    fn op(actor: &str, base: i64, id: &str, changes: Value) -> Value {
        json!({"id":id,"actor":actor,"base":base,"at":1,"label":id,"type":"edit","changes":changes})
    }
    fn append(doc: &mut Value, op: Value) {
        drawing::apply_changes(&mut doc["scene"], &op["changes"], false).unwrap();
        doc["revision"] = json!(doc["revision"].as_i64().unwrap() + 1);
        doc["operations"].as_array_mut().unwrap().push(op);
        validate_document(doc).unwrap();
    }
    fn wire(doc: &Value, generation: &str) -> Value {
        json!({"generation":generation,"revision":doc["revision"],"dependencyRevision":0,"document":doc,"attachments":{},"versions":{}})
    }
    #[test]
    fn native_wire_validation_rejects_replaced_seed_and_immutable_dependency_changes() {
        let scene = drawing::initial_scene("test");
        let doc = json!({"seed":scene,"scene":scene,"revision":0,"operations":[]});
        let generation = uuid::Uuid::new_v4().to_string();
        let initial = wire(&doc, &generation);
        validate_wire(&initial, &Value::Null).unwrap();
        let mut changed = initial.clone();
        changed["document"]["seed"]["layers"]["test-layer"]["name"] = json!("Changed");
        changed["document"]["scene"] = changed["document"]["seed"].clone();
        assert!(validate_wire(&changed, &initial).unwrap_err().to_string().contains("immutable history"));
        let mut with_original = initial.clone();
        with_original["dependencyRevision"] = json!(1);
        with_original["attachments"]["original"] = json!({"sha256":"a".repeat(64),"size":3,"mime":"image/png","fileName":"صورة.png"});
        validate_wire(&with_original, &initial).unwrap();
        let mut removed = with_original.clone();
        removed["dependencyRevision"] = json!(2);
        removed["attachments"] = json!({});
        assert!(validate_wire(&removed, &with_original).is_err());
        let mut unversioned = with_original.clone();
        unversioned["dependencyRevision"] = json!(0);
        assert!(validate_wire(&unversioned, &initial).is_err());
    }
    #[test]
    fn recovery_atomically_preserves_renderer_only_artwork_and_is_idempotent_after_a_lost_reply() {
        let dir = std::env::temp_dir().join(format!("worlds-drawing-recovery-{}", db::new_id()));
        let conn = db::open(&dir.join("worlds.db")).unwrap();
        let actor = store::profile(&conn).unwrap().id;
        let page = store::create_page(
            &conn,
            &store::Ctx::user(),
            store::NewPage { kind: Some("drawing".into()), metadata: Some(json!({"sync":{"shared":true}})), ..Default::default() },
        )
        .unwrap();
        let initial = open(&conn, &page.id, "https://sync.test", "workspace", "alice").unwrap()["document"].clone();
        let mut remote = initial.clone();
        let generation = uuid::Uuid::new_v4().to_string();
        let create = op(
            &actor,
            0,
            "create",
            json!([{"type":"put","collection":"nodes","id":"shape","value":shape(&initial["scene"],"shape")},{"type":"order","list":"nodeOrder","ids":["shape"]}]),
        );
        drawing::apply(&conn, &store::Ctx::user(), &page.id, create.clone()).unwrap();
        let mut shared = create;
        shared["actor"] = json!("alice");
        append(&mut remote, shared);
        accept(&conn, &page.id, 1, wire(&remote, &generation)).unwrap();
        drawing::apply(
            &conn,
            &store::Ctx::user(),
            &page.id,
            op(&actor, 1, "local-x", json!([{"type":"patch","collection":"nodes","id":"shape","fields":{"x":60}}])),
        )
        .unwrap();
        let acknowledged = drawing::load(&conn, &page.id).unwrap();
        let mut renderer = acknowledged.clone();
        conn.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES ('original',?1,'image','photo.png','image/png',3,'immutable.png',1)",[&page.id]).unwrap();
        let mut image = shape(&initial["scene"], "unsent-image");
        image["kind"] = json!("image");
        image["assetId"] = json!("a");
        let unsent = op(
            &actor,
            2,
            "renderer-only",
            json!([{"type":"put","collection":"assets","id":"a","value":{"id":"a","attachmentId":"original","name":"photo.png","mime":"image/png","width":1,"height":1}},{"type":"put","collection":"nodes","id":"unsent-image","value":image},{"type":"order","list":"nodeOrder","ids":["shape","unsent-image"]}]),
        );
        append(&mut renderer, unsent.clone());
        let record = json!({"acknowledged":acknowledged,"pending":[unsent]});
        append(&mut remote, op("bob", 1, "remote-x", json!([{"type":"patch","collection":"nodes","id":"shape","fields":{"x":99}}])));
        let incoming = wire(&remote, &generation);
        assert_eq!(accept(&conn, &page.id, 2, incoming.clone()).unwrap()["status"], "conflict");
        let id = uuid::Uuid::new_v4().to_string();
        assert!(recover(&conn, &page.id, 1, &id, renderer.clone(), record.clone(), incoming.clone(), "نسختي").is_err());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        // A wrong generation fails after the copy has been prepared. The whole
        // transaction, including its originals and removed outbox, must roll back.
        let mut wrong = incoming.clone();
        wrong["generation"] = json!(uuid::Uuid::new_v4().to_string());
        assert!(recover(&conn, &page.id, 2, &id, renderer.clone(), record.clone(), wrong, "نسختي").is_err());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(snapshot(&conn, &page.id).unwrap()["pending"].as_array().unwrap().len(), 1);
        let recovered = recover(&conn, &page.id, 2, &id, renderer.clone(), record.clone(), incoming.clone(), "نسختي").unwrap();
        let copy = recovered["copy"]["id"].as_str().unwrap().to_string();
        assert_eq!(drawing::load(&conn, &copy).unwrap()["scene"]["nodes"]["shape"]["x"], 60);
        assert!(drawing::load(&conn, &copy).unwrap()["scene"]["nodes"].get("unsent-image").is_some());
        assert_ne!(drawing::load(&conn, &copy).unwrap()["scene"]["assets"]["a"]["attachmentId"], "original");
        assert!(!crate::sync::page_mode(&conn, &copy).unwrap().shared);
        assert_eq!(drawing::versions(&conn, &copy).unwrap().as_array().unwrap().len(), 1);
        assert_eq!(recovered["document"]["scene"]["nodes"]["shape"]["x"], 99);
        assert!(snapshot(&conn, &page.id).unwrap()["pending"].as_array().unwrap().is_empty());
        assert_eq!(
            recover(&conn, &page.id, 2, &id, renderer.clone(), record.clone(), incoming.clone(), "retry").unwrap()["copy"]["id"],
            copy
        );
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM drawing_sync_recoveries", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        conn.execute("INSERT INTO account(id,user_id,email,device_id,server_url,signed_in_at) VALUES (1,'alice','test@example.invalid','device','https://identity.test',0)",[]).unwrap();
        conn.execute(
            "INSERT INTO account_workspaces(id,name,role,default_level,synced_at) VALUES ('workspace','Team','guest','none',0)",
            [],
        )
        .unwrap();
        conn.execute("UPDATE pages SET workspace_id='workspace' WHERE id=?1", [&page.id]).unwrap();
        assert!(recover(&conn, &page.id, 2, &id, renderer, record, incoming, "Denied retry")
            .unwrap_err()
            .to_string()
            .contains("Permission denied"));
        drop(conn);
        let conn = db::open(&dir.join("worlds.db")).unwrap();
        assert!(drawing::load(&conn, &copy).is_ok());
        drop(conn);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn durable_replica_merges_independent_authors_and_retains_conflicting_offline_edits() {
        let dir = std::env::temp_dir().join(format!("worlds-drawing-replica-{}", db::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("worlds.db");
        let conn = db::open(&path).unwrap();
        let actor = store::profile(&conn).unwrap().id;
        let page = store::create_page(
            &conn,
            &store::Ctx::user(),
            store::NewPage { kind: Some("drawing".into()), metadata: Some(json!({"sync":{"shared":true}})), ..Default::default() },
        )
        .unwrap();
        let first = open(&conn, &page.id, "https://sync.test", "workspace", "alice").unwrap();
        assert_eq!(pending_pages(&conn).unwrap(), vec![page.id.clone()]);
        let seed = first["document"].clone();
        let mut remote = seed.clone();
        let generation = uuid::Uuid::new_v4().to_string();
        let a = shape(&seed["scene"], "alice-node");
        let b = shape(&seed["scene"], "bob-node");
        let create = op(
            &actor,
            0,
            "alice-op",
            json!([{"type":"put","collection":"nodes","id":"alice-node","value":a},{"type":"order","list":"nodeOrder","ids":["alice-node"]}]),
        );
        drawing::apply(&conn, &store::Ctx::user(), &page.id, create).unwrap();
        append(
            &mut remote,
            op(
                "bob",
                0,
                "bob-op",
                json!([{"type":"put","collection":"nodes","id":"bob-node","value":b},{"type":"order","list":"nodeOrder","ids":["bob-node"]}]),
            ),
        );
        assert_eq!(accept(&conn, &page.id, 1, wire(&remote, &generation)).unwrap()["status"], "accepted");
        drop(conn);
        let conn = db::open(&path).unwrap();
        let stored = snapshot(&conn, &page.id).unwrap();
        assert_eq!(stored["pending"].as_array().unwrap().len(), 1);
        assert_eq!(stored["pending"][0]["operation"]["base"], 1);
        assert_eq!(stored["document"]["scene"]["nodeOrder"], json!(["bob-node", "alice-node"]));
        let mut accepted = stored["pending"][0]["operation"].clone();
        accepted["actor"] = json!("alice");
        append(&mut remote, accepted);
        assert_eq!(accept(&conn, &page.id, 2, wire(&remote, &generation)).unwrap()["status"], "accepted");
        assert!(snapshot(&conn, &page.id).unwrap()["pending"].as_array().unwrap().is_empty());
        assert!(pending_pages(&conn).unwrap().is_empty());
        drawing::apply(
            &conn,
            &store::Ctx::user(),
            &page.id,
            op(&actor, 2, "local-move", json!([{"type":"patch","collection":"nodes","id":"alice-node","fields":{"x":60}}])),
        )
        .unwrap();
        append(&mut remote, op("bob", 2, "other-move", json!([{"type":"patch","collection":"nodes","id":"bob-node","fields":{"x":90}}])));
        assert_eq!(accept(&conn, &page.id, 3, wire(&remote, &generation)).unwrap()["status"], "accepted");
        assert_eq!(snapshot(&conn, &page.id).unwrap()["document"]["scene"]["nodes"]["bob-node"]["x"], 90);
        append(
            &mut remote,
            op("bob", 3, "conflicting-move", json!([{"type":"patch","collection":"nodes","id":"alice-node","fields":{"x":99}}])),
        );
        assert_eq!(accept(&conn, &page.id, 4, wire(&remote, &generation)).unwrap()["status"], "conflict");
        let kept = snapshot(&conn, &page.id).unwrap();
        assert_eq!(kept["document"]["scene"]["nodes"]["alice-node"]["x"], 60);
        assert_eq!(kept["pending"][0]["operation"]["id"], "local-move");
        assert_eq!(accept(&conn, &page.id, 1, wire(&remote, &generation)).unwrap()["status"], "retry");
        crate::sync::set_shared(&conn, &page.id, false).unwrap();
        assert!(snapshot(&conn, &page.id).unwrap_err().to_string().contains("sharing mode"));
        assert!(pending_pages(&conn).unwrap().is_empty());
        crate::sync::set_shared(&conn, &page.id, true).unwrap();
        assert_eq!(pending_pages(&conn).unwrap(), vec![page.id.clone()]);
        conn.execute("INSERT INTO account(id,user_id,email,device_id,server_url,signed_in_at) VALUES (1,'other-account','test@example.invalid','test-device','https://identity.test',0)", []).unwrap();
        assert!(drawing::load(&conn, &page.id).unwrap_err().to_string().contains("another signed-in account"));
        assert!(snapshot(&conn, &page.id).is_err());
        assert!(pending_pages(&conn).unwrap().is_empty());
        conn.execute("DELETE FROM account", []).unwrap();
        assert_eq!(snapshot(&conn, &page.id).unwrap()["pending"][0]["operation"]["id"], "local-move");
        drop(conn);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn original_checksums_and_local_page_ownership_are_independent_of_remote_identifiers() {
        let dir = std::env::temp_dir().join(format!("worlds-drawing-original-{}", db::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = db::open(&dir.join("worlds.db")).unwrap();
        let a =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let b =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let bytes = b"owned bytes";
        let hash = format!("{:x}", Sha256::digest(bytes));
        assert!(store_original_in(&conn, &dir, &a.id, "original", "original.bin", "application/octet-stream", "wrong", bytes).is_err());
        store_original_in(&conn, &dir, &a.id, "original", "original.bin", "application/octet-stream", &hash, bytes).unwrap();
        assert!(store_original_in(&conn, &dir, &b.id, "original", "original.bin", "application/octet-stream", &hash, bytes).is_err());
        store_original_in(&conn, &dir, &a.id, "original", "original.bin", "application/octet-stream", &hash, bytes).unwrap();
        drop(conn);
        let _ = std::fs::remove_dir_all(dir);
    }
}
