//! Fresh local import stages. Raw originals are staged through attachment_import_raw;
//! the final document, comparison bases and editable branches install atomically.
use crate::{db, drawing, store, AppState};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use tauri::State;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Experiment {
    pub name: String,
    pub description: String,
    pub status: String,
    pub scene: Value,
    pub base: Value,
    #[serde(default)]
    pub version_aliases: HashMap<String, String>,
}
fn local_page(conn: &Connection, name: &str, metadata: Value) -> Result<store::PageMeta> {
    let page = store::create_page(
        conn,
        &store::Ctx::user(),
        store::NewPage { title: Some(name.into()), kind: Some("drawing".into()), metadata: Some(metadata), ..Default::default() },
    )?;
    conn.execute("UPDATE pages SET workspace_id=NULL,parent_id=NULL WHERE id=?1", [&page.id])?;
    Ok(store::page_meta_by_id(conn, &page.id)?.unwrap())
}
pub fn stage(conn: &Connection, name: &str) -> Result<Value> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = stage(&tx, name)?;
        tx.commit()?;
        return Ok(result);
    }
    if name.trim().is_empty() || name.chars().count() > 160 {
        bail!("Name the imported project");
    }
    let token = db::new_id();
    let page =
        local_page(conn, name.trim(), json!({"sync":{"shared":false},"packageStage":{"token":token,"owner":store::profile(conn)?.id}}))?;
    conn.execute("UPDATE pages SET archived=1 WHERE id=?1", [&page.id])?;
    Ok(json!({"page":store::page_meta_by_id(conn,&page.id)?.unwrap(),"token":token}))
}
fn check_stage(conn: &Connection, page: &str, token: &str) -> Result<()> {
    let p = store::get_page(conn, page)?.ok_or_else(|| anyhow!("Import stage unavailable"))?;
    let mode = crate::sync::page_mode(conn, page)?;
    let local: bool = conn.query_row("SELECT workspace_id IS NULL FROM pages WHERE id=?1", [page], |r| r.get(0))?;
    let replicas: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM drawing_sync_state WHERE page_id=?1)", [page], |r| r.get(0))?;
    let children: i64 = conn.query_row("SELECT COUNT(*) FROM pages WHERE parent_id=?1", [page], |r| r.get(0))?;
    let doc = drawing::load(conn, page)?;
    if !local
        || p.meta.kind != "drawing"
        || mode.shared
        || replicas
        || children != 0
        || p.meta.parent_id.is_some()
        || p.metadata["packageStage"]["token"] != token
        || p.metadata["packageStage"]["owner"] != store::profile(conn)?.id
        || doc["revision"] != 0
        || doc["scene"] != drawing::initial_scene(page)
        || ["nodes", "assets", "masks", "steps"].iter().any(|key| doc["scene"][key].as_object().is_none_or(|v| !v.is_empty()))
    {
        bail!("Only an unchanged fresh local import stage can be installed or cancelled");
    }
    Ok(())
}
pub fn abort(conn: &Connection, page: &str, token: &str) -> Result<bool> {
    if conn.is_autocommit() {
        let paths: Vec<String> = conn
            .prepare("SELECT rel_path FROM attachments WHERE page_id=?1")?
            .query_map([page], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let tx = conn.unchecked_transaction()?;
        let result = abort(&tx, page, token)?;
        tx.commit()?;
        if result {
            for path in paths {
                let used: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM attachments WHERE rel_path=?1)", [&path], |r| r.get(0))?;
                if !used {
                    if let (Ok(base), Ok(target)) = (db::attachments_dir().canonicalize(), db::attachments_dir().join(&path).canonicalize())
                    {
                        if target.starts_with(&base) {
                            let _ = std::fs::remove_file(target);
                        }
                    }
                }
            }
        }
        return Ok(result);
    }
    let Some(p) = store::get_page(conn, page)? else { return Ok(false) };
    if p.metadata.get("packageStage").is_none() {
        return Ok(false);
    }
    check_stage(conn, page, token)?;
    conn.execute("DELETE FROM attachments WHERE page_id=?1", [page])?;
    store::delete_page(conn, &store::Ctx::user(), page)?;
    store::purge_page(conn, page)?;
    Ok(true)
}
fn owned(conn: &Connection, page: &str, scene: &Value) -> Result<()> {
    let mut pending = vec![scene.clone()];
    let mut versions = HashSet::new();
    while let Some(s) = pending.pop() {
        drawing::validate_scene(&s)?;
        for asset in s["assets"].as_object().unwrap().values() {
            let id = asset["attachmentId"].as_str().ok_or_else(|| anyhow!("Missing staged original"))?;
            let a = store::get_attachment(conn, id)?.ok_or_else(|| anyhow!("Missing staged original"))?;
            if a.page_id.as_deref() != Some(page) || !store::attachment_abs_path(&a).is_file() {
                bail!("Package originals must be owned files of the new local project");
            }
        }
        for step in s["steps"].as_object().unwrap().values() {
            if let Some(id) = step["pinnedVersionId"].as_str() {
                if versions.insert(id.to_string()) {
                    if versions.len() > 500 {
                        bail!("Too many package snapshots");
                    }
                    pending.push(drawing::version_scene(conn, page, id)?);
                }
            }
        }
    }
    Ok(())
}
pub fn install(conn: &Connection, page: &str, token: &str, document: Value, experiments: Vec<Experiment>) -> Result<Value> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = install(&tx, page, token, document, experiments)?;
        tx.commit()?;
        return Ok(result);
    }
    check_stage(conn, page, token)?;
    if experiments.len() > 24
        || document["operations"].as_array().is_none_or(|ops| ops.len() > 500)
        || serde_json::to_vec(&json!({"document":document,
        "experiments":experiments.iter().map(|e|json!({"scene":e.scene,
        "base":e.base})).collect::<Vec<_>>()}))?
        .len()
            > 64 * 1024 * 1024
    {
        bail!(
            "The editable package exceeds \
        its import limits"
        );
    }
    for e in &experiments {
        if e.name.trim().is_empty()
            || e.name.chars().count() > 160
            || e.description.chars().count() > 4000
            || !["draft", "review", "approved"].contains(&e.status.as_str())
            || e.version_aliases.len() > 500
        {
            bail!("Invalid portable experiment");
        }
        owned(conn, page, &e.scene)?;
        owned(conn, page, &e.base)?;
        for target in e.version_aliases.values() {
            owned(conn, page, &drawing::version_scene(conn, page, target)?)?;
        }
    }
    drawing::history_import(conn, page, document)?;
    let mut imported = Vec::new();
    for e in experiments {
        let base_id = db::new_id();
        let mut base = e.base;
        if let Some(m) = base.as_object_mut() {
            m.remove("libraryPublication");
        }
        conn.execute(
            "INSERT INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES (?1,?2,0,?3,?4,?5,?6)",
            params![base_id, page, format!("Imported experiment base: {}", e.name), store::profile(conn)?.id, base.to_string(), db::now()],
        )?;
        let branch = local_page(conn, &e.name, json!({"sync":{"shared":false}}))?;
        let mut scene = drawing::materialize_scene_dependencies(conn, page, &branch.id, e.scene.clone())?;
        if let Some(m) = scene.as_object_mut() {
            m.remove("libraryPublication");
        }
        let mut aliases = serde_json::Map::new();
        for (id, step) in e.scene["steps"].as_object().unwrap() {
            if let (Some(old), Some(new)) = (step["pinnedVersionId"].as_str(), scene["steps"][id]["pinnedVersionId"].as_str()) {
                if let Some(source) = e.version_aliases.get(old) {
                    aliases.insert(new.into(), json!(source));
                }
            }
        }
        drawing::history_import(conn, &branch.id, json!({"revision":0,"seed":scene,"scene":scene,"operations":[]}))?;
        let p = store::set_page_meta(
            conn,
            &store::Ctx::user(),
            &branch.id,
            "experiment",
            json!({"sourceId":page,"baseVersionId":base_id,"author":store::profile(conn)?.id,"createdAt":db::now(),"description":e.description,"status":e.status,"versionAliases":aliases}),
        )?;
        imported.push(p);
    }
    conn.execute("UPDATE pages SET archived=0,metadata=json_remove(metadata,'$.packageStage') WHERE id=?1", [page])?;
    db::mark_change(conn, Some(page), "drawing", "import")?;
    Ok(json!({"page":store::page_meta_by_id(conn,page)?.unwrap(),"experiments":imported}))
}
#[tauri::command]
pub async fn drawing_package_stage(state: State<'_, AppState>, name: String) -> Result<Value, String> {
    stage(&state.conn(), &name).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_package_abort(state: State<'_, AppState>, page_id: String, token: String) -> Result<bool, String> {
    abort(&state.conn(), &page_id, &token).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_package_install(
    state: State<'_, AppState>,
    page_id: String,
    token: String,
    document: Value,
    experiments: Vec<Experiment>,
) -> Result<Value, String> {
    install(&state.conn(), &page_id, &token, document, experiments).map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Connection, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("worlds-package-{}", db::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        (db::open(&dir.join("worlds.db")).unwrap(), dir)
    }
    fn doc(scene: &Value) -> Value {
        json!({"revision":0,"seed":scene,"scene":scene,"operations":[]})
    }
    fn experiment(scene: Value, base: Value) -> Experiment {
        Experiment {
            name: "Editable alternative".into(),
            description: "Original comparison retained".into(),
            status: "review".into(),
            scene,
            base,
            version_aliases: HashMap::new(),
        }
    }
    #[test]
    fn atomic_editable_experiments_preserve_base_and_reopen() {
        let (conn, dir) = fixture();
        let staged = stage(&conn, "Independent main").unwrap();
        let page = staged["page"]["id"].as_str().unwrap().to_string();
        let token = staged["token"].as_str().unwrap().to_string();
        let main = drawing::initial_scene("main");
        let mut base = main.clone();
        base["frames"]["main-frame"]["background"] = json!("#ff0000");
        let mut branch = main.clone();
        branch["frames"]["main-frame"]["background"] = json!("#0000ff");
        let result = install(&conn, &page, &token, doc(&main), vec![experiment(branch.clone(), base.clone())]).unwrap();
        let child = result["experiments"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(drawing::load(&conn, &child).unwrap()["scene"], branch);
        let meta = store::get_page(&conn, &child).unwrap().unwrap();
        assert_eq!(meta.metadata["experiment"]["sourceId"], page);
        let base_id = meta.metadata["experiment"]["baseVersionId"].as_str().unwrap();
        assert_eq!(drawing::version_scene(&conn, &page, base_id).unwrap(), base);
        assert!(!abort(&conn, &page, &token).unwrap());
        let actor = store::profile(&conn).unwrap().id;
        drawing::apply(&conn,&store::Ctx::user(),&child,json!({"id":"edit-imported-branch","actor":actor,"base":0,"at":1,"label":"Edit imported branch","type":"edit","changes":[{"type":"patch","collection":"layers","id":"main-layer","fields":{"name":"Edited independently"}}]})).unwrap();
        assert_ne!(drawing::load(&conn, &page).unwrap()["scene"], drawing::load(&conn, &child).unwrap()["scene"]);
        drop(conn);
        let conn = db::open(&dir.join("worlds.db")).unwrap();
        assert_eq!(drawing::load(&conn, &child).unwrap()["revision"], 1);
        assert_eq!(drawing::load(&conn, &page).unwrap()["scene"], main);
    }
    #[test]
    fn invalid_second_experiment_rolls_back_everything_and_stage_can_cancel() {
        let (conn, _) = fixture();
        let staged = stage(&conn, "Cancelled").unwrap();
        let page = staged["page"]["id"].as_str().unwrap();
        let token = staged["token"].as_str().unwrap();
        let scene = drawing::initial_scene("portable");
        let mut invalid = scene.clone();
        invalid["assets"]["foreign"] =
            json!({"id":"foreign","attachmentId":"not-owned","name":"Foreign","mime":"image/png","width":1,"height":1});
        let before: i64 = conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0)).unwrap();
        assert!(install(
            &conn,
            page,
            token,
            doc(&scene),
            vec![experiment(scene.clone(), scene.clone()), experiment(invalid, scene.clone())]
        )
        .is_err());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get::<_, i64>(0)).unwrap(), before);
        assert_eq!(drawing::load(&conn, page).unwrap()["revision"], 0);
        assert!(abort(&conn, page, token).unwrap());
        assert!(store::get_page(&conn, page).unwrap().is_none());
    }
    #[test]
    fn refuses_changed_shared_or_wrong_nonce_targets() {
        let (conn, _) = fixture();
        let staged = stage(&conn, "Protected stage").unwrap();
        let page = staged["page"]["id"].as_str().unwrap();
        let token = staged["token"].as_str().unwrap();
        let scene = drawing::initial_scene("portable");
        assert!(install(&conn, page, "wrong", doc(&scene), vec![]).is_err());
        conn.execute("UPDATE pages SET metadata=json_set(metadata,'$.sync.shared',json('true')) WHERE id=?1", [page]).unwrap();
        assert!(install(&conn, page, token, doc(&scene), vec![]).is_err());
        assert!(abort(&conn, page, token).is_err());
        assert!(store::get_page(&conn, page).unwrap().is_some());
    }
    #[test]
    fn pinned_snapshot_aliases_remain_independently_owned() {
        let (conn, _) = fixture();
        let stage = stage(&conn, "Pinned bundle").unwrap();
        let page = stage["page"]["id"].as_str().unwrap();
        let token = stage["token"].as_str().unwrap();
        let snapshot = drawing::initial_scene("portable");
        for id in ["branch-pin", "source-pin"] {
            conn.execute("INSERT INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES (?1,?2,0,'Imported snapshot','original-author',?3,1)",params![id,page,snapshot.to_string()]).unwrap();
        }
        let mut branch = snapshot.clone();
        branch["steps"]["step"] = json!({"id":"step","title":"Pinned","body":"","frameId":"portable-frame","camera":{"x":0,"y":0,"w":100,"h":100},"hiddenNodeIds":[],"transition":"cut","duration":null,"pinnedVersionId":"branch-pin"});
        branch["stepOrder"] = json!(["step"]);
        let mut experiment = experiment(branch, snapshot.clone());
        experiment.version_aliases.insert("branch-pin".into(), "source-pin".into());
        let result = install(&conn, page, token, doc(&snapshot), vec![experiment]).unwrap();
        let child = result["experiments"][0]["id"].as_str().unwrap();
        let scene = drawing::load(&conn, child).unwrap();
        let pin = scene["scene"]["steps"]["step"]["pinnedVersionId"].as_str().unwrap();
        assert_ne!(pin, "branch-pin");
        assert_eq!(drawing::version_scene(&conn, child, pin).unwrap(), snapshot);
        let p = store::get_page(&conn, child).unwrap().unwrap();
        assert_eq!(p.metadata["experiment"]["versionAliases"][pin], "source-pin");
    }
    #[test]
    fn real_owned_original_bundle_and_cancellation() {
        let dir = std::env::temp_dir().join(format!("worlds-package-owned-{}", db::new_id()));
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "drawing_package::tests::owned_original_child", "--nocapture"])
            .env("WORLDS_PACKAGE_OWNED_CHILD", "1")
            .env("WORLDS_DATA_DIR", &dir)
            .status()
            .unwrap();
        assert!(status.success());
        println!("native package owned-file evidence: {}", dir.display());
    }
    #[test]
    fn owned_original_child() {
        if std::env::var("WORLDS_PACKAGE_OWNED_CHILD").is_err() {
            return;
        }
        use base64::Engine;
        let dir = db::data_dir();
        assert!(dir.starts_with(std::env::temp_dir()));
        let conn = db::open(&dir.join("worlds.db")).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAKc5Z5gAAAABJRU5ErkJggg==")
            .unwrap();
        let staged = stage(&conn, "Owned bundle").unwrap();
        let page = staged["page"]["id"].as_str().unwrap();
        let token = staged["token"].as_str().unwrap();
        let original = store::add_attachment_bytes(&conn, Some(page), "owned.png", &bytes).unwrap();
        let mut scene = drawing::initial_scene("portable");
        scene["assets"]["a"] = json!({"id":"a","attachmentId":original.id,"name":"Owned","mime":"image/png","width":1,"height":1});
        let result = install(&conn, page, token, doc(&scene), vec![experiment(scene.clone(), scene.clone())]).unwrap();
        let branch = result["experiments"][0]["id"].as_str().unwrap();
        let document = drawing::load(&conn, branch).unwrap();
        let copied = store::get_attachment(&conn, document["scene"]["assets"]["a"]["attachmentId"].as_str().unwrap()).unwrap().unwrap();
        assert_eq!(copied.page_id.as_deref(), Some(branch));
        assert_ne!(copied.id, original.id);
        assert_eq!(std::fs::read(store::attachment_abs_path(&copied)).unwrap(), bytes);
        let cancelled = stage(&conn, "Cancel owned bytes").unwrap();
        let cancel_page = cancelled["page"]["id"].as_str().unwrap();
        let cancel_original = store::add_attachment_bytes(&conn, Some(cancel_page), "cancel.png", &bytes).unwrap();
        assert!(abort(&conn, cancel_page, cancelled["token"].as_str().unwrap()).unwrap());
        assert!(store::get_attachment(&conn, &cancel_original.id).unwrap().is_none());
        assert!(!store::attachment_abs_path(&cancel_original).exists());
        assert_eq!(std::fs::read(store::attachment_abs_path(&copied)).unwrap(), bytes);
        std::fs::write(
            dir.join("package-owned-result.json"),
            json!({"passed":true,"branchOwnsByteExactCopy":true,"abortDeletesStagedFile":true,"completedBranchOriginalRemains":true})
                .to_string(),
        )
        .unwrap();
    }
}
