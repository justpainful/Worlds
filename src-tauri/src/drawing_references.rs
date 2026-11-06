//! Resolve a linked resource with the viewer's source rights. A denied, missing
//! or deleted source has one indistinguishable response and no cached title.
use crate::account::permissions::{require, Level};
use crate::{db, drawing, store, AppState};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::State;
pub fn search(conn: &Connection, query: &str, editable: bool) -> Result<Vec<store::PageMeta>> {
    let q = query.trim().to_lowercase();
    Ok(store::list_pages(conn, false)?.into_iter().filter(|p| !p.archived && p.kind != "template" && (!editable || matches!(p.kind.as_str(), "page" | "document" | "presentation")) && p.title.to_lowercase().contains(&q) && require(conn, &p.id, if editable { Level::Edit } else { Level::View }).is_ok()).take(100).collect())
}

fn count_tasks(value: &Value, done: &mut usize, total: &mut usize) {
    if value["type"] == "taskItem" { *total += 1; if value["attrs"]["checked"] == true { *done += 1; } }
    if let Some(children) = value["content"].as_array() { for child in children { count_tasks(child, done, total); } }
}
pub fn read(conn: &Connection, source: &str) -> Result<Value> {
    let unavailable = || json!({ "state": "unavailable", "checkedAt": db::now() });
    if require(conn, source, Level::View).is_err() { return Ok(unavailable()); }
    let Some(page) = store::get_page(conn, source)? else { return Ok(unavailable()); };
    if page.meta.deleted_at.is_some() { return Ok(unavailable()); }
    let mut done = 0; let mut total = 0;
    for b in &page.blocks { count_tasks(&b.content, &mut done, &mut total); }
    let image = page.metadata.pointer("/file/attachmentId").and_then(Value::as_str).and_then(|id| page.attachments.iter().find(|a| a.id == id && a.mime.starts_with("image/") && a.mime != "image/svg+xml"));
    Ok(json!({ "state": "ready", "sourceId": source, "title": page.meta.title.chars().take(300).collect::<String>(), "kind": page.meta.kind, "excerpt": page.meta.preview.chars().take(240).collect::<String>(), "updatedAt": page.meta.updated_at, "checkedAt": db::now(), "tasksDone": done, "tasksTotal": total, "imageAttachmentId": image.map(|a| &a.id), "imageMime": image.map(|a| &a.mime), "imageWidth": image.and_then(|a| a.width), "imageHeight": image.and_then(|a| a.height) }))
}

/// Prepare outside networking; source policies remain independent of the host.
pub fn prepare_read(conn:&Connection,source:&str)->Result<crate::drawing_export::Prepared>{
 if read(conn,source)?["state"]!="ready"{bail!("Source unavailable");}crate::drawing_export::prepare_read(conn,source)
}
pub fn finish_read(conn:&Connection,plan:&crate::drawing_export::Prepared)->Result<Value>{crate::drawing_export::recheck(conn,plan)?;read(conn,&plan.context.page_id)}
pub fn read_failure(error:&anyhow::Error)->Value{let offline=error.chain().filter_map(|e|e.downcast_ref::<reqwest::Error>()).any(|e|e.is_connect()||e.is_timeout());json!({"state":if offline{"offline"}else{"unavailable"},"checkedAt":db::now()})}

pub fn create_task(conn: &Connection, drawing_id: &str, frame_id: &str, camera: Value, title: &str) -> Result<store::PageMeta> {
    if conn.is_autocommit() { let tx = conn.unchecked_transaction()?; let result = create_task(&tx, drawing_id, frame_id, camera, title)?; tx.commit()?; return Ok(result); }
    require(conn, drawing_id, Level::Edit)?;
    if title.trim().is_empty() || title.chars().count() > 300 { bail!("Give the linked task a title"); }
    let doc = drawing::load(conn, drawing_id)?;
    if doc["scene"]["frames"].get(frame_id).is_none() { bail!("The source frame no longer exists"); }
    for key in ["x", "y", "w", "h"] { let n = camera[key].as_f64().ok_or_else(|| anyhow!("Invalid task region"))?; if !n.is_finite() || n.abs() > 10000000.0 || (["w", "h"].contains(&key) && n <= 0.0) { bail!("Invalid task region"); } }
    let task_id = db::new_id();
    store::create_page(conn, &store::Ctx::user(), store::NewPage {
        title: Some(title.trim().into()), parent_id: Some(drawing_id.into()), kind: Some("page".into()), icon: Some("pi:checklist".into()),
        metadata: Some(json!({ "drawingTask": { "drawingId": drawing_id, "frameId": frame_id, "camera": camera, "taskId": task_id } })),
        blocks: Some(vec![json!({ "type": "taskList", "attrs": { "bid": task_id }, "content": [{ "type": "taskItem", "attrs": { "checked": false }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": title.trim() }] }] }] }), json!({ "type": "drawingEmbed", "attrs": { "pageId": drawing_id, "frameId": frame_id, "camera": camera, "versionId": null } })]), ..Default::default()
    })
}
pub fn insert_embed(conn: &Connection, drawing_id: &str, target_id: &str, frame_id: &str, camera: Value, version_id: Option<&str>) -> Result<()> {
    if conn.is_autocommit() { let tx = conn.unchecked_transaction()?; insert_embed(&tx, drawing_id, target_id, frame_id, camera, version_id)?; tx.commit()?; return Ok(()); }
    require(conn, drawing_id, Level::View)?; require(conn, target_id, Level::Edit)?;
    let target = store::page_meta_by_id(conn, target_id)?.ok_or_else(|| anyhow!("Target page unavailable"))?;
    if target.deleted_at.is_some() || !matches!(target.kind.as_str(), "page" | "document" | "presentation") { bail!("Choose an editable page, document or presentation"); }
    let scene = if let Some(version) = version_id { drawing::version_scene(conn, drawing_id, version)? } else { drawing::load(conn, drawing_id)?["scene"].clone() };
    if scene["frames"].get(frame_id).is_none() { bail!("The frame is unavailable"); }
    for key in ["x", "y", "w", "h"] { let n = camera[key].as_f64().ok_or_else(|| anyhow!("Invalid embedded region"))?; if !n.is_finite() || n.abs() > 10000000.0 || (["w", "h"].contains(&key) && n <= 0.0) { bail!("Invalid embedded region"); } }
    store::insert_blocks(conn, &store::Ctx::user(), target_id, None, vec![json!({ "type": "drawingEmbed", "attrs": { "pageId": drawing_id, "frameId": frame_id, "camera": camera, "versionId": version_id } })])?;
    Ok(())
}
#[tauri::command]
pub async fn drawing_reference_read(state: State<'_, AppState>, source_id: String,token:Option<String>,offline:Option<bool>) -> Result<Value, String> {
 let plan={let conn=state.conn();match prepare_read(&conn,&source_id){Ok(plan)=>plan,Err(_)=>return Ok(json!({"state":"unavailable","checkedAt":db::now()}))}};
 if offline.unwrap_or(false)&&crate::drawing_export::needs_token(&plan){return Ok(json!({"state":"offline","checkedAt":db::now()}));}
 if let Err(error)=crate::drawing_export::authorize(&plan,token.as_deref()).await{return Ok(read_failure(&error));}
 finish_read(&state.conn(),&plan).map_err(|e|format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_reference_task(state: State<'_, AppState>, page_id: String, frame_id: String, camera: Value, title: String) -> Result<store::PageMeta, String> { create_task(&state.conn(), &page_id, &frame_id, camera, &title).map_err(|e| format!("{e:#}")) }
#[tauri::command]
pub async fn drawing_embed_insert(state: State<'_, AppState>, page_id: String, target_id: String, frame_id: String, camera: Value, version_id: Option<String>) -> Result<(), String> { insert_embed(&state.conn(), &page_id, &target_id, &frame_id, camera, version_id.as_deref()).map_err(|e| format!("{e:#}")) }
#[tauri::command]
pub async fn drawing_reference_search(state: State<'_, AppState>, query: String, editable: bool,token:Option<String>,offline:Option<bool>) -> Result<Vec<store::PageMeta>, String> {
 let plans={let conn=state.conn();search(&conn,&query,editable).map_err(|e|format!("{e:#}"))?.into_iter().filter_map(|page|prepare_read(&conn,&page.id).ok().filter(|plan|!offline.unwrap_or(false)||!crate::drawing_export::needs_token(plan)).map(|plan|(page,plan))).collect::<Vec<_>>()};
 let mut available=Vec::new();for chunk in plans.chunks(2){let first=crate::drawing_export::authorize(&chunk[0].1,token.as_deref());let second=async{if chunk.len()>1{crate::drawing_export::authorize(&chunk[1].1,token.as_deref()).await}else{Ok(())}};let(a,b)=tokio::join!(first,second);for((page,plan),allowed)in chunk.iter().zip([a,b]){if allowed.is_ok(){let conn=state.conn();if finish_read(&conn,plan).is_ok_and(|v|v["state"]=="ready"){if let Some(meta)=store::page_meta_by_id(&conn,&page.id).map_err(|e|format!("{e:#}"))?{available.push(meta);}}}}}Ok(available)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn owned_snapshot_survives_source_deletion_and_relink_undo(){let dir=std::env::temp_dir().join(format!("worlds-reference-snapshot-{}",db::new_id()));let status=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","drawing_references::tests::snapshot_child","--nocapture"]).env("WORLDS_REFERENCE_SNAPSHOT_CHILD","1").env("WORLDS_DATA_DIR",&dir).status().unwrap();assert!(status.success());println!("native reference snapshot evidence: {}",dir.display());}
    #[test]fn snapshot_child(){if std::env::var("WORLDS_REFERENCE_SNAPSHOT_CHILD").is_err(){return;}use base64::Engine;let dir=db::data_dir();assert!(dir.starts_with(std::env::temp_dir()));let conn=db::open(&dir.join("worlds.db")).unwrap();let source=store::create_page(&conn,&store::Ctx::user(),store::NewPage{title:Some("Owned source preview".into()),kind:Some("file".into()),..Default::default()}).unwrap();let target=store::create_page(&conn,&store::Ctx::user(),store::NewPage{kind:Some("drawing".into()),..Default::default()}).unwrap();let bytes=base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAKc5Z5gAAAABJRU5ErkJggg==").unwrap();let original=store::add_attachment_bytes(&conn,Some(&source.id),"source.png",&bytes).unwrap();store::set_page_meta(&conn,&store::Ctx::user(),&source.id,"file",json!({"attachmentId":original.id})).unwrap();let data=read(&conn,&source.id).unwrap();assert_eq!(data["imageAttachmentId"],original.id);let mut scene=drawing::initial_scene(&target.id);let layer=scene["layerOrder"][0].clone();let frame=scene["defaultFrameId"].clone();scene["nodes"]["ref"]=json!({"id":"ref","kind":"reference","name":"Frozen reference","sourceId":source.id,"sourceMode":"snapshot","referenceSnapshot":{"title":data["title"],"kind":data["kind"],"checkedAt":data["checkedAt"],"updatedAt":data["updatedAt"]},"assetId":"frozen","layerId":layer,"frameId":frame,"x":10,"y":10,"w":320,"h":180,"rotation":0,"opacity":1,"visible":true,"locked":false,"paint":{"fill":"#f6f6f6","stroke":"#202023","strokeWidth":0,"dash":[]},"textStyle":{"font":"Arial","size":16,"leading":1.7},"effects":[]});scene["nodeOrder"]=json!(["ref"]);scene["assets"]["frozen"]=json!({"id":"frozen","attachmentId":original.id,"name":"Snapshot","mime":"image/png","width":1,"height":1});let owned=drawing::materialize_scene_assets(&conn,&target.id,scene).unwrap();let copied=store::get_attachment(&conn,owned["assets"]["frozen"]["attachmentId"].as_str().unwrap()).unwrap().unwrap();assert_ne!(copied.id,original.id);assert_eq!(copied.page_id.as_deref(),Some(target.id.as_str()));drawing::history_import(&conn,&target.id,json!({"revision":0,"seed":owned,"scene":owned,"operations":[]})).unwrap();store::delete_page(&conn,&store::Ctx::user(),&source.id).unwrap();assert_eq!(read(&conn,&source.id).unwrap()["state"],"unavailable");store::purge_page(&conn,&source.id).unwrap();conn.execute("DELETE FROM attachments WHERE id=?1",[&original.id]).unwrap();assert!(store::get_attachment(&conn,&original.id).unwrap().is_none());assert_eq!(std::fs::read(store::attachment_abs_path(&copied)).unwrap(),bytes);let frozen=drawing::load(&conn,&target.id).unwrap();assert_eq!(frozen["scene"]["nodes"]["ref"]["referenceSnapshot"]["title"],"Owned source preview");let replacement=store::create_page(&conn,&store::Ctx::user(),store::NewPage{title:Some("Accessible replacement".into()),..Default::default()}).unwrap();let actor=store::profile(&conn).unwrap().id;drawing::apply(&conn,&store::Ctx::user(),&target.id,json!({"id":"relink","actor":actor,"base":0,"at":1,"label":"Relink source","type":"edit","changes":[{"type":"patch","collection":"nodes","id":"ref","fields":{"sourceId":replacement.id,"sourceMode":"live","referenceSnapshot":null,"assetId":null}}]})).unwrap();let relinked=drawing::load(&conn,&target.id).unwrap();assert_eq!(relinked["scene"]["nodes"]["ref"]["sourceId"],replacement.id);assert!(relinked["scene"]["nodes"]["ref"]["referenceSnapshot"].is_null());let undo=drawing::history_toggle(&conn,&target.id,1,&db::new_id(),false,&actor).unwrap();assert_eq!(undo["document"]["scene"],frozen["scene"]);std::fs::write(dir.join("reference-snapshot-result.json"),json!({"passed":true,"checks":["source image is copied to a distinct destination-owned original","source deletion and purge remove its identity while destination-owned immutable bytes remain exact","frozen content retains capture time and title after source loss","relink clears live-preview data and uses an accessible independent source","author Undo restores the complete frozen snapshot without source access"]}).to_string()).unwrap();}
    #[test]
    fn references_never_disclose_denied_or_deleted_sources_and_tasks_keep_a_return_region() {
        let path = std::env::temp_dir().join(format!("worlds-drawing-reference-{}.db", db::new_id())); let conn = db::open(&path).unwrap();
        let source = store::create_page(&conn, &store::Ctx::user(), store::NewPage { title: Some("Private title".into()), kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let frame = drawing::load(&conn, &source.id).unwrap()["scene"]["defaultFrameId"].as_str().unwrap().to_owned();
        let camera = json!({ "x": 25, "y": 35, "w": 300, "h": 220 });
        let task = create_task(&conn, &source.id, &frame, camera.clone(), "Review this region").unwrap();
        let preview = read(&conn, &task.id).unwrap(); assert_eq!(preview["tasksDone"], 0); assert_eq!(preview["tasksTotal"], 1);
        let task_page = store::get_page(&conn, &task.id).unwrap().unwrap(); assert_eq!(task_page.blocks[1].content["attrs"]["camera"], camera); assert_eq!(task_page.blocks[1].content["attrs"]["pageId"], source.id);
        assert_eq!(task_page.metadata["drawingTask"]["taskId"], task_page.blocks[0].id);
        let mut checked = task_page.blocks[0].content.clone(); checked["content"][0]["attrs"]["checked"] = json!(true); store::update_block(&conn, &store::Ctx::user(), &task_page.blocks[0].id, checked).unwrap();
        assert_eq!(read(&conn, &task.id).unwrap()["tasksDone"], 1);
        insert_embed(&conn, &source.id, &task.id, &frame, camera.clone(), None).unwrap();
        assert_eq!(store::get_page(&conn, &task.id).unwrap().unwrap().blocks.iter().filter(|b| b.content["type"] == "drawingEmbed").count(), 2);
        conn.execute("UPDATE pages SET workspace_id = 'revoked-team' WHERE id = ?1", [&source.id]).unwrap();
        let denied = read(&conn, &source.id).unwrap(); let absent = read(&conn, "missing").unwrap();
        assert_eq!(denied["state"], absent["state"]); assert!(denied.get("title").is_none()); assert!(!denied.to_string().contains("Private title"));
        assert!(!search(&conn, "Private", false).unwrap().iter().any(|p| p.id == source.id));
        assert!(insert_embed(&conn, &source.id, &task.id, &frame, camera.clone(), None).is_err());
        assert!(create_task(&conn, &source.id, &frame, camera, "Denied").is_err());
        store::delete_page(&conn, &store::Ctx::user(), &task.id).unwrap(); assert_eq!(read(&conn, &task.id).unwrap()["state"], "unavailable");
        drop(conn); let _ = std::fs::remove_file(path);
    }
}
