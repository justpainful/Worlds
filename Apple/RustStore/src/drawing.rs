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
    let root_path = database.parent().ok_or_else(|| anyhow::anyhow!("invalid database path"))?.join("attachments");
    reject_symlink_ancestors(&root_path)?;
    let root = root_path.canonicalize()?;
    if !root.is_dir() { bail!("attachment directory unavailable") }
    for item in assets.values() {
        let id = item["attachmentId"].as_str().ok_or_else(|| anyhow::anyhow!("missing attachment ID"))?;
        let original = store::get_attachment(conn, id)?.ok_or_else(|| anyhow::anyhow!("missing original attachment"))?;
        if original.page_id.as_deref() != Some(page) { bail!("asset is not owned by the drawing") }
        let relative = Path::new(&original.rel_path);
        if relative.as_os_str().is_empty() || !relative.components().all(|part| matches!(part, Component::Normal(_))) { bail!("invalid attachment path") }
        let path = root.join(relative);
        reject_symlink_ancestors(&path)?;
        let resolved = path.canonicalize()?;
        if !resolved.starts_with(&root) { bail!("attachment escapes its directory") }
        let metadata = std::fs::metadata(resolved)?;
        if !metadata.is_file() || original.size < 0 || metadata.len() != original.size as u64 { bail!("original attachment missing or changed") }
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
    validate_owned_assets(&tx, path, page, &doc["scene"])?;
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
        let saved = super::apply_personal(&path,"fixture-page",add).unwrap();
        assert_eq!(saved["revision"],1);
        assert_eq!(saved["scene"]["assets"]["asset"]["attachmentId"],"a");
        let edit = json!({"id":"after-asset","actor":"artist","base":1,"at":2,"label":"Edit","type":"edit","changes":[]});
        std::fs::remove_file(&file).unwrap();
        assert!(super::apply_personal(&path,"fixture-page",edit.clone()).is_err());
        assert_eq!(super::load_personal(&path,"fixture-page").unwrap(),saved);
        std::fs::write(&file, [1u8,2,3]).unwrap();
        conn.execute("UPDATE attachments SET page_id=NULL WHERE id='a'", []).unwrap();
        assert!(super::apply_personal(&path,"fixture-page",edit.clone()).is_err());
        conn.execute("UPDATE attachments SET page_id='fixture-page',rel_path='../outside' WHERE id='a'", []).unwrap();
        assert!(super::apply_personal(&path,"fixture-page",edit).is_err());
        assert_eq!(super::load_personal(&path,"fixture-page").unwrap(),saved);
        conn.execute("UPDATE attachments SET rel_path='2026-01/asset.png' WHERE id='a'", []).unwrap();
        conn.execute("INSERT INTO drawing_sync_state(page_id,server_url,workspace_id,user_id,basis,updated_at) VALUES('fixture-page','https://example.test','w','u','{}',1)", []).unwrap();
        let denied = json!({"id":"sync-denied","actor":"artist","base":1,"at":3,"label":"Shared","type":"edit","changes":[]});
        assert!(super::apply_personal(&path,"fixture-page",denied).is_err());
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

}
