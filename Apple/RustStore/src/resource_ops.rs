use super::*;
use std::collections::HashSet;

fn blocks(c: &Connection, page: &str) -> Result<Vec<(String, Value)>> {
    c.prepare("SELECT id,content FROM blocks WHERE page_id=?1 ORDER BY sort_key")?
        .query_map([page], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?
        .map(|row| { let (id, raw) = row?; Ok((id, serde_json::from_str(&raw)?)) }).collect()
}
fn snapshot(c: &Connection, id: &str) -> Result<Value> {
    require_personal(c, id)?;
    let (kind, revision, metadata): (String,i64,String) = c.query_row("SELECT kind,updated_at,metadata FROM pages WHERE id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    if kind != "project" && kind != "gallery" && kind != "stream" { bail!("unsupported resource kind") }
    let metadata: Value = serde_json::from_str(&metadata)?;
    let current = blocks(c, id)?;
    if kind == "project" { project_links(c, &metadata)?; } else if kind == "gallery" { attachment_ids(c, &current)?; }
    let entries: Vec<Value> = current.into_iter().map(|(id,content)| serde_json::json!({"id":id,"content":content})).collect();
    Ok(serde_json::json!({"id":id,"kind":kind,"revision":revision,"metadata":metadata,"blocks":entries}))
}
pub fn read_resource(path: &Path, id: &str) -> Result<Value> {
    let mut connection = open_existing(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
    let value = snapshot(&tx,id)?;
    tx.commit()?; Ok(value)
}
fn check_metadata(c: &Connection, id: &str, base: i64, expected: &Value, kind: &str) -> Result<()> {
    require_personal(c,id)?;
    let (actual_kind, at, raw): (String,i64,String) = c.query_row("SELECT kind,updated_at,metadata FROM pages WHERE id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    if actual_kind != kind { bail!("invalid resource kind") }
    if at != base || serde_json::from_str::<Value>(&raw)? != *expected { bail!("conflict: resource metadata changed") }
    Ok(())
}
fn metadata_key<'a>(expected: &Value, replacement: &'a Value, key: &str) -> Result<&'a Value> {
    let mut old = expected.as_object().cloned().ok_or_else(||anyhow::anyhow!("invalid metadata"))?;
    let mut new = replacement.as_object().cloned().ok_or_else(||anyhow::anyhow!("invalid metadata"))?;
    old.remove(key);
    let value = new.remove(key).ok_or_else(||anyhow::anyhow!("missing metadata key"))?;
    if old != new || !value.is_object() { bail!("invalid metadata: unrelated fields changed") }
    Ok(replacement.get(key).unwrap())
}
fn project_links(c: &Connection, metadata: &Value) -> Result<()> {
    let Some(project) = metadata.get("project") else { return Ok(()) };
    if project.is_null() { return Ok(()) }
    let object = project.as_object().ok_or_else(||anyhow::anyhow!("invalid project metadata"))?;
    let Some(value) = object.get("links") else { return Ok(()) };
    for link in value.as_array().ok_or_else(||anyhow::anyhow!("invalid links"))? {
        require_personal(c,link.as_str().ok_or_else(||anyhow::anyhow!("invalid link"))?)?;
    }
    Ok(())
}
fn validate_new_project(c: &Connection, id: &str, old: &Value, next: &Value) -> Result<()> {
    let object = next.get("project").and_then(Value::as_object).ok_or_else(||anyhow::anyhow!("invalid project metadata"))?;
    if let Some(status) = object.get("status") {
        if !matches!(status.as_str(), Some("planned" | "active" | "paused" | "done")) { bail!("invalid project status") }
    }
    for key in ["start", "due"] {
        if let Some(value) = object.get(key) {
            if !value.is_null() {
                let text = value.as_str().ok_or_else(||anyhow::anyhow!("invalid date"))?;
                let date = chrono::NaiveDate::parse_from_str(text,"%Y-%m-%d")?;
                if date.format("%Y-%m-%d").to_string() != text { bail!("invalid date") }
            }
        }
    }
    if object.get("description").is_some_and(|v|!v.is_string()) { bail!("invalid description") }
    let mut previous = HashSet::new();
    for value in old.pointer("/project/links").and_then(Value::as_array).into_iter().flatten() {
        let target = value.as_str().ok_or_else(||anyhow::anyhow!("invalid old project link"))?;
        if !previous.insert(target) { bail!("ambiguous old project links") }
    }
    let mut seen = HashSet::new();
    if let Some(links) = object.get("links") {
        for value in links.as_array().ok_or_else(||anyhow::anyhow!("invalid links"))? {
            let target = value.as_str().ok_or_else(||anyhow::anyhow!("invalid link"))?;
            if !seen.insert(target) { bail!("duplicate project link") }
            if !previous.contains(target) {
                let (kind,parent,archived): (String,Option<String>,i64) = c.query_row("SELECT kind,parent_id,archived FROM pages WHERE id=?1",[target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
                if target == id || kind == "template" || (parent.as_deref() == Some(id) && archived == 0) { bail!("invalid project link") }
            }
        }
    }
    Ok(())
}
pub fn save_project(path: &Path, id: &str, base: i64, expected: Value, metadata: Value) -> Result<Value> {
    let mut connection = open_existing(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    check_metadata(&tx,id,base,&expected,"project")?;
    project_links(&tx,&expected)?; project_links(&tx,&metadata)?;
    validate_new_project(&tx,id,&expected,&metadata)?;
    let project = metadata_key(&expected,&metadata,"project")?.clone();
    store::set_page_meta(&tx,&store::Ctx::user(),id,"project",project)?;
    let result = snapshot(&tx,id)?;
    tx.commit()?; Ok(result)
}

/// Updates only URL and format in the original stream metadata. Unknown stream
/// fields and every unrelated metadata key are retained from the CAS baseline.
pub fn save_stream(path: &Path, id: &str, base: i64, expected: Value, url: &str) -> Result<Value> {
    if !expected.is_object() { bail!("invalid resource metadata") }
    let raw=url.trim();
    if raw.is_empty() || raw.len()>65536 || raw.bytes().any(|b| b.is_ascii_control()) { bail!("invalid stream URL") }
    let parsed=url::Url::parse(raw).map_err(|_|anyhow::anyhow!("invalid stream URL"))?;
    if !matches!(parsed.scheme(),"http" | "https") || parsed.host_str().is_none() { bail!("invalid stream URL") }
    let path_part=raw.split(['?', '#']).next().unwrap_or("").to_lowercase();
    let format=if path_part.ends_with(".m3u8") || path_part.ends_with(".m3u") { "hls" } else if path_part.ends_with(".mpd") { "dash" } else { "progressive" };
    let mut connection=open_existing(path)?;
    let tx=connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    check_metadata(&tx,id,base,&expected,"stream")?;
    let mut stream=match expected.get("stream") {
        None | Some(Value::Null) => serde_json::Map::new(),
        Some(Value::Object(object)) => object.clone(),
        _ => bail!("invalid stream metadata"),
    };
    stream.insert("url".into(),Value::String(raw.to_owned()));
    stream.insert("format".into(),Value::String(format.into()));
    store::set_page_meta(&tx,&store::Ctx::user(),id,"stream",Value::Object(stream))?;
    let result=snapshot(&tx,id)?;
    tx.commit()?; Ok(result)
}
fn attachment_ids(c: &Connection, entries: &[(String,Value)]) -> Result<()> {
    for (_, value) in entries {
        if value.get("type").and_then(Value::as_str) != Some("galleryItem") { continue }
        let id = value.pointer("/attrs/attachmentId").and_then(Value::as_str).filter(|s|!s.is_empty()).ok_or_else(||anyhow::anyhow!("invalid gallery attachment"))?;
        let owner: Option<Option<String>> = c.query_row("SELECT page_id FROM attachments WHERE id=?1", [id], |r|r.get(0)).optional()?;
        let owner = owner.flatten().ok_or_else(||anyhow::anyhow!("attachment unavailable or owner not established"))?;
        require_personal(c,&owner)?;
    }
    Ok(())
}
pub fn save_gallery(path: &Path, id: &str, base: i64, expected_metadata: Value, metadata: Value, expected: Vec<BlockInput>, next: Vec<BlockInput>) -> Result<Value> {
    let mut connection = open_existing(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let out = save_gallery_transaction(&tx,id,base,expected_metadata,metadata,expected,next)?;
    tx.commit()?; Ok(out)
}
/// Caller owns the transaction, allowing an isolated importer to register the
/// attachment and gallery block together. This alone does not publish files.
pub(crate) fn save_gallery_transaction(tx: &Connection, id: &str, base: i64, expected_metadata: Value, metadata: Value, expected: Vec<BlockInput>, next: Vec<BlockInput>) -> Result<Value> {
    check_metadata(tx,id,base,&expected_metadata,"gallery")?;
    let before = blocks(tx,id)?;
    if before.len() != expected.len() || before.iter().zip(&expected).any(|((id,value),e)|id != &e.id || value != &e.content) { bail!("conflict: gallery blocks changed") }
    let old_opaque: Vec<_> = before.iter().filter(|(_,v)|v.get("type").and_then(Value::as_str) != Some("galleryItem")).collect();
    let next_pairs: Vec<_> = next.iter().map(|b|(b.id.clone(),b.content.clone())).collect();
    let new_opaque: Vec<_> = next_pairs.iter().filter(|(_,v)|v.get("type").and_then(Value::as_str) != Some("galleryItem")).collect();
    if old_opaque != new_opaque { bail!("invalid change: unknown blocks must be preserved") }
    let mut seen = HashSet::new();
    for item in &next {
        if item.id.is_empty() || !seen.insert(&item.id) || item.content.pointer("/attrs/bid").and_then(Value::as_str) != Some(item.id.as_str()) { bail!("invalid block identity") }
        let owner: Option<String> = tx.query_row("SELECT page_id FROM blocks WHERE id=?1",[&item.id],|r|r.get(0)).optional()?;
        if owner.as_deref().is_some_and(|other| other != id) { bail!("conflict: block belongs to another page") }
    }
    attachment_ids(&tx,&before)?; attachment_ids(&tx,&next_pairs)?;
    let gallery = if metadata != expected_metadata { Some(metadata_key(&expected_metadata,&metadata,"gallery")?.clone()) } else { None };
    store::snapshot_before_user_edit(&tx,id)?;
    let input = next.into_iter().map(|item| store::BlockInput {id:item.id,content:item.content}).collect();
    let result = store::save_blocks(&tx,&store::Ctx::user(),id,input)?;
    if !result.remapped.is_empty() { bail!("conflict: block IDs were remapped") }
    if let Some(value) = gallery { store::set_page_meta(&tx,&store::Ctx::user(),id,"gallery",value)?; }
    snapshot(tx,id)
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> std::path::PathBuf {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db");
        let path = std::env::temp_dir().join(format!("worlds-resource-{}.db",uuid::Uuid::new_v4()));
        std::fs::copy(src,&path).unwrap();
        let c = Connection::open(&path).unwrap();
        c.execute_batch("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('p','Project','project','{\"project\":{\"status\":\"active\",\"links\":[]},\"other\":true}',1,100),('g','Gallery','gallery','{\"gallery\":{\"view\":\"grid\"}}',1,100); INSERT INTO pages(id,title,kind,metadata,workspace_id,created_at,updated_at) VALUES('private','Private','page','{}','team',1,100); INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','fixture-page','image','a.png','image/png',1,'test/a.png',1),('secret','private','image','s.png','image/png',1,'test/s.png',1);").unwrap();
        drop(c); path
    }
    fn gallery(id:&str, attachment:&str) -> BlockInput {
        BlockInput{id:id.into(),content:json!({"type":"galleryItem","attrs":{"bid":id,"attachmentId":attachment,"name":"a.png","mime":"image/png","size":1,"kind":"image","caption":""}})}
    }
    #[test]
    fn stream_save_preserves_unknown_fields_and_rejects_conflicts_and_shared_pages() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('s','Stream','stream',?1,1,100)",[json!({"other":{"x":1},"stream":{"url":"https://old.test/video","format":"progressive","future":{"keep":true}}}).to_string()]).unwrap();
        drop(c);
        let old=read_resource(&path,"s").unwrap();
        let saved=save_stream(&path,"s",100,old["metadata"].clone(),"  https://example.test/live.M3U8?token=abc  ").unwrap();
        assert_eq!(saved["metadata"]["stream"]["url"],"https://example.test/live.M3U8?token=abc");
        assert_eq!(saved["metadata"]["stream"]["format"],"hls");
        assert_eq!(saved["metadata"]["stream"]["future"],json!({"keep":true}));
        assert_eq!(saved["metadata"]["other"],json!({"x":1}));
        assert!(save_stream(&path,"s",100,old["metadata"].clone(),"https://example.test/file").is_err());
        let revision=saved["revision"].as_i64().unwrap();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata=json_set(metadata,'$.other.x',2) WHERE id='s'",[]).unwrap(); drop(c);
        assert!(save_stream(&path,"s",revision,saved["metadata"].clone(),"https://example.test/file").is_err());
        let current=read_resource(&path,"s").unwrap();
        assert!(save_stream(&path,"s",revision,current["metadata"].clone(),"file:///etc/passwd").is_err());
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET workspace_id='team' WHERE id='s'",[]).unwrap(); drop(c);
        assert!(save_stream(&path,"s",revision,current["metadata"].clone(),"https://example.test/a.mpd").is_err());
        let c=Connection::open(&path).unwrap();
        let raw:String=c.query_row("SELECT metadata FROM pages WHERE id='s'",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),current["metadata"]);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn stream_ffi_reads_and_saves_original_metadata_shape() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('s','Stream','stream','{}',1,100)",[]).unwrap(); drop(c);
        let invoke=|request: Value| -> Value {
            let bytes=request.to_string(); let ptr=unsafe { crate::worlds_store_call(bytes.as_ptr(),bytes.len()) };
            let value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_str().unwrap()).unwrap();
            unsafe { crate::worlds_store_free(ptr) }; value
        };
        let read=invoke(json!({"operation":"read_resource","path":path,"page":"s"}));
        assert_eq!(read["ok"],true);
        let saved=invoke(json!({"operation":"save_stream","path":path,"page":"s","base":read["value"]["revision"],"expected_metadata":read["value"]["metadata"],"url":"https://example.test/video.m3u#part"}));
        assert_eq!(saved["ok"],true,"{saved}");
        assert_eq!(saved["value"]["metadata"]["stream"]["format"],"hls");
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ffi_project_and_gallery_request_names_are_accepted() {
        let path=fixture();
        let read=json!({"operation":"read_resource","path":path,"page":"p"}).to_string();
        let pointer=unsafe { crate::worlds_store_call(read.as_ptr(),read.len()) };
        let response:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(pointer) }.to_str().unwrap()).unwrap();
        unsafe { crate::worlds_store_free(pointer) };
        assert_eq!(response["ok"],true);
        let record=&response["value"]; let mut changed=record["metadata"].clone(); changed["project"]["status"]=json!("done");
        let request=json!({"operation":"save_project","path":path,"page":"p","base":record["revision"],"expected_metadata":record["metadata"],"metadata":changed}).to_string();
        let pointer=unsafe { crate::worlds_store_call(request.as_ptr(),request.len()) };
        let saved:Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(pointer) }.to_str().unwrap()).unwrap();
        unsafe { crate::worlds_store_free(pointer) };
        assert_eq!(saved["ok"],true,"{saved}");
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn project_updates_index_and_detects_same_revision_metadata_change() {
        let path=fixture();
        let old=read_resource(&path,"p").unwrap(); let base=old["revision"].as_i64().unwrap();
        let mut new=old["metadata"].clone(); new["project"]["description"]=json!("searchable project detail");
        let result=save_project(&path,"p",base,old["metadata"].clone(),new).unwrap();
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'searchable'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='p'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        c.execute("UPDATE pages SET metadata=json_set(metadata,'$.other',false) WHERE id='p'",[]).unwrap(); drop(c);
        assert!(save_project(&path,"p",result["revision"].as_i64().unwrap(),result["metadata"].clone(),result["metadata"].clone()).is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn gallery_checks_attachment_access_and_never_deletes_originals() {
        let path=fixture();
        let old=read_resource(&path,"g").unwrap(); let base=old["revision"].as_i64().unwrap();
        let added=save_gallery(&path,"g",base,old["metadata"].clone(),old["metadata"].clone(),vec![],vec![gallery("b","a")]).unwrap();
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM blocks WHERE page_id='g'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE page_id='g' AND kind='edited'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='g' AND kind='blocks'",[],|r|r.get::<_,i64>(0)).unwrap(),1); drop(c);
        let denied=save_gallery(&path,"g",added["revision"].as_i64().unwrap(),added["metadata"].clone(),added["metadata"].clone(),vec![gallery("b","a")],vec![gallery("b","a"),gallery("s","secret")]);
        assert!(denied.is_err());
        let removed=save_gallery(&path,"g",added["revision"].as_i64().unwrap(),added["metadata"].clone(),added["metadata"].clone(),vec![gallery("b","a")],vec![]).unwrap();
        assert!(removed["blocks"].as_array().unwrap().is_empty());
        let c=Connection::open(&path).unwrap(); assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE id='a'",[],|r|r.get::<_,i64>(0)).unwrap(),1); drop(c);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn gallery_attachment_and_block_share_transaction_and_roll_back() {
        let path=fixture(); let old=read_resource(&path,"g").unwrap();
        let mut c=Connection::open(&path).unwrap();
        {
            let tx=c.transaction().unwrap();
            tx.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('new','g','image','n.png','image/png',4,'2026-11/n.png',1)",[]).unwrap();
            assert!(save_gallery_transaction(&tx,"g",old["revision"].as_i64().unwrap(),old["metadata"].clone(),old["metadata"].clone(),vec![],vec![gallery("b","new")]).is_ok());
            tx.rollback().unwrap();
        }
        assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE id='new'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("SELECT count(*) FROM blocks WHERE page_id='g'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        {
            let tx=c.transaction().unwrap();
            tx.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('new','g','image','n.png','image/png',4,'2026-11/n.png',1)",[]).unwrap();
            save_gallery_transaction(&tx,"g",old["revision"].as_i64().unwrap(),old["metadata"].clone(),old["metadata"].clone(),vec![],vec![gallery("b","new")]).unwrap();
            tx.commit().unwrap();
        }
        assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE id='new'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM blocks WHERE page_id='g'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn gallery_refuses_dropping_unknown_blocks() {
        let path=fixture();
        let opaque = json!({"type":"futureBlock","attrs":{"bid":"opaque","payload":"keep"}});
        let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('opaque','g','futureBlock',0,?1,1,1)",[opaque.to_string()]).unwrap(); drop(c);
        let snapshot=read_resource(&path,"g").unwrap();
        let expected=vec![BlockInput{id:"opaque".into(),content:opaque}];
        assert!(save_gallery(&path,"g",snapshot["revision"].as_i64().unwrap(),snapshot["metadata"].clone(),snapshot["metadata"].clone(),expected,vec![]).is_err());
        let c=Connection::open(&path).unwrap(); assert_eq!(c.query_row("SELECT count(*) FROM blocks WHERE id='opaque'",[],|r|r.get::<_,i64>(0)).unwrap(),1); drop(c);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn project_rejects_shared_links_and_preserves_source() {
        let path=fixture(); let original=read_resource(&path,"p").unwrap();
        let mut changed=original["metadata"].clone(); changed["project"]["links"]=json!(["private"]);
        assert!(save_project(&path,"p",100,original["metadata"].clone(),changed).is_err());
        assert_eq!(read_resource(&path,"p").unwrap()["metadata"],original["metadata"]);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn new_project_link_rechecks_target_kind_parent_and_deletion() {
        for mutation in [
            "UPDATE pages SET kind='template' WHERE id='fixture-page'",
            "UPDATE pages SET parent_id='p',archived=0 WHERE id='fixture-page'",
            "UPDATE pages SET deleted_at=1 WHERE id='fixture-page'",
        ] {
            let path=fixture();
            let original=read_resource(&path,"p").unwrap();
            let mut replacement=original["metadata"].clone();
            replacement["project"]["links"]=json!(["fixture-page"]);
            let c=Connection::open(&path).unwrap(); c.execute(mutation,[]).unwrap(); drop(c);
            assert!(save_project(&path,"p",100,original["metadata"].clone(),replacement).is_err(),"{mutation}");
            let c=Connection::open(&path).unwrap();
            let raw:String=c.query_row("SELECT metadata FROM pages WHERE id='p'",[],|r|r.get(0)).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),original["metadata"]);
            assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='p'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            drop(c); std::fs::remove_file(path).unwrap();
        }
    }
    #[test]
    fn removed_existing_link_does_not_silently_disappear_from_project() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata=json_set(metadata,'$.project.links',json('[\"fixture-page\"]')) WHERE id='p'",[]).unwrap();
        drop(c);
        let original=read_resource(&path,"p").unwrap();
        let mut replacement=original["metadata"].clone(); replacement["project"]["description"]=json!("draft");
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET deleted_at=1 WHERE id='fixture-page'",[]).unwrap(); drop(c);
        assert!(save_project(&path,"p",100,original["metadata"].clone(),replacement).is_err());
        let c=Connection::open(&path).unwrap();
        let raw:String=c.query_row("SELECT metadata FROM pages WHERE id='p'",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),original["metadata"]);
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='p'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn duplicate_existing_links_cannot_be_silently_removed() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata=json_set(metadata,'$.project.links',json('[\"fixture-page\",\"fixture-page\"]')) WHERE id='p'",[]).unwrap(); drop(c);
        let original=read_resource(&path,"p").unwrap();
        let mut replacement=original["metadata"].clone(); replacement["project"]["links"]=json!([]);
        assert!(save_project(&path,"p",100,original["metadata"].clone(),replacement).is_err());
        let c=Connection::open(&path).unwrap();
        let raw:String=c.query_row("SELECT metadata FROM pages WHERE id='p'",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),original["metadata"]);
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='p'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn project_save_rechecks_sharing_after_draft_opened() {
        let path = fixture();
        let original = read_resource(&path, "p").unwrap();
        let mut changed = original["metadata"].clone();
        changed["project"]["description"] = json!("draft");
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET workspace_id='team' WHERE id='p'", []).unwrap();
        drop(c);
        assert!(save_project(&path, "p", 100, original["metadata"].clone(), changed).is_err());
        let c = Connection::open(&path).unwrap();
        let (metadata, workspace): (String, String) = c.query_row("SELECT metadata, workspace_id FROM pages WHERE id='p'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(), original["metadata"]);
        assert_eq!(workspace, "team");
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='p'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    // Documents why the path-based bridge must remain disconnected from UI.
    // Both databases intentionally have the same project CAS baseline.
    #[test]
    fn path_bridge_does_not_bind_draft_to_database_identity() {
        let path = fixture();
        let original = read_resource(&path, "p").unwrap();
        let displaced = path.with_extension("original.db");
        let replacement = path.with_extension("replacement.db");
        std::fs::copy(&path, &replacement).unwrap();
        let c = Connection::open(&replacement).unwrap();
        c.execute("UPDATE pages SET title='replacement marker' WHERE id='fixture-page'", []).unwrap();
        drop(c);
        std::fs::rename(&path, &displaced).unwrap();
        std::fs::rename(&replacement, &path).unwrap();
        let mut changed = original["metadata"].clone();
        changed["project"]["description"] = json!("written to replacement");
        save_project(&path, "p", 100, original["metadata"].clone(), changed).unwrap();
        let new = read_resource(&path, "p").unwrap();
        let old = read_resource(&displaced, "p").unwrap();
        assert_eq!(new["metadata"]["project"]["description"], "written to replacement");
        assert_eq!(old["metadata"], original["metadata"]);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(displaced).unwrap();
    }
    // A diagnostic only: pathname identity checks have a TOCTOU window and
    // cannot make an SQLite VFS safe against concurrent path replacement.
    #[cfg(unix)]
    #[test]
    fn identity_probe_rejects_swapped_main_wal_and_shm_before_write() {
        use std::os::unix::fs::MetadataExt;
        fn identity(path: &Path) -> (u64, u64) {
            let meta = std::fs::symlink_metadata(path).unwrap();
            assert!(meta.file_type().is_file());
            (meta.dev(), meta.ino())
        }
        let path = fixture();
        let c = Connection::open(&path).unwrap();
        let mode: String = c.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
        c.execute("UPDATE pages SET title='fixture WAL' WHERE id='fixture-page'", []).unwrap();
        let wal = std::path::PathBuf::from(format!("{}-wal", path.display()));
        let shm = std::path::PathBuf::from(format!("{}-shm", path.display()));
        let paths = [&path, &wal, &shm];
        let baseline: Vec<_> = paths.iter().map(|p| identity(p)).collect();
        for (index, current) in paths.iter().enumerate() {
            let displaced = std::path::PathBuf::from(format!("{}.displaced", current.display()));
            std::fs::rename(current, &displaced).unwrap();
            std::fs::copy(&displaced, current).unwrap();
            // Fail before executing any mutation. Restore the live sidecars
            // before the SQLite connection is closed.
            assert_ne!(identity(current), baseline[index]);
            std::fs::remove_file(current).unwrap();
            std::fs::rename(&displaced, current).unwrap();
            assert_eq!(identity(current), baseline[index]);
        }
        assert_eq!(c.query_row("SELECT title FROM pages WHERE id='fixture-page'", [], |r| r.get::<_, String>(0)).unwrap(), "fixture WAL");
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn project_save_rechecks_existing_link_after_it_becomes_shared() {
        let path = fixture();
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata=json_set(metadata,'$.project.links',json('[\"fixture-page\"]')) WHERE id='p'", []).unwrap();
        drop(c);
        let original = read_resource(&path, "p").unwrap();
        let mut changed = original["metadata"].clone();
        changed["project"]["description"] = json!("draft");
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET workspace_id='team' WHERE id='fixture-page'", []).unwrap();
        drop(c);
        assert!(save_project(&path, "p", 100, original["metadata"].clone(), changed).is_err());
        let c = Connection::open(&path).unwrap();
        let metadata: String = c.query_row("SELECT metadata FROM pages WHERE id='p'", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(), original["metadata"]);
        assert_eq!(c.query_row("SELECT count(*) FROM changes WHERE page_id='p'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn gallery_refuses_same_timestamp_block_change_and_unknown_block_loss() {
        let path=fixture();
        let old=read_resource(&path,"g").unwrap(); let base=old["revision"].as_i64().unwrap();
        let added=save_gallery(&path,"g",base,old["metadata"].clone(),old["metadata"].clone(),vec![],vec![gallery("b","a")]).unwrap();
        let c=Connection::open(&path).unwrap();
        let mut changed=gallery("b","a").content; changed["attrs"]["caption"]=json!("concurrent");
        c.execute("UPDATE blocks SET content=?1 WHERE id='b'",[changed.to_string()]).unwrap(); drop(c);
        assert!(save_gallery(&path,"g",added["revision"].as_i64().unwrap(),added["metadata"].clone(),added["metadata"].clone(),vec![gallery("b","a")],vec![]).is_err());
        std::fs::remove_file(path).unwrap();
    }
}

fn presentation_attachments(c: &Connection, entries: &[(String,Value)]) -> Result<()> {
    for (_, item) in entries {
        if item.get("type").and_then(Value::as_str) != Some("slide") { continue }
        let attrs = item.get("attrs").and_then(Value::as_object).ok_or_else(||anyhow::anyhow!("invalid slide attributes"))?;
        let mut values = Vec::new();
        if let Some(background) = attrs.get("background") {
            if let Some(id) = background.get("attachmentId") { values.push(id); }
        }
        if let Some(elements) = attrs.get("elements") {
            for element in elements.as_array().ok_or_else(||anyhow::anyhow!("invalid slide elements"))? {
                if let Some(id) = element.get("attachmentId") { values.push(id); }
            }
        }
        for value in values {
            if value.is_null() { continue }
            let id = value.as_str().filter(|v|!v.is_empty()).ok_or_else(||anyhow::anyhow!("invalid attachment ID"))?;
            let owner: Option<Option<String>> = c.query_row("SELECT page_id FROM attachments WHERE id=?1", [id], |r|r.get(0)).optional()?;
            let owner = owner.flatten().ok_or_else(||anyhow::anyhow!("attachment unavailable or owner not established"))?;
            require_personal(c, &owner)?;
        }
    }
    Ok(())
}

fn presentation_unambiguous(c: &Connection, page: &str) -> Result<()> {
    let count: i64 = c.query_row("SELECT COUNT(*) FROM blocks WHERE page_id=?1 AND CASE WHEN json_valid(content) THEN EXISTS(SELECT 1 FROM json_tree(content) WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*)>1) ELSE 1 END",[page],|r|r.get(0))?;
    if count != 0 { bail!("unsupported presentation: ambiguous block content") }
    Ok(())
}
fn presentation_refs(c: &Connection, page: &str, entries: &[(String,Value)]) -> Result<()> {
    let mut expected = HashSet::new();
    for (id,value) in entries {
        let mut refs=Vec::new(); content::collect_refs(value,&mut refs);
        expected.extend(refs.into_iter().map(|(target,kind)|(id.clone(),target,kind.to_string())));
    }
    let actual: HashSet<(String,String,String)>=c.prepare("SELECT source_block,target_page,kind FROM refs WHERE source_page=?1")?
        .query_map([page],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    if actual != expected { bail!("unsupported presentation: reference index is inconsistent") }
    Ok(())
}

// The experimental native presentation editor can change notes, text, geometry
// and selected text-style fields. Preserve every other field and element until
// a complete editor can prove an explicit operation is safe.
fn protected_slide(value: &Value) -> Result<Value> {
    let mut result=value.clone();
    let attrs=result.get_mut("attrs").and_then(Value::as_object_mut).ok_or_else(||anyhow::anyhow!("invalid slide attributes"))?;
    // Only text notes are editable. Preserve malformed or future values in
    // the protected comparison so a save cannot silently overwrite them.
    if attrs.get("notes").is_some_and(Value::is_string) { attrs.remove("notes"); }
    if let Some(elements)=attrs.get_mut("elements") {
        for element in elements.as_array_mut().ok_or_else(||anyhow::anyhow!("invalid slide elements"))? {
            let Some(object)=element.as_object_mut() else { continue };
            let kind=object.get("type").and_then(Value::as_str).unwrap_or("").to_string();
            if ["text","image","video","shape"].contains(&kind.as_str()) {
                for key in ["x","y","w","h","rot"] {
                    let valid=object.get(key).and_then(Value::as_f64).is_some_and(|n|
                        n.is_finite() && (key=="rot" || n.abs()<=1_000_000.0) && (!(key=="w" || key=="h") || n>0.0));
                    if valid { object.remove(key); }
                }
            }
            if kind=="text" {
                // Unknown text payloads must survive unrelated edits; only
                // ordinary strings are supported by the native editor.
                if object.get("text").is_some_and(Value::is_string) { object.remove("text"); }
                if let Some(style)=object.get_mut("style").and_then(Value::as_object_mut) {
                    for (key,min,max) in [("fontSize",1.0,2048.0),("fontWeight",100.0,1000.0)] {
                        if style.get(key).and_then(Value::as_f64).is_some_and(|v|v.is_finite() && (min..=max).contains(&v)) { style.remove(key); }
                    }
                    for key in ["color","font"] { if style.get(key).is_some_and(Value::is_string) { style.remove(key); } }
                    if style.get("italic").is_some_and(Value::is_boolean) { style.remove("italic"); }
                    if style.get("align").and_then(Value::as_str).is_some_and(|v|["left","center","right"].contains(&v)) { style.remove("align"); }
                    if style.is_empty() { object.remove("style"); }
                }
            }
        }
    }
    Ok(result)
}

pub fn read_presentation(path: &Path, id: &str) -> Result<Value> {
    let mut connection = open_existing(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
    let value = presentation_snapshot(&tx,id)?;
    tx.commit()?; Ok(value)
}
fn presentation_snapshot(c: &Connection, id: &str) -> Result<Value> {
    require_personal(c,id)?;
    let (kind,revision,raw): (String,i64,String) = c.query_row("SELECT kind,updated_at,metadata FROM pages WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    if kind != "presentation" { bail!("invalid resource kind") }
    let metadata: Value = serde_json::from_str(&raw)?;
    presentation_unambiguous(c,id)?;
    let current = blocks(c,id)?;
    presentation_attachments(c,&current)?;
    let entries: Vec<Value> = current.into_iter().map(|(id,content)|serde_json::json!({"id":id,"content":content})).collect();
    Ok(serde_json::json!({"id":id,"kind":kind,"revision":revision,"metadata":metadata,"blocks":entries}))
}
pub fn save_presentation(path: &Path, id: &str, base: i64, expected_metadata: Value, expected: Vec<BlockInput>, next: Vec<BlockInput>) -> Result<Value> {
    save_presentation_deleting(path,id,base,expected_metadata,expected,next,vec![])
}
pub fn save_presentation_deleting(path: &Path, id: &str, base: i64, expected_metadata: Value, expected: Vec<BlockInput>, next: Vec<BlockInput>, deleting: Vec<String>) -> Result<Value> {
    let mut connection = open_existing(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    check_metadata(&tx,id,base,&expected_metadata,"presentation")?;
    presentation_unambiguous(&tx,id)?;
    let before = blocks(&tx,id)?;
    presentation_refs(&tx,id,&before)?;
    if before.len() != expected.len() || before.iter().zip(&expected).any(|((id,v),e)|id != &e.id || v != &e.content) { bail!("conflict: presentation blocks changed") }
    let next_pairs: Vec<_> = next.iter().map(|b|(b.id.clone(),b.content.clone())).collect();
    let old_opaque: Vec<_> = before.iter().filter(|(_,v)|v.get("type").and_then(Value::as_str) != Some("slide")).collect();
    let new_opaque: Vec<_> = next_pairs.iter().filter(|(_,v)|v.get("type").and_then(Value::as_str) != Some("slide")).collect();
    if old_opaque != new_opaque { bail!("invalid change: non-slide blocks must be preserved") }
    let declared: HashSet<_> = deleting.iter().cloned().collect();
    if declared.len() != deleting.len() { bail!("invalid change: duplicate deleted slide") }
    let previous: HashSet<_> = before.iter().filter(|(_,v)|v.get("type").and_then(Value::as_str)==Some("slide")).map(|(id,_)|id.clone()).collect();
    let remaining: HashSet<_> = next_pairs.iter().filter(|(_,v)|v.get("type").and_then(Value::as_str)==Some("slide")).map(|(id,_)|id.clone()).collect();
    if remaining.is_empty() || previous.difference(&remaining).cloned().collect::<HashSet<_>>() != declared { bail!("invalid change: deleted slides must be explicitly identified") }
    if declared.len()>1 { bail!("unsupported change: delete one slide per save") }
    if !declared.is_empty() && before.iter().filter(|(key,_)|!declared.contains(key)).map(|(key,_)|key).ne(next_pairs.iter().map(|(key,_)|key)) { bail!("unsupported change: save reordering separately from deletion") }
    for deleted in &declared {
        let (raw,content,direction,text,kind,created,updated): (String,String,String,String,String,i64,i64)=tx.query_row("SELECT properties,content,direction,text,type,created_at,updated_at FROM blocks WHERE page_id=?1 AND id=?2",rusqlite::params![id,deleted],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)))?;
        if !serde_json::from_str::<Value>(&raw).ok().and_then(|v|v.as_object().map(|o|o.is_empty())).unwrap_or(false) { bail!("unsupported change: slide properties cannot be restored") }
        tx.execute_batch("CREATE TABLE IF NOT EXISTS native_presentation_deleted(id TEXT PRIMARY KEY,page_id TEXT NOT NULL,block_id TEXT NOT NULL,content TEXT NOT NULL,properties TEXT NOT NULL,direction TEXT NOT NULL,text TEXT NOT NULL,block_type TEXT NOT NULL,block_created INTEGER NOT NULL,block_updated INTEGER NOT NULL,original_order TEXT NOT NULL,remaining_order TEXT NOT NULL,created_at INTEGER NOT NULL,restored_at INTEGER)")?;
        let recovery=uuid::Uuid::new_v4().to_string();
        let original_order=serde_json::to_string(&before.iter().map(|(key,_)|key).collect::<Vec<_>>())?;
        let remaining_order=serde_json::to_string(&next_pairs.iter().map(|(key,_)|key).collect::<Vec<_>>())?;
        tx.execute("INSERT INTO native_presentation_deleted(id,page_id,block_id,content,properties,direction,text,block_type,block_created,block_updated,original_order,remaining_order,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",rusqlite::params![recovery,id,deleted,content,raw,direction,text,kind,created,updated,original_order,remaining_order,db::now()])?;
    }
    for (block_id,old) in &before {
        if old.get("type").and_then(Value::as_str) != Some("slide") { continue }
        if declared.contains(block_id) { continue }
        let new=next_pairs.iter().find(|(candidate,_)| candidate==block_id).map(|(_,v)|v)
            .ok_or_else(||anyhow::anyhow!("unsupported change: slide removal is not yet available"))?;
        if new.get("type").and_then(Value::as_str) != Some("slide") || protected_slide(old)? != protected_slide(new)? { bail!("unsupported change: slide content would lose protected fields") }
    }
    let mut ids = HashSet::new();
    for item in &next {
        if item.id.is_empty() || !ids.insert(&item.id) { bail!("invalid block identity") }
        // The original save_blocks injects attrs.bid for every block. Refuse
        // opaque content lacking it rather than silently changing that content.
        if item.content.pointer("/attrs/bid").and_then(Value::as_str) != Some(item.id.as_str()) { bail!("invalid block identity") }
        let owner: Option<String> = tx.query_row("SELECT page_id FROM blocks WHERE id=?1",[&item.id],|r|r.get(0)).optional()?;
        if owner.as_deref().is_some_and(|other| other != id) { bail!("conflict: block belongs to another page") }
    }
    presentation_attachments(&tx,&before)?; presentation_attachments(&tx,&next_pairs)?;
    if declared.is_empty() { store::snapshot_before_user_edit(&tx,id)?; }
    else { store::snapshot(&tx,id,"user",None,Some("Before slide deletion"))?; }
    let result = store::save_blocks(&tx,&store::Ctx::user(),id,next.into_iter().map(|b|store::BlockInput{id:b.id,content:b.content}).collect())?;
    if !result.remapped.is_empty() { bail!("conflict: block IDs were remapped") }
    presentation_refs(&tx,id,&next_pairs)?;
    let output = presentation_snapshot(&tx,id)?;
    tx.commit()?; Ok(output)
}

pub fn deleted_presentation_slides(path: &Path, page: &str) -> Result<Value> {
    let mut c=open_existing(path)?; let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
    require_personal(&tx,page)?;
    let kind:String=tx.query_row("SELECT kind FROM pages WHERE id=?1",[page],|r|r.get(0))?;
    if kind!="presentation" { bail!("invalid resource kind") }
    let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_presentation_deleted')",[],|r|r.get(0))?;
    let items:Vec<Value>=if exists {
        tx.prepare("SELECT id,block_id,created_at FROM native_presentation_deleted WHERE page_id=?1 AND restored_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 100")?
            .query_map([page],|r|Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"blockID":r.get::<_,String>(1)?,"createdAt":r.get::<_,i64>(2)?})))?.collect::<rusqlite::Result<_>>()?
    } else { Vec::new() };
    tx.commit()?; Ok(serde_json::json!({"items":items}))
}

/// Restores one native deletion record only when its recorded remaining order
/// matches the current page. Live data, refs and assets are checked in the same transaction.
pub fn restore_presentation_slide(path: &Path, page: &str, recovery_id: &str, base: i64, metadata: Value, expected: Vec<BlockInput>) -> Result<Value> {
    if uuid::Uuid::parse_str(recovery_id).is_err() { bail!("invalid recovery ID") }
    let mut c=open_existing(path)?; let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    check_metadata(&tx,page,base,&metadata,"presentation")?; presentation_unambiguous(&tx,page)?;
    let current=blocks(&tx,page)?; presentation_refs(&tx,page,&current)?;
    if current.len()!=expected.len() || current.iter().zip(&expected).any(|((id,value),entry)|id!=&entry.id || value!=&entry.content) { bail!("conflict: presentation blocks changed") }
    type Saved=(String,String,String,String,String,String,i64,i64,String,String);
    let saved:Option<Saved>=tx.query_row("SELECT block_id,content,properties,direction,text,block_type,block_created,block_updated,original_order,remaining_order FROM native_presentation_deleted WHERE id=?1 AND page_id=?2 AND restored_at IS NULL",rusqlite::params![recovery_id,page],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?))).optional()?;
    let (block_id,raw,properties,direction,text,kind,created,updated,original,remaining)=saved.ok_or_else(||anyhow::anyhow!("recovery record unavailable"))?;
    let original:Vec<String>=serde_json::from_str(&original)?; let remaining:Vec<String>=serde_json::from_str(&remaining)?;
    let ids:Vec<String>=current.iter().map(|(id,_)|id.clone()).collect();
    if ids!=remaining || original.iter().filter(|id|*id!=&block_id).cloned().collect::<Vec<_>>()!=remaining || original.iter().filter(|id|*id==&block_id).count()!=1 { bail!("conflict: presentation order changed") }
    let used:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM blocks WHERE id=?1)",[&block_id],|r|r.get(0))?;
    if used { bail!("conflict: deleted block ID is already used") }
    let content:Value=serde_json::from_str(&raw)?;
    if kind!="slide" || content.get("type").and_then(Value::as_str)!=Some("slide") || content.pointer("/attrs/bid").and_then(Value::as_str)!=Some(block_id.as_str()) || content::plain_text(&content)!=text { bail!("unsupported recovery record") }
    if !serde_json::from_str::<Value>(&properties).ok().and_then(|v|v.as_object().map(|o|o.is_empty())).unwrap_or(false) { bail!("unsupported recovery properties") }
    let position=original.iter().position(|id|id==&block_id).ok_or_else(||anyhow::anyhow!("invalid recovery order"))?;
    let mut next=current.clone(); next.insert(position,(block_id.clone(),content));
    presentation_attachments(&tx,&next)?;
    store::snapshot(&tx,page,"user",None,Some("Before slide recovery"))?;
    let result=store::save_blocks(&tx,&store::Ctx::user(),page,next.iter().map(|(id,content)|store::BlockInput{id:id.clone(),content:content.clone()}).collect())?;
    if !result.remapped.is_empty() { bail!("conflict: block IDs were remapped") }
    tx.execute("UPDATE blocks SET properties=?2,direction=?3,created_at=?4,updated_at=?5 WHERE id=?1 AND page_id=?6",rusqlite::params![block_id,properties,direction,created,updated,page])?;
    presentation_refs(&tx,page,&next)?;
    tx.execute("UPDATE native_presentation_deleted SET restored_at=?3 WHERE id=?1 AND page_id=?2 AND restored_at IS NULL",rusqlite::params![recovery_id,page,db::now()])?;
    let output=presentation_snapshot(&tx,page)?; tx.commit()?; Ok(output)
}

#[cfg(test)]
mod presentation_tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("presentation-{}.db",uuid::Uuid::new_v4()));
        std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),&path).unwrap();
        let c=Connection::open(&path).unwrap();
        c.execute_batch("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('deck','Deck','presentation','{}',1,100); INSERT INTO pages(id,title,kind,metadata,workspace_id,created_at,updated_at) VALUES('shared','Shared','presentation','{}','team',1,100);").unwrap();
        let slide=json!({"type":"slide","attrs":{"bid":"s","notes":"original","elements":[]}});
        let opaque=json!({"type":"future","attrs":{"bid":"o","payload":true}});
        for (id,content,key) in [("s",slide,0),("o",opaque,1)] { c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES(?1,'deck',?2,?3,?4,1,1)",rusqlite::params![id,content["type"].as_str().unwrap(),key,content.to_string()]).unwrap(); }
        drop(c); path
    }
    fn inputs(value:&Value) -> Vec<BlockInput> { value["blocks"].as_array().unwrap().iter().map(|v|BlockInput{id:v["id"].as_str().unwrap().into(),content:v["content"].clone()}).collect() }
    #[test]
    fn saves_slide_preserves_other_blocks_and_refuses_stale_snapshot() {
        let path=fixture(); let old=read_presentation(&path,"deck").unwrap();
        let mut next=inputs(&old); next[0].content["attrs"]["notes"]=json!("changed");
        let saved=save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),next).unwrap();
        assert_eq!(saved["blocks"][0]["content"]["attrs"]["notes"],"changed");
        assert_eq!(saved["blocks"][1],old["blocks"][1]);
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),inputs(&old)).is_err());
        assert!(read_presentation(&path,"shared").is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn malformed_speaker_notes_are_preserved_and_cannot_be_replaced() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        let original=json!({"type":"slide","attrs":{"bid":"s","notes":{"future":true},"elements":[{"id":"t","type":"text","text":"before"}]}});
        c.execute("UPDATE blocks SET content=?1 WHERE id='s'",[original.to_string()]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap();
        for replacement in [json!("replacement"),json!(null),json!({"future":false})] {
            let mut attack=inputs(&old); attack[0].content["attrs"]["notes"]=replacement;
            assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),attack).is_err());
            assert_eq!(read_presentation(&path,"deck").unwrap(),old);
        }
        let mut legitimate=inputs(&old); legitimate[0].content["attrs"]["elements"][0]["text"]=json!("after");
        let saved=save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),legitimate).unwrap();
        assert_eq!(saved["blocks"][0]["content"]["attrs"]["notes"],json!({"future":true}));
        assert_eq!(saved["blocks"][0]["content"]["attrs"]["elements"][0]["text"],"after");
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),inputs(&old)).is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn malformed_slide_text_is_preserved_during_other_edits() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        let original=json!({"type":"slide","attrs":{"bid":"s","notes":"before","elements":[{"id":"t","type":"text","text":{"future":"payload"}}]}});
        c.execute("UPDATE blocks SET content=?1 WHERE id='s'",[original.to_string()]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap();
        for value in [json!("replacement"),json!(null),json!({"future":"changed"})] {
            let mut attack=inputs(&old); attack[0].content["attrs"]["elements"][0]["text"]=value;
            assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),attack).is_err());
            assert_eq!(read_presentation(&path,"deck").unwrap(),old);
        }
        let mut safe=inputs(&old); safe[0].content["attrs"]["notes"]=json!("after");
        let saved=save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),safe).unwrap();
        assert_eq!(saved["blocks"][0]["content"]["attrs"]["elements"][0]["text"],json!({"future":"payload"}));
        assert_eq!(saved["blocks"][0]["content"]["attrs"]["notes"],"after");
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn unknown_slide_alignment_is_preserved_during_other_edits() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        let original=json!({"type":"slide","attrs":{"bid":"s","notes":"before","elements":[{"id":"t","type":"text","text":"text","style":{"align":"future"}}]}});
        c.execute("UPDATE blocks SET content=?1 WHERE id='s'",[original.to_string()]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap();
        for value in [json!("center"),json!(null),json!({"future":true})] {
            let mut attack=inputs(&old); attack[0].content["attrs"]["elements"][0]["style"]["align"]=value;
            assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),attack).is_err());
            assert_eq!(read_presentation(&path,"deck").unwrap(),old);
        }
        let mut safe=inputs(&old); safe[0].content["attrs"]["notes"]=json!("after");
        let saved=save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),safe).unwrap();
        assert_eq!(saved["blocks"][0]["content"]["attrs"]["elements"][0]["style"]["align"],"future");
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn malformed_slide_style_and_geometry_survive_other_edits() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        let original=json!({"type":"slide","attrs":{"bid":"s","notes":"before","elements":[{"id":"t","type":"text","text":"text","x":{"future":1},"w":-1,"style":{"fontWeight":{"future":true},"fontSize":0,"italic":"future","font":null,"color":22}}]}});
        c.execute("UPDATE blocks SET content=?1 WHERE id='s'",[original.to_string()]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap();
        for (key,value) in [("fontWeight",json!(700)),("fontSize",json!(32)),("italic",json!(true)),("font",json!("Arial")),("color",json!("red"))] {
            let mut attack=inputs(&old); attack[0].content["attrs"]["elements"][0]["style"][key]=value;
            assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),attack).is_err(),"{key}");
            assert_eq!(read_presentation(&path,"deck").unwrap(),old);
        }
        for (key,value) in [("x",json!(3)),("w",json!(20))] {
            let mut attack=inputs(&old); attack[0].content["attrs"]["elements"][0][key]=value;
            assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),attack).is_err(),"{key}");
        }
        let mut safe=inputs(&old); safe[0].content["attrs"]["notes"]=json!("after");
        let saved=save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),safe).unwrap();
        assert_eq!(saved["blocks"][0]["content"]["attrs"]["elements"],original["attrs"]["elements"]);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_opaque_block_that_original_writer_would_mutate() {
        let path=fixture();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE blocks SET content='{\"type\":\"future\",\"attrs\":{\"payload\":true}}' WHERE id='o'",[]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap();
        let mut next=inputs(&old); next[0].content["attrs"]["notes"]=json!("changed");
        assert!(save_presentation(&path,"deck",old["revision"].as_i64().unwrap(),old["metadata"].clone(),inputs(&old),next).is_err());
        assert_eq!(read_presentation(&path,"deck").unwrap(),old);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn same_revision_mutations_and_shared_attachment_fail_closed() {
        let path=fixture(); let old=read_presentation(&path,"deck").unwrap();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata='{\"other\":true}' WHERE id='deck'",[]).unwrap();
        drop(c);
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),inputs(&old)).is_err());
        let fresh=read_presentation(&path,"deck").unwrap();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE blocks SET content=json_set(content,'$.attrs.notes','other') WHERE id='s'",[]).unwrap();
        c.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('secret','shared','image','s.png','image/png',1,'x/s.png',1)",[]).unwrap();
        drop(c);
        assert!(save_presentation(&path,"deck",100,fresh["metadata"].clone(),inputs(&fresh),inputs(&fresh)).is_err());
        let newer=read_presentation(&path,"deck").unwrap();
        let mut next=inputs(&newer); next[0].content["attrs"]["elements"]=json!([{"id":"e","type":"image","attachmentId":"secret"}]);
        assert!(save_presentation(&path,"deck",100,newer["metadata"].clone(),inputs(&newer),next).is_err());
        assert_eq!(read_presentation(&path,"deck").unwrap(),newer);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_lost_opaque_and_unauthorized_attachment() {
        let path=fixture(); let old=read_presentation(&path,"deck").unwrap();
        let mut next=inputs(&old); next.pop();
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),next).is_err());
        let mut next=inputs(&old); next[0].content["attrs"]["background"]=json!({"attachmentId":"missing"});
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),next).is_err());
        assert_eq!(read_presentation(&path,"deck").unwrap(),old);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn slide_reorder_roundtrips_media_and_unknown_elements_even_when_file_missing() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('image','deck','image','a.png','image/png',4,'missing/a.png',1)",[]).unwrap();
        let rich=json!({"type":"slide","attrs":{"bid":"s","notes":"original","background":{"attachmentId":"image","mode":"crop"},"elements":[{"id":"text","type":"text","text":"مرحبا 🌍","style":{"fontSize":32,"plugin":"keep"},"future":{"keep":true}},{"id":"image-el","type":"image","attachmentId":"image","crop":{"x":3}},{"id":"unknown","type":"future","data":[1,2]}],"unknownField":{"a":1}}});
        let other=json!({"type":"slide","attrs":{"bid":"s2","notes":"second","elements":[]}});
        c.execute("UPDATE blocks SET content=?1,properties=?2 WHERE id='s'",rusqlite::params![rich.to_string(),r#"{"plugin":"keep"}"#]).unwrap();
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('s2','deck','slide',2,?1,1,1)",[other.to_string()]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap(); let mut next=inputs(&old);
        next[0].content["attrs"]["elements"][0]["text"]=json!("تم 🌍"); next.swap(0,2);
        let saved=save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),next).unwrap();
        let mut expected=rich; expected["attrs"]["elements"][0]["text"]=json!("تم 🌍");
        assert_eq!(saved["blocks"][2]["content"],expected);
        assert_eq!(saved["blocks"][1],old["blocks"][1]);
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT properties FROM blocks WHERE id='s'",[],|r|r.get::<_,String>(0)).unwrap(),r#"{"plugin":"keep"}"#);
        assert_eq!(c.query_row("SELECT rel_path FROM attachments WHERE id='image'",[],|r|r.get::<_,String>(0)).unwrap(),"missing/a.png");
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_unknown_element_loss_slide_removal_and_stale_refs_atomically() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        let rich=json!({"type":"slide","attrs":{"bid":"s","notes":"original","elements":[{"id":"future","type":"future","data":{"keep":true}}]}});
        c.execute("UPDATE blocks SET content=?1 WHERE id='s'",[rich.to_string()]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap(); let mut next=inputs(&old);
        next[0].content["attrs"]["elements"]=json!([]);
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),next).is_err());
        let next=vec![inputs(&old).pop().unwrap()];
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),next).is_err());
        let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO refs(source_page,source_block,target_page,kind) VALUES('deck','s','x','plugin')",[]).unwrap(); drop(c);
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),inputs(&old)).is_err());
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT content FROM blocks WHERE id='s'",[],|r|r.get::<_,String>(0)).unwrap(),rich.to_string());
        assert_eq!(c.query_row("SELECT count(*) FROM refs WHERE source_page='deck'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT count(*) FROM history WHERE page_id='deck'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn explicit_slide_delete_keeps_shared_assets_snapshots_and_rolls_back() {
        let path=fixture(); let media=path.with_extension("media"); std::fs::write(&media,b"original media").unwrap();
        let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('media','deck','image','a.png','image/png',14,'media/a.png',1)",[]).unwrap();
        let first=json!({"type":"slide","attrs":{"bid":"s","elements":[{"id":"a","type":"image","attachmentId":"media"}]}});
        let second=json!({"type":"slide","attrs":{"bid":"s2","elements":[{"id":"b","type":"image","attachmentId":"media"}]}});
        c.execute("UPDATE blocks SET content=?1 WHERE id='s'",[first.to_string()]).unwrap();
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('s2','deck','slide',2,?1,1,1)",[second.to_string()]).unwrap(); drop(c);
        let old=read_presentation(&path,"deck").unwrap();
        let next=|| inputs(&old).into_iter().filter(|block|block.id!="s").collect();
        assert!(save_presentation(&path,"deck",100,old["metadata"].clone(),inputs(&old),next()).is_err());
        assert!(save_presentation_deleting(&path,"deck",100,old["metadata"].clone(),inputs(&old),inputs(&old).into_iter().filter(|block|block.id=="o").collect(),vec!["s".into(),"s2".into()]).is_err());
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE blocks SET properties=?1 WHERE id='s'",[r#"{"plugin":true}"#]).unwrap(); drop(c);
        assert!(save_presentation_deleting(&path,"deck",100,old["metadata"].clone(),inputs(&old),next(),vec!["s".into()]).is_err());
        let c=Connection::open(&path).unwrap(); c.execute("UPDATE blocks SET properties='{}' WHERE id='s'",[]).unwrap();
        c.execute_batch("CREATE TRIGGER fail_slide_delete BEFORE DELETE ON blocks WHEN OLD.id='s' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap(); drop(c);
        assert!(save_presentation_deleting(&path,"deck",100,old["metadata"].clone(),inputs(&old),next(),vec!["s".into()]).is_err());
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM versions WHERE page_id='deck'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("SELECT count(*) FROM blocks WHERE id='s'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        c.execute_batch("DROP TRIGGER fail_slide_delete").unwrap(); drop(c);
        let saved=save_presentation_deleting(&path,"deck",100,old["metadata"].clone(),inputs(&old),next(),vec!["s".into()]).unwrap();
        assert!(!saved["blocks"].as_array().unwrap().iter().any(|b|b["id"]=="s"));
        let reopened=read_presentation(&path,"deck").unwrap(); assert_eq!(reopened,saved);
        let c=Connection::open(&path).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE id='media'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        let snap:String=c.query_row("SELECT snapshot FROM versions WHERE page_id='deck' ORDER BY created_at DESC LIMIT 1",[],|r|r.get(0)).unwrap();
        assert!(serde_json::from_str::<Value>(&snap).unwrap()["blocks"].as_array().unwrap().iter().any(|v|v.pointer("/attrs/bid")==Some(&json!("s"))));
        assert_eq!(std::fs::read(&media).unwrap(),b"original media");
        drop(c); std::fs::remove_file(path).unwrap(); std::fs::remove_file(media).unwrap();
    }
    #[test]
    fn deleted_slide_restores_after_reopen_and_rolls_back_on_failure() {
        let path=fixture(); let c=Connection::open(&path).unwrap();
        c.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('media','deck','image','a.png','image/png',4,'media/a.png',1)",[]).unwrap();
        let rich=json!({"type":"slide","attrs":{"bid":"s","elements":[{"id":"a","type":"image","attachmentId":"media","future":{"keep":true}}]}});
        let next_slide=json!({"type":"slide","attrs":{"bid":"s2","elements":[]}});
        c.execute("UPDATE blocks SET content=?1,direction='rtl',created_at=42 WHERE id='s'",[rich.to_string()]).unwrap();
        c.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('s2','deck','slide',2,?1,1,1)",[next_slide.to_string()]).unwrap(); drop(c);
        let original=read_presentation(&path,"deck").unwrap();
        let remaining=inputs(&original).into_iter().filter(|b|b.id!="s").collect();
        let after=save_presentation_deleting(&path,"deck",100,original["metadata"].clone(),inputs(&original),remaining,vec!["s".into()]).unwrap();
        let ids=deleted_presentation_slides(&path,"deck").unwrap(); let recovery=ids["items"][0]["id"].as_str().unwrap();
        let c=Connection::open(&path).unwrap();
        c.execute("UPDATE blocks SET sort_key=-1 WHERE id='s2'",[]).unwrap(); drop(c);
        let reordered=read_presentation(&path,"deck").unwrap();
        assert!(restore_presentation_slide(&path,"deck",recovery,reordered["revision"].as_i64().unwrap(),reordered["metadata"].clone(),inputs(&reordered)).unwrap_err().to_string().contains("order changed"));
        let c=Connection::open(&path).unwrap(); c.execute("UPDATE blocks SET sort_key=1 WHERE id='s2'",[]).unwrap();
        c.execute("UPDATE pages SET workspace_id='team' WHERE id='deck'",[]).unwrap(); drop(c);
        assert!(restore_presentation_slide(&path,"deck",recovery,after["revision"].as_i64().unwrap(),after["metadata"].clone(),inputs(&after)).is_err());
        let c=Connection::open(&path).unwrap(); c.execute("UPDATE pages SET workspace_id=NULL WHERE id='deck'",[]).unwrap();
        c.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON blocks WHEN NEW.id='s' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap(); drop(c);
        assert!(restore_presentation_slide(&path,"deck",recovery,after["revision"].as_i64().unwrap(),after["metadata"].clone(),inputs(&after)).is_err());
        assert_eq!(deleted_presentation_slides(&path,"deck").unwrap()["items"].as_array().unwrap().len(),1);
        let c=Connection::open(&path).unwrap(); c.execute_batch("DROP TRIGGER fail_restore").unwrap(); drop(c);
        let restored=restore_presentation_slide(&path,"deck",recovery,after["revision"].as_i64().unwrap(),after["metadata"].clone(),inputs(&after)).unwrap();
        assert_eq!(restored["blocks"],original["blocks"]);
        assert_eq!(read_presentation(&path,"deck").unwrap()["blocks"],original["blocks"]);
        assert!(deleted_presentation_slides(&path,"deck").unwrap()["items"].as_array().unwrap().is_empty());
        let c=Connection::open(&path).unwrap();
        let (direction,created,properties):(String,i64,String)=c.query_row("SELECT direction,created_at,properties FROM blocks WHERE id='s'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!((direction,created,properties),("rtl".into(),42,"{}".into()));
        assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE id='media'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(c); std::fs::remove_file(path).unwrap();
    }
}
