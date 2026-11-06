//! Drawing commands have their own validated scene and durable journal.
//! All writers (UI, MCP and later sync) use the same revision-checked path.
use crate::account::permissions::{require, Level};
use crate::{db, store, AppState};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::State;
#[path="drawing_history.rs"]
mod history;
#[path="drawing_annotations.rs"]
mod annotations;

const MAPS: &[&str] = &["frames", "layers", "nodes", "assets", "masks", "steps"];
const LISTS: &[(&str, &str)] = &[("frameOrder", "frames"), ("layerOrder", "layers"), ("nodeOrder", "nodes"), ("stepOrder", "steps")];
fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str> { v.get(k).and_then(Value::as_str).ok_or_else(|| anyhow!("missing {k}")) }
fn safe_id(s: &str) -> bool { !s.is_empty() && s.len() <= 160 && !matches!(s, "__proto__" | "prototype" | "constructor") }
fn numeric(v: &Value, k: &str) -> Result<f64> { v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite()).ok_or_else(|| anyhow!("invalid {k}")) }
fn rect(v: &Value) -> Result<()> { numeric(v, "x")?; numeric(v, "y")?; if numeric(v, "w")? <= 0.0 || numeric(v, "h")? <= 0.0 { bail!("invalid drawing dimensions"); } Ok(()) }
fn opacity(v: &Value) -> Result<()> { let n = numeric(v, "opacity")?; if !(0.0..=1.0).contains(&n) { bail!("invalid opacity"); } Ok(()) }

fn stroke_work(points: &[Value], brush: &Value) -> Result<f64> {
    let size = numeric(brush, "size")?; let spacing = numeric(brush, "spacing")?;
    if !(1.0..=2048.0).contains(&size) || !(0.01..=2.0).contains(&spacing) || points.len() > 65536 { bail!("invalid brush dimensions or sample count"); }
    opacity(brush)?;
    let mut length = 0.0;
    for (i, p) in points.iter().enumerate() {
        for k in ["x", "y", "pressure", "time", "tiltX", "tiltY"] { numeric(p, k)?; }
        if i > 0 { length += (numeric(p,"x")? - numeric(&points[i-1],"x")?).hypot(numeric(p,"y")? - numeric(&points[i-1],"y")?); }
    }
    let pigment = match text(brush,"kind")? {
        "spray" => (size / 3.0).ceil().max(1.0),
        "crayon" => (size * 5.0).ceil().clamp(5.0,256.0),
        "natural-pencil" => (size * 4.0).ceil().clamp(5.0,256.0),
        "oil" => 13.0,
        "watercolor" => 2.0,
        "pencil" | "hard" | "soft" | "ink" | "marker" | "highlighter" | "texture" | "calligraphy" => 1.0,
        _ => bail!("invalid brush kind"),
    };
    let pressure_spacing = if brush["pressureSize"].as_bool().unwrap_or(true) { 0.1 } else { 1.0 };
    let work = if points.is_empty() { 0.0 } else { (2.0 + length / (size * spacing * pressure_spacing).max(0.25)) * pigment };
    if !work.is_finite() || work > 1000000.0 { bail!("stroke exceeds the paint limit; start another stroke"); }
    Ok(work)
}

pub fn initial_scene(page: &str) -> Value {
    let f = format!("{page}-frame");
    let l = format!("{page}-layer");
    json!({ "schema": 1, "defaultFrameId": f,
        "frames": { &f: { "id": f, "name": "Frame 1", "x": 0, "y": 0, "w": 1280, "h": 720, "background": "#ffffff", "clip": true, "status": "draft", "exportScale": 1 } },
        "frameOrder": [f], "layers": { &l: { "id": l, "name": "Layer 1", "visible": true, "locked": false, "positionLocked": false, "alphaLocked": false, "opacity": 1, "blend": "source-over", "parentId": null } },
        "layerOrder": [l], "nodes": {}, "nodeOrder": [], "assets": {}, "masks": {}, "steps": {}, "stepOrder": [] })
}

pub fn validate_scene(scene: &Value) -> Result<()> {
    if scene.get("schema").and_then(Value::as_u64) != Some(1) { bail!("unsupported drawing schema"); }
    for name in MAPS {
        let map = scene.get(name).and_then(Value::as_object).ok_or_else(|| anyhow!("invalid {name}"))?;
        if map.len() > 100000 { bail!("too many drawing elements"); }
        for (id, value) in map { if !safe_id(id) || text(value, "id")? != id { bail!("invalid drawing identifier"); } }
    }
    for (list, map) in LISTS {
        let ids = scene.get(list).and_then(Value::as_array).ok_or_else(|| anyhow!("invalid {list}"))?;
        let entities = scene[map].as_object().unwrap();
        let mut seen = HashSet::new();
        for id in ids {
            let id = id.as_str().ok_or_else(|| anyhow!("invalid order identifier"))?;
            if !seen.insert(id) || !entities.contains_key(id) { bail!("invalid {list}"); }
        }
        if ids.len() != entities.len() { bail!("incomplete {list}"); }
    }
    if scene["frames"].get(text(scene, "defaultFrameId")?).is_none() || scene["layerOrder"].as_array().unwrap().is_empty() { bail!("a drawing needs a frame and a layer"); }
    for f in scene["frames"].as_object().unwrap().values() {
        rect(f)?;
        if let Some(grid)=f.get("grid"){if grid["visible"].as_bool().is_none()||grid["snap"].as_bool().is_none()||!(1.0..=10000.0).contains(&numeric(grid,"size")?){bail!("invalid frame grid");}}
        if let Some(guides)=f.get("guides"){let guides=guides.as_array().ok_or_else(||anyhow!("invalid frame guides"))?;let mut seen=HashSet::new();if guides.len()>128{bail!("too many guides");}for guide in guides{let id=text(guide,"id")?;if !safe_id(id)||!seen.insert(id)||!matches!(guide["axis"].as_str(),Some("x"|"y"))||numeric(guide,"at")?.abs()>1e9{bail!("invalid frame guide");}}}
        let w = numeric(f, "w")?; let h = numeric(f, "h")?;
        if w > 16384.0 || h > 16384.0 || w * h > 67108864.0 { bail!("frame exceeds memory limit"); }
    }
    for l in scene["layers"].as_object().unwrap().values() {
        opacity(l)?;
        let mut seen = HashSet::from([text(l, "id")?]);
        let mut parent = l.get("parentId").and_then(Value::as_str);
        while let Some(p) = parent {
            if !seen.insert(p) { bail!("cyclic layer group"); }
            let next = scene["layers"].get(p).ok_or_else(|| anyhow!("missing layer group"))?;
            parent = next.get("parentId").and_then(Value::as_str);
        }
    }
    for a in scene["assets"].as_object().unwrap().values(){
        if text(a,"attachmentId")?.is_empty()||a["mime"].as_str().is_none()||!(1.0..=1000000.0).contains(&numeric(a,"width")?)||!(1.0..=1000000.0).contains(&numeric(a,"height")?){bail!("invalid original asset");}
        if let Some(orientation)=a.get("orientation"){let value=orientation.as_f64().ok_or_else(||anyhow!("invalid image orientation"))?;if !(1.0..=8.0).contains(&value)||value.fract()!=0.0{bail!("invalid image orientation");}}
        if let Some(frame)=a.get("frameIndex"){let value=frame.as_f64().ok_or_else(||anyhow!("invalid animation frame"))?;if !(0.0..1000.0).contains(&value)||value.fract()!=0.0{bail!("invalid animation frame");}}
    }
    for n in scene["nodes"].as_object().unwrap().values() {
        annotations::validate_node(n)?;
        rect(n)?; opacity(n)?; numeric(n, "rotation")?;
        if let Some(size) = n.get("geometrySize") { for key in ["w", "h"] { let value = numeric(size, key)?; if !(0.000001..=1e9).contains(&value) { bail!("invalid original geometry size"); } } }
        if !matches!(text(n, "kind")?, "stroke" | "shape" | "text" | "image" | "reference" | "raster") { bail!("unknown drawing element"); }
        if let Some(flag)=n.get("redaction"){
            let redaction=flag.as_bool().ok_or_else(||anyhow!("invalid redaction flag"))?;
            if redaction&&(n["kind"]!="shape"||n["shape"]!="rect"||n["paint"]["fill"]!="#000000"||numeric(&n["paint"],"strokeWidth")?!=0.0||numeric(n,"opacity")?!=1.0||numeric(n,"rotation")?!=0.0||!n["paint"]["gradient"].is_null()||!n["maskId"].is_null()||!n["path"].is_null()||!n["anchor"].is_null()||!n["endAnchor"].is_null()||!n["annotationGroup"].is_null()||n["effects"].as_array().is_none_or(|effects|!effects.is_empty())||n["erase"].as_bool()==Some(true)||n["alphaLock"].as_bool()==Some(true)){bail!("redaction must be an opaque, unmasked black rectangle");}
        }
        text(n, "name")?;
        if n["kind"] == "reference" {
            if !n["sourceId"].as_str().is_some_and(safe_id) || !matches!(n["sourceMode"].as_str(), Some("live" | "snapshot")) { bail!("Invalid linked source"); }
            if n["sourceMode"] == "live" && (!n["referenceSnapshot"].is_null() || !n["sourceTitle"].is_null()) { bail!("Live links store identifiers, not source previews"); }
            if n["sourceMode"] == "snapshot" && (!n["referenceSnapshot"]["title"].is_string() || !n["referenceSnapshot"]["kind"].is_string() || n["referenceSnapshot"].to_string().len() > 32768) { bail!("Invalid frozen source snapshot"); }
        }
        text(&n["paint"], "fill")?; text(&n["paint"], "stroke")?;
        let width = numeric(&n["paint"], "strokeWidth")?;
        if !(0.0..=2048.0).contains(&width) || !n["paint"]["dash"].is_array() { bail!("invalid element paint"); }
        if let Some(g)=n["paint"].get("gradient"){if !matches!(g["type"].as_str(),Some("linear"|"radial")){bail!("invalid gradient");}for point in [&g["from"],&g["to"]]{if numeric(point,"x")?.abs()>1e9||numeric(point,"y")?.abs()>1e9{bail!("invalid gradient point");}}let stops=g["stops"].as_array().ok_or_else(||anyhow!("invalid gradient stops"))?;if !(2..=32).contains(&stops.len()){bail!("invalid gradient stops");}let mut last=0.0;for stop in stops{let at=numeric(stop,"at")?;if !(last..=1.0).contains(&at){bail!("invalid gradient order");}text(stop,"color")?;last=at;}}
        text(&n["textStyle"], "font")?;
        if !(1.0..=2048.0).contains(&numeric(&n["textStyle"], "size")?) || !(0.5..=8.0).contains(&numeric(&n["textStyle"], "leading")?) { bail!("invalid text style"); }
        if text(n,"kind")?=="text" {
        let style=&n["textStyle"];
        if text(style,"font")?.chars().count()>120||!(100.0..=1000.0).contains(&numeric(style,"weight")?)||style["italic"].as_bool().is_none()||!matches!(style["align"].as_str(),Some("start"|"center"|"end"))||!matches!(style["direction"].as_str(),Some("auto"|"rtl"|"ltr"))||style.get("resizeMode").is_some_and(|value|!matches!(value.as_str(),Some("wrap"|"scale"))){bail!("invalid text style");}
        text(style,"color")?;text(style,"background")?;text(style,"border")?;
        }
        if let Some(path)=n.get("path"){let points=path["vertices"].as_array().ok_or_else(||anyhow!("invalid editable path"))?;if path["closed"].as_bool().is_none()||!(2..=4096).contains(&points.len()){bail!("invalid editable path");}for point in points{for p in std::iter::once(point).chain(point.get("in")).chain(point.get("out")) {if numeric(p,"x")?.abs()>1e9||numeric(p,"y")?.abs()>1e9{bail!("invalid editable path point");}}}}
        let effects = n["effects"].as_array().ok_or_else(|| anyhow!("invalid effects"))?;
        if effects.len() > 64 { bail!("too many effects"); }
        for e in effects { if !matches!(text(e, "kind")?, "brightness" | "contrast" | "saturation" | "temperature" | "grayscale" | "invert" | "blur" | "sharpen" | "pixelate") || !(-1.0..=256.0).contains(&numeric(e, "amount")?) { bail!("invalid effect"); } }
        if scene["layers"].get(text(n, "layerId")?).is_none() { bail!("missing layer"); }
        for (key, map) in [("frameId", "frames"), ("assetId", "assets"), ("maskId", "masks")] {
            if let Some(id) = n.get(key).and_then(Value::as_str) { if scene[map].get(id).is_none() { bail!("missing {key}"); } }
        }
        if text(n, "kind")? == "stroke" {
            let points = n.get("samples").and_then(Value::as_array).ok_or_else(|| anyhow!("missing stroke samples"))?;
            if points.is_empty() || points.len() > 65536 || !n["brush"].is_object() { bail!("invalid stroke"); }
            let brush = &n["brush"];
            if !(1.0..=2048.0).contains(&numeric(brush, "size")?) || !(0.01..=2.0).contains(&numeric(brush, "spacing")?) { bail!("invalid brush dimensions"); }
            opacity(brush)?;
            for p in points {
                for k in ["x", "y", "pressure", "time", "tiltX", "tiltY"] { numeric(p, k)?; }
                let x = numeric(p, "x")?; let y = numeric(p, "y")?;
                let geometry = n.get("geometrySize").unwrap_or(n);
                if x < -2048.0 || y < -2048.0 || x > numeric(geometry, "w")? + 2048.0 || y > numeric(geometry, "h")? + 2048.0 { bail!("invalid stroke bounds"); }
            }
            stroke_work(points, brush)?;
        }
        if matches!(text(n, "kind")?, "image" | "raster") && n["assetId"].as_str().is_none() { bail!("missing original image"); }
    }
    for mask in scene["masks"].as_object().unwrap().values() {
        let strokes = mask["strokes"].as_array().ok_or_else(|| anyhow!("invalid mask"))?;
        let mut work = 0.0;
        for stroke in strokes {
            let points = stroke["samples"].as_array().ok_or_else(||anyhow!("invalid mask samples"))?;
            work += stroke_work(points, &stroke["brush"])?;
            if work > 1000000.0 { bail!("mask exceeds the paint limit"); }
        }
        if let Some(id) = mask["assetId"].as_str() { if scene["assets"].get(id).is_none() { bail!("missing mask asset"); } }
    }
    for step in scene["steps"].as_object().unwrap().values() {
        rect(&step["camera"])?;
        if scene["frames"].get(text(step, "frameId")?).is_none() { bail!("missing step frame"); }
    }
    if scene.get("libraryPublication").is_some(){crate::drawing_library::validate_scene_publication(scene)?;}
    Ok(())
}

fn pixel_guard_equal(a:&Value,b:&Value)->bool {
    match(a,b) {
        (Value::Number(a),Value::Number(b))=>a.as_f64()==b.as_f64(),
        (Value::Array(a),Value::Array(b))=>a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|pixel_guard_equal(a,b)),
        (Value::Object(a),Value::Object(b))=>a.len()==b.len()&&a.iter().all(|(key,value)|b.get(key).is_some_and(|other|pixel_guard_equal(value,other))),
        _=>a==b,
    }
}
/// Durable read precondition for an offline destructive pixel edit. History
/// replay ignores it; only accepting/rebasing a new edit checks its source.
pub(crate) fn check_pixel_guard(scene:&Value,guard:&Value)->Result<()> {
    use std::collections::BTreeSet;
    if !guard.is_object() || serde_json::to_vec(guard)?.len()>32*1024*1024 { bail!("Invalid pixel source guard"); }
    let frame=text(guard,"frameId")?;let layer=text(guard,"layerId")?;let source=text(guard,"source")?;
    if !safe_id(frame)||!safe_id(layer)||!["current","visible"].contains(&source)||scene["frames"].get(frame).is_none()||scene["layers"].get(layer).is_none(){bail!("Invalid pixel source guard");}
    let layers:Vec<Value>=scene["layerOrder"].as_array().ok_or_else(||anyhow!("Invalid layer order"))?.iter().filter_map(|id|{
        let key=id.as_str()?;let l=&scene["layers"][key];
        ((source=="visible"||key==layer)&&l["visible"].as_bool()==Some(true)&&l["opacity"].as_f64().unwrap_or(0.0)>0.0).then(||l.clone())
    }).collect();
    let ids:BTreeSet<&str>=layers.iter().filter_map(|l|l["id"].as_str()).collect();
    let nodes:Vec<Value>=scene["nodeOrder"].as_array().ok_or_else(||anyhow!("Invalid node order"))?.iter().filter_map(|id|{
        let n=&scene["nodes"][id.as_str()?];
        (n["layerId"].as_str().is_some_and(|id|ids.contains(id))&&(n["frameId"].is_null()||n["frameId"].as_str()==Some(frame))).then(||n.clone())
    }).collect();
    let mut masks=BTreeSet::new();let mut assets=BTreeSet::new();let mut targets=BTreeSet::new();
    for n in &nodes {
        if let Some(id)=n["assetId"].as_str(){assets.insert(id.to_string());}
        if let Some(id)=n["brush"]["tipAssetId"].as_str(){assets.insert(id.to_string());}
        if let Some(id)=n["maskId"].as_str(){masks.insert(id.to_string());}
        if let Some(effects)=n["effects"].as_array(){for e in effects{if let Some(id)=e["maskId"].as_str(){masks.insert(id.to_string());}}}
        for key in ["anchor","endAnchor"]{if let Some(id)=n[key]["nodeId"].as_str(){targets.insert(id.to_string());}}
    }
    for id in &masks {
        let m=&scene["masks"][id];if let Some(id)=m["assetId"].as_str(){assets.insert(id.to_string());}
        if let Some(strokes)=m["strokes"].as_array(){for s in strokes{if let Some(id)=s["brush"]["tipAssetId"].as_str(){assets.insert(id.to_string());}}}
    }
    let entities=|collection:&str,keys:BTreeSet<String>|->Value{Value::Object(keys.into_iter().map(|key|{let value=scene[collection].get(&key).cloned().unwrap_or(Value::Null);(key,value)}).collect())};
    let mut ancestors_set=BTreeSet::new();
    for selected in &layers {let mut parent=selected["parentId"].as_str();while let Some(key)=parent{if !ancestors_set.insert(key.to_string()){break;}parent=scene["layers"][key]["parentId"].as_str();}}
    let ancestors:Vec<Value>=scene["layerOrder"].as_array().unwrap().iter().filter_map(|id|{let key=id.as_str()?;(ancestors_set.contains(key)&&!ids.contains(key)).then(||scene["layers"][key].clone())}).collect();
    let mut actual=json!({"frameId":frame,"layerId":layer,"source":source,"expected":{"frame":scene["frames"][frame],"layers":layers,"nodes":nodes,"targets":entities("nodes",targets),"masks":entities("masks",masks),"assets":entities("assets",assets)}});
    if !ancestors.is_empty(){actual["expected"]["ancestors"]=json!(ancestors);}
    if !pixel_guard_equal(&actual,guard){bail!("conflict: the sampled pixel source changed; keep this edit for recovery");}
    Ok(())
}
pub(crate) fn apply_changes(scene: &mut Value, changes: &Value, replay: bool) -> Result<()> {
    let changes = changes.as_array().ok_or_else(|| anyhow!("missing drawing changes"))?;
    if changes.len() > 10000 { bail!("too many changes"); }
    for c in changes {
        match text(c, "type")? {
            "defaultFrame" => scene["defaultFrameId"] = c["id"].clone(),
            "order" => {
                let list = text(c, "list")?;
                let (_, map) = LISTS.iter().find(|(l, _)| *l == list).ok_or_else(|| anyhow!("invalid order"))?;
                let mut ids = c["ids"].as_array().ok_or_else(|| anyhow!("invalid order"))?.clone();
                if replay {
                    ids.retain(|id| id.as_str().is_some_and(|id| scene[map].get(id).is_some()));
                    for id in scene[map].as_object().unwrap().keys() { let v = json!(id); if !ids.contains(&v) { ids.push(v); } }
                }
                scene[list] = json!(ids);
            }
            kind @ ("put" | "patch" | "remove") => {
                let map = text(c, "collection")?; let id = text(c, "id")?;
                if !MAPS.contains(&map) || !safe_id(id) { bail!("invalid drawing entity"); }
                let entities = scene[map].as_object_mut().ok_or_else(|| anyhow!("invalid collection"))?;
                match kind {
                    "put" => { if entities.contains_key(id) { bail!("element already exists"); } entities.insert(id.into(), c["value"].clone()); }
                    "remove" => { entities.remove(id); }
                    _ => {
                        let fields = c["fields"].as_object().ok_or_else(|| anyhow!("invalid fields"))?;
                        let target = entities.get_mut(id).and_then(Value::as_object_mut).ok_or_else(|| anyhow!("element changed or was removed"))?;
                        for (k, v) in fields { if !safe_id(k) || k == "id" { bail!("invalid element field"); } target.insert(k.clone(), v.clone()); }
                    }
                }
            }
            _ => bail!("unknown drawing operation"),
        }
    }
    Ok(())
}

fn require_drawing(conn: &Connection, page: &str, level: Level) -> Result<()> {
    require(conn, page, level)?;
    crate::drawing_sync::check_bound_identity(conn, page)?;
    let p = store::page_meta_by_id(conn, page)?.ok_or_else(|| anyhow!("drawing not found"))?;
    if p.kind != "drawing" || p.deleted_at.is_some() { bail!("drawing not found"); }
    Ok(())
}
pub fn load(conn: &Connection, page: &str) -> Result<Value> {
    require_drawing(conn, page, Level::View)?;
    let row: Option<(i64, String, String)> = conn.query_row("SELECT revision, seed, scene FROM drawing_documents WHERE page_id = ?1", [page], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    let (revision, seed, scene) = if let Some((r, a, b)) = row { (r, serde_json::from_str::<Value>(&a)?, serde_json::from_str::<Value>(&b)?) } else { let s = initial_scene(page); (0, s.clone(), s) };
    let mut stmt = conn.prepare("SELECT payload FROM drawing_operations WHERE page_id = ?1 ORDER BY revision")?;
    let raw: Vec<String> = stmt.query_map([page], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let operations: Vec<Value> = raw.iter().map(|s| serde_json::from_str(s)).collect::<serde_json::Result<_>>()?;
    let metadata: String = conn.query_row("SELECT metadata FROM pages WHERE id = ?1", [page], |r| r.get(0))?;
    let metadata: Value = serde_json::from_str(&metadata)?;
    Ok(json!({ "revision": revision, "seed": seed, "scene": scene, "operations": operations, "experiment": metadata.get("experiment") }))
}
pub fn apply(conn: &Connection, ctx: &store::Ctx, page: &str, op: Value) -> Result<Value> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = apply(&tx, ctx, page, op)?;
        tx.commit()?;
        return Ok(result);
    }
    require_drawing(conn, page, Level::Edit)?;
    let actor = store::profile(conn)?.id;
    if text(&op, "actor")? != actor || !safe_id(text(&op, "id")?) || text(&op, "label")?.trim().is_empty() || op["at"].as_f64().is_none() { bail!("invalid drawing author or operation"); }
    if op.get("requiresBase").is_some_and(|flag|flag.as_bool()!=Some(true)||op["type"]!="edit"){bail!("Invalid strict drawing base");}
    if !op["versionRestore"].is_null() && (!op["versionRestore"].is_object() || op["versionRestore"]["backupId"] != op["id"] || op["versionRestore"]["expectedRevision"] != op["base"] || !op["versionRestore"]["versionId"].as_str().is_some_and(safe_id)) { bail!("Invalid version restore receipt"); }
    if op.to_string().len() > 8 * 1024 * 1024 { bail!("drawing operation is too large; split the stroke into segments"); }
    let tx = conn;
    let doc = load(&tx, page)?;
    let mut ops = doc["operations"].as_array().unwrap().clone();
    if let Some(old) = ops.iter().find(|p| p["id"] == op["id"]) {
        if old != &op { bail!("operation identifier was reused"); }
        return Ok(doc);
    }
    let revision = doc["revision"].as_i64().unwrap();
    if op["base"].as_i64() != Some(revision) { bail!("conflict: the drawing changed; retain this edit in a recovered copy"); }
    if op["type"]=="edit" && !op["pixelGuard"].is_null(){check_pixel_guard(&doc["scene"],&op["pixelGuard"])?;}
    let mut scene = doc["scene"].clone();
    match text(&op, "type")? {
        "edit" => apply_changes(&mut scene, &op["changes"], false)?,
        "toggle" => {
            let target = ops.iter().find(|p| p["id"] == op["target"]).ok_or_else(|| anyhow!("missing undo target"))?;
            if target["type"] != "edit" || target["actor"] != op["actor"] || !op["enabled"].is_boolean() { bail!("only the author can undo this operation"); }
            scene = doc["seed"].clone();
            let mut enabled = std::collections::HashMap::<String, bool>::new();
            for p in ops.iter().chain(std::iter::once(&op)) {
                if p["type"] == "edit" { enabled.insert(text(p, "id")?.into(), true); }
                else { enabled.insert(text(p, "target")?.into(), p["enabled"].as_bool().unwrap_or(true)); }
            }
            for p in &ops { if p["type"] == "edit" && enabled.get(text(p, "id")?) == Some(&true) { apply_changes(&mut scene, &p["changes"], true)?; } }
        }
        _ => bail!("unknown drawing operation"),
    }
    validate_scene(&scene)?;
    for asset in scene["assets"].as_object().unwrap().values() {
        let a = store::get_attachment(&tx, text(asset, "attachmentId")?)?.ok_or_else(|| anyhow!("missing original attachment"))?;
        if let Some(source_page) = a.page_id { require(&tx, &source_page, Level::View)?; }
    }
    let search = search_text(&scene);
    tx.execute("INSERT INTO drawing_documents(page_id, revision, seed, scene, search_text, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(page_id) DO UPDATE SET revision = excluded.revision, scene = excluded.scene, search_text = excluded.search_text, updated_at = excluded.updated_at", params![page, revision + 1, doc["seed"].to_string(), scene.to_string(), search, db::now()])?;
    tx.execute("INSERT INTO drawing_operations(page_id, id, revision, actor, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![page, text(&op, "id")?, revision + 1, actor, op.to_string(), db::now()])?;
    crate::drawing_sync::queue_local(tx, page, &doc["scene"], &op)?;
    tx.execute("UPDATE pages SET updated_at = ?1 WHERE id = ?2", params![db::now(), page])?;
    store::index_page(&tx, page)?;
    rebuild_links(&tx, page, &scene)?;
    store::record(&tx, ctx, Some(page), "drawing", text(&op, "label")?, None, None, None, json!({ "drawingOperationId": op["id"], "revision": revision + 1 }))?;
    db::mark_change(&tx, Some(page), "drawing", &ctx.origin)?;
    ops.push(op);
    Ok(json!({ "revision": revision + 1, "seed": doc["seed"], "scene": scene, "operations": ops, "experiment": doc.get("experiment") }))
}

/// Chooses from the bounded SQLite author window and commits one ordinary
/// canonical toggle. The stable request ID makes a lost IPC reply retry safe.
pub fn history_toggle(conn:&Connection,page:&str,expected_revision:i64,request_id:&str,redo:bool,expected_actor:&str)->Result<Value>{
 if conn.is_autocommit(){let tx=conn.unchecked_transaction()?;let result=history_toggle(&tx,page,expected_revision,request_id,redo,expected_actor)?;tx.commit()?;return Ok(result);}
 require_drawing(conn,page,Level::Edit)?;uuid::Uuid::parse_str(request_id)?;let actor=store::profile(conn)?.id;if actor!=expected_actor{bail!("Undo belongs to another signed-in account");}
 let old:Option<String>=conn.query_row("SELECT payload FROM drawing_operations WHERE page_id=?1 AND id=?2",params![page,request_id],|r|r.get(0)).optional()?;
 if let Some(raw)=old{let old:Value=serde_json::from_str(&raw)?;if old["type"]!="toggle"||old["actor"]!=actor||old["base"].as_i64()!=Some(expected_revision)||old["enabled"].as_bool()!=Some(redo){bail!("Undo request identifier was reused");}return Ok(json!({"document":load(conn,page)?,"operationId":request_id,"window":history::choose(conn,page,&actor,redo)?.info}));}
 let revision:Option<i64>=conn.query_row("SELECT revision FROM drawing_documents WHERE page_id=?1",[page],|r|r.get(0)).optional()?;
 let revision=revision.unwrap_or(0);if revision!=expected_revision{bail!("history-stale: The drawing changed before Undo. Review the current drawing and try again.");}
 let window=history::choose(conn,page,&actor,redo)?;
 let Some(target)=window.target else{return Ok(json!({"document":load(conn,page)?,"operationId":Value::Null,"window":window.info}));};
 let operation=json!({"id":request_id,"actor":actor,"base":revision,"at":db::now(),"label":if redo{"Redo"}else{"Undo"},"type":"toggle","target":target,"enabled":redo});
 let document=apply(conn,&store::Ctx::user(),page,operation)?;
 Ok(json!({"document":document,"operationId":request_id,"window":window.info}))
}

fn storage_message(error:anyhow::Error)->String{
 if error.chain().any(|e|e.downcast_ref::<rusqlite::Error>().is_some_and(|e|matches!(e,rusqlite::Error::SqliteFailure(code,_) if code.code==rusqlite::ErrorCode::DiskFull))){return "Storage is full. The saved drawing is unchanged; your pending work is kept for retry.".into();}
 format!("{error:#}")
}

pub fn history_import(conn:&Connection,page:&str,document:Value)->Result<Value>{
 if conn.is_autocommit(){let tx=conn.unchecked_transaction()?;let result=history_import(&tx,page,document)?;tx.commit()?;return Ok(result);}
 require_drawing(conn,page,Level::Full)?;
 let shared=crate::sync::page_mode(conn,page)?.shared;
 let has_replica:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM drawing_sync_state WHERE page_id=?1)",[page],|r|r.get(0))?;
 let count:i64=conn.query_row("SELECT COUNT(*) FROM drawing_operations WHERE page_id=?1",[page],|r|r.get(0))?;
 let current=load(conn,page)?;
 let contains_artwork=["nodes","assets","masks","steps"].iter().any(|key|current["scene"][key].as_object().is_some_and(|v|!v.is_empty()));
 if shared||has_replica||count!=0||current["revision"]!=0||contains_artwork{bail!("History can only be imported into a new local drawing with no edits");}
 history::validate_import(conn,page,&document)?;
 conn.execute("INSERT INTO drawing_documents(page_id,revision,seed,scene,search_text,updated_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(page_id) DO UPDATE SET revision=excluded.revision,seed=excluded.seed,scene=excluded.scene,search_text=excluded.search_text,thumbnail_id=NULL,updated_at=excluded.updated_at",params![page,document["revision"].as_i64(),document["seed"].to_string(),document["scene"].to_string(),search_text(&document["scene"]),db::now()])?;
 for operation in document["operations"].as_array().unwrap(){conn.execute("INSERT INTO drawing_operations(page_id,id,revision,actor,payload,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![page,text(operation,"id")?,operation["base"].as_i64().unwrap()+1,text(operation,"actor")?,operation.to_string(),operation["at"].as_i64().unwrap_or_else(db::now)])?;}
 conn.execute("UPDATE pages SET updated_at=?1 WHERE id=?2",params![db::now(),page])?;store::index_page(conn,page)?;rebuild_links(conn,page,&document["scene"])?;
 store::record(conn,&store::Ctx::user(),Some(page),"drawing","Import drawing history",None,None,None,json!({"revision":document["revision"]}))?;db::mark_change(conn,Some(page),"drawing","import")?;load(conn,page)
}

pub fn versions(conn: &Connection, page: &str) -> Result<Value> {
    require_drawing(conn, page, Level::View)?;
    let mut stmt = conn.prepare("SELECT id, revision, label, author, created_at FROM drawing_versions WHERE page_id = ?1 ORDER BY created_at DESC, rowid DESC")?;
    let rows: Vec<Value> = stmt.query_map([page], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "revision": r.get::<_, i64>(1)?, "label": r.get::<_, String>(2)?, "author": r.get::<_, String>(3)?, "createdAt": r.get::<_, i64>(4)? })))?.collect::<rusqlite::Result<_>>()?;
    Ok(json!(rows))
}
pub fn save_version(conn: &Connection, page: &str, label: &str) -> Result<Value> {
    require_drawing(conn, page, Level::Edit)?;
    let doc = load(conn, page)?;
    let id = db::new_id();
    let actor = store::profile(conn)?.id;
    conn.execute("INSERT INTO drawing_versions(id, page_id, revision, label, author, scene, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![id, page, doc["revision"].as_i64(), label, actor, doc["scene"].to_string(), db::now()])?;
    Ok(json!({ "id": id, "revision": doc["revision"], "label": label, "author": actor, "createdAt": db::now() }))
}
pub fn version_scene(conn: &Connection, page: &str, id: &str) -> Result<Value> {
    require_drawing(conn, page, Level::View)?;
    let scene: String = conn.query_row("SELECT scene FROM drawing_versions WHERE id = ?1 AND page_id = ?2", params![id, page], |r| r.get(0))?;
    Ok(serde_json::from_str(&scene)?)
}

fn scene_changes(before: &Value, after: &Value) -> Result<Value> {
    validate_scene(after)?;
    let mut changes = Vec::new();
    for map in MAPS {
        let old = before[map].as_object().ok_or_else(|| anyhow!("invalid current drawing"))?;
        let new = after[map].as_object().unwrap();
        for id in old.keys().filter(|id| !new.contains_key(*id)) { changes.push(json!({"type":"remove","collection":map,"id":id})); }
        for (id, value) in new {
            if let Some(prior) = old.get(id) {
                let prior = prior.as_object().ok_or_else(|| anyhow!("invalid current drawing entity"))?;
                let value = value.as_object().ok_or_else(|| anyhow!("invalid restored drawing entity"))?;
                let mut fields = serde_json::Map::new();
                for key in prior.keys().chain(value.keys()).filter(|key| key.as_str() != "id") {
                    if prior.get(key) != value.get(key) { fields.insert(key.clone(), value.get(key).cloned().unwrap_or(Value::Null)); }
                }
                if !fields.is_empty() { changes.push(json!({"type":"patch","collection":map,"id":id,"fields":fields})); }
            } else { changes.push(json!({"type":"put","collection":map,"id":id,"value":value})); }
        }
    }
    for (list, _) in LISTS { if before[list] != after[list] { changes.push(json!({"type":"order","list":list,"ids":after[list]})); } }
    if before["defaultFrameId"] != after["defaultFrameId"] { changes.push(json!({"type":"defaultFrame","id":after["defaultFrameId"]})); }
    Ok(json!(changes))
}

/// Save the state being replaced and append its replacement in one transaction.
/// The caller keeps the same restore ID after a lost IPC reply.
pub fn restore_version(conn: &Connection, page: &str, version: &str, expected_revision: i64, restore_id: &str, label: &str, backup_label: &str) -> Result<Value> {
    if conn.is_autocommit() { let tx = conn.unchecked_transaction()?; let result = restore_version(&tx, page, version, expected_revision, restore_id, label, backup_label)?; tx.commit()?; return Ok(result); }
    require_drawing(conn, page, Level::Edit)?;
    uuid::Uuid::parse_str(restore_id)?;
    if label.trim().is_empty() || backup_label.trim().is_empty() || label.chars().count() > 200 || backup_label.chars().count() > 200 { bail!("Name the restored edit and its saved previous version"); }
    let actor = store::profile(conn)?.id;
    let metadata = json!({"versionId":version,"expectedRevision":expected_revision,"backupId":restore_id});
    let prior: Option<String> = conn.query_row("SELECT payload FROM drawing_operations WHERE page_id=?1 AND id=?2", params![page, restore_id], |r| r.get(0)).optional()?;
    if let Some(prior) = prior {
        let prior: Value = serde_json::from_str(&prior)?;
        if prior["versionRestore"] != metadata || prior["actor"] != actor { bail!("Restore identifier was reused"); }
        // Access is checked again even when the first reply was lost.
        let backup = version_scene(conn, page, restore_id)?;
        if prior["changes"] != scene_changes(&backup, &version_scene(conn,page,version)?)? { bail!("Restore identifier was reused"); }
        return Ok(json!({"operationId":restore_id,"backupId":restore_id,"document":load(conn,page)?}));
    }
    let before = load(conn, page)?;
    if before["revision"].as_i64() != Some(expected_revision) { bail!("The drawing changed after this preview. Review the current version before restoring."); }
    if crate::sync::page_mode(conn, page)?.shared {
        let pending: i64 = conn.query_row("SELECT COUNT(*) FROM drawing_sync_outbox WHERE page_id=?1", [page], |r| r.get(0))?;
        let status: Option<String> = conn.query_row("SELECT status FROM drawing_sync_state WHERE page_id=?1", [page], |r| r.get(0)).optional()?;
        if pending > 0 || status.as_deref() != Some("synced") { bail!("Synchronize this shared drawing before restoring a version"); }
    }
    let target = version_scene(conn, page, version)?;
    let mut versions = vec![version.to_string()]; let mut checked = HashSet::new();
    while let Some(id) = versions.pop() {
        if !checked.insert(id.clone()) { continue; }
        if checked.len() > 10000 { bail!("Too many pinned versions to restore"); }
        let snapshot = version_scene(conn,page,&id)?; validate_scene(&snapshot)?;
        for asset in snapshot["assets"].as_object().unwrap().values() {
            let original = store::get_attachment(conn,text(asset,"attachmentId")?)?.ok_or_else(||anyhow!("A saved original is missing"))?;
            if let Some(source) = original.page_id { require(conn,&source,Level::View)?; }
            if !db::attachments_dir().join(original.rel_path).is_file() { bail!("A saved original file is missing. Recover it before restoring this version."); }
        }
        for step in snapshot["steps"].as_object().unwrap().values() { if let Some(id) = step["pinnedVersionId"].as_str() { versions.push(id.to_string()); } }
    }
    let changes = scene_changes(&before["scene"], &target)?;
    if changes.as_array().unwrap().is_empty() { bail!("This version already matches the current drawing"); }
    conn.execute("INSERT INTO drawing_versions(id,page_id,revision,label,author,scene,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![restore_id,page,expected_revision,backup_label,actor,before["scene"].to_string(),db::now()])?;
    let document = apply(conn, &store::Ctx::user(), page, json!({"id":restore_id,"actor":actor,"base":expected_revision,"at":db::now(),"label":label,"type":"edit","changes":changes,"versionRestore":metadata}))?;
    Ok(json!({"operationId":restore_id,"backupId":restore_id,"document":document}))
}

pub fn search_text(scene: &Value) -> String {
    let mut out = Vec::new();
    for map in ["frames", "nodes", "steps"] {
        if let Some(entities) = scene[map].as_object() { for value in entities.values() {
            for key in ["name", "text", "title", "body"] { if let Some(s) = value[key].as_str() { out.push(s.to_string()); } }
            if value["sourceMode"] == "snapshot" { for key in ["title", "excerpt"] { if let Some(s) = value["referenceSnapshot"][key].as_str() { out.push(s.to_string()); } } }
        } }
    }
    out.join("\n")
}
pub fn rebuild_links(conn: &Connection, page: &str, scene: &Value) -> Result<()> {
    conn.execute("DELETE FROM refs WHERE source_page = ?1 AND kind = 'drawing_link'", [page])?;
    for node in scene["nodes"].as_object().unwrap().values() {
        if let Some(source) = node["sourceId"].as_str() { conn.execute("INSERT OR IGNORE INTO refs(source_page, source_block, target_page, kind) VALUES (?1, ?2, ?3, 'drawing_link')", params![page, node["id"].as_str(), source])?; }
    }
    Ok(())
}

/// A duplicated drawing owns its originals so revoking/deleting the source cannot break it.
pub fn duplicate_into(conn: &Connection, source: &str, target: &str) -> Result<()> {
    let raw: Option<String> = conn.query_row("SELECT scene FROM drawing_documents WHERE page_id = ?1", [source], |r| r.get(0)).optional()?;
    let Some(raw) = raw else { return Ok(()) };
    let scene: Value = serde_json::from_str(&raw)?;
    let scene = materialize_scene_dependencies(conn, source, target, scene)?;
    conn.execute("INSERT INTO drawing_documents(page_id, revision, seed, scene, search_text, updated_at) VALUES (?1, 0, ?2, ?2, ?3, ?4)", params![target, scene.to_string(), search_text(&scene), db::now()])?;
    store::index_page(conn, target)?;
    rebuild_links(conn, target, &scene)?;
    Ok(())
}
pub fn materialize_scene_dependencies(conn: &Connection, source: &str, target: &str, scene: Value) -> Result<Value> {
    require(conn, source, Level::View)?;
    let mut scene = materialize_scene_assets(conn, target, scene)?;
    if source!=target{scene.as_object_mut().unwrap().remove("libraryPublication");}
    let mut version_ids = std::collections::HashMap::<String, String>::new();
    let mut versions = std::collections::HashMap::<String, Value>::new();
    let mut pending: Vec<String> = scene["steps"].as_object().unwrap().values().filter_map(|step| step["pinnedVersionId"].as_str().map(String::from)).collect();
    while let Some(old_id) = pending.pop() {
        if version_ids.contains_key(&old_id) { continue; }
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM drawing_versions WHERE page_id = ?1 AND id = ?2)", params![target, old_id], |r| r.get(0))?;
        if exists { version_ids.insert(old_id.clone(), old_id); continue; }
        if version_ids.len() >= 500 { bail!("too many linked presentation versions to duplicate"); }
        let raw: String = conn.query_row("SELECT scene FROM drawing_versions WHERE page_id = ?1 AND id = ?2", params![source, old_id], |r| r.get(0))?;
        let snapshot: Value = serde_json::from_str(&raw)?;
        pending.extend(snapshot["steps"].as_object().unwrap().values().filter_map(|step| step["pinnedVersionId"].as_str().map(String::from)));
        version_ids.insert(old_id.clone(), db::new_id()); versions.insert(old_id, snapshot);
    }
    let remap_versions = |scene: &mut Value| { if let Some(steps) = scene["steps"].as_object_mut() { for step in steps.values_mut() { if let Some(new_id) = step["pinnedVersionId"].as_str().and_then(|id| version_ids.get(id)) { step["pinnedVersionId"] = json!(new_id); } } } };
    remap_versions(&mut scene);
    for (old_id, snapshot) in versions {
        let mut snapshot = materialize_scene_assets(conn, target, snapshot)?;if source!=target{snapshot.as_object_mut().unwrap().remove("libraryPublication");} remap_versions(&mut snapshot);
        conn.execute("INSERT INTO drawing_versions(id, page_id, revision, label, author, scene, created_at) SELECT ?1, ?2, revision, label, author, ?3, created_at FROM drawing_versions WHERE id = ?4 AND page_id = ?5", params![version_ids[&old_id], target, snapshot.to_string(), old_id, source])?;
    }
    Ok(scene)
}

/// Independent attachment identities share immutable bytes on disk.
pub fn materialize_scene_assets(conn: &Connection, target: &str, mut scene: Value) -> Result<Value> {
    require(conn, target, Level::Edit)?;
    validate_scene(&scene)?;
    let mut copied: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Some(assets) = scene["assets"].as_object_mut() { for asset in assets.values_mut() {
        let source_id = text(asset, "attachmentId")?.to_string();
        let copied_id = if let Some(id) = copied.get(&source_id) { id.clone() } else {
            let attachment = store::get_attachment(conn, &source_id)?.ok_or_else(|| anyhow!("missing original attachment"))?;
            if let Some(source_page) = &attachment.page_id { require(conn, source_page, Level::View)?; }
            let existing: Option<String> = conn.query_row("SELECT id FROM attachments WHERE page_id = ?1 AND rel_path = ?2 LIMIT 1", params![target, attachment.rel_path], |r| r.get(0)).optional()?;
            let attachment_id = if let Some(id) = existing { id } else {
                let id = db::new_id();
                conn.execute("INSERT INTO attachments(id, page_id, kind, file_name, mime, size, rel_path, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)", params![id, target, attachment.kind, attachment.file_name, attachment.mime, attachment.size, attachment.rel_path, attachment.width, attachment.height, db::now()])?;
                id
            };
            copied.insert(source_id, attachment_id.clone()); attachment_id
        };
        asset["attachmentId"] = json!(copied_id);
    } }
    Ok(scene)
}

pub fn create_experiment(conn: &Connection, source: &str, name: &str, description: &str) -> Result<store::PageMeta> {
    create_experiment_authorized(conn,source,name,description,None)
}
pub fn create_experiment_authorized(conn: &Connection, source: &str, name: &str, description: &str, permit: Option<&crate::drawing_copy::Permit>) -> Result<store::PageMeta> {
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        let result = create_experiment_authorized(&tx, source, name, description,permit)?;
        tx.commit()?; return Ok(result);
    }
    require_drawing(conn, source, Level::Edit)?;
    crate::drawing_copy::require_current(conn,source,permit)?;
    if name.trim().is_empty() { bail!("name the experiment"); }
    let tx = conn;
    let base = save_version(&tx, source, &format!("Experiment base: {name}"))?;
    let page = store::duplicate_page_authorized(&tx, &store::Ctx::user(), source, false, Some("drawing"), Some(Some(source)),permit)?;
    let before = load(&tx, source)?; let after = load(&tx, &page.id)?;
    let mut aliases = serde_json::Map::new();
    for (id, step) in before["scene"]["steps"].as_object().unwrap() {
        if let (Some(old), Some(new)) = (step["pinnedVersionId"].as_str(), after["scene"]["steps"][id]["pinnedVersionId"].as_str()) { aliases.insert(new.into(), json!(old)); }
    }
    store::update_page(&tx, &store::Ctx::user(), &page.id, store::PagePatch { title: Some(name.trim().into()), ..Default::default() })?;
    let page = store::set_page_meta(&tx, &store::Ctx::user(), &page.id, "experiment", json!({ "sourceId": source, "baseVersionId": base["id"], "author": store::profile(&tx)?.id, "createdAt": db::now(), "description": description, "status": "draft", "versionAliases": aliases }))?;
    Ok(page)
}
pub fn list_experiments(conn: &Connection, source: &str) -> Result<Value> {
    require_drawing(conn, source, Level::View)?;
    let ids: Vec<String> = conn.prepare("SELECT id FROM pages WHERE kind = 'drawing' AND deleted_at IS NULL AND json_extract(metadata, '$.experiment.sourceId') = ?1 ORDER BY created_at DESC")?.query_map([source], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    for id in ids { if require(conn, &id, Level::View).is_ok() { if let Some(page) = store::get_page(conn, &id)? { out.push(json!({ "page": page.meta, "experiment": page.metadata.get("experiment") })); } } }
    Ok(json!(out))
}

#[tauri::command]
pub async fn drawing_load(state: State<'_, AppState>, page_id: String) -> Result<Value, String> { load(&state.conn(), &page_id).map_err(|e| format!("{e:#}")) }
#[tauri::command]
pub async fn drawing_apply(state: State<'_, AppState>, page_id: String, operation: Value) -> Result<Value, String> { apply(&state.conn(), &store::Ctx::user(), &page_id, operation).map_err(storage_message) }
#[tauri::command]
pub async fn drawing_history_toggle(state:State<'_,AppState>,page_id:String,expected_revision:i64,request_id:String,redo:bool,actor:String)->Result<Value,String>{history_toggle(&state.conn(),&page_id,expected_revision,&request_id,redo,&actor).map_err(storage_message)}
#[tauri::command]
pub async fn drawing_history_import(state:State<'_,AppState>,page_id:String,document:Value)->Result<Value,String>{history_import(&state.conn(),&page_id,document).map_err(storage_message)}
#[tauri::command]
pub async fn drawing_versions(state: State<'_, AppState>, page_id: String) -> Result<Value, String> { versions(&state.conn(), &page_id).map_err(|e| format!("{e:#}")) }
#[tauri::command]
pub async fn drawing_version_save(state: State<'_, AppState>, page_id: String, label: String) -> Result<Value, String> { save_version(&state.conn(), &page_id, &label).map_err(|e| format!("{e:#}")) }
#[tauri::command]
pub async fn drawing_version_scene(state: State<'_, AppState>, page_id: String, version_id: String) -> Result<Value, String> { version_scene(&state.conn(), &page_id, &version_id).map_err(|e| format!("{e:#}")) }
#[tauri::command]
pub async fn drawing_version_restore(state: State<'_, AppState>, page_id: String, version_id: String, expected_revision: i64, restore_id: String, label: String, backup_label: String) -> Result<Value, String> {
    restore_version(&state.conn(), &page_id, &version_id, expected_revision, &restore_id, &label, &backup_label).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_version_import(state: State<'_, AppState>, page_id: String, version_id: String, label: String, scene: Value) -> Result<Value, String> {
    let conn = state.conn(); require_drawing(&conn, &page_id, Level::Edit).map_err(|e| format!("{e:#}"))?;
    uuid::Uuid::parse_str(&version_id).map_err(|_| "Invalid imported version identifier")?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let scene = materialize_scene_assets(&tx, &page_id, scene).map_err(|e| format!("{e:#}"))?;
    let old: Option<(String, String)> = tx.query_row("SELECT page_id, scene FROM drawing_versions WHERE id = ?1", [&version_id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
    if let Some((page, data)) = old { if page != page_id || serde_json::from_str::<Value>(&data).map_err(|e| e.to_string())? != scene { return Err("Imported version identifier was reused".into()); } }
    else { let author = store::profile(&tx).map_err(|e| e.to_string())?.id; tx.execute("INSERT INTO drawing_versions(id, page_id, revision, label, author, scene, created_at) VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6)", params![version_id, page_id, label, author, scene.to_string(), db::now()]).map_err(|e| e.to_string())?; }
    tx.commit().map_err(|e| e.to_string())?; Ok(json!({ "id": version_id }))
}
#[tauri::command]
pub async fn drawing_materialize_assets(state: State<'_, AppState>, page_id: String, scene: Value, source_id: Option<String>) -> Result<Value, String> {
    let plan=if let Some(source)=source_id.as_deref() { crate::drawing_copy::Plan::materialization(&state.conn(),source,&page_id,scene.clone()) } else { crate::drawing_copy::Plan::originals(&state.conn(),&page_id,&scene) }.map_err(|e|format!("{e:#}"))?;
    let permit=crate::drawing_copy::authorize_app(&state,plan).await.map_err(|e|format!("{e:#}"))?;
    let conn = state.conn(); require_drawing(&conn, &page_id, Level::Edit).map_err(|e| format!("{e:#}"))?;
    permit.recheck(&conn).map_err(|e|format!("{e:#}"))?;
    if let Some(source)=source_id.as_deref() { crate::drawing_copy::require_scene(&conn,source,&scene,Some(&permit)).map_err(|e|format!("{e:#}"))?; }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let result = if let Some(source) = source_id { materialize_scene_dependencies(&tx, &source, &page_id, scene) } else { materialize_scene_assets(&tx, &page_id, scene) }.map_err(|e| format!("{e:#}"))?;
    tx.commit().map_err(|e| e.to_string())?; Ok(result)
}
#[tauri::command]
pub async fn drawing_experiment_create(state: State<'_, AppState>, page_id: String, name: String, description: String) -> Result<store::PageMeta, String> {
    let plan=crate::drawing_copy::Plan::tree(&state.conn(),&page_id,false).map_err(|e|format!("{e:#}"))?;
    let permit=crate::drawing_copy::authorize_app(&state,plan).await.map_err(|e|format!("{e:#}"))?;
    create_experiment_authorized(&state.conn(), &page_id, &name, &description,Some(&permit)).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_experiments(state: State<'_, AppState>, page_id: String) -> Result<Value, String> { list_experiments(&state.conn(), &page_id).map_err(|e| format!("{e:#}")) }

#[cfg(test)]
mod tests {
    #[test]
    fn original_assets_validate_dimensions_and_codec_independent_orientation(){
        let mut scene=super::initial_scene("oriented");scene["assets"]["a"]=serde_json::json!({"id":"a","attachmentId":"original","name":"Camera photo","mime":"image/webp","width":8,"height":12,"orientation":6});
        super::validate_scene(&scene).unwrap();
        for value in [0.0,9.0,2.5]{scene["assets"]["a"]["orientation"]=serde_json::json!(value);assert!(super::validate_scene(&scene).is_err());}
        scene["assets"]["a"]["orientation"]=serde_json::json!(6);scene["assets"]["a"]["width"]=serde_json::json!(0);assert!(super::validate_scene(&scene).is_err());
    }
    use super::*;
    #[test]
    fn paint_budget_counts_spray_particles_granules_and_mask_strokes() {
        let point = |x| json!({"x":x,"y":0,"pressure":1,"time":0,"tiltX":0,"tiltY":0});
        let brush = json!({"kind":"spray","size":2048,"spacing":0.01,"pressureSize":true,"opacity":1});
        assert!(stroke_work(&[point(0),point(100)],&brush).unwrap() < 1000000.0);
        assert!(stroke_work(&[point(0),point(10000)],&brush).is_err());
        let crayon = json!({"kind":"crayon","size":100,"spacing":0.01,"pressureSize":true,"opacity":1});
        assert!(stroke_work(&[point(0),point(10000)],&crayon).is_err());
        let mut scene = initial_scene("budget");
        let stroke = json!({"samples":[point(0),point(1000)],"brush":brush,"reveal":true});
        scene["masks"]["mask"] = json!({"id":"mask","strokes":[stroke]});
        validate_scene(&scene).unwrap();
        scene["masks"]["mask"]["strokes"] = json!([stroke,stroke,stroke,stroke]);
        assert!(validate_scene(&scene).unwrap_err().to_string().contains("mask exceeds"));
        scene["masks"]["mask"]["strokes"] = json!([{"samples":[point(0),point(10000)],"brush":brush}]);
        assert!(validate_scene(&scene).is_err());
    }
    #[test]
    fn restore_keeps_previous_version_is_idempotent_and_survives_reopen_and_undo() {
        let path = std::env::temp_dir().join(format!("worlds-drawing-restore-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap(); let actor = store::profile(&conn).unwrap().id;
        let page = store::create_page(&conn, &store::Ctx::user(), store::NewPage {kind:Some("drawing".into()),..Default::default()}).unwrap();
        let initial = load(&conn, &page.id).unwrap(); let layer = initial["scene"]["layerOrder"][0].as_str().unwrap();
        let saved = save_version(&conn, &page.id, "Initial").unwrap(); let version = saved["id"].as_str().unwrap();
        let before = apply(&conn, &store::Ctx::user(), &page.id, json!({"id":"rename","actor":actor,"base":0,"at":1,"label":"Name","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Current"}}]})).unwrap();
        let restore_id = db::new_id(); let restored = restore_version(&conn, &page.id, version, 1, &restore_id, "Restore initial", "Before restore").unwrap();
        assert_eq!(restored["document"]["revision"],2); assert_eq!(restored["document"]["scene"], initial["scene"]);
        assert_eq!(version_scene(&conn,&page.id,&restore_id).unwrap(),before["scene"]);
        assert_eq!(restore_version(&conn,&page.id,version,1,&restore_id,"Restore initial","Before restore").unwrap()["document"]["revision"],2);
        assert!(restore_version(&conn,&page.id,&restore_id,1,&restore_id,"Restore initial","Before restore").is_err());
        let count = versions(&conn,&page.id).unwrap().as_array().unwrap().len();
        assert!(restore_version(&conn,&page.id,version,1,&db::new_id(),"Restore","Backup").unwrap_err().to_string().contains("changed after"));
        assert_eq!(versions(&conn,&page.id).unwrap().as_array().unwrap().len(),count);
        drop(conn); let conn = db::open(&path).unwrap();
        apply(&conn,&store::Ctx::user(),&page.id,json!({"id":"undo-restore","actor":actor,"base":2,"at":3,"label":"Undo restore","type":"toggle","target":restore_id,"enabled":false})).unwrap();
        assert_eq!(load(&conn,&page.id).unwrap()["scene"],before["scene"]);
        assert_eq!(restore_version(&conn,&page.id,version,1,&restore_id,"Restore initial","Before restore").unwrap()["document"]["revision"],3);
        conn.execute("INSERT INTO account_workspaces(id,name,role,synced_at) VALUES ('denied','Team','member',0)",[]).unwrap();
        conn.execute("UPDATE pages SET workspace_id='denied' WHERE id=?1",[&page.id]).unwrap();
        assert!(restore_version(&conn,&page.id,version,1,&restore_id,"Restore initial","Before restore").is_err());
        drop(conn); let _ = std::fs::remove_file(path);
    }
    #[test]
    fn restore_rolls_back_backup_document_and_outbox_when_the_operation_cannot_commit() {
        let path = std::env::temp_dir().join(format!("worlds-drawing-restore-rollback-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap(); let actor = store::profile(&conn).unwrap().id;
        let page = store::create_page(&conn,&store::Ctx::user(),store::NewPage{kind:Some("drawing".into()),..Default::default()}).unwrap();
        let saved = save_version(&conn,&page.id,"Initial").unwrap(); let layer=format!("{}-layer",page.id);
        let before=apply(&conn,&store::Ctx::user(),&page.id,json!({"id":"name","actor":actor,"base":0,"at":1,"label":"Name","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Current"}}]})).unwrap();
        conn.execute("UPDATE pages SET metadata=json_set(metadata,'$.sync.shared',json('true')) WHERE id=?1",[&page.id]).unwrap();
        crate::drawing_sync::open(&conn,&page.id,"https://sync.test","workspace","alice").unwrap();
        crate::drawing_sync::set_error(&conn,&page.id,"synced","").unwrap();
        conn.execute_batch("CREATE TRIGGER refuse_restore BEFORE INSERT ON drawing_operations BEGIN SELECT RAISE(ABORT,'storage refused'); END;").unwrap();
        let restore_id=db::new_id();
        assert!(restore_version(&conn,&page.id,saved["id"].as_str().unwrap(),1,&restore_id,"Restore","Backup").unwrap_err().to_string().contains("storage refused"));
        assert_eq!(load(&conn,&page.id).unwrap(),before); assert_eq!(versions(&conn,&page.id).unwrap().as_array().unwrap().len(),1);
        let pending:i64=conn.query_row("SELECT COUNT(*) FROM drawing_sync_outbox WHERE page_id=?1",[&page.id],|r|r.get(0)).unwrap(); assert_eq!(pending,0);
        conn.execute_batch("DROP TRIGGER refuse_restore;").unwrap();
        crate::drawing_sync::set_error(&conn,&page.id,"offline","offline").unwrap();
        assert!(restore_version(&conn,&page.id,saved["id"].as_str().unwrap(),1,&restore_id,"Restore","Backup").unwrap_err().to_string().contains("Synchronize"));
        drop(conn); let _ = std::fs::remove_file(path);
    }
    #[test]
    fn nested_mcp_transaction_and_saved_versions_keep_real_stroke_data() {
        let path = std::env::temp_dir().join(format!("worlds-drawing-stroke-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap();
        let actor = store::profile(&conn).unwrap().id;
        let page = store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let node = json!({ "id": "stroke", "kind": "stroke", "name": "Highlighter", "layerId": format!("{}-layer", page.id), "frameId": format!("{}-frame", page.id), "groupId": null, "visible": true, "locked": false, "x": 10, "y": 20, "w": 220, "h": 40, "rotation": 0, "opacity": 1, "flipX": false, "flipY": false,
            "paint": { "fill": "transparent", "stroke": "#202023", "strokeWidth": 3, "dash": [], "cap": "round", "radius": 16 },
            "textStyle": { "font": "IBM Plex Sans Arabic", "size": 28, "weight": 400, "italic": false, "align": "start", "direction": "auto", "leading": 1.7, "background": "transparent", "color": "#202023", "border": "transparent" },
            "effects": [], "brush": { "kind": "highlighter", "size": 28, "opacity": 0.35, "flow": 1, "hardness": 1, "spacing": 0.12, "angle": 0, "roundness": 1, "smoothing": 0.15, "stabilizer": 0, "taperStart": 0, "taperEnd": 0, "pressureSize": false, "pressureOpacity": false, "pressureFlow": false, "pressureCurve": 1, "color": "#f5d742" },
            "samples": [{ "x": 20, "y": 20, "pressure": 1, "tiltX": 0, "tiltY": 0, "time": 0 }, { "x": 200, "y": 20, "pressure": 1, "tiltX": 0, "tiltY": 0, "time": 20 }], "seed": 10 });
        let op = json!({ "id": "stroke-op", "actor": actor, "base": 0, "at": 1, "label": "Highlighter", "type": "edit", "changes": [{ "type": "put", "collection": "nodes", "id": "stroke", "value": node }, { "type": "order", "list": "nodeOrder", "ids": ["stroke"] }] });
        let tx = conn.unchecked_transaction().unwrap();
        crate::account::guarded_tool_call(&tx, "drawings_apply", &json!({ "id": page.id }), |c| apply(c, &store::Ctx::user(), &page.id, op)).unwrap();
        tx.commit().unwrap();
        let version = save_version(&conn, &page.id, "حفظ التظليل").unwrap();
        let copied = store::duplicate_page(&conn, &store::Ctx::user(), &page.id, false, None, None).unwrap();
        assert_eq!(load(&conn, &copied.id).unwrap()["scene"]["nodes"]["stroke"]["brush"]["opacity"], 0.35);
        let template = store::save_as_template(&conn, &store::Ctx::user(), &page.id).unwrap();
        let from_template = store::instantiate_template(&conn, &store::Ctx::user(), &template.id, None, None).unwrap();
        assert_eq!(from_template.kind, "drawing");
        assert_eq!(load(&conn, &from_template.id).unwrap()["scene"]["nodeOrder"], json!(["stroke"]));
        drop(conn);
        let conn = db::open(&path).unwrap();
        assert_eq!(load(&conn, &page.id).unwrap()["scene"]["nodes"]["stroke"], node);
        assert_eq!(version_scene(&conn, &page.id, version["id"].as_str().unwrap()).unwrap()["nodes"]["stroke"], node);
        let step = json!({ "id": "step", "title": "شرح", "body": "تجربة", "frameId": format!("{}-frame", page.id), "camera": { "x": 0, "y": 0, "w": 1280, "h": 720 }, "hiddenNodeIds": [], "transition": "cut", "duration": null });
        let op = json!({ "id": "step-op", "actor": actor, "base": 1, "at": 2, "label": "Step", "type": "edit", "changes": [{ "type": "put", "collection": "steps", "id": "step", "value": step }, { "type": "order", "list": "stepOrder", "ids": ["step"] }] });
        apply(&conn, &store::Ctx::user(), &page.id, op).unwrap();
        let pinned = save_version(&conn, &page.id, "Pinned").unwrap();
        apply(&conn, &store::Ctx::user(), &page.id, json!({ "id": "pin-op", "actor": actor, "base": 2, "at": 3, "label": "Pin", "type": "edit", "changes": [{ "type": "patch", "collection": "steps", "id": "step", "fields": { "pinnedVersionId": pinned["id"] } }] })).unwrap();
        let branch = create_experiment(&conn, &page.id, "Alternative", "Try a blue pen").unwrap();
        let experiment = load(&conn, &branch.id).unwrap();
        assert_eq!(experiment["experiment"]["sourceId"], page.id);
        let branch_pin = experiment["scene"]["steps"]["step"]["pinnedVersionId"].as_str().unwrap();
        assert_ne!(branch_pin, pinned["id"].as_str().unwrap());
        assert_eq!(version_scene(&conn, &branch.id, branch_pin).unwrap()["nodes"]["stroke"], node);
        assert_eq!(experiment["experiment"]["versionAliases"][branch_pin], pinned["id"]);
        let mut brush = node["brush"].clone(); brush["color"] = json!("#2b82de");
        apply(&conn, &store::Ctx::user(), &branch.id, json!({ "id": "blue-op", "actor": actor, "base": 0, "at": 4, "label": "Blue", "type": "edit", "changes": [{ "type": "patch", "collection": "nodes", "id": "stroke", "fields": { "brush": brush } }] })).unwrap();
        assert_eq!(load(&conn, &page.id).unwrap()["scene"]["nodes"]["stroke"]["brush"]["color"], "#f5d742");
        assert_eq!(load(&conn, &branch.id).unwrap()["scene"]["nodes"]["stroke"]["brush"]["color"], "#2b82de");
        assert_eq!(list_experiments(&conn, &page.id).unwrap().as_array().unwrap().len(), 1);
        let mut long = node.clone(); long["id"] = json!("long"); long["w"] = json!(5020); long["samples"][1]["x"] = json!(5000);
        apply(&conn, &store::Ctx::user(), &page.id, json!({"id":"long-op","actor":actor,"base":3,"at":5,"label":"Long stroke","type":"edit","changes":[{"type":"put","collection":"nodes","id":"long","value":long},{"type":"order","list":"nodeOrder","ids":["stroke","long"]}]})).unwrap();
        let resized = apply(&conn, &store::Ctx::user(), &page.id, json!({"id":"resize-op","actor":actor,"base":4,"at":6,"label":"Resize","type":"edit","changes":[{"type":"patch","collection":"nodes","id":"long","fields":{"w":50.2,"h":4,"geometrySize":{"w":5020,"h":40}}}]})).unwrap();
        assert_eq!(resized["scene"]["nodes"]["long"]["samples"], long["samples"]);
        let scaled_version = save_version(&conn, &page.id, "Resized originals").unwrap();
        drop(conn); let conn = db::open(&path).unwrap();
        assert_eq!(load(&conn,&page.id).unwrap()["scene"]["nodes"]["long"]["geometrySize"],json!({"w":5020,"h":40}));
        assert_eq!(version_scene(&conn,&page.id,scaled_version["id"].as_str().unwrap()).unwrap()["nodes"]["long"]["samples"],long["samples"]);
        let undone = apply(&conn,&store::Ctx::user(),&page.id,json!({"id":"undo-resize","actor":actor,"base":5,"at":7,"label":"Undo resize","type":"toggle","target":"resize-op","enabled":false})).unwrap();
        assert_eq!(undone["scene"]["nodes"]["long"],long);
        let copied = store::duplicate_page(&conn,&store::Ctx::user(),&page.id,false,None,None).unwrap();
        assert_eq!(load(&conn,&copied.id).unwrap()["scene"]["nodes"]["long"]["samples"],long["samples"]);
        drop(conn); let _ = std::fs::remove_file(path);
    }
    #[test]
    fn durable_journal_rejects_stale_writes_and_roundtrips_undo() {
        let path = std::env::temp_dir().join(format!("worlds-drawing-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap();
        let actor = store::profile(&conn).unwrap().id;
        let p = store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), title: Some("Drawing".into()), ..Default::default() }).unwrap();
        let lid = format!("{}-layer", p.id);
        let op = json!({ "id": "one", "actor": actor, "base": 0, "at": 1, "label": "Rename", "type": "edit", "changes": [{ "type": "patch", "collection": "layers", "id": lid, "fields": { "name": "حبر" } }] });
        let d = apply(&conn, &store::Ctx::user(), &p.id, op.clone()).unwrap();
        assert_eq!(d["scene"]["layers"][&lid]["name"], "حبر");
        assert_eq!(apply(&conn, &store::Ctx::user(), &p.id, op.clone()).unwrap()["revision"], 1);
        let mut stale = op.clone(); stale["id"] = json!("stale");
        assert!(apply(&conn, &store::Ctx::user(), &p.id, stale).is_err());
        let undo = json!({ "id": "two", "actor": actor, "base": 1, "at": 2, "label": "Undo", "type": "toggle", "target": "one", "enabled": false });
        apply(&conn, &store::Ctx::user(), &p.id, undo).unwrap();
        drop(conn);
        let conn = db::open(&path).unwrap();
        let reopened = load(&conn, &p.id).unwrap();
        assert_eq!(reopened["revision"], 2);
        assert_eq!(reopened["scene"]["layers"][&lid]["name"], "Layer 1");
        assert_eq!(reopened["operations"].as_array().unwrap().len(), 2);
        drop(conn); let _ = std::fs::remove_file(path);
    }
}
