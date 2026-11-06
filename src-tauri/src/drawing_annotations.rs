use anyhow::{anyhow,bail,Result};
use serde_json::Value;
fn number(v:&Value,key:&str)->Result<f64>{v[key].as_f64().filter(|n|n.is_finite()).ok_or_else(||anyhow!("invalid annotation {key}"))}
fn identifier(v:&Value)->bool{v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=160&&!matches!(s,"__proto__"|"prototype"|"constructor"))}
pub(super) fn validate_node(node:&Value)->Result<()>{
 for key in ["anchor","endAnchor"]{let a=&node[key];if a.is_null(){continue;}if !a.is_object()||!a["nodeId"].is_null()&&!identifier(&a["nodeId"]){bail!("invalid annotation target");}if !a.as_object().unwrap().contains_key("nodeId"){bail!("missing annotation target");}
  if a.as_object().unwrap().keys().any(|key|!matches!(key.as_str(),"nodeId"|"u"|"v"|"fallback"|"region"|"review"|"sourceKey")){bail!("unknown annotation anchor field");}
  // Legacy arrows can attach to stroke ink just outside its geometry rectangle.
  for k in ["u","v"]{if number(a,k)?.abs()>1e9{bail!("invalid annotation position");}}
  number(&a["fallback"],"x")?;number(&a["fallback"],"y")?;
  if let Some(region)=a.get("region"){for k in ["x","y","w","h"]{let n=number(region,k)?;if matches!(k,"w"|"h")&&n<=0.0{bail!("invalid annotation region");}}}
  if a.get("review").is_some_and(|v|!v.is_boolean())||a.get("sourceKey").is_some_and(|v|v.as_str().is_none_or(|s|s.len()>4096)){bail!("invalid annotation review metadata");}
 }
 if !node["annotationGroup"].is_null()&&!identifier(&node["annotationGroup"]){bail!("invalid annotation group");}
 if !node["annotationStatus"].is_null()&&!matches!(node["annotationStatus"].as_str(),Some("open"|"active"|"resolved")){bail!("invalid annotation status");}Ok(())
}
#[cfg(test)]mod tests{
 use super::*;use serde_json::json;
 #[test]fn dangling_targets_and_optional_legacy_fields_remain_valid(){for target in [Value::Null,json!("deleted-node")]{let node=json!({"anchor":{"nodeId":target,"u":1,"v":0.5,"fallback":{"x":42,"y":-10}},"annotationGroup":"group","annotationStatus":"resolved"});validate_node(&node).unwrap();}validate_node(&json!({})).unwrap();}
 #[test]fn bounds_types_and_review_metadata_are_validated(){let valid=json!({"anchor":{"nodeId":"target","u":-0.1,"v":1.1,"fallback":{"x":0,"y":1},"sourceKey":"{}","review":true,"region":{"x":0,"y":0,"w":10,"h":20}},"annotationStatus":"active"});validate_node(&valid).unwrap();for (pointer,value) in [("/anchor/u",json!(-1e10)),("/anchor/v",json!(1e10)),("/anchor/fallback/x",json!("bad")),("/anchor/review",json!(1)),("/anchor/sourceKey",json!("x".repeat(4097))),("/anchor/region/w",json!(0)),("/annotationStatus",json!("closed"))]{let mut n=valid.clone();*n.pointer_mut(pointer).unwrap()=value;assert!(validate_node(&n).is_err(),"{pointer}");}let mut unknown=valid.clone();unknown["anchor"]["unexpected"]=json!({"payload":"rejected"});assert!(validate_node(&unknown).is_err());for key in ["anchor","endAnchor"]{assert!(validate_node(&json!({key:{"u":0,"v":0,"fallback":{"x":0,"y":0}}})).is_err());}}
 #[test]fn scene_journal_persists_anchors_status_and_label_position_through_reopen_and_author_undo(){
  use crate::{db,store};use super::super::{apply,load,history_toggle,validate_scene};
  let path=std::env::temp_dir().join(format!("worlds-annotations-{}.db",db::new_id()));let conn=db::open(&path).unwrap();let actor=store::profile(&conn).unwrap().id;let page=store::create_page(&conn,&store::Ctx::user(),store::NewPage{kind:Some("drawing".into()),..Default::default()}).unwrap();let doc=load(&conn,&page.id).unwrap();let layer=doc["scene"]["layerOrder"][0].clone();let frame=doc["scene"]["defaultFrameId"].clone();
  let label=json!({"id":"label","kind":"text","name":"Label","text":"شرح","layerId":layer,"frameId":frame,"groupId":null,"visible":true,"locked":false,"x":200,"y":100,"w":200,"h":80,"rotation":0,"opacity":1,"flipX":false,"flipY":false,"annotationGroup":"annotation","annotationStatus":"open","paint":{"fill":"transparent","stroke":"#245b93","strokeWidth":2,"dash":[]},"textStyle":{"font":"sans-serif","size":18,"leading":1.7,"weight":400,"italic":false,"align":"start","direction":"auto","background":"transparent","border":"transparent","color":"#245b93"},"effects":[]});let mut arrow=label.clone();arrow["id"]=json!("arrow");arrow["kind"]=json!("shape");arrow["shape"]=json!("arrow");arrow["anchor"]=json!({"nodeId":"deleted-source","u":-0.02,"v":1.01,"fallback":{"x":10,"y":20},"sourceKey":"{\"sha256\":null}","review":true});arrow["endAnchor"]=json!({"nodeId":"label","u":0,"v":0.5,"fallback":{"x":200,"y":140}});
  let initial=apply(&conn,&store::Ctx::user(),&page.id,json!({"id":db::new_id(),"actor":actor,"base":0,"at":db::now(),"label":"Create annotation","type":"edit","requiresBase":true,"changes":[{"type":"put","collection":"nodes","id":"arrow","value":arrow},{"type":"put","collection":"nodes","id":"label","value":label},{"type":"order","list":"nodeOrder","ids":["arrow","label"]}]})).unwrap();validate_scene(&initial["scene"]).unwrap();
  let changed=apply(&conn,&store::Ctx::user(),&page.id,json!({"id":db::new_id(),"actor":actor,"base":1,"at":db::now(),"label":"Move label and status","type":"edit","requiresBase":true,"changes":[{"type":"patch","collection":"nodes","id":"label","fields":{"x":450,"annotationStatus":"resolved"}},{"type":"patch","collection":"nodes","id":"arrow","fields":{"annotationStatus":"resolved"}}]})).unwrap();assert_eq!(changed["scene"]["nodes"]["label"]["x"],450);
  drop(conn);let conn=db::open(&path).unwrap();assert_eq!(load(&conn,&page.id).unwrap()["scene"],changed["scene"]);let undone=history_toggle(&conn,&page.id,2,&db::new_id(),false,&actor).unwrap();assert_eq!(undone["document"]["scene"],initial["scene"]);let redone=history_toggle(&conn,&page.id,3,&db::new_id(),true,&actor).unwrap();assert_eq!(redone["document"]["scene"],changed["scene"]);
  let mut invalid=changed["scene"].clone();invalid["nodes"]["arrow"]["anchor"]["review"]=json!("false");assert!(validate_scene(&invalid).is_err());drop(conn);std::fs::remove_file(path).unwrap();
 }
}
