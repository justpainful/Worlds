use anyhow::{bail, Result};
use rusqlite::Connection;
#[path = "../../../src-tauri/src/drawing_annotations_validation.rs"]
mod annotations;
#[path = "../../../src-tauri/src/drawing_scene.rs"]
pub(crate) mod drawing_scene;
use crate::account::permissions::Level;
use crate::{open_existing, require_personal, store};
use serde_json::Value;
use std::path::Path;
use drawing_scene::{initial_scene, validate_scene, text, safe_id, check_pixel_guard, apply_changes};
fn require_drawing(conn: &Connection, page: &str, _: Level) -> Result<()> {
    require_personal(conn, page)?;
    crate::drawing_sync::check_bound_identity(conn, page)?;
    let kind: String = conn.query_row("SELECT kind FROM pages WHERE id=?1", [page], |r| r.get(0))?;
    if kind != "drawing" { bail!("not a drawing") } Ok(())
}
fn require_asset_read(conn: &Connection, page: &str, source_page: &str) -> Result<()> {
    if source_page != page { bail!("asset is not owned by the drawing") }
    require_personal(conn, source_page)
}
fn reject_symlink_ancestors(path: &Path) -> Result<()> {
    for component in path.ancestors() {
        if std::fs::symlink_metadata(component)?.file_type().is_symlink() { bail!("symbolic links are not supported") }
    }
    Ok(())
}
fn validate_owned_assets(conn: &Connection, database: &Path, page: &str, scene: &Value) -> Result<()> {
    use std::path::Component;
    let assets = scene["assets"].as_object().ok_or_else(|| anyhow::anyhow!("invalid assets"))?;
    if assets.is_empty() { return Ok(()); }
    let root = database.parent().ok_or_else(|| anyhow::anyhow!("invalid database path"))?.join("attachments");
    for item in assets.values() {
        let id = item["attachmentId"].as_str().ok_or_else(|| anyhow::anyhow!("missing attachment ID"))?;
        let original = store::get_attachment(conn, id)?.ok_or_else(|| anyhow::anyhow!("missing original attachment"))?;
        if original.page_id.as_deref() != Some(page) { bail!("asset is not owned by the drawing") }
        let relative = Path::new(&original.rel_path);
        if relative.as_os_str().is_empty() || !relative.components().all(|part| matches!(part, Component::Normal(_))) { bail!("invalid attachment path") }
        let file = crate::attachment_open::open_confined(&root, relative)?;
        let metadata = file.metadata()?;
        if original.size < 0 || metadata.len() != original.size as u64 { bail!("original attachment missing or changed") }
    }
    Ok(())
}
// Assets may survive in history or saved versions after removal from the current
// scene. Refuse the entire write if any persisted JSON still references one.
fn contains_asset_reference(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields.iter().any(|(key, item)| {
            (key == "assets" && !item.as_object().is_some_and(|v| v.is_empty())) ||
            (matches!(key.as_str(), "attachmentId" | "assetId" | "tipAssetId") && !item.is_null() && item.as_str() != Some("")) ||
            contains_asset_reference(item)
        }),
        Value::Array(items) => items.iter().any(contains_asset_reference),
        _ => false,
    }
}
fn reject_asset_dependencies(conn: &Connection, page: &str, doc: &Value) -> Result<()> {
    if contains_asset_reference(doc) { bail!("asset-backed drawing writes are disabled") }
    let mut query = conn.prepare("SELECT scene FROM drawing_versions WHERE page_id=?1")?;
    let versions = query.query_map([page], |row| row.get::<_, String>(0))?;
    for version in versions {
        let parsed: Value = serde_json::from_str(&version?)?;
        if contains_asset_reference(&parsed) { bail!("drawing version references an asset") }
    }
    Ok(())
}
#[path = "../../../src-tauri/src/drawing_persistence.rs"]
mod drawing_persistence;

/// Strict personal-only facade; no files or replicas are silently omitted.
pub fn load_personal(path: &Path, page: &str) -> Result<Value> {
    let conn = open_existing(path)?;
    let tx = conn.unchecked_transaction()?;
    let doc = drawing_persistence::load(&tx, page)?;
    tx.commit()?; Ok(doc)
}
pub fn apply_personal(path: &Path, page: &str, operation: Value) -> Result<Value> {
    reject_symlink_ancestors(path)?;
    let mut conn = open_existing(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_drawing(&tx, page, Level::Edit)?;
    if !operation["versionRestore"].is_null() { bail!("version restore is unavailable") }
    let doc = drawing_persistence::apply(&tx, &store::Ctx::user(), page, operation)?;
    // Do not follow asset paths at all while durable identity remains unsolved.
    reject_asset_dependencies(&tx, page, &doc)?;
    tx.commit()?; Ok(doc)
}
pub fn duplicate_into(_: &Connection, _: &str, _: &str) -> Result<()> { bail!("drawing copy unavailable") }

#[cfg(test)]
mod tests {
    use super::drawing_scene::{apply_changes, validate_scene};
    use serde_json::{json, Value};

    #[test]
    fn original_journal_fixture_matches_shared_scene_core() {
        let fixture: Value = serde_json::from_str(include_str!("../../WorldsCore/Tests/WorldsDrawingTests/original-journal-fixture.json")).unwrap();
        let mut scene = fixture["initial"]["scene"].clone();
        validate_scene(&scene).unwrap();
        apply_changes(&mut scene, &fixture["add"]["changes"], false).unwrap();
        validate_scene(&scene).unwrap();
        assert_eq!(scene, fixture["afterUndo"]["scene"]);
        apply_changes(&mut scene, &fixture["move"]["changes"], false).unwrap();
        validate_scene(&scene).unwrap();
        assert_eq!(scene, fixture["afterRedo"]["scene"]);
    }
    #[test]
    fn invalid_scene_and_publication_are_refused() {
        let mut scene = super::drawing_scene::initial_scene("example");
        validate_scene(&scene).unwrap();
        scene["libraryPublication"] = json!({});
        assert!(validate_scene(&scene).is_err());
        scene.as_object_mut().unwrap().remove("libraryPublication");
        scene["defaultFrameId"] = json!("missing");
        assert!(validate_scene(&scene).is_err());
    }
    #[test]
    fn validation_dispatch_uses_shared_core_and_refuses_invalid_scene() {
        let scene = super::drawing_scene::initial_scene("ffi");
        let request = json!({"operation":"validate_drawing_scene","scene":scene});
        assert!(crate::dispatch(&serde_json::to_vec(&request).unwrap()).is_ok());
        let mut invalid = request;
        invalid["scene"]["defaultFrameId"] = json!("missing");
        assert!(crate::dispatch(&serde_json::to_vec(&invalid).unwrap()).is_err());
    }

    #[test]
    fn personal_original_save_roundtrip_conflict_and_rollback() {
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../WorldsCore/Tests/WorldsNativeWritesTests/worlds-v11.db");
        let target = std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-drawing-{}.db", uuid::Uuid::new_v4()));
        std::fs::copy(source, &target).unwrap();
        let conn = rusqlite::Connection::open(&target).unwrap();
        conn.execute("UPDATE pages SET kind='drawing' WHERE id='fixture-page'", []).unwrap();
        conn.execute("INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1)", []).unwrap();
        let before = super::load_personal(&target, "fixture-page").unwrap();
        let layer = before["scene"]["layerOrder"][0].as_str().unwrap();
        let op = json!({"id":"op-1","actor":"artist","base":0,"at":1,"label":"Rename layer","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Ink"}}]});
        let after = super::apply_personal(&target, "fixture-page", op.clone()).unwrap();
        assert_eq!(after["revision"],1); assert_eq!(after["scene"]["layers"][layer]["name"],"Ink");
        assert_eq!(super::load_personal(&target,"fixture-page").unwrap(),after);
        let request = json!({"operation":"load_personal_drawing","path":target.to_str().unwrap(),"page":"fixture-page"});
        assert_eq!(crate::dispatch(&serde_json::to_vec(&request).unwrap()).unwrap(), after);
        assert_eq!(super::apply_personal(&target,"fixture-page",op).unwrap(),after);
        let stale = json!({"id":"op-2","actor":"artist","base":0,"at":2,"label":"Stale","type":"edit","changes":[]});
        assert!(super::apply_personal(&target,"fixture-page",stale).is_err());
        // A deleted current asset can still be required by a saved version.
        conn.execute("INSERT INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES('v','fixture-page',0,'old','artist',?1,1)",
            [json!({"assets":{"a":{"attachmentId":"original"}}}).to_string()]).unwrap();
        let blocked = json!({"id":"blocked","actor":"artist","base":1,"at":3,"label":"Blocked","type":"edit","changes":[]});
        assert!(super::apply_personal(&target,"fixture-page",blocked).is_err());
        assert_eq!(super::load_personal(&target,"fixture-page").unwrap(),after);
        conn.execute("DELETE FROM drawing_versions WHERE id='v'", []).unwrap();
        conn.execute_batch("CREATE TRIGGER refuse_drawing BEFORE INSERT ON drawing_operations BEGIN SELECT RAISE(ABORT,'disk error'); END;").unwrap();
        let rejected = json!({"id":"op-3","actor":"artist","base":1,"at":3,"label":"Refused","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Lost"}}]});
        assert!(super::apply_personal(&target,"fixture-page",rejected).is_err());
        assert_eq!(super::load_personal(&target,"fixture-page").unwrap(),after);
        conn.execute("UPDATE pages SET workspace_id='shared' WHERE id='fixture-page'", []).unwrap();
        assert!(super::load_personal(&target,"fixture-page").is_err());
        drop(conn); std::fs::remove_file(target).unwrap();
    }

    #[test]
    fn owned_asset_file_required_and_failures_roll_back() {
        let directory = std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-owned-assets-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(directory.join("attachments/2026-01")).unwrap();
        let path = directory.join("worlds.db");
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../WorldsCore/Tests/WorldsNativeWritesTests/worlds-v11.db");
        std::fs::copy(source, &path).unwrap();
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("UPDATE pages SET kind='drawing' WHERE id='fixture-page'", []).unwrap();
        conn.execute("INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1)", []).unwrap();
        let file = directory.join("attachments/2026-01/asset.png");
        std::fs::write(&file, [1u8,2,3]).unwrap();
        conn.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,width,height,created_at) VALUES('a','fixture-page','image','asset.png','image/png',3,'2026-01/asset.png',1,1,1)", []).unwrap();
        let add = json!({"id":"asset-add","actor":"artist","base":0,"at":1,"label":"Add original","type":"edit","changes":[{"type":"put","collection":"assets","id":"asset","value":{"id":"asset","attachmentId":"a","mime":"image/png","width":1,"height":1}}]});
        let mut scene = super::drawing_scene::initial_scene("fixture-page");
        scene["assets"]["asset"] = json!({"id":"asset","attachmentId":"a","mime":"image/png","width":1,"height":1});
        #[cfg(unix)] assert!(super::validate_owned_assets(&conn,&path,"fixture-page",&scene).is_ok());
        assert!(super::apply_personal(&path,"fixture-page",add.clone()).is_err());
        assert_eq!(super::load_personal(&path,"fixture-page").unwrap()["revision"],0);
        std::fs::remove_file(&file).unwrap();
        assert!(super::validate_owned_assets(&conn,&path,"fixture-page",&scene).is_err());
        std::fs::write(&file, [1u8,2,3]).unwrap();
        conn.execute("UPDATE attachments SET page_id=NULL WHERE id='a'", []).unwrap();
        assert!(super::validate_owned_assets(&conn,&path,"fixture-page",&scene).is_err());
        conn.execute("UPDATE attachments SET page_id='fixture-page',rel_path='../outside' WHERE id='a'", []).unwrap();
        assert!(super::validate_owned_assets(&conn,&path,"fixture-page",&scene).is_err());
        assert_eq!(super::load_personal(&path,"fixture-page").unwrap()["revision"],0);
        conn.execute("UPDATE attachments SET rel_path='2026-01/asset.png' WHERE id='a'", []).unwrap();
        conn.execute("INSERT INTO drawing_sync_state(page_id,server_url,workspace_id,user_id,basis,updated_at) VALUES('fixture-page','https://example.test','w','u','{}',1)", []).unwrap();
        assert!(super::apply_personal(&path,"fixture-page",add).is_err());
        drop(conn); std::fs::remove_dir_all(directory).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_attachment_is_rejected() {
        use std::os::unix::fs::symlink;
        let directory = std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-link-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(directory.join("attachments")).unwrap();
        std::fs::write(directory.join("original"), [1u8]).unwrap();
        symlink(directory.join("original"),directory.join("attachments/link")).unwrap();
        assert!(super::reject_symlink_ancestors(&directory.join("attachments/link")).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn asset_scan_includes_nested_history_references() {
        assert!(super::contains_asset_reference(&json!({"operations":[{"changes":[{"value":{"attachmentId":"original"}}]}]})));
        assert!(super::contains_asset_reference(&json!({"seed":{"nodes":{"n":{"brush":{"tipAssetId":"tip"}}}}})));
        assert!(!super::contains_asset_reference(&json!({"scene":{"assets":{},"nodes":{}}})));
    }

}
