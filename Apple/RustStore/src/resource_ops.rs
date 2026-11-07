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
    if kind != "project" && kind != "gallery" { bail!("unsupported resource kind") }
    let metadata: Value = serde_json::from_str(&metadata)?;
    let current = blocks(c, id)?;
    if kind == "project" { project_links(c, &metadata)?; } else { attachment_ids(c, &current)?; }
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
    let previous: HashSet<&str> = old.pointer("/project/links").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
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
    check_metadata(&tx,id,base,&expected_metadata,"gallery")?;
    let before = blocks(&tx,id)?;
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
    let out = snapshot(&tx,id)?;
    tx.commit()?; Ok(out)
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
