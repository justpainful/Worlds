//! Read-only extraction of an owner's drawing comments from a Yjs snapshot.
use serde_json::{json, Value};
use yrs::{Doc, Map, Out, Transact, Update, types::ToJson, updates::decoder::Decode};

fn id(v: &Value) -> bool {
    v.as_str().is_some_and(|s| !s.is_empty() && s.encode_utf16().count() <= 160 && !["__proto__","constructor","prototype"].contains(&s))
}
fn number(v: Option<&Value>) -> Option<f64> { v?.as_f64().filter(|n|n.is_finite()) }
fn truthy(v: &Value) -> bool { match v { Value::Null=>false,Value::Bool(b)=>*b,Value::Number(n)=>n.as_f64().is_some_and(|x|x!=0.0),Value::String(s)=>!s.is_empty(),_=>true } }
fn valid_anchor(v: &Value) -> bool {
    let Some(a)=v.as_object() else { return false };
    if a.get("kind").and_then(Value::as_str)!=Some("drawing") || !a.get("frameId").is_some_and(id) || !a.get("nodeId").is_some_and(|v|v.is_null() || id(v)) { return false }
    if !["u","v"].iter().all(|k|number(a.get(*k)).is_some_and(|n|(0.0..=1.0).contains(&n))) { return false }
    let Some(region)=a.get("region").and_then(Value::as_object) else { return false };
    let Some(fallback)=a.get("fallback").and_then(Value::as_object) else { return false };
    let coordinate=|v:Option<&Value>| number(v).is_some_and(|n|n.abs()<=1e8);
    ["x","y","w","h"].iter().all(|k|coordinate(region.get(*k))) &&
        ["w","h"].iter().all(|k|number(region.get(*k)).is_some_and(|n|n>0.0 && n<=32768.0)) &&
        ["x","y"].iter().all(|k|coordinate(fallback.get(*k)))
}

pub fn extract(update: &[u8], owner: &str) -> Result<Vec<u8>, &'static str> {
    if update.len()>4*1024*1024 || owner.is_empty() || owner.len()>1024 { return Err("invalid archive") }
    let doc=Doc::new();
    doc.transact_mut().apply_update(Update::decode_v1(update).map_err(|_|"invalid update")?).map_err(|_|"invalid update")?;
    let threads=doc.get_or_insert_map("threads"); let txn=doc.transact();
    if threads.len(&txn)>10_000 { return Err("archive too large") }
    let mut out=Vec::new();
    for (thread_id, value) in threads.iter(&txn) {
        let Out::YMap(thread)=value else { continue };
        let value=serde_json::to_value(thread.to_json(&txn)).map_err(|_|"invalid thread")?;
        let Some(anchor)=value.get("anchor").filter(|v|valid_anchor(v)) else { continue };
        let thread_time=number(value.get("createdAt")).unwrap_or(0.0);
        let resolved=value.get("resolved").is_some_and(truthy);
        for comment in value.get("comments").and_then(Value::as_array).into_iter().flatten() {
            let (Some(comment_id),Some(author),Some(body))=(comment.get("id").and_then(Value::as_str),comment.get("author").and_then(Value::as_str),comment.get("body").and_then(Value::as_str)) else { continue };
            if author!=owner || comment.get("deleted").is_some_and(truthy) || body.trim().is_empty() { continue }
            if body.len()>256*1024 || comment_id.len()>1024 || out.len()>=10_000 { return Err("archive too large") }
            let at=number(comment.get("createdAt")).filter(|v|v.abs()<=8.64e15).unwrap_or(0.0);
            out.push((thread_time,json!({"threadID":thread_id,"commentID":comment_id,"body":body,"createdAt":at,"resolved":resolved,"anchor":anchor})));
        }
    }
    out.sort_by(|a,b|a.0.total_cmp(&b.0));
    let bytes=serde_json::to_vec(&out.into_iter().map(|(_,v)|v).collect::<Vec<_>>()).map_err(|_|"encoding failed")?;
    if bytes.len()>8*1024*1024 { return Err("archive too large") }
    Ok(bytes)
}
