//! Headless native adapter for scripts/drawing-native-smoke.mjs. This example
//! refuses the ordinary app data directory and never starts the desktop shell.
use anyhow::{anyhow, bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use worlds_lib::{db, drawing, drawing_copy, drawing_export, drawing_library, drawing_sync, store, sync};
fn s<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str().ok_or_else(|| anyhow!("Missing {k}"))
}
fn command(conn: &Connection, v: &Value) -> Result<Value> {
    let page = s(v, "page")?;
    match s(v, "action")? {
        "packageStage" => worlds_lib::drawing_package::stage(conn, s(v, "name")?),
        "packageInstall" => worlds_lib::drawing_package::install(
            conn,
            page,
            s(v, "token")?,
            v["document"].clone(),
            serde_json::from_value(v["experiments"].clone())?,
        ),
        "packageAbort" => Ok(json!(worlds_lib::drawing_package::abort(conn, page, s(v, "token")?)?)),
        "referenceRead" => {
            let source = s(v, "sourceId")?;
            let plan = match worlds_lib::drawing_references::prepare_read(conn, source) {
                Ok(plan) => plan,
                Err(_) => return Ok(json!({"state":"unavailable","checkedAt":db::now()})),
            };
            if v["offline"] == true && drawing_export::needs_token(&plan) {
                return Ok(json!({"state":"offline","checkedAt":db::now()}));
            }
            if let Err(error) = tokio::runtime::Runtime::new()?.block_on(drawing_export::authorize(&plan, v["token"].as_str())) {
                return Ok(worlds_lib::drawing_references::read_failure(&error));
            }
            worlds_lib::drawing_references::finish_read(conn, &plan)
        }
        "setup" => {
            // Fixture import supplies the same page identity to two isolated
            // computers, as the normal workspace-tree import does in the app.
            conn.execute("INSERT OR IGNORE INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES (?1,'Native sync test','drawing',?2,?3,?3)",params![page,json!({"sync":{"shared":true}}).to_string(),db::now()])?;
            db::set_setting(conn, "sync.serverUrl", &v["server"])?;
            db::set_setting(conn, "sync.workspaceId", &v["workspace"])?;
            drawing_sync::open(conn, page, s(v, "server")?, s(v, "workspace")?, s(v, "user")?)
        }
        "snapshot" => drawing_sync::snapshot(conn, page),
        "librarySetup" => {
            conn.execute("INSERT OR REPLACE INTO account(id,user_id,email,device_id,server_url,signed_in_at) VALUES (1,?1,'library@example.invalid','library-device',?2,0)",params![s(v,"user")?,s(v,"server")?])?;
            conn.execute("INSERT OR REPLACE INTO account_workspaces(id,name,role,default_level,synced_at) VALUES (?1,'Library fixture','member','edit',0)",[s(v,"workspace")?])?;
            db::set_setting(conn, "account.activeWorkspace", &v["workspace"])?;
            conn.execute("UPDATE pages SET workspace_id=?2 WHERE id=?1", params![page, s(v, "workspace")?])?;
            conn.execute(
                "INSERT OR REPLACE INTO account_page_access(workspace_id,page_id,level) VALUES (?1,?2,?3)",
                params![s(v, "workspace")?, page, v["level"].as_str().unwrap_or("full")],
            )?;
            drawing_sync::snapshot(conn, page)
        }
        "libraryPublish" => {
            let scene = v.get("scene").cloned().unwrap_or(drawing::load(conn, page)?["scene"].clone());
            let plan = drawing_copy::Plan::scene(conn, page, scene.clone())?;
            let permit = tokio::runtime::Runtime::new()?.block_on(plan.authorize(v["token"].as_str()))?;
            drawing_library::publish_authorized(
                conn,
                drawing_library::Publish {
                    source_id: page.into(),
                    item_id: v["itemId"].as_str().map(str::to_owned),
                    expected_version: v["expectedVersion"].as_i64(),
                    name: s(v, "name")?.into(),
                    kind: s(v, "kind")?.into(),
                    scope: v["scope"].as_str().unwrap_or("workspace").into(),
                    tags: serde_json::from_value(v["tags"].clone())?,
                    scene,
                    payload: v["payload"].clone(),
                },
                Some(&permit),
            )
        }
        "libraryRead" => drawing_library::read(conn, s(v, "itemId")?, v["version"].as_i64()),
        "libraryList" => drawing_library::list(conn, page),
        "libraryCachedLevel" => {
            conn.execute(
                "INSERT OR REPLACE INTO account_page_access(workspace_id,page_id,level) VALUES (?1,?2,?3)",
                params![s(v, "workspace")?, s(v, "id")?, s(v, "level")?],
            )?;
            Ok(Value::Null)
        }
        "libraryRemove" => {
            drawing_library::remove(conn, s(v, "itemId")?)?;
            Ok(Value::Null)
        }
        "libraryDeleteSource" => {
            worlds_lib::account::permissions::require(conn, page, worlds_lib::account::permissions::Level::Full)?;
            store::delete_page(conn, &store::Ctx::user(), page)?;
            Ok(Value::Null)
        }
        "sessionToken" => {
            db::set_setting(conn, "sync.devToken", &v["token"])?;
            Ok(Value::Null)
        }
        "copyCounts" => {
            let counts: [i64; 4] = ["pages", "drawing_versions", "drawing_library_items", "attachments"]
                .map(|table| conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap());
            Ok(json!(counts))
        }
        "copy" => {
            let mode = s(v, "mode")?;
            let scene = drawing::load(conn, page)?["scene"].clone();
            let plan = if mode == "publish" {
                drawing_copy::Plan::scene(conn, page, scene.clone())?
            } else {
                drawing_copy::Plan::tree(conn, page, mode == "template" || mode == "duplicate")?
            };
            let permit = tokio::runtime::Runtime::new()?.block_on(plan.authorize(v["token"].as_str()))?;
            let value = match mode {
                "duplicate" => json!(store::duplicate_page_authorized(conn, &store::Ctx::user(), page, true, None, None, Some(&permit))?),
                "template" => json!(store::save_as_template_authorized(conn, &store::Ctx::user(), page, Some(&permit))?),
                "experiment" => json!(drawing::create_experiment_authorized(conn, page, "Authorized branch", "", Some(&permit))?),
                "publish" => drawing_library::publish_authorized(
                    conn,
                    drawing_library::Publish {
                        source_id: page.into(),
                        item_id: None,
                        expected_version: None,
                        name: "Authorized template".into(),
                        kind: "template".into(),
                        scope: "personal".into(),
                        tags: vec![],
                        scene,
                        payload: json!({}),
                    },
                    Some(&permit),
                )?,
                _ => bail!("Unknown copy mode"),
            };
            Ok(value)
        }
        "instantiateTemplate" => {
            let source = s(v, "templateId")?;
            let plan = drawing_copy::Plan::tree(conn, source, true)?;
            let permit = tokio::runtime::Runtime::new()?.block_on(plan.authorize(v["token"].as_str()))?;
            Ok(json!(store::instantiate_template_authorized(conn, &store::Ctx::user(), source, None, None, Some(&permit))?))
        }
        "instantiateLibrary" => {
            let item = s(v, "itemId")?;
            let publication = drawing_library::read(conn, item, Some(1))?;
            let plan = drawing_copy::Plan::scene(conn, item, publication["scene"].clone())?;
            let permit = tokio::runtime::Runtime::new()?.block_on(plan.authorize(v["token"].as_str()))?;
            Ok(json!(drawing_library::instantiate(conn, item, 1, Some(&permit))?))
        }
        "copyScene" => drawing::load(conn, s(v, "copyId")?),
        "shareCopySource" => {
            let source = s(v, "sourceId")?;
            conn.execute("UPDATE pages SET metadata=json_set(metadata,'$.sync.shared',json('true')) WHERE id=?1", [source])?;
            drawing_sync::open(conn, source, s(v, "server")?, s(v, "workspace")?, s(v, "user")?)
        }
        "materializeLibrary" => {
            let source = s(v, "itemId")?;
            let scene = drawing_library::read(conn, source, Some(1))?["scene"].clone();
            let plan = drawing_copy::Plan::materialization(conn, source, page, scene.clone())?;
            let permit = tokio::runtime::Runtime::new()?.block_on(plan.authorize(v["token"].as_str()))?;
            permit.recheck(conn)?;
            drawing_copy::require_scene(conn, source, &scene, Some(&permit))?;
            let tx = conn.unchecked_transaction()?;
            let copied = drawing::materialize_scene_dependencies(&tx, source, page, scene)?;
            tx.commit()?;
            Ok(copied)
        }
        "apply" => drawing::apply(conn, &store::Ctx::user(), page, v["operation"].clone()),
        "exportPolicy" => {
            let work = drawing_export::prepare_policy(conn, page, v.get("update").cloned().filter(|v| !v.is_null()))?;
            let reply = tokio::runtime::Runtime::new()?.block_on(drawing_export::fetch_policy(&work, v["token"].as_str()))?;
            drawing_export::accept_policy(conn, &work, reply)
        }
        "exportRequirements" => {
            Ok(json!(drawing_export::needs_token(&drawing_export::prepare(conn, serde_json::from_value(v["context"].clone())?)?)))
        }
        "exportRaw" => {
            let body = STANDARD.decode(s(v, "data")?)?;
            let (context, token, bytes) = drawing_export::parse_envelope(&body)?;
            let path = std::path::PathBuf::from(s(v, "path")?);
            let data = std::path::PathBuf::from(std::env::var("WORLDS_DATA_DIR")?);
            let allowed = data.parent().ok_or_else(|| anyhow!("Missing isolated export directory"))?.canonicalize()?;
            if !path.parent().ok_or_else(|| anyhow!("Missing export parent"))?.canonicalize()?.starts_with(allowed) {
                bail!("Keep native test exports inside the isolated run directory");
            }
            let prepared = drawing_export::prepare(conn, context)?;
            tokio::runtime::Runtime::new()?.block_on(drawing_export::authorize(&prepared, token.as_deref()))?;
            drawing_export::recheck(conn, &prepared)?;
            drawing_export::write_file(&path, &bytes, prepared.context.kind)?;
            Ok(Value::Null)
        }
        "exportSource" => {
            conn.execute("INSERT OR IGNORE INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES (?1,'Private source title','page',?2,?3,?3)",params![s(v,"id")?,json!({"sync":{"shared":true}}).to_string(),db::now()])?;
            Ok(Value::Null)
        }
        "accept" => {
            drawing_sync::accept(conn, page, v["expectedRevision"].as_i64().ok_or_else(|| anyhow!("Missing revision"))?, v["state"].clone())
        }
        "status" => {
            drawing_sync::set_error(conn, page, s(v, "status")?, v["error"].as_str().unwrap_or(""))?;
            Ok(Value::Null)
        }
        "version" => drawing::save_version(conn, page, s(v, "label")?),
        "versionScene" => drawing::version_scene(conn, page, s(v, "versionId")?),
        "restoreVersion" => drawing::restore_version(
            conn,
            page,
            s(v, "versionId")?,
            v["expectedRevision"].as_i64().ok_or_else(|| anyhow!("Missing revision"))?,
            s(v, "restoreId")?,
            "Restore version",
            "Before version restore",
        ),
        "original" => {
            drawing::load(conn, page)?;
            let Some(a) = store::get_attachment(conn, s(v, "id")?)? else { return Ok(Value::Null) };
            if a.page_id.as_deref() != Some(page) {
                bail!("Original belongs to another drawing");
            }
            Ok(
                json!({"fileName":a.file_name,"mime":a.mime,"bytes":STANDARD.encode(std::fs::read(db::attachments_dir().join(a.rel_path))?)}),
            )
        }
        "storeOriginal" => {
            drawing_sync::store_original(
                conn,
                page,
                s(v, "id")?,
                s(&v["info"], "fileName")?,
                s(&v["info"], "mime")?,
                s(&v["info"], "sha256")?,
                &STANDARD.decode(s(v, "bytes")?)?,
            )?;
            Ok(Value::Null)
        }
        "recover" => drawing_sync::recover(
            conn,
            page,
            v["expectedRevision"].as_i64().ok_or_else(|| anyhow!("Missing revision"))?,
            s(v, "recoveryId")?,
            v["document"].clone(),
            v["record"].clone(),
            v["state"].clone(),
            s(v, "title")?,
        ),
        "syncLoad" => Ok(json!(sync::load(conn, page, v["channel"].as_i64().unwrap_or(0))?)),
        "syncAppend" => Ok(json!(sync::append(
            conn,
            page,
            v["channel"].as_i64().unwrap_or(0),
            &STANDARD.decode(s(v, "bytes")?)?,
            s(v, "origin")?,
            v["outbox"].as_bool().unwrap_or(false)
        )?)),
        "syncCompact" => {
            sync::compact(
                conn,
                page,
                v["channel"].as_i64().unwrap_or(0),
                &STANDARD.decode(s(v, "bytes")?)?,
                v["upto"].as_i64().unwrap_or(0),
            )?;
            Ok(Value::Null)
        }
        "syncOutbox" => Ok(json!(sync::outbox_list(conn, Some(page), 10000)?)),
        "syncOutboxMax" => Ok(json!(sync::outbox_max_id(conn, page, v["channel"].as_i64().unwrap_or(0))?)),
        "syncAck" => Ok(json!(sync::outbox_ack(conn, &serde_json::from_value::<Vec<i64>>(v["ids"].clone())?)?)),
        "syncAckUpto" => Ok(json!(sync::outbox_ack_upto(conn, page, v["channel"].as_i64().unwrap_or(0), v["upto"].as_i64().unwrap_or(0))?)),
        "syncReject" => Ok(json!(sync::outbox_reject(conn, &serde_json::from_value::<Vec<i64>>(v["ids"].clone())?, s(v, "reason")?)?)),
        "syncArchiveRejection" => {
            sync::archive_rejection(
                conn,
                page,
                v["channel"].as_i64().unwrap_or(1),
                s(v, "archiveId")?,
                s(v, "owner")?,
                &STANDARD.decode(s(v, "data")?)?,
                &STANDARD.decode(s(v, "empty")?)?,
                s(v, "reason")?,
            )?;
            Ok(Value::Null)
        }
        "syncRejected" => sync::rejected_list(conn, page, s(v, "owner")?, v["before"]["createdAt"].as_i64(), v["before"]["id"].as_str()),
        "syncRejectedRead" => Ok(json!(sync::rejected_read(conn, page, s(v, "archiveId")?, s(v, "owner")?)?)),
        "syncFail" => Ok(json!(sync::outbox_fail(conn, &serde_json::from_value::<Vec<i64>>(v["ids"].clone())?, s(v, "reason")?)?)),
        "syncCursor" => {
            sync::cursor_set(conn, page, v["channel"].as_i64().unwrap_or(0), &serde_json::from_value(v["cursor"].clone())?)?;
            Ok(Value::Null)
        }
        "syncStatus" => Ok(json!(sync::page_status(conn, page)?)),
        _ => bail!("Unknown native test action"),
    }
}
fn main() -> Result<()> {
    let dir = std::path::PathBuf::from(std::env::var("WORLDS_DATA_DIR")?);
    if !dir.file_name().and_then(|s| s.to_str()).is_some_and(|s| s.starts_with("drawing-native-")) {
        bail!("Use an isolated drawing-native-* test directory");
    }
    let conn = db::open(&dir.join("worlds.db"))?;
    store::profile(&conn)?;
    for line in io::stdin().lock().lines() {
        let line = line?;
        let input: Value = serde_json::from_str(&line)?;
        let result = match command(&conn, &input) {
            Ok(value) => json!({"requestId":input["requestId"],"ok":true,"value":value}),
            Err(e) => json!({"requestId":input["requestId"],"ok":false,"error":format!("{e:#}")}),
        };
        println!("{result}");
        io::stdout().flush()?;
    }
    Ok(())
}
