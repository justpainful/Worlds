//! Pure drawing scene operations shared with the native Apple bridge.
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use std::collections::HashSet;
use super::annotations;

pub(crate) const MAPS: &[&str] = &["frames", "layers", "nodes", "assets", "masks", "steps"];
pub(crate) const LISTS: &[(&str, &str)] = &[("frameOrder", "frames"), ("layerOrder", "layers"), ("nodeOrder", "nodes"), ("stepOrder", "steps")];
pub(crate) fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str> { v.get(k).and_then(Value::as_str).ok_or_else(|| anyhow!("missing {k}")) }
pub(crate) fn safe_id(s: &str) -> bool { !s.is_empty() && s.len() <= 160 && !matches!(s, "__proto__" | "prototype" | "constructor") }
pub(crate) fn numeric(v: &Value, k: &str) -> Result<f64> { v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite()).ok_or_else(|| anyhow!("invalid {k}")) }
pub(crate) fn rect(v: &Value) -> Result<()> { numeric(v, "x")?; numeric(v, "y")?; if numeric(v, "w")? <= 0.0 || numeric(v, "h")? <= 0.0 { bail!("invalid drawing dimensions"); } Ok(()) }
pub(crate) fn opacity(v: &Value) -> Result<()> { let n = numeric(v, "opacity")?; if !(0.0..=1.0).contains(&n) { bail!("invalid opacity"); } Ok(()) }

pub(crate) fn stroke_work(points: &[Value], brush: &Value) -> Result<f64> {
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

pub(crate) fn pixel_guard_equal(a:&Value,b:&Value)->bool {
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
