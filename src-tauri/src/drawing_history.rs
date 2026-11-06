//! Bounded author Undo eligibility selected directly from the durable journal.
//! Canonical history stays intact for shared replay and original-asset ownership.
use anyhow::Result;
use rusqlite::{params,Connection};
use serde_json::{json,Value};
pub(super) const MAX_EDITS:usize=200;
pub(super) const MAX_BYTES:i64=16*1024*1024;
pub(super) struct Window{pub target:Option<String>,pub info:Value}
pub(super) fn choose(conn:&Connection,page:&str,actor:&str,redo:bool)->Result<Window>{
 let mut stmt=conn.prepare("SELECT e.id,e.revision,length(CAST(e.payload AS BLOB)),COALESCE((SELECT json_extract(t.payload,'$.enabled') FROM drawing_operations t WHERE t.page_id=e.page_id AND t.actor=e.actor AND json_extract(t.payload,'$.type')='toggle' AND json_extract(t.payload,'$.target')=e.id ORDER BY t.revision DESC LIMIT 1),1),COALESCE((SELECT t.revision FROM drawing_operations t WHERE t.page_id=e.page_id AND t.actor=e.actor AND json_extract(t.payload,'$.type')='toggle' AND json_extract(t.payload,'$.target')=e.id ORDER BY t.revision DESC LIMIT 1),0) FROM drawing_operations e WHERE e.page_id=?1 AND e.actor=?2 AND json_extract(e.payload,'$.type')='edit' ORDER BY e.revision DESC LIMIT ?3")?;
 let rows=stmt.query_map(params![page,actor,(MAX_EDITS+1) as i64],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,bool>(3)?,r.get::<_,i64>(4)?)))?;
 let mut edits=Vec::new();let mut bytes=0;let mut truncated=false;
 for row in rows{let row=row?;if edits.len()>=MAX_EDITS||bytes+row.2>MAX_BYTES{truncated=true;break;}bytes+=row.2;edits.push(row);}
 let newest_edit=edits.first().map(|e|e.1).unwrap_or(0);
 let target=if redo{edits.iter().filter(|e|!e.3&&e.4>newest_edit).max_by_key(|e|e.4)}else{edits.iter().find(|e|e.3)}.map(|e|e.0.clone());
 Ok(Window{target,info:json!({"maxEdits":MAX_EDITS,"maxBytes":MAX_BYTES,"edits":edits.len(),"bytes":bytes,"truncated":truncated})})
}

pub(super) fn validate_import(conn:&Connection,page:&str,document:&Value)->Result<()>{
 use anyhow::{anyhow,bail};use std::collections::{HashMap,HashSet};
 if serde_json::to_vec(document)?.len()>64*1024*1024{bail!("The imported drawing history exceeds 64 MiB");}
 let operations=document["operations"].as_array().ok_or_else(||anyhow!("Invalid imported drawing history"))?;
 if operations.len()>100000||document["revision"].as_u64()!=Some(operations.len() as u64){bail!("Invalid imported drawing history revision");}
 let mut originals=HashSet::<String>::new();let mut versions=HashSet::<String>::new();
 let mut owned_scene=|scene:&Value|->Result<()>{
   crate::drawing::validate_scene(scene)?;
   let mut pending=vec![scene.clone()];
   while let Some(snapshot)=pending.pop(){
     crate::drawing::validate_scene(&snapshot)?;
     for asset in snapshot["assets"].as_object().unwrap().values(){
       let id=super::text(asset,"attachmentId")?;
       if originals.insert(id.to_string()){
         let original=crate::store::get_attachment(conn,id)?.ok_or_else(||anyhow!("An imported original is missing"))?;
         if original.page_id.as_deref()!=Some(page)||!crate::store::attachment_abs_path(&original).is_file(){bail!("Imported drawing originals must be owned files of the new target drawing");}
       }
     }
     for step in snapshot["steps"].as_object().unwrap().values(){if let Some(id)=step["pinnedVersionId"].as_str(){if versions.insert(id.to_string()){if versions.len()>500{bail!("Too many imported pinned versions");}pending.push(crate::drawing::version_scene(conn,page,id)?);}}}
   }
   Ok(())
 };
 owned_scene(&document["seed"])?;owned_scene(&document["scene"])?;
 let mut seen=HashMap::<String,&Value>::new();let mut enabled=HashMap::<String,bool>::new();let mut scene=document["seed"].clone();
 for(i,operation)in operations.iter().enumerate(){
   let id=super::text(operation,"id")?;let actor=super::text(operation,"actor")?;
   if !super::safe_id(id)||!super::safe_id(actor)||operation["base"].as_u64()!=Some(i as u64)||operation["at"].as_f64().is_none()||super::text(operation,"label")?.trim().is_empty()||seen.contains_key(id){bail!("Invalid imported drawing operation");}
   if operation.get("requiresBase").is_some_and(|flag|flag.as_bool()!=Some(true)||operation["type"]!="edit"){bail!("Invalid strict drawing base");}
   match super::text(operation,"type")?{
     "edit"=>{
       if !operation["pixelGuard"].is_null(){super::check_pixel_guard(&scene,&operation["pixelGuard"])?;}
       if !operation["versionRestore"].is_null(){let receipt=&operation["versionRestore"];if receipt["backupId"]!=operation["id"]||receipt["expectedRevision"]!=operation["base"]||!receipt["versionId"].as_str().is_some_and(super::safe_id){bail!("Invalid imported restore receipt");}}
       crate::drawing::apply_changes(&mut scene,&operation["changes"],false)?;enabled.insert(id.to_string(),true);
     }
     "toggle"=>{
       let target=super::text(operation,"target")?;let prior=seen.get(target).ok_or_else(||anyhow!("Missing imported Undo target"))?;
       if prior["type"]!="edit"||prior["actor"]!=operation["actor"]||!operation["enabled"].is_boolean(){bail!("Invalid imported Undo author");}enabled.insert(target.to_string(),operation["enabled"].as_bool().unwrap());
       scene=document["seed"].clone();for edit in &operations[..i]{if edit["type"]=="edit"&&enabled.get(super::text(edit,"id")?)==Some(&true){crate::drawing::apply_changes(&mut scene,&edit["changes"],true)?;}}
     }
     _=>bail!("Invalid imported drawing operation type"),
   }
   owned_scene(&scene)?;seen.insert(id.to_string(),operation);
 }
 if scene!=document["scene"]{bail!("Imported drawing history does not match its final scene");}Ok(())
}

#[cfg(test)]
#[path="drawing_history/tests.rs"]
mod tests;
