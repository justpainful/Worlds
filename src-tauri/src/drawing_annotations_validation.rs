use anyhow::{anyhow,bail,Result};
use serde_json::Value;
fn number(v:&Value,key:&str)->Result<f64>{v[key].as_f64().filter(|n|n.is_finite()).ok_or_else(||anyhow!("invalid annotation {key}"))}
fn identifier(v:&Value)->bool{v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=160&&!matches!(s,"__proto__"|"prototype"|"constructor"))}
pub(crate) fn validate_node(node:&Value)->Result<()>{
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
