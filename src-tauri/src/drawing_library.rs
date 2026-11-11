//! Published reusable drawings. Each item inherits ordinary page rights and owns
//! its originals. A publication never mutates an already inserted copy.
use crate::account::permissions::{page_level, require, Level};
use crate::{db, drawing, store, AppState};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Publish {
    pub source_id: String,
    pub item_id: Option<String>,
    pub expected_version: Option<i64>,
    pub name: String,
    pub kind: String,
    pub scope: String,
    pub tags: Vec<String>,
    pub scene: Value,
    pub payload: Value,
}
fn validate(input: &Publish) -> Result<()> {
    if input.name.trim().is_empty()
        || input.name.chars().count() > 160
        || input.tags.len() > 24
        || input.tags.iter().any(|s| s.chars().count() > 64)
    {
        bail!("Invalid library name or tags");
    }
    if !matches!(input.kind.as_str(), "brush" | "palette" | "elements" | "style" | "frame" | "template" | "signature")
        || !matches!(input.scope.as_str(), "personal" | "workspace")
    {
        bail!("Invalid library category or scope");
    }
    drawing::validate_scene(&input.scene)?;
    if !input.payload.is_object() || input.payload.to_string().len() > 65536 {
        bail!("Invalid library settings");
    }
    if input.kind == "brush" {
        let brush = &input.payload["brush"];
        let range = |key: &str, min: f64, max: f64| brush[key].as_f64().is_some_and(|n| n.is_finite() && (min..=max).contains(&n));
        if ![
            "hard",
            "soft",
            "pencil",
            "ink",
            "marker",
            "highlighter",
            "spray",
            "texture",
            "calligraphy",
            "oil",
            "crayon",
            "natural-pencil",
            "watercolor",
        ]
        .contains(&brush["kind"].as_str().unwrap_or(""))
            || !range("size", 1.0, 2048.0)
            || !range("spacing", 0.01, 2.0)
            || !range("opacity", 0.0, 1.0)
            || !range("flow", 0.0, 1.0)
            || !range("hardness", 0.0, 1.0)
            || !range("roundness", 0.01, 1.0)
            || !range("angle", -360.0, 360.0)
            || !range("smoothing", 0.0, 1.0)
            || !range("stabilizer", 0.0, 200.0)
            || !range("taperStart", 0.0, 1.0)
            || !range("taperEnd", 0.0, 1.0)
            || !range("pressureCurve", 0.1, 4.0)
            || !brush["color"].as_str().is_some_and(color)
            || ["pressureSize", "pressureOpacity", "pressureFlow"].iter().any(|k| !brush[k].is_boolean())
        {
            bail!("Invalid library brush");
        }
        if let Some(tip) = brush["tipAssetId"].as_str() {
            if input.scene["assets"].get(tip).is_none() {
                bail!("Missing brush tip original");
            }
        }
    }
    if input.kind == "palette" {
        let colors = input.payload["colors"].as_array().ok_or_else(|| anyhow!("Missing palette colors"))?;
        if colors.is_empty() || colors.len() > 256 || colors.iter().any(|c| !c.as_str().is_some_and(color)) {
            bail!("Invalid palette colors");
        }
    }
    if input.kind == "style" {
        let style = &input.payload["style"];
        if !style.as_object().is_some_and(|m| m.len() == 2 && m.contains_key("paint") && m.contains_key("textStyle")) {
            bail!("Invalid library style fields");
        }
        let prototype =
            input.scene["nodes"].as_object().unwrap().values().next().ok_or_else(|| anyhow!("Select an element to save its style"))?;
        if style["paint"] != prototype["paint"] || style["textStyle"] != prototype["textStyle"] {
            bail!("Style must match its preview element");
        }
    }
    Ok(())
}
fn color(s: &str) -> bool {
    (s.len() == 7 || s.len() == 9) && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
}
fn strip_publication(mut scene: Value) -> Value {
    if let Some(map) = scene.as_object_mut() {
        map.remove("libraryPublication");
    }
    scene
}
fn publication_input(scene: &Value) -> Result<Publish> {
    let p = &scene["libraryPublication"];
    let allowed = ["schema", "itemId", "version", "name", "kind", "tags", "sourceId", "payload", "createdAt"];
    let id = |v: &Value| {
        v.as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 160 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'))
    };
    if p["schema"] != 1
        || !p.as_object().is_some_and(|m| m.len() == allowed.len() && m.keys().all(|k| allowed.contains(&k.as_str())))
        || !id(&p["itemId"])
        || !p["version"].as_i64().is_some_and(|v| (1..=500).contains(&v))
        || !p["createdAt"].as_i64().is_some_and(|v| v >= 0)
        || (!p["sourceId"].is_null() && !id(&p["sourceId"]))
    {
        bail!("Invalid published library metadata");
    }
    Ok(Publish {
        source_id: p["sourceId"].as_str().unwrap_or("missing-source").into(),
        item_id: None,
        expected_version: None,
        name: p["name"].as_str().ok_or_else(|| anyhow!("Invalid publication name"))?.into(),
        kind: p["kind"].as_str().ok_or_else(|| anyhow!("Invalid publication kind"))?.into(),
        scope: "personal".into(),
        tags: serde_json::from_value(p["tags"].clone())?,
        scene: strip_publication(scene.clone()),
        payload: p["payload"].clone(),
    })
}
/// Validation is descriptive only. It never grants ownership, workspace or page
/// access. The nested scene probe excludes the descriptor to avoid recursion.
pub fn validate_scene_publication(scene: &Value) -> Result<()> {
    validate(&publication_input(scene)?)?;
    Ok(())
}
fn descriptor(item: &str, version: i64, name: &str, kind: &str, tags: &Value, source: Option<&str>, payload: &Value, at: i64) -> Value {
    json!({"schema":1,"itemId":item,"version":version,"name":name,"kind":kind,"tags":tags,"sourceId":source,"payload":payload,"createdAt":at})
}
/// Upgrade unpublished wire metadata by creating new immutable saved versions.
/// Existing snapshot identifiers and already inserted copies remain untouched.
pub fn prepare_sync_versions(conn: &Connection, page: &str) -> Result<()> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        prepare_sync_versions(&tx, page)?;
        tx.commit()?;
        return Ok(());
    }
    if let Some(account) =
        conn.query_row("SELECT user_id FROM account WHERE id=1 AND status='active'", [], |r| r.get::<_, String>(0)).optional()?
    {
        conn.execute(
            "UPDATE drawing_library_items SET owner=?3 WHERE page_id=?1 AND owner=?2",
            params![page, store::profile(conn)?.id, account],
        )?;
    }
    let rows:Vec<(i64,String,String,String,String,String,Option<String>,String,i64,String)>=conn.prepare("SELECT v.version,v.snapshot_id,d.scene,p.title,i.kind,i.tags,i.source_id,v.payload,v.created_at,v.author FROM drawing_library_versions v JOIN drawing_versions d ON d.id=v.snapshot_id JOIN drawing_library_items i ON i.page_id=v.page_id JOIN pages p ON p.id=v.page_id WHERE v.page_id=?1")?.query_map([page],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?)))?.collect::<rusqlite::Result<_>>()?;
    for (version, old, raw, name, kind, tags, source, payload, at, author) in rows {
        let mut scene: Value = serde_json::from_str(&raw)?;
        if scene.get("libraryPublication").is_some() {
            validate_scene_publication(&scene)?;
            continue;
        }
        scene["libraryPublication"] = descriptor(
            page,
            version,
            &name,
            &kind,
            &serde_json::from_str::<Value>(&tags)?,
            source.as_deref(),
            &serde_json::from_str::<Value>(&payload)?,
            at,
        );
        validate_scene_publication(&scene)?;
        let id = db::new_id();
        conn.execute(
            "INSERT INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![id, page, version, format!("Library version {version}"), author, scene.to_string(), at],
        )?;
        conn.execute(
            "UPDATE drawing_library_versions SET snapshot_id=?3 WHERE page_id=?1 AND version=?2 AND snapshot_id=?4",
            params![page, version, id, old],
        )?;
    }
    Ok(())
}
/// Materialize only validated immutable publication descriptors belonging to
/// this actual page. Scope and rights come from pages/account tables, never XML
/// or metadata supplied by another device. The enclosing checkpoint is atomic.
pub fn install_sync_versions(conn: &Connection, page: &str, versions: &Value) -> Result<()> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        install_sync_versions(&tx, page, versions)?;
        tx.commit()?;
        return Ok(());
    }
    require(conn, page, Level::View)?;
    let page_meta = store::page_meta_by_id(conn, page)?
        .filter(|p| p.deleted_at.is_none() && p.kind == "drawing")
        .ok_or_else(|| anyhow!("Library drawing unavailable"))?;
    let mut records = Vec::new();
    for (id, version) in versions.as_object().ok_or_else(|| anyhow!("Invalid shared versions"))? {
        let scene = &version["scene"];
        let Some(p) = scene.get("libraryPublication") else {
            continue;
        };
        validate_scene_publication(scene)?;
        if p["itemId"] != page || p["version"] != version["revision"] || p["createdAt"] != version["createdAt"] {
            bail!("Publication descriptor does not match its saved version");
        }
        records.push((p["version"].as_i64().unwrap(), id, version));
    }
    if records.is_empty() {
        return Ok(());
    }
    records.sort_by_key(|r| r.0);
    if records.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        bail!("Immutable library publication version was reused");
    }
    let old: Option<(String, i64)> = conn
        .query_row("SELECT kind,current_version FROM drawing_library_items WHERE page_id=?1", [page], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let known: std::collections::HashSet<i64> = conn
        .prepare("SELECT version FROM drawing_library_versions WHERE page_id=?1")?
        .query_map([page], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let supplied: std::collections::HashSet<i64> = records.iter().map(|r| r.0).collect();
    if (1..=records.last().unwrap().0).any(|n| !known.contains(&n) && !supplied.contains(&n)) {
        bail!("Missing immutable library publication history");
    }
    let kind = records[0].2["scene"]["libraryPublication"]["kind"].as_str().unwrap();
    if old.as_ref().is_some_and(|(k, _)| k != kind) || records.iter().any(|r| r.2["scene"]["libraryPublication"]["kind"] != kind) {
        bail!("Published library category changed");
    }
    if old.is_none() {
        let owner = records[0].2["author"].as_str().ok_or_else(|| anyhow!("Missing publication author"))?;
        conn.execute(
            "INSERT INTO drawing_library_items(page_id,kind,tags,source_id,owner,current_version) VALUES (?1,?2,'[]',NULL,?3,0)",
            params![page, kind, owner],
        )?;
    }
    for (number, id, version) in &records {
        let p = &version["scene"]["libraryPublication"];
        let existing:Option<(String,String)>=conn.query_row("SELECT d.scene,v.payload FROM drawing_library_versions v JOIN drawing_versions d ON d.id=v.snapshot_id WHERE v.page_id=?1 AND v.version=?2",params![page,number],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((raw, payload)) = existing {
            if serde_json::from_str::<Value>(&raw)? != version["scene"] || serde_json::from_str::<Value>(&payload)? != p["payload"] {
                bail!("Immutable library publication version was reused");
            }
        } else {
            conn.execute(
                "INSERT INTO drawing_library_versions(page_id,version,snapshot_id,payload,created_at,author) VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    page,
                    number,
                    id,
                    p["payload"].to_string(),
                    p["createdAt"].as_i64().unwrap(),
                    version["author"].as_str().unwrap_or("remote")
                ],
            )?;
        }
    }
    let latest = records.last().unwrap();
    let p = &latest.2["scene"]["libraryPublication"];
    if latest.0 >= old.as_ref().map(|r| r.1).unwrap_or(0) {
        conn.execute(
            "UPDATE drawing_library_items SET current_version=?2,tags=?3,source_id=?4 WHERE page_id=?1",
            params![page, latest.0, p["tags"].to_string(), p["sourceId"].as_str()],
        )?;
        conn.execute("UPDATE pages SET title=?2,metadata=json_set(metadata,'$.drawingLibrary',json('true')),updated_at=MAX(updated_at,?3) WHERE id=?1",params![page,p["name"].as_str().unwrap(),p["createdAt"].as_i64().unwrap()])?;
        store::index_page(conn, page)?;
        db::mark_change(conn, Some(&page_meta.id), "drawing_library", "sync")?;
    }
    Ok(())
}

fn row(conn: &Connection, id: &str) -> Result<Value> {
    require(conn, id, Level::View)?;
    let page = store::page_meta_by_id(conn, id)?.filter(|p| p.deleted_at.is_none()).ok_or_else(|| anyhow!("Library item unavailable"))?;
    let (kind, tags, source, owner, version, workspace): (String, String, Option<String>, String, i64, Option<String>) = conn.query_row("SELECT l.kind, l.tags, l.source_id, l.owner, l.current_version, p.workspace_id FROM drawing_library_items l JOIN pages p ON p.id = l.page_id WHERE l.page_id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?;
    let history: Vec<Value> = conn
        .prepare("SELECT version, created_at, author FROM drawing_library_versions WHERE page_id = ?1 ORDER BY version DESC")?
        .query_map([id], |r| {
            Ok(json!({ "version": r.get::<_, i64>(0)?, "createdAt": r.get::<_, i64>(1)?, "author": r.get::<_, String>(2)? }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let source_state = match source.as_deref() {
        Some(source) => match store::page_meta_by_id(conn, source)? {
            Some(p) if p.deleted_at.is_none() => {
                if page_level(conn, source)? >= Level::View {
                    "available"
                } else {
                    "denied"
                }
            }
            _ => "missing",
        },
        None => "missing",
    };
    let status: Option<String> = conn.query_row("SELECT status FROM drawing_sync_state WHERE page_id=?1", [id], |r| r.get(0)).optional()?;
    Ok(
        json!({ "page": page, "kind": kind, "tags": serde_json::from_str::<Value>(&tags)?, "sourceId": source, "sourceState":source_state,"syncStatus":status.unwrap_or("local".into()),"owner": owner, "version": version, "scope": if workspace.is_some() { "workspace" } else { "personal" }, "workspaceId": workspace, "canEdit": page_level(conn, id)? >= Level::Edit, "canDelete": page_level(conn, id)? >= Level::Full, "versions": history }),
    )
}
pub fn list(conn: &Connection, source: &str) -> Result<Value> {
    require(conn, source, Level::View)?;
    let workspace: Option<String> = conn.query_row("SELECT workspace_id FROM pages WHERE id = ?1", [source], |r| r.get(0))?;
    let ids: Vec<String> = conn.prepare("SELECT l.page_id FROM drawing_library_items l JOIN pages p ON p.id = l.page_id WHERE p.deleted_at IS NULL AND p.archived = 0 AND (p.workspace_id IS NULL OR p.workspace_id = ?1) ORDER BY p.updated_at DESC")?.query_map([workspace], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    for id in ids {
        if page_level(conn, &id)? >= Level::View {
            out.push(row(conn, &id)?);
        }
    }
    Ok(json!(out))
}
pub fn read(conn: &Connection, id: &str, version: Option<i64>) -> Result<Value> {
    let item = row(conn, id)?;
    let version = version.unwrap_or_else(|| item["version"].as_i64().unwrap());
    let (snapshot, payload): (String, String) = conn.query_row(
        "SELECT snapshot_id, payload FROM drawing_library_versions WHERE page_id = ?1 AND version = ?2",
        params![id, version],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(
        json!({ "item": item, "version": version, "scene": drawing::version_scene(conn, id, &snapshot)?, "payload": serde_json::from_str::<Value>(&payload)? }),
    )
}
pub fn publish(conn: &Connection, input: Publish) -> Result<Value> {
    publish_authorized(conn, input, None)
}
pub fn publish_authorized(conn: &Connection, input: Publish, permit: Option<&crate::drawing_copy::Permit>) -> Result<Value> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = publish_authorized(&tx, input, permit)?;
        tx.commit()?;
        return Ok(result);
    }
    validate(&input)?;
    require(conn, &input.source_id, Level::View)?;
    crate::drawing_copy::require_scene(conn, &input.source_id, &input.scene, permit)?;
    if !store::page_meta_by_id(conn, &input.source_id)?.is_some_and(|p| p.kind == "drawing" && p.deleted_at.is_none()) {
        bail!("Open an available source drawing before publishing");
    }
    let owner = conn
        .query_row("SELECT user_id FROM account WHERE id=1 AND status='active'", [], |r| r.get::<_, String>(0))
        .optional()?
        .unwrap_or(store::profile(conn)?.id);
    let item_id = if let Some(id) = input.item_id.as_ref() {
        let old = row(conn, id)?;
        require(conn, id, Level::Edit)?;
        if old["version"].as_i64() != input.expected_version {
            bail!("Library changed. Refresh before publishing another version");
        }
        if old["kind"] != input.kind || old["scope"] != input.scope {
            bail!("Library category and scope cannot change between versions");
        }
        if input.scope == "workspace" && old["page"]["parentId"].as_str() == Some(&input.source_id) {
            let folder: Option<String> = conn.query_row("SELECT parent_id FROM pages WHERE id=?1", [&input.source_id], |r| r.get(0))?;
            if let Some(parent) = folder.as_deref() {
                require(conn, parent, Level::Edit)?;
            }
            store::move_page(conn, &store::Ctx::user(), id, folder.as_deref(), None)?;
            require(conn, id, Level::Edit)?;
        }
        id.clone()
    } else {
        if input.expected_version.is_some_and(|v| v != 0) {
            bail!("Invalid first library version");
        }
        let (workspace, folder): (Option<String>, Option<String>) =
            conn.query_row("SELECT workspace_id,parent_id FROM pages WHERE id = ?1 AND deleted_at IS NULL", [&input.source_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;
        if input.scope == "workspace" {
            require(conn, &input.source_id, Level::Edit)?;
            if workspace.is_none() {
                bail!("Open a drawing in a shared workspace to publish shared material");
            }
        }
        // A publication is an independent sibling, not a descendant that would
        // be deleted or implicitly revoked with its original drawing.
        let parent = if input.scope == "workspace" { folder } else { None };
        let page = store::create_page(
            conn,
            &store::Ctx::user(),
            store::NewPage {
                title: Some(input.name.trim().into()),
                kind: Some("drawing".into()),
                parent_id: parent,
                icon: Some("pi:paintbrush".into()),
                metadata: Some(json!({ "drawingLibrary": true })),
                ..Default::default()
            },
        )?;
        // The ordinary create trigger chooses the active workspace. Personal library
        // material must explicitly stay personal even while a Team is active.
        if input.scope == "personal" {
            conn.execute("UPDATE pages SET workspace_id = NULL WHERE id = ?1", [&page.id])?;
        } else {
            conn.execute("UPDATE pages SET workspace_id=?2 WHERE id=?1", params![page.id, workspace])?;
            require(conn, &page.id, Level::Edit)?;
        }
        conn.execute(
            "INSERT INTO drawing_library_items(page_id, kind, tags, source_id, owner) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![page.id, input.kind, json!(input.tags).to_string(), input.source_id, owner],
        )?;
        page.id
    };
    let mut scene = drawing::materialize_scene_dependencies(conn, &input.source_id, &item_id, strip_publication(input.scene))?;
    let current: i64 = conn.query_row("SELECT current_version FROM drawing_library_items WHERE page_id = ?1", [&item_id], |r| r.get(0))?;
    let version = current + 1;
    if version > 500 {
        bail!("The library publication history exceeds500 versions");
    }
    let at = db::now();
    scene["libraryPublication"] =
        descriptor(&item_id, version, input.name.trim(), &input.kind, &json!(input.tags), Some(&input.source_id), &input.payload, at);
    validate_scene_publication(&scene)?;
    let snapshot_id = db::new_id();
    conn.execute(
        "INSERT INTO drawing_versions(id, page_id, revision, label, author, scene, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![snapshot_id, item_id, version, format!("Library version {version}"), owner, scene.to_string(), at],
    )?;
    conn.execute(
        "INSERT INTO drawing_library_versions(page_id, version, snapshot_id, payload, created_at, author) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![item_id, version, snapshot_id, input.payload.to_string(), at, owner],
    )?;
    conn.execute(
        "UPDATE drawing_library_items SET current_version = ?2, tags = ?3 WHERE page_id = ?1",
        params![item_id, version, json!(input.tags).to_string()],
    )?;
    if current == 0 {
        let ordinary = strip_publication(scene.clone());
        conn.execute(
            "INSERT INTO drawing_documents(page_id, revision, seed, scene, search_text, updated_at) VALUES (?1, 0, ?2, ?2, ?3, ?4)",
            params![item_id, ordinary.to_string(), drawing::search_text(&ordinary), at],
        )?;
    }
    conn.execute("UPDATE drawing_sync_state SET status=CASE WHEN status IN ('conflict','denied') THEN status ELSE 'pending' END,updated_at=?2 WHERE page_id=?1",params![item_id,at])?;
    store::update_page(
        conn,
        &store::Ctx::user(),
        &item_id,
        store::PagePatch { title: Some(input.name.trim().into()), ..Default::default() },
    )?;
    // A color/tag-only publication still changes the small page-tree revision,
    // allowing other devices to discover its new dependency version lazily.
    conn.execute("UPDATE pages SET updated_at=MAX(updated_at+1,?2) WHERE id=?1", params![item_id, at])?;
    db::mark_change(conn, Some(&item_id), "drawing_library", "ui")?;
    read(conn, &item_id, None)
}
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    row(conn, id)?;
    require(conn, id, Level::Full)?;
    store::delete_page(conn, &store::Ctx::user(), id)
}

pub fn instantiate(conn: &Connection, id: &str, version: i64, permit: Option<&crate::drawing_copy::Permit>) -> Result<store::PageMeta> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let page = instantiate(&tx, id, version, permit)?;
        tx.commit()?;
        return Ok(page);
    }
    let publication = read(conn, id, Some(version))?;
    if publication["item"]["kind"] != "template" {
        bail!("Choose a drawing template");
    }
    // Recheck the exact authorized publication before deriving detached artwork.
    // Stripping its descriptor first would invalidate every managed-copy permit.
    crate::drawing_copy::require_scene(conn, id, &publication["scene"], permit)?;
    let scene = strip_publication(publication["scene"].clone());
    let page = store::create_page(
        conn,
        &store::Ctx::user(),
        store::NewPage {
            title: publication["item"]["page"]["title"].as_str().map(str::to_string),
            kind: Some("drawing".into()),
            ..Default::default()
        },
    )?;
    let scene = drawing::materialize_scene_dependencies(conn, id, &page.id, scene)?;
    conn.execute(
        "INSERT INTO drawing_documents(page_id,revision,seed,scene,search_text,updated_at) VALUES (?1,0,?2,?2,?3,?4)",
        params![page.id, scene.to_string(), drawing::search_text(&scene), db::now()],
    )?;
    store::index_page(conn, &page.id)?;
    drawing::rebuild_links(conn, &page.id, &scene)?;
    Ok(page)
}

#[tauri::command]
pub async fn drawing_library_list(state: State<'_, AppState>, page_id: String) -> Result<Value, String> {
    list(&state.conn(), &page_id).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_library_read(state: State<'_, AppState>, item_id: String, version: Option<i64>) -> Result<Value, String> {
    read(&state.conn(), &item_id, version).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_library_publish(state: State<'_, AppState>, input: Publish) -> Result<Value, String> {
    let plan = crate::drawing_copy::Plan::scene(&state.conn(), &input.source_id, input.scene.clone()).map_err(|e| format!("{e:#}"))?;
    let permit = crate::drawing_copy::authorize_app(&state, plan).await.map_err(|e| format!("{e:#}"))?;
    publish_authorized(&state.conn(), input, Some(&permit)).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_library_remove(state: State<'_, AppState>, item_id: String) -> Result<(), String> {
    remove(&state.conn(), &item_id).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_library_instantiate(state: State<'_, AppState>, item_id: String, version: i64) -> Result<store::PageMeta, String> {
    let publication = read(&state.conn(), &item_id, Some(version)).map_err(|e| format!("{e:#}"))?;
    let plan = crate::drawing_copy::Plan::scene(&state.conn(), &item_id, publication["scene"].clone()).map_err(|e| format!("{e:#}"))?;
    let permit = crate::drawing_copy::authorize_app(&state, plan).await.map_err(|e| format!("{e:#}"))?;
    instantiate(&state.conn(), &item_id, version, Some(&permit)).map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn template_instantiation_rechecks_the_authorized_publication_before_detaching_it() {
        let path = std::env::temp_dir().join(format!("worlds-library-permit-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap();
        let source =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let mut request = input(&source.id, drawing::initial_scene(&source.id));
        request.kind = "template".into();
        request.payload = json!({});
        let publication = publish(&conn, request).unwrap();
        let item = publication["item"]["page"]["id"].as_str().unwrap();
        assert!(publication["scene"]["libraryPublication"].is_object());
        let plan = crate::drawing_copy::Plan::scene(&conn, item, publication["scene"].clone()).unwrap();
        let permit = tokio::runtime::Runtime::new().unwrap().block_on(plan.authorize(None)).unwrap();
        let copy = instantiate(&conn, item, 1, Some(&permit)).unwrap();
        let copied = drawing::load(&conn, &copy.id).unwrap();
        assert!(copied["scene"].get("libraryPublication").is_none());
        assert_eq!(copied["scene"]["nodeOrder"], publication["scene"]["nodeOrder"]);
        let mut altered = publication["scene"].clone();
        let frame = altered["defaultFrameId"].as_str().unwrap().to_owned();
        altered["frames"][frame]["background"] = json!("#ff0000");
        assert!(crate::drawing_copy::require_scene(&conn, item, &altered, Some(&permit)).is_err());
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
    fn copy_wire_versions(from: &Connection, to: &Connection, page: &str) -> Value {
        let rows: Vec<(String, i64, String, String, String, i64)> = from
            .prepare("SELECT id,revision,label,author,scene,created_at FROM drawing_versions WHERE page_id=?1")
            .unwrap()
            .query_map([page], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let mut versions = serde_json::Map::new();
        for (id, revision, label, author, raw, at) in rows {
            to.execute(
                "INSERT OR IGNORE INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![id, page, revision, label, author, raw, at],
            )
            .unwrap();
            versions.insert(id,json!({"revision":revision,"label":label,"author":author,"scene":serde_json::from_str::<Value>(&raw).unwrap(),"createdAt":at}));
        }
        json!(versions)
    }
    #[test]
    fn synced_publications_refuse_corruption_and_missing_history_and_never_roll_back() {
        let base = std::env::temp_dir().join(format!("worlds-library-replicas-{}", db::new_id()));
        let a = db::open(&base.join("a.db")).unwrap();
        let b = db::open(&base.join("b.db")).unwrap();
        let source =
            store::create_page(&a, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let scene = drawing::initial_scene(&source.id);
        let first = publish(&a, input(&source.id, scene.clone())).unwrap();
        let item = first["item"]["page"]["id"].as_str().unwrap();
        let mut update = input(&source.id, scene);
        update.item_id = Some(item.into());
        update.expected_version = Some(1);
        update.name = "أزرق مشترك".into();
        update.tags = vec!["أزرق".into()];
        update.payload = json!({"colors":["#0000ff80"]});
        publish(&a, update).unwrap();
        b.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES (?1,'Imported','drawing','{}',0,0)", [item])
            .unwrap();
        let all = copy_wire_versions(&a, &b, item);
        let first_only = Value::Object(
            all.as_object().unwrap().iter().filter(|(_, v)| v["revision"] == 1).map(|(k, v)| (k.clone(), v.clone())).collect(),
        );
        let second_only = Value::Object(
            all.as_object().unwrap().iter().filter(|(_, v)| v["revision"] == 2).map(|(k, v)| (k.clone(), v.clone())).collect(),
        );
        assert!(install_sync_versions(&b, item, &second_only).unwrap_err().to_string().contains("history"));
        assert_eq!(b.query_row("SELECT COUNT(*) FROM drawing_library_items", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        install_sync_versions(&b, item, &all).unwrap();
        install_sync_versions(&b, item, &all).unwrap();
        install_sync_versions(&b, item, &first_only).unwrap();
        assert_eq!(read(&b, item, None).unwrap()["version"], 2);
        assert_eq!(row(&b, item).unwrap()["page"]["title"], "أزرق مشترك");
        let mut corrupt = all.clone();
        let key = corrupt.as_object().unwrap().iter().find(|(_, v)| v["revision"] == 2).unwrap().0.clone();
        corrupt[&key]["scene"]["libraryPublication"]["payload"]["colors"] = json!(["#ffffff"]);
        assert!(install_sync_versions(&b, item, &corrupt).unwrap_err().to_string().contains("reused"));
        assert_eq!(read(&b, item, None).unwrap()["payload"]["colors"][0], "#0000ff80");
        corrupt = all.clone();
        corrupt[&key]["scene"]["libraryPublication"]["owner"] = json!("forged-owner");
        assert!(install_sync_versions(&b, item, &corrupt).is_err());
        corrupt = all.clone();
        corrupt[&key]["scene"]["libraryPublication"]["itemId"] = json!("another-page");
        assert!(install_sync_versions(&b, item, &corrupt).is_err());
        drop(b);
        let reopened = db::open(&base.join("b.db")).unwrap();
        assert_eq!(read(&reopened, item, Some(1)).unwrap()["payload"]["colors"][0], "#ff0000");
        assert_eq!(read(&reopened, item, None).unwrap()["item"]["tags"], json!(["أزرق"]));
        drop(reopened);
        drop(a);
        if let (Ok(target), Ok(temp)) = (base.canonicalize(), std::env::temp_dir().canonicalize()) {
            if target.starts_with(&temp) && target.file_name().is_some_and(|s| s.to_string_lossy().starts_with("worlds-library-replicas-"))
            {
                let _ = std::fs::remove_dir_all(target);
            }
        }
    }
    #[test]
    fn legacy_publications_gain_new_descriptors_without_rewriting_old_snapshot_ids() {
        let path = std::env::temp_dir().join(format!("worlds-library-legacy-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap();
        let source =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let first = publish(&conn, input(&source.id, drawing::initial_scene(&source.id))).unwrap();
        let item = first["item"]["page"]["id"].as_str().unwrap();
        let old: String =
            conn.query_row("SELECT snapshot_id FROM drawing_library_versions WHERE page_id=?1", [item], |r| r.get(0)).unwrap();
        let raw = strip_publication(first["scene"].clone());
        conn.execute("UPDATE drawing_versions SET scene=?2 WHERE id=?1", params![old, raw.to_string()]).unwrap();
        prepare_sync_versions(&conn, item).unwrap();
        let new: String =
            conn.query_row("SELECT snapshot_id FROM drawing_library_versions WHERE page_id=?1", [item], |r| r.get(0)).unwrap();
        assert_ne!(old, new);
        let old_raw: String = conn.query_row("SELECT scene FROM drawing_versions WHERE id=?1", [old], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&old_raw).unwrap(), raw);
        assert_eq!(read(&conn, item, None).unwrap()["scene"]["libraryPublication"]["version"], 1);
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn publication_survives_source_deletion_and_keeps_actual_account_identity() {
        let path = std::env::temp_dir().join(format!("worlds-library-source-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap();
        conn.execute("INSERT INTO account(id,user_id,email,device_id,server_url,signed_in_at) VALUES (1,'alice','library@example.invalid','device','https://identity.test',0)",[]).unwrap();
        conn.execute("INSERT INTO account_workspaces(id,name,role,synced_at) VALUES ('team','Team','owner',0)", []).unwrap();
        let source =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let publish_input = input(&source.id, drawing::initial_scene(&source.id));
        let first = publish(&conn, publish_input).unwrap();
        let item = first["item"]["page"]["id"].as_str().unwrap();
        assert_ne!(first["item"]["page"]["parentId"], source.id);
        assert_eq!(first["item"]["owner"], "alice");
        store::delete_page(&conn, &store::Ctx::user(), &source.id).unwrap();
        let retained = read(&conn, item, None).unwrap();
        assert_eq!(retained["item"]["sourceState"], "missing");
        assert_eq!(retained["payload"]["colors"][0], "#ff0000");
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn style_payload_cannot_inject_geometry_or_asset_changes() {
        let mut scene = drawing::initial_scene("style");
        let layer = scene["layerOrder"][0].clone();
        let frame = scene["defaultFrameId"].clone();
        let paint = json!({"fill":"#ffffff","stroke":"#000000","strokeWidth":1,"dash":[],"cap":"round","radius":0});
        let text = json!({"font":"sans-serif","size":24,"weight":400,"italic":false,"align":"start","direction":"auto","leading":1.5,"color":"#000000","background":"transparent","border":"transparent"});
        scene["nodes"]["style-node"] = json!({"id":"style-node","kind":"shape","shape":"rect","layerId":layer,"frameId":frame,"groupId":null,"name":"Style","visible":true,"locked":false,"rotation":0,"opacity":1,"flipX":false,"flipY":false,"x":0,"y":0,"w":10,"h":10,"paint":paint,"textStyle":text,"effects":[]});
        scene["nodeOrder"] = json!(["style-node"]);
        drawing::validate_scene(&scene).unwrap();
        let mut value = input("source", scene);
        value.kind = "style".into();
        value.payload = json!({"style":{"paint":paint,"textStyle":text,"assetId":"foreign","x":999}});
        assert!(validate(&value).unwrap_err().to_string().contains("style fields"));
        value.payload["style"].as_object_mut().unwrap().remove("assetId");
        value.payload["style"].as_object_mut().unwrap().remove("x");
        validate(&value).unwrap();
    }
    fn input(source: &str, scene: Value) -> Publish {
        Publish {
            source_id: source.into(),
            item_id: None,
            expected_version: None,
            name: "ألوان المشروع".into(),
            kind: "palette".into(),
            scope: "personal".into(),
            tags: vec!["ألوان".into()],
            scene,
            payload: json!({ "colors": ["#ff0000", "#00ff00"] }),
        }
    }
    #[test]
    fn immutable_publications_own_originals_and_refuse_stale_or_unauthorized_changes() {
        let path = std::env::temp_dir().join(format!("worlds-library-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap();
        let source =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        conn.execute("INSERT INTO attachments(id, page_id, kind, file_name, mime, size, rel_path, width, height, created_at) VALUES ('original', ?1, 'image', 'mask.png', 'image/png', 3, 'immutable.png', 1, 1, 1)", [&source.id]).unwrap();
        let mut scene = drawing::initial_scene(&source.id);
        scene["assets"]["a"] =
            json!({ "id": "a", "attachmentId": "original", "name": "mask.png", "mime": "image/png", "width": 1, "height": 1 });
        let first = publish(&conn, input(&source.id, scene.clone())).unwrap();
        let item_id = first["item"]["page"]["id"].as_str().unwrap();
        assert_ne!(first["scene"]["assets"]["a"]["attachmentId"], "original");
        let mut next = input(&source.id, scene.clone());
        next.item_id = Some(item_id.into());
        next.expected_version = Some(1);
        next.payload = json!({ "colors": ["#0000ff"] });
        conn.execute("UPDATE pages SET updated_at=0 WHERE id=?1", [item_id]).unwrap();
        publish(&conn, next).unwrap();
        assert!(row(&conn, item_id).unwrap()["page"]["updatedAt"].as_i64().unwrap() > 0);
        assert_eq!(read(&conn, item_id, Some(1)).unwrap()["payload"]["colors"][0], "#ff0000");
        assert_eq!(read(&conn, item_id, None).unwrap()["version"], 2);
        let mut stale = input(&source.id, scene.clone());
        stale.item_id = Some(item_id.into());
        stale.expected_version = Some(1);
        assert!(publish(&conn, stale).unwrap_err().to_string().contains("changed"));
        assert_eq!(list(&conn, &source.id).unwrap().as_array().unwrap().len(), 1);
        let copied = drawing::materialize_scene_dependencies(&conn, item_id, &source.id, first["scene"].clone()).unwrap();
        remove(&conn, item_id).unwrap();
        assert!(read(&conn, item_id, None).is_err());
        assert!(store::get_attachment(&conn, copied["assets"]["a"]["attachmentId"].as_str().unwrap()).unwrap().is_some());
        store::purge_page(&conn, item_id).unwrap();
        assert!(store::get_attachment(&conn, copied["assets"]["a"]["attachmentId"].as_str().unwrap()).unwrap().is_some());
        // An active Team must not accidentally receive a personal publication.
        conn.execute("INSERT INTO account_workspaces(id, name, role, synced_at) VALUES ('team', 'Team', 'member', 0)", []).unwrap();
        db::set_setting(&conn, "account.activeWorkspace", &json!("team")).unwrap();
        let personal = publish(&conn, input(&source.id, scene.clone())).unwrap();
        assert_eq!(personal["item"]["scope"], "personal");
        let private_id = personal["item"]["page"]["id"].as_str().unwrap();
        conn.execute("UPDATE pages SET workspace_id = 'team' WHERE id = ?1", [private_id]).unwrap();
        assert!(read(&conn, private_id, None).is_err());
        assert!(list(&conn, &source.id).unwrap().as_array().unwrap().is_empty());
        let mut denied = input(&source.id, scene);
        denied.item_id = Some(private_id.into());
        denied.expected_version = Some(1);
        assert!(publish(&conn, denied).is_err());
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}
