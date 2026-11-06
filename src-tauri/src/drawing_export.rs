//! Export policy is permission state, independent of artwork and undo history.
use crate::account::permissions::{page_level, require, Level};
use crate::{db, drawing, store, sync, AppState};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportLevel {
    View,
    Comment,
    Edit,
    Full,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rules {
    pub images: ExportLevel,
    pub projects: ExportLevel,
    pub comments: ExportLevel,
}
impl Default for Rules {
    fn default() -> Self {
        Self { images: ExportLevel::View, projects: ExportLevel::View, comments: ExportLevel::View }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub revision: u64,
    pub rules: Rules,
}
impl Default for Policy {
    fn default() -> Self {
        Self { revision: 0, rules: Rules::default() }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Images,
    Projects,
    Comments,
}
impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Images => "images",
            Self::Projects => "projects",
            Self::Comments => "comments",
        }
    }
}
fn policy_valid(p: &Policy) -> Result<()> {
    if p.revision > 9007199254740991 {
        bail!("Invalid export policy revision");
    }
    Ok(())
}
pub fn allowed(p: &Policy, level: Level, kind: Kind) -> bool {
    let min = match match kind {
        Kind::Images => &p.rules.images,
        Kind::Projects => &p.rules.projects,
        Kind::Comments => &p.rules.comments,
    } {
        ExportLevel::View => Level::View,
        ExportLevel::Comment => Level::Comment,
        ExportLevel::Edit => Level::Edit,
        ExportLevel::Full => Level::Full,
    };
    level >= min
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub scene: Value,
    pub frame_id: Option<String>,
    pub annotations: Option<bool>,
    pub region: Option<Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub page_id: String,
    pub kind: Kind,
    pub scenes: Vec<Scene>,
    pub archive_id: Option<String>,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub source_page_ids:Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    workspace_id: String,
    doc_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Remote {
    server: String,
    workspace: String,
    page: String,
    user: String,
    kind: String,
    sources: Vec<Source>,
    initial_rules: Option<Rules>,
    generation: Option<String>,
}
pub struct Prepared {
    pub context: Context,
    owner: String,
    requests: Vec<Remote>,
    source_only: bool,
}

fn available(conn: &Connection, page: &str) -> Result<store::PageMeta> {
    require(conn, page, Level::View)?;
    crate::drawing_sync::check_bound_identity(conn, page)?;
    store::page_meta_by_id(conn, page)?.filter(|p| p.deleted_at.is_none()).ok_or_else(|| anyhow!("An export source is unavailable"))
}
pub fn initial_policy(conn: &Connection, page: &str) -> Result<Policy> {
    let p = available(conn, page)?;
    let metadata = metadata(conn, page)?;
    if p.kind != "drawing" && !(p.kind == "template" && metadata["templateResourceKind"] == "drawing") {
        bail!("Open a drawing before exporting");
    }
    let value = metadata.get("drawingExportPolicy");
    let policy: Policy = match value {
        Some(v) => serde_json::from_value(v.clone())?,
        None => Policy::default(),
    };
    policy_valid(&policy)?;
    Ok(policy)
}
pub fn cached(conn: &Connection, page: &str) -> Result<Policy> {
    let local = initial_policy(conn, page)?;
    let metadata = metadata(conn, page)?;
    if let Some(remote) = remote_for(conn, page, &owner(conn, page)?, "source")? {
        if let Some(cache) = metadata.get("drawingExportPolicyCache") {
            if cache["server"] == remote.server && cache["workspace"] == remote.workspace && cache["page"] == page {
                let policy: Policy = serde_json::from_value(cache["policy"].clone())?;
                policy_valid(&policy)?;
                return Ok(policy);
            }
        }
    }
    Ok(local)
}
fn metadata(conn: &Connection, page: &str) -> Result<Value> {
    let raw: String = conn.query_row("SELECT metadata FROM pages WHERE id=?1", [page], |r| r.get(0))?;
    Ok(serde_json::from_str(&raw)?)
}
fn cache(conn: &Connection, page: &str, policy: &Policy) -> Result<()> {
    policy_valid(policy)?;
    conn.execute(
        "UPDATE pages SET metadata=json_set(metadata,'$.drawingExportPolicy',json(?2)) WHERE id=?1",
        params![page, serde_json::to_string(policy)?],
    )?;
    Ok(())
}
fn owner(conn: &Connection, page: &str) -> Result<String> {
    if let Some(user) =
        conn.query_row("SELECT user_id FROM account WHERE id=1 AND status='active'", [], |r| r.get::<_, String>(0)).optional()?
    {
        return Ok(user);
    }
    if let Some(user) =
        conn.query_row("SELECT user_id FROM drawing_sync_state WHERE page_id=?1", [page], |r| r.get::<_, String>(0)).optional()?
    {
        return Ok(user);
    }
    if let Some(token) = db::get_setting(conn, "sync.devToken")?.and_then(|v| v.as_str().map(str::to_string)) {
        use base64::Engine;
        if let Some(bytes) =
            token.split('.').nth(1).and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p.trim_end_matches('=')).ok())
        {
            if let Some(user) = serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| v["sub"].as_str().map(str::to_string)) {
                return Ok(user);
            }
        }
    }
    Ok(store::profile(conn)?.id)
}
fn setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(db::get_setting(conn, key)?.and_then(|v| v.as_str().map(|s| s.trim().trim_end_matches('/').to_string())).filter(|s| !s.is_empty()))
}
fn remote_for(conn: &Connection, page: &str, user: &str, kind: &str) -> Result<Option<Remote>> {
    available(conn, page)?;
    let mode = sync::page_mode(conn, page)?;
    let workspace_id: Option<String> = conn.query_row("SELECT workspace_id FROM pages WHERE id=?1", [page], |r| r.get(0))?;
    if !mode.shared && workspace_id.is_none() {
        return Ok(None);
    }
    let bound: Option<(String, String, String)> = conn
        .query_row("SELECT server_url,workspace_id,user_id FROM drawing_sync_state WHERE page_id=?1", [page], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let configured = setting(conn, "sync.serverUrl")?.ok_or_else(|| anyhow!("Connect to verify export permissions"))?;
    let (server, workspace) = if let Some((server, workspace, bound_user)) = bound {
        if bound_user != user || configured != server.trim_end_matches('/') {
            bail!("Reconnect this drawing with its bound account and server before exporting");
        }
        (server, workspace)
    } else {
        (configured, workspace_id.or(mode.workspace_id).or(setting(conn, "sync.workspaceId")?).unwrap_or_else(|| "default".into()))
    };
    let url = reqwest::Url::parse(&server)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("Invalid bound export server");
    }
    Ok(Some(Remote {
        server,
        workspace,
        page: page.into(),
        user: user.into(),
        kind: kind.into(),
        sources: vec![],
        initial_rules: if kind == "source" { None } else { Some(initial_policy(conn, page)?.rules) },
        generation: if kind == "source" {
            None
        } else {
            conn.query_row("SELECT remote FROM drawing_sync_state WHERE page_id=?1", [page], |r| r.get::<_, Option<String>>(0))
                .optional()?
                .flatten()
                .map(|raw| serde_json::from_str::<Value>(&raw))
                .transpose()?
                .and_then(|v| v["generation"].as_str().map(str::to_string))
        },
    }))
}
fn used_assets(scene: &Value, frame: Option<&str>, annotations: bool, all: bool, region: Option<&Value>) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    if all {
        for id in scene["assets"].as_object().unwrap().keys() {
            out.insert(id.clone());
        }
        return out;
    }
    for node in scene["nodes"].as_object().unwrap().values() {
        if !visible(scene, node, frame, annotations, region) {
            continue;
        }
        for id in [node["assetId"].as_str(), node["brush"]["tipAssetId"].as_str()].into_iter().flatten() {
            out.insert(id.into());
        }
        let mut masks = Vec::new();
        if let Some(id) = node["maskId"].as_str() {
            masks.push(id);
        }
        if let Some(effects) = node["effects"].as_array() {
            for e in effects {
                if e["enabled"] != true {
                    continue;
                }
                if let Some(id) = e["maskId"].as_str() {
                    masks.push(id);
                }
            }
        }
        for id in masks {
            let mask = &scene["masks"][id];
            if mask["enabled"] != true {
                continue;
            }
            if let Some(asset) = mask["assetId"].as_str() {
                out.insert(asset.into());
            }
            if let Some(strokes) = mask["strokes"].as_array() {
                for s in strokes {
                    if let Some(asset) = s["brush"]["tipAssetId"].as_str() {
                        out.insert(asset.into());
                    }
                }
            }
        }
    }
    out
}
fn ink_rect(node: &Value) -> (f64, f64, f64, f64) {
    let num = |v: &Value, key: &str, default: f64| v[key].as_f64().filter(|v| v.is_finite()).unwrap_or(default);
    let w = num(node, "w", 0.0);
    let h = num(node, "h", 0.0);
    if let Some(vertices)=node["path"]["vertices"].as_array().filter(|v|!v.is_empty()){
        let mut x=f64::INFINITY;let mut y=f64::INFINITY;let mut right=f64::NEG_INFINITY;let mut bottom=f64::NEG_INFINITY;
        for vertex in vertices{for p in std::iter::once(vertex).chain(vertex.get("in")).chain(vertex.get("out")){let px=num(p,"x",0.0);let py=num(p,"y",0.0);x=x.min(px);y=y.min(py);right=right.max(px);bottom=bottom.max(py);}}
        let sx=w/num(&node["geometrySize"],"w",w);let sy=h/num(&node["geometrySize"],"h",h);return(x*sx,y*sy,(right-x).max(1.0)*sx,(bottom-y).max(1.0)*sy);
    }
    if node["kind"] != "stroke" || !node["brush"].is_object() {
        return (0.0, 0.0, w, h);
    }
    let Some(samples) = node["samples"].as_array().filter(|p| !p.is_empty()) else { return (0.0, 0.0, w, h) };
    let b = &node["brush"];
    let size = num(b, "size", 12.0).clamp(1.0, 2048.0);
    let radius = size / 2.0;
    let roundness = num(b, "roundness", 1.0).clamp(0.05, 1.0);
    let angle = num(b, "angle", 0.0).clamp(-360.0, 360.0).to_radians();
    let c = angle.cos().abs();
    let s = angle.sin().abs();
    let (rx, ry) = match b["kind"].as_str().unwrap_or("hard") {
        "marker" | "highlighter" => (radius, radius),
        "spray" => {
            let r = radius + (size / 48.0).max(0.5);
            (r, r)
        }
        "texture" => (radius * (c + roundness * s), radius * (s + roundness * c)),
        kind => {
            let mut r = radius;
            if kind == "crayon" || kind == "natural-pencil" {
                r += (size * if kind == "crayon" { 0.035 } else { 0.065 }).max(0.3);
            }
            if kind == "watercolor" {
                r = r.max(r * 0.9 + 0.5_f64.max(r * 0.04) / 2.0);
            }
            (r * c.hypot(roundness * s), r * s.hypot(roundness * c))
        }
    };
    let mut x = f64::INFINITY;
    let mut y = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    let straight=b["straightLine"]==true&&matches!(b["kind"].as_str(),Some("highlighter"|"marker"));
    for(index,p)in samples.iter().enumerate() {
        if straight&&index!=0&&index!=samples.len()-1{continue;}
        let px = num(p, "x", 0.0);
        let py = num(p, "y", 0.0);
        x = x.min(px);
        y = y.min(py);
        right = right.max(px);
        bottom = bottom.max(py);
    }
    let sx = w / num(&node["geometrySize"], "w", w);
    let sy = h / num(&node["geometrySize"], "h", h);
    ((x - rx - 2.0) * sx, (y - ry - 2.0) * sy, (right - x + rx * 2.0 + 4.0).max(1.0) * sx, (bottom - y + ry * 2.0 + 4.0).max(1.0) * sy)
}
fn visible(scene: &Value, node: &Value, frame: Option<&str>, annotations: bool, region: Option<&Value>) -> bool {
    let layer = &scene["layers"][node["layerId"].as_str().unwrap_or("")];
    if !(node["visible"] != false
        && node["opacity"].as_f64().unwrap_or(1.0) > 0.0
        && layer["visible"] != false
        && layer["opacity"].as_f64().unwrap_or(1.0) > 0.0
        && (frame.is_none() || node["frameId"].is_null() || node["frameId"].as_str() == frame)
        && (annotations || node["anchor"].is_null() && node["annotationGroup"].is_null()))
    {
        return false;
    }
    if !node["anchor"].is_null() || !node["endAnchor"].is_null() {
        return true;
    }
    let scope = region.or_else(|| frame.and_then(|id| scene["frames"].get(id)));
    let Some(scope) = scope else {
        return true;
    };
    let num = |v: &Value, k: &str| v[k].as_f64().unwrap_or(0.0);
    let (x, y, w, h) = ink_rect(node);
    let angle = num(node, "rotation").to_radians();
    let scale = if node["geometrySize"].is_object() { (num(node, "w") / num(&node["geometrySize"], "w")).max(num(node, "h") / num(&node["geometrySize"], "h")) } else { 1.0 };
    let padding = if node["kind"] == "stroke" { 0.0 } else { num(&node["paint"], "strokeWidth") * scale / 2.0 };
    let hw = (w * angle.cos().abs() + h * angle.sin().abs()) / 2.0 + padding;
    let hh = (w * angle.sin().abs() + h * angle.cos().abs()) / 2.0 + padding;
    let dx = (x + w / 2.0 - num(node, "w") / 2.0) * if node["flipX"] == true { -1.0 } else { 1.0 };
    let dy = (y + h / 2.0 - num(node, "h") / 2.0) * if node["flipY"] == true { -1.0 } else { 1.0 };
    let cx = num(node, "x") + num(node, "w") / 2.0 + dx * angle.cos() - dy * angle.sin();
    let cy = num(node, "y") + num(node, "h") / 2.0 + dx * angle.sin() + dy * angle.cos();
    cx - hw < num(scope, "x") + num(scope, "w")
        && cx + hw > num(scope, "x")
        && cy - hh < num(scope, "y") + num(scope, "h")
        && cy + hh > num(scope, "y")
}
pub fn prepare(conn: &Connection, context: Context) -> Result<Prepared> {
    let policy = cached(conn, &context.page_id)?;
    let user = owner(conn, &context.page_id)?;
    if context.scenes.len() > 4096 || serde_json::to_vec(&context)?.len() > 64 * 1024 * 1024 {
        bail!("The export context exceeds its memory limit");
    }
    if context.kind == Kind::Comments {
        if !context.scenes.is_empty() {
            bail!("Comment text cannot include drawing originals");
        }
        sync::rejected_read(
            conn,
            &context.page_id,
            context.archive_id.as_deref().ok_or_else(|| anyhow!("Choose a refused comment copy"))?,
            &user,
        )?;
    } else if context.scenes.is_empty() {
        bail!("Prepare the exported artwork first");
    }
    if context.source_page_ids.len()>64||(!context.source_page_ids.is_empty()&&context.kind!=Kind::Projects)||context.source_page_ids.iter().any(|id|id.is_empty()||id.len()>160||!id.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'_'||c==b'-')){bail!("Invalid independent project export sources");}
    let mut pages = BTreeSet::new();
    for entry in &context.scenes {
        drawing::validate_scene(&entry.scene)?;
        if entry.frame_id.as_ref().is_some_and(|f| entry.scene["frames"].get(f).is_none()) {
            bail!("The exported frame is unavailable");
        }
        if let Some(r) = &entry.region {
            for key in ["x", "y", "w", "h"] {
                if !r[key].as_f64().is_some_and(f64::is_finite) {
                    bail!("Invalid export region");
                }
            }
            if r["w"].as_f64().unwrap() <= 0.0 || r["h"].as_f64().unwrap() <= 0.0 {
                bail!("Invalid export region");
            }
        }
        for id in used_assets(
            &entry.scene,
            entry.frame_id.as_deref(),
            entry.annotations.unwrap_or(true),
            context.kind == Kind::Projects,
            entry.region.as_ref(),
        ) {
            let attachment =
                entry.scene["assets"][&id]["attachmentId"].as_str().ok_or_else(|| anyhow!("An export original is unavailable"))?;
            let original = store::get_attachment(conn, attachment)?.ok_or_else(|| anyhow!("An export original is unavailable"))?;
            if let Some(page) = original.page_id {
                pages.insert(page);
            }
        }
        for node in entry.scene["nodes"].as_object().unwrap().values() {
            if node["sourceMode"] == "live"
                && (context.kind == Kind::Projects
                    || visible(&entry.scene, node, entry.frame_id.as_deref(), entry.annotations.unwrap_or(true), entry.region.as_ref()))
            {
                pages.insert(node["sourceId"].as_str().ok_or_else(|| anyhow!("An export source is unavailable"))?.to_string());
            }
        }
    }
    pages.remove(&context.page_id);
    if pages.len() > 4096 {
        bail!("Too many independent export sources");
    }
    let primary = remote_for(conn, &context.page_id, &user, context.kind.name())?;
    let mut requests = Vec::new();
    for id in context.source_page_ids.iter().collect::<BTreeSet<_>>(){if id==&context.page_id{continue;}let p=available(conn,id)?;if p.kind!="drawing"{bail!("Choose a drawing project source");}if let Some(request)=remote_for(conn,id,&user,"projects")?{requests.push(request);}else if !allowed(&initial_policy(conn,id)?,page_level(conn,id)?,Kind::Projects){bail!("An included project export policy does not allow this export");}}
    let mut foreign = BTreeMap::<String, Vec<Source>>::new();
    for page in pages {
        available(conn, &page)?;
        if let Some(source) = remote_for(conn, &page, &user, "source")? {
            foreign.entry(source.server.clone()).or_default().push(Source { workspace_id: source.workspace, doc_id: source.page });
        }
    }
    if let Some(mut root) = primary {
        root.sources = foreign.remove(&root.server).unwrap_or_default();
        requests.push(root);
    } else if !allowed(&policy, page_level(conn, &context.page_id)?, context.kind) {
        bail!("The export policy does not allow this export");
    }
    for (server, mut sources) in foreign {
        let source = sources.remove(0);
        requests.push(Remote {
            server,
            workspace: source.workspace_id,
            page: source.doc_id,
            user: user.clone(),
            kind: "source".into(),
            sources,
            initial_rules: None,
            generation: None,
        });
    }
    Ok(Prepared { context, owner: user, requests, source_only: false })
}
/// Internal View-only source reading. Never exposed as a file export class.
pub(crate) fn prepare_read(conn: &Connection, page: &str) -> Result<Prepared> {
    available(conn, page)?;
    let user = owner(conn, page)?;
    let requests = remote_for(conn, page, &user, "source")?.into_iter().collect();
    Ok(Prepared {
        context: Context { page_id: page.into(), kind: Kind::Projects, scenes: vec![], archive_id: None,source_page_ids:vec![] },
        owner: user,
        requests,
        source_only: true,
    })
}
pub fn needs_token(prepared: &Prepared) -> bool {
    !prepared.requests.is_empty()
}
fn remote_url(r: &Remote, path: &str) -> Result<reqwest::Url> {
    let mut url = reqwest::Url::parse(&r.server)?;
    url.path_segments_mut().map_err(|_| anyhow!("Invalid export server"))?.pop_if_empty().extend([
        "v1",
        "workspaces",
        &r.workspace,
        "docs",
        &r.page,
        "drawing",
        path,
    ]);
    Ok(url)
}
async fn call(r: &Remote, path: &str, method: reqwest::Method, body: Option<Value>, token: Option<&str>) -> Result<(Policy, String)> {
    let token =
        token.filter(|t| !t.is_empty() && t.len() < 32768).ok_or_else(|| anyhow!("Sign in and connect to verify export permissions"))?;
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(15)).build()?;
    let mut request = client.request(method, remote_url(r, path)?).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request.send().await.map_err(|_| anyhow!("Connect to verify the current export permissions"))?;
    if !response.status().is_success() {
        bail!(match response.status().as_u16() {
            401 => "Sign in again before exporting",
            403 => "The current permissions or export policy do not allow this action",
            409 => "The shared drawing or export policy changed. Refresh before saving",
            _ => "The export service could not verify this action",
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 65536 {
            bail!("Invalid export authorization response");
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)?;
    let policy: Policy = serde_json::from_value(value["policy"].clone())?;
    policy_valid(&policy)?;
    let level = value["level"].as_str().unwrap_or("none").to_string();
    if value["ok"] != true || value["userId"].as_str() != Some(&r.user) || Level::parse(&level) < Level::View {
        bail!("The export authorization belongs to another account or is unavailable");
    }
    Ok((policy, level))
}
pub async fn authorize(prepared: &Prepared, token: Option<&str>) -> Result<()> {
    for request in &prepared.requests {
        let (policy, level) = call(
            request,
            "export-authorize",
            reqwest::Method::POST,
            Some(
                json!({"kind":request.kind,"sources":request.sources,"initialRules":request.initial_rules,"generation":request.generation}),
            ),
            token,
        )
        .await?;
        if request.kind != "source" && !allowed(&policy, Level::parse(&level), prepared.context.kind) {
            bail!("The current export policy does not allow this export");
        }
    }
    Ok(())
}
pub fn recheck(conn: &Connection, prepared: &Prepared) -> Result<()> {
    let fresh =
        if prepared.source_only { prepare_read(conn, &prepared.context.page_id)? } else { prepare(conn, prepared.context.clone())? };
    if fresh.owner != prepared.owner || fresh.requests != prepared.requests {
        bail!("The export account or sources changed. Prepare the export again");
    }
    Ok(())
}

#[tauri::command]
pub async fn drawing_export_requirements(state: State<'_, AppState>, context: Context) -> Result<bool, String> {
    let result = prepare(&state.conn(), context).map(|p| needs_token(&p));
    result.map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_export_policy_cached(state: State<'_, AppState>, page_id: String) -> Result<Value, String> {
    let result = (|| -> Result<Value> {
        let conn = state.conn();
        Ok(
            json!({"policy":cached(&conn,&page_id)?,"level":page_level(&conn,&page_id)?.as_str(),"shared":remote_for(&conn,&page_id,&owner(&conn,&page_id)?,"source")?.is_some()}),
        )
    })();
    result.map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn drawing_export_check(state: State<'_, AppState>, context: Context, token: Option<String>) -> Result<(), String> {
    let result = async {
        let prepared = prepare(&state.conn(), context)?;
        authorize(&prepared, token.as_deref()).await?;
        recheck(&state.conn(), &prepared)
    }
    .await;
    result.map_err(|e: anyhow::Error| format!("{e:#}"))
}
pub struct PolicyRequest {
    page: String,
    remote: Option<Remote>,
    update: Option<Value>,
    local: Value,
}
pub fn prepare_policy(conn: &Connection, page: &str, update: Option<Value>) -> Result<PolicyRequest> {
    let mut policy = cached(conn, page)?;
    let level = page_level(conn, page)?;
    if update.is_some() {
        require(conn, page, Level::Full)?;
    }
    let remote = remote_for(conn, page, &owner(conn, page)?, "source")?;
    if remote.is_none() {
        if let Some(update) = &update {
            let expected = update["expectedRevision"].as_u64().ok_or_else(|| anyhow!("Invalid export policy update"))?;
            let rules: Rules = serde_json::from_value(update["rules"].clone())?;
            let request_id = update["requestId"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 160)
                .ok_or_else(|| anyhow!("Invalid export policy request"))?;
            let metadata = metadata(conn, page)?;
            let old = metadata.get("drawingExportPolicyRequest");
            if old.is_some_and(|old| old["requestId"] == request_id) {
                if old != Some(update) {
                    bail!("Export policy request identifier was reused");
                }
            } else {
                if policy.revision != expected {
                    bail!("The export policy changed. Refresh it before saving");
                }
                policy = Policy { revision: policy.revision + 1, rules };
                policy_valid(&policy)?;
                let tx = conn.unchecked_transaction()?;
                cache(&tx, page, &policy)?;
                tx.execute(
                    "UPDATE pages SET metadata=json_set(metadata,'$.drawingExportPolicyRequest',json(?2)) WHERE id=?1",
                    params![page, update.to_string()],
                )?;
                db::mark_change(&tx, Some(page), "drawing_policy", "ui")?;
                tx.commit()?;
            }
        }
    }
    Ok(PolicyRequest { page: page.into(), remote, update, local: json!({"policy":policy,"level":level.as_str(),"shared":false}) })
}
pub async fn fetch_policy(work: &PolicyRequest, token: Option<&str>) -> Result<Value> {
    if let Some(remote) = &work.remote {
        let (policy, level) = call(
            remote,
            "export-policy",
            if work.update.is_some() { reqwest::Method::PUT } else { reqwest::Method::GET },
            work.update.clone(),
            token,
        )
        .await?;
        Ok(json!({"policy":policy,"level":level,"shared":true}))
    } else {
        Ok(work.local.clone())
    }
}
pub fn accept_policy(conn: &Connection, work: &PolicyRequest, reply: Value) -> Result<Value> {
    if remote_for(conn, &work.page, &owner(conn, &work.page)?, "source")? != work.remote {
        bail!("The policy account or server changed");
    }
    if let Some(remote) = &work.remote {
        let policy: Policy = serde_json::from_value(reply["policy"].clone())?;
        policy_valid(&policy)?;
        let cached = json!({"server":remote.server,"workspace":remote.workspace,"page":work.page,"policy":policy});
        conn.execute(
            "UPDATE pages SET metadata=json_set(metadata,'$.drawingExportPolicyCache',json(?2)) WHERE id=?1",
            params![work.page, cached.to_string()],
        )?;
    }
    Ok(reply)
}
#[tauri::command]
pub async fn drawing_export_policy(
    state: State<'_, AppState>,
    page_id: String,
    token: Option<String>,
    update: Option<Value>,
) -> Result<Value, String> {
    let result = async {
        let work = prepare_policy(&state.conn(), &page_id, update)?;
        let reply = fetch_policy(&work, token.as_deref()).await?;
        accept_policy(&state.conn(), &work, reply)
    }
    .await;
    result.map_err(|e: anyhow::Error| format!("{e:#}"))
}
pub fn parse_envelope(body: &[u8]) -> Result<(Context, Option<String>, Vec<u8>)> {
    if body.len() < 4 || body.len() > 320 * 1024 * 1024 {
        bail!("Invalid export size");
    }
    let length = u32::from_le_bytes(body[..4].try_into()?) as usize;
    if length > 64 * 1024 * 1024 || 4 + length >= body.len() || body.len() - 4 - length > 256 * 1024 * 1024 {
        bail!("Invalid export context");
    }
    let envelope: Value = serde_json::from_slice(&body[4..4 + length])?;
    let context: Context = serde_json::from_value(envelope["context"].clone())?;
    let token = envelope["token"].as_str().map(str::to_string);
    Ok((context, token, body[4 + length..].to_vec()))
}
pub fn write_file(path: &Path, bytes: &[u8], kind: Kind) -> Result<()> {
    let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("").to_lowercase();
    let expected = match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "svg" | "zip" => Kind::Images,
        "worldsdraw" => Kind::Projects,
        "txt" => Kind::Comments,
        _ => bail!("Choose a supported export format"),
    };
    if !path.is_absolute() || kind != expected {
        bail!("The export type does not match the chosen file format");
    }
    let temporary = path.parent().ok_or_else(|| anyhow!("Choose an export folder"))?.join(format!(".worlds-export-{}.tmp", db::new_id()));
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
    Ok(())
}
#[tauri::command]
pub async fn drawing_export_raw(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let result = async {
        let (context, token, bytes, path) = {
            let tauri::ipc::InvokeBody::Raw(body) = request.body() else { bail!("Expected export bytes") };
            let (context, token, bytes) = parse_envelope(body)?;
            let path =
                request.headers().get("x-worlds-path").and_then(|v| v.to_str().ok()).ok_or_else(|| anyhow!("Choose an export path"))?;
            let path = PathBuf::from(percent_encoding::percent_decode_str(path).decode_utf8()?.as_ref());
            (context, token, bytes, path)
        };
        let prepared = prepare(&state.conn(), context)?;
        authorize(&prepared, token.as_deref()).await?;
        let conn = state.conn();
        recheck(&conn, &prepared)?;
        write_file(&path, &bytes, prepared.context.kind)
    }
    .await;
    result.map_err(|e: anyhow::Error| format!("Could not save the export: {e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn influence_bounds_match_the_shared_renderer_analytic_fixtures() {
        let fixtures: Vec<Value> = serde_json::from_str(include_str!("../../src/drawing/fixtures/brush-bounds.json")).unwrap();
        for f in fixtures {
            let node = json!({"kind":"stroke","w":f["nodeSize"]["w"].as_f64().unwrap_or(20.0),"h":f["nodeSize"]["h"].as_f64().unwrap_or(20.0),"geometrySize":f["geometrySize"],"brush":f["brush"],"samples":f["samples"]});
            let b = ink_rect(&node);
            for (i, actual) in [b.0, b.1, b.2, b.3].into_iter().enumerate() {
                let expected = f["bounds"][i].as_f64().unwrap();
                assert!((actual - expected).abs() < 1e-8, "{} component {i}: {actual} vs {expected}", f["name"]);
            }
        }
    }
    fn fixture(name: &str) -> (Connection, String, PathBuf) {
        let dir = std::env::temp_dir().join(format!("worlds-export-{name}-{}", db::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = db::open(&dir.join("worlds.db")).unwrap();
        let page =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        (conn, page.id, dir)
    }
    fn context(page: &str, scene: Value, kind: Kind) -> Context {
        Context {
            page_id: page.into(),
            kind,
            scenes: vec![Scene {
                frame_id: Some(scene["defaultFrameId"].as_str().unwrap().into()),
                scene,
                annotations: Some(true),
                region: None,
            }],
            archive_id: None,
            source_page_ids:vec![],
        }
    }
    #[test]
    fn private_exports_need_no_token_and_policy_is_not_an_artwork_edit() {
        let (conn, page, _dir) = fixture("personal");
        let before = drawing::load(&conn, &page).unwrap();
        let prepared = prepare(&conn, context(&page, before["scene"].clone(), Kind::Projects)).unwrap();
        assert!(!needs_token(&prepared));
        let request =
            json!({"requestId":db::new_id(),"expectedRevision":0,"rules":{"images":"comment","projects":"full","comments":"edit"}});
        let work = prepare_policy(&conn, &page, Some(request.clone())).unwrap();
        assert!(work.remote.is_none());
        assert_eq!(cached(&conn, &page).unwrap().revision, 1);
        prepare_policy(&conn, &page, Some(request)).unwrap();
        assert_eq!(cached(&conn, &page).unwrap().revision, 1);
        assert_eq!(drawing::load(&conn, &page).unwrap(), before);
        let policy = cached(&conn, &page).unwrap();
        assert!(!allowed(&policy, Level::View, Kind::Images));
        assert!(allowed(&policy, Level::Comment, Kind::Images));
        assert!(!allowed(&policy, Level::Edit, Kind::Projects));
        assert!(allowed(&policy, Level::Full, Kind::Projects));
        let version = drawing::save_version(&conn, &page, "Before policy-independent edits").unwrap();
        let actor = store::profile(&conn).unwrap().id;
        let layer = before["scene"]["layerOrder"][0].as_str().unwrap();
        drawing::apply(&conn, &store::Ctx::user(), &page, json!({"id":"edit","actor":actor,"base":0,"at":1,"label":"Rename","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Changed"}}]})).unwrap();
        let restore_id = db::new_id();
        drawing::restore_version(&conn, &page, version["id"].as_str().unwrap(), 1, &restore_id, "Restore", "Before restore").unwrap();
        assert_eq!(cached(&conn, &page).unwrap(), policy);
        drawing::apply(
            &conn,
            &store::Ctx::user(),
            &page,
            json!({"id":"undo","actor":actor,"base":2,"at":3,"label":"Undo restore","type":"toggle","target":restore_id,"enabled":false}),
        )
        .unwrap();
        assert_eq!(cached(&conn, &page).unwrap(), policy);
    }
    #[test]
    fn project_exports_check_unused_originals_but_frame_images_do_not_expose_hidden_sources() {
        let (conn, page, _dir) = fixture("sources");
        let source = store::create_page(&conn, &store::Ctx::user(), store::NewPage::default()).unwrap();
        conn.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES ('foreign',?1,'image','private.png','image/png',1,'private.png',1)",[&source.id]).unwrap();
        let mut scene = drawing::initial_scene(&page);
        scene["assets"]["foreign"] =
            json!({"id":"foreign","attachmentId":"foreign","name":"Original","mime":"image/png","width":1,"height":1});
        conn.execute("INSERT INTO account_workspaces(id,name,role,synced_at) VALUES ('denied','Team','member',0)", []).unwrap();
        conn.execute("UPDATE pages SET workspace_id='denied' WHERE id=?1", [&source.id]).unwrap();
        assert!(prepare(&conn, context(&page, scene.clone(), Kind::Images)).is_ok());
        assert!(prepare(&conn, context(&page, scene, Kind::Projects)).is_err());
        conn.execute("UPDATE pages SET workspace_id='denied' WHERE id=?1", [&page]).unwrap();
        assert!(
            prepare_policy(&conn, &page, Some(json!({"requestId":db::new_id(),"expectedRevision":0,"rules":Rules::default()}))).is_err()
        );
    }
    #[test]
    fn visible_legacy_tip_overhang_requires_its_source_even_outside_the_saved_box() {
        let (conn, page, _dir) = fixture("tip-overhang");
        let source = store::create_page(&conn, &store::Ctx::user(), store::NewPage::default()).unwrap();
        conn.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES ('tip-original',?1,'image','tip.png','image/png',1,'tip.png',1)", [&source.id]).unwrap();
        conn.execute("INSERT INTO account_workspaces(id,name,role,synced_at) VALUES ('denied-tip','Team','member',0)", []).unwrap();
        conn.execute("UPDATE pages SET workspace_id='denied-tip' WHERE id=?1", [&source.id]).unwrap();
        let mut scene = drawing::initial_scene(&page);
        let layer = scene["layerOrder"][0].clone();
        let frame = scene["defaultFrameId"].clone();
        scene["assets"]["tip"] = json!({"id":"tip","attachmentId":"tip-original","name":"Tip","mime":"image/png","width":1,"height":1});
        scene["nodes"]["legacy"] = json!({"id":"legacy","kind":"stroke","name":"Legacy tip","x":100,"y":100,"w":20,"h":20,"rotation":0,"opacity":1,"visible":true,"layerId":layer,"frameId":frame,
            "paint":{"fill":"transparent","stroke":"#202023","strokeWidth":0,"dash":[]},"textStyle":{"font":"Arial","size":28,"leading":1.7},"effects":[],
            "brush":{"kind":"texture","size":100,"spacing":0.12,"opacity":1,"angle":45,"roundness":1,"tipAssetId":"tip"},"samples":[{"x":0,"y":0,"pressure":1,"time":0,"tiltX":0,"tiltY":0}]});
        scene["nodeOrder"] = json!(["legacy"]);
        drawing::validate_scene(&scene).unwrap();
        let original = scene["nodes"]["legacy"].clone();
        let mut work = context(&page, scene.clone(), Kind::Images);
        work.scenes[0].region = Some(json!({"x":30,"y":90,"w":10,"h":20}));
        assert!(visible(&scene, &original, frame.as_str(), true, work.scenes[0].region.as_ref()));
        assert!(prepare(&conn, work).is_err());
        let mut outside = context(&page, scene.clone(), Kind::Images);
        outside.scenes[0].region = Some(json!({"x":5,"y":90,"w":5,"h":20}));
        assert!(prepare(&conn, outside).is_ok());
        // Flip/rotation keep the historical metadata center as the pivot.
        scene["nodes"]["legacy"]["flipX"] = json!(true);
        scene["nodes"]["legacy"]["rotation"] = json!(90);
        assert!(visible(&scene, &scene["nodes"]["legacy"], frame.as_str(), true, Some(&json!({"x":48,"y":115,"w":1,"h":10}))));
        assert_eq!(scene["nodes"]["legacy"]["samples"], original["samples"]);
        assert_eq!(scene["nodes"]["legacy"]["w"], original["w"]);
        scene["nodes"]["legacy"]["geometrySize"] = json!({"w":20,"h":20});
        scene["nodes"]["legacy"]["w"] = json!(40);
        scene["nodes"]["legacy"]["h"] = json!(10);
        scene["nodes"]["legacy"]["rotation"] = json!(0);
        scene["nodes"]["legacy"]["flipX"] = json!(false);
        drawing::validate_scene(&scene).unwrap();
        let mut scaled = context(&page, scene.clone(), Kind::Images);
        scaled.scenes[0].region = Some(json!({"x":-30,"y":90,"w":10,"h":20}));
        assert!(visible(&scene, &scene["nodes"]["legacy"], frame.as_str(), true, scaled.scenes[0].region.as_ref()));
        assert!(prepare(&conn, scaled).is_err());
    }
    #[test]
    fn shared_exports_only_contact_the_current_configured_server() {
        let (conn, page, _dir) = fixture("server-binding");
        conn.execute("UPDATE pages SET metadata=json_set(metadata,'$.sync.shared',json('true')) WHERE id=?1", [&page]).unwrap();
        let user = store::profile(&conn).unwrap().id;
        crate::drawing_sync::open(&conn, &page, "https://old.example", "workspace", &user).unwrap();
        // Clearing the active server must not send a new account token to a
        // previously bound origin, even if a cached replica is still present.
        assert!(remote_for(&conn, &page, &user, "images").is_err());
        db::set_setting(&conn, "sync.serverUrl", &json!("https://current.example")).unwrap();
        assert!(remote_for(&conn, &page, &user, "images").is_err());
        db::set_setting(&conn, "sync.serverUrl", &json!("https://old.example/")).unwrap();
        assert_eq!(remote_for(&conn, &page, &user, "images").unwrap().unwrap().server, "https://old.example");
        assert!(remote_for(&conn, &page, "another-account", "images").is_err());
    }
    #[test]
    fn exact_file_bytes_are_separate_from_the_transient_envelope_and_cannot_change_export_class() {
        let (conn, page, dir) = fixture("bytes");
        let context = context(&page, drawing::initial_scene(&page), Kind::Images);
        let json = serde_json::to_vec(&json!({"context":context,"token":"transient-test-token"})).unwrap();
        let bytes = b"actual-image-bytes";
        let mut packet = (json.len() as u32).to_le_bytes().to_vec();
        packet.extend_from_slice(&json);
        packet.extend_from_slice(bytes);
        let (context, token, payload) = parse_envelope(&packet).unwrap();
        assert_eq!(token.as_deref(), Some("transient-test-token"));
        let prepared = prepare(&conn, context).unwrap();
        recheck(&conn, &prepared).unwrap();
        let path = dir.join("result.png");
        write_file(&path, &payload, Kind::Images).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(write_file(&path, b"project", Kind::Projects).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(parse_envelope(&packet[..3]).is_err());
        let invalid = json!({"pageId":page,"kind":"source","scenes":[]});
        assert!(serde_json::from_value::<Context>(invalid).is_err());
    }
}
