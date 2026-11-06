//! Fresh permissions for managed independent copies. Permits stay in memory
//! for one operation; no database mutex is held during network requests.
use crate::{db, drawing, drawing_export as export, store, AppState};
use anyhow::{anyhow, bail, Result};
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
    time::{Duration, Instant},
};

struct Entry {
    source: String,
    drawing: bool,
    stamp: Option<String>,
    prepared: export::Prepared,
}
pub struct Plan {
    entries: Vec<Entry>,
    bytes: usize,
}
pub struct Permit {
    entries: Vec<Entry>,
    started: Instant,
}

fn drawing_source(conn: &Connection, page: &str) -> Result<bool> {
    crate::account::permissions::require(conn, page, crate::account::Level::View)?;
    let p =
        store::page_meta_by_id(conn, page)?.filter(|p| p.deleted_at.is_none()).ok_or_else(|| anyhow!("A copy source is unavailable"))?;
    if p.kind == "drawing" {
        return Ok(true);
    }
    if p.kind != "template" {
        return Ok(false);
    }
    let kind: Option<String> =
        conn.query_row("SELECT json_extract(metadata,'$.templateResourceKind') FROM pages WHERE id=?1", [page], |r| r.get(0))?;
    Ok(kind.as_deref() == Some("drawing"))
}
fn stamp(conn: &Connection, source: &str) -> Result<Option<String>> {
    let raw: Option<String> = conn
        .query_row("SELECT CAST(revision AS TEXT) || ':' || scene FROM drawing_documents WHERE page_id=?1", [source], |r| r.get(0))
        .optional()?;
    Ok(raw.map(|raw| crate::account::secrets::sha256_hex(&raw)))
}
fn current_scene(conn: &Connection, source: &str) -> Result<Value> {
    let raw: Option<String> = conn.query_row("SELECT scene FROM drawing_documents WHERE page_id=?1", [source], |r| r.get(0)).optional()?;
    Ok(match raw {
        Some(raw) => serde_json::from_str(&raw)?,
        None => drawing::initial_scene(source),
    })
}
fn context(conn: &Connection, source: &str, scene: Value, target: Option<&str>) -> Result<export::Context> {
    let mut bytes = serde_json::to_vec(&scene)?.len();
    let mut scenes = vec![export::Scene { scene, frame_id: None, annotations: None, region: None }];
    let mut seen = BTreeSet::new();
    let mut index = 0;
    while index < scenes.len() {
        drawing::validate_scene(&scenes[index].scene)?;
        let pins: Vec<String> = scenes[index].scene["steps"]
            .as_object()
            .unwrap()
            .values()
            .filter_map(|s| s["pinnedVersionId"].as_str().map(str::to_owned))
            .collect();
        for pin in pins {
            if !seen.insert(pin.clone()) {
                continue;
            }
            if seen.len() > 500 {
                bail!("Too many pinned versions to copy");
            }
            let mut raw: Option<String> = conn
                .query_row("SELECT scene FROM drawing_versions WHERE id=?1 AND page_id=?2", rusqlite::params![pin, source], |r| r.get(0))
                .optional()?;
            if raw.is_none() {
                if let Some(target) = target {
                    crate::account::permissions::require(conn, target, crate::account::Level::View)?;
                    raw = conn
                        .query_row("SELECT scene FROM drawing_versions WHERE id=?1 AND page_id=?2", rusqlite::params![pin, target], |r| {
                            r.get(0)
                        })
                        .optional()?;
                }
            }
            let raw = raw.ok_or_else(|| anyhow!("A pinned copy version is unavailable"))?;
            bytes += raw.len();
            if bytes > 64 * 1024 * 1024 {
                bail!("The copy context exceeds its memory limit");
            }
            scenes.push(export::Scene { scene: serde_json::from_str(&raw)?, frame_id: None, annotations: None, region: None });
        }
        index += 1;
    }
    Ok(export::Context { page_id: source.into(), kind: export::Kind::Projects, scenes, archive_id: None,source_page_ids:vec![] })
}
impl Plan {
    pub fn empty() -> Self {
        Self { entries: vec![], bytes: 0 }
    }
    pub fn tree(conn: &Connection, root: &str, deep: bool) -> Result<Self> {
        let mut plan = Self::empty();
        let mut pending = vec![root.to_owned()];
        let mut seen = BTreeSet::new();
        while let Some(page) = pending.pop() {
            if !seen.insert(page.clone()) {
                bail!("The copy source tree contains a cycle");
            }
            if seen.len() > 10000 {
                bail!("The copy source tree is too large");
            }
            if drawing_source(conn, &page)? {
                plan.add_scene(conn, &page, current_scene(conn, &page)?)?;
            }
            if deep {
                let children = conn
                    .prepare("SELECT id FROM pages WHERE parent_id=?1 AND deleted_at IS NULL")?
                    .query_map([&page], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                pending.extend(children);
            }
        }
        Ok(plan)
    }
    pub fn scene(conn: &Connection, source: &str, scene: Value) -> Result<Self> {
        let mut plan = Self::empty();
        plan.add_scene(conn, source, scene)?;
        Ok(plan)
    }
    pub fn materialization(conn: &Connection, source: &str, target: &str, scene: Value) -> Result<Self> {
        let mut plan = Self::empty();
        plan.add_scene_to(conn, source, scene, Some(target))?;
        Ok(plan)
    }
    fn add_scene(&mut self, conn: &Connection, source: &str, scene: Value) -> Result<()> {
        self.add_scene_to(conn, source, scene, None)
    }
    fn push(&mut self, entry: Entry) -> Result<()> {
        self.bytes += serde_json::to_vec(&entry.prepared.context)?.len();
        if self.bytes > 64 * 1024 * 1024 {
            bail!("The complete copy context exceeds its memory limit");
        }
        self.entries.push(entry);
        Ok(())
    }
    fn add_scene_to(&mut self, conn: &Connection, source: &str, scene: Value, target: Option<&str>) -> Result<()> {
        if !drawing_source(conn, source)? {
            bail!("Open a drawing before copying artwork");
        }
        let prepared = export::prepare(conn, context(conn, source, scene, target)?)?;
        self.push(Entry { source: source.into(), drawing: true, stamp: stamp(conn, source)?, prepared })
    }
    /// Foreign originals copied without an explicit library/source identifier.
    pub fn originals(conn: &Connection, target: &str, scene: &Value) -> Result<Self> {
        drawing::validate_scene(scene)?;
        let mut plan = Self::empty();
        let mut sources = BTreeMap::<String, Vec<Value>>::new();
        for asset in scene["assets"].as_object().unwrap().values() {
            let attachment = store::get_attachment(conn, asset["attachmentId"].as_str().ok_or_else(|| anyhow!("Missing original"))?)?
                .ok_or_else(|| anyhow!("Missing original"))?;
            if let Some(source) = attachment.page_id {
                if source != target {
                    sources.entry(source).or_default().push(asset.clone());
                }
            }
        }
        for (source, assets) in sources {
            if drawing_source(conn, &source)? {
                let mut selected = drawing::initial_scene(&source);
                for asset in assets {
                    let id = asset["id"].as_str().ok_or_else(|| anyhow!("Invalid copied original"))?.to_owned();
                    selected["assets"][id] = asset;
                }
                plan.add_scene(conn, &source, selected)?;
            } else {
                plan.push(Entry { source: source.clone(), drawing: false, stamp: None, prepared: export::prepare_read(conn, &source)? })?;
            }
        }
        Ok(plan)
    }
    pub fn needs_token(&self) -> bool {
        self.entries.iter().any(|e| export::needs_token(&e.prepared))
    }
    pub async fn authorize(self, token: Option<&str>) -> Result<Permit> {
        let started = Instant::now();
        for entry in &self.entries {
            export::authorize(&entry.prepared, token).await?;
        }
        Ok(Permit { entries: self.entries, started })
    }
    pub fn tool(conn: &Connection, name: &str, args: &Value) -> Result<Self> {
        let id = |key: &str| args[key].as_str().ok_or_else(|| anyhow!("Missing copy source"));
        match name {
            "pages_duplicate" => Self::tree(conn, id("pageId")?, args["deep"].as_bool().unwrap_or(true)),
            "templates_create_from_page" => Self::tree(conn, id("pageId")?, true),
            "templates_instantiate" => Self::tree(conn, id("templateId")?, true),
            "drawing_library_publish" => Self::scene(
                conn,
                args["input"]["sourceId"].as_str().ok_or_else(|| anyhow!("Missing source drawing"))?,
                args["input"]["scene"].clone(),
            ),
            _ => Ok(Self::empty()),
        }
    }
}
impl Permit {
    fn fresh(&self) -> Result<()> {
        if self.started.elapsed() > Duration::from_secs(60) {
            bail!("Copy authorization expired. Try copying again");
        }
        Ok(())
    }
    fn recheck_entry(conn: &Connection, entry: &Entry) -> Result<()> {
        export::recheck(conn, &entry.prepared)?;
        if entry.drawing && stamp(conn, &entry.source)? != entry.stamp {
            bail!("A drawing changed while copy permissions were checked. Try again");
        }
        Ok(())
    }
    pub fn recheck(&self, conn: &Connection) -> Result<()> {
        self.fresh()?;
        for entry in &self.entries {
            Self::recheck_entry(conn, entry)?;
        }
        Ok(())
    }
}
pub fn require_scene(conn: &Connection, source: &str, scene: &Value, permit: Option<&Permit>) -> Result<()> {
    if let Some(permit) = permit {
        permit.fresh()?;
        if let Some(entry) = permit.entries.iter().find(|e| e.source == source && e.drawing) {
            Permit::recheck_entry(conn, entry)?;
            if entry.prepared.context.scenes.first().is_none_or(|s| &s.scene != scene) {
                bail!("The artwork to copy changed. Prepare the copy again");
            }
            return Ok(());
        }
    }
    let plan = Plan::scene(conn, source, scene.clone())?;
    if plan.needs_token() {
        bail!("Check current drawing copy permissions before creating an independent copy");
    }
    Ok(())
}
pub fn require_current(conn: &Connection, source: &str, permit: Option<&Permit>) -> Result<()> {
    require_scene(conn, source, &current_scene(conn, source)?, permit)
}
async fn token(db: &Mutex<Connection>) -> Result<Option<String>> {
    let status = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row("SELECT status FROM account WHERE id=1", [], |r| r.get::<_, String>(0)).optional()?
    };
    if let Some(status) = status {
        if status != "active" {
            bail!("Sign in again before copying shared artwork");
        }
        return Ok(Some(
            crate::account::client::access_token(db, &crate::account::secrets::KeyringStore, false).await.map_err(|e| anyhow!("{e}"))?.1,
        ));
    }
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    Ok(db::get_setting(&conn, "sync.devToken")?.and_then(|v| v.as_str().map(str::to_owned)))
}
pub async fn authorize_app(state: &AppState, plan: Plan) -> Result<Permit> {
    let token = if plan.needs_token() { token(&state.db).await? } else { None };
    plan.authorize(token.as_deref()).await
}
pub fn authorize_stdio(plan: Plan) -> Result<Permit> {
    if !plan.needs_token() {
        return Ok(Permit { entries: plan.entries, started: Instant::now() });
    }
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        let token = if plan.needs_token() {
            let db = Mutex::new(db::open(&db::db_path())?);
            token(&db).await?
        } else {
            None
        };
        plan.authorize(token.as_deref()).await
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (Connection, String) {
        let path = std::env::temp_dir().join(format!("worlds-copy-{}.db", db::new_id()));
        let conn = db::open(&path).unwrap();
        let source =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        (conn, source.id)
    }
    fn shared(conn: &Connection, page: &str) {
        conn.execute("UPDATE pages SET metadata=json_set(metadata,'$.sync.shared',json('true')) WHERE id=?1", [page]).unwrap();
        db::set_setting(conn, "sync.serverUrl", &json!("https://copy-authority.test")).unwrap();
        let user = store::profile(conn).unwrap().id;
        crate::drawing_sync::open(conn, page, "https://copy-authority.test", "workspace", &user).unwrap();
    }
    fn counts(conn: &Connection) -> Vec<i64> {
        ["pages", "drawing_versions", "drawing_library_items", "attachments", "drawing_operations"]
            .iter()
            .map(|table| conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap())
            .collect()
    }
    fn publication(source: &str, scene: Value) -> crate::drawing_library::Publish {
        crate::drawing_library::Publish {
            source_id: source.into(),
            item_id: None,
            expected_version: None,
            name: "Template".into(),
            kind: "template".into(),
            scope: "personal".into(),
            tags: vec![],
            scene,
            payload: json!({}),
        }
    }
    #[test]
    fn private_tree_templates_and_library_copies_keep_each_resource_kind_and_source() {
        let (conn, source) = fixture();
        let child = store::create_page(
            &conn,
            &store::Ctx::user(),
            store::NewPage {
                title: Some("Task notes".into()),
                parent_id: Some(source.clone()),
                kind: Some("page".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let before = drawing::load(&conn, &source).unwrap();
        let copy = store::duplicate_page(&conn, &store::Ctx::user(), &source, true, None, None).unwrap();
        let kind: String = conn.query_row("SELECT kind FROM pages WHERE parent_id=?1", [&copy.id], |r| r.get(0)).unwrap();
        assert_eq!(kind, "page");
        assert_eq!(store::page_meta_by_id(&conn, &child.id).unwrap().unwrap().parent_id.as_deref(), Some(source.as_str()));
        let template = store::save_as_template(&conn, &store::Ctx::user(), &source).unwrap();
        let from = store::instantiate_template(&conn, &store::Ctx::user(), &template.id, None, None).unwrap();
        assert_eq!(from.kind, "drawing");
        let published = crate::drawing_library::publish(&conn, publication(&source, before["scene"].clone())).unwrap();
        let item = published["item"]["page"]["id"].as_str().unwrap();
        let from_library = crate::drawing_library::instantiate(&conn, item, 1, None).unwrap();
        assert_eq!(drawing::load(&conn, &from_library.id).unwrap()["scene"], before["scene"]);
        assert_eq!(drawing::load(&conn, &source).unwrap(), before);
    }
    #[test]
    fn shared_copy_paths_refuse_without_a_fresh_permit_and_leave_no_artifacts() {
        let (conn, source) = fixture();
        shared(&conn, &source);
        let before = counts(&conn);
        assert!(store::duplicate_page(&conn, &store::Ctx::user(), &source, true, None, None).is_err());
        assert_eq!(counts(&conn), before);
        assert!(store::save_as_template(&conn, &store::Ctx::user(), &source).is_err());
        assert_eq!(counts(&conn), before);
        assert!(drawing::create_experiment(&conn, &source, "Branch", "").is_err());
        assert_eq!(counts(&conn), before);
        assert!(
            crate::drawing_library::publish(&conn, publication(&source, drawing::load(&conn, &source).unwrap()["scene"].clone())).is_err()
        );
        assert_eq!(counts(&conn), before);
        assert!(Plan::tree(&conn, &source, true).unwrap().needs_token());
    }
    #[test]
    fn permits_refuse_changed_sources_other_sources_expiry_and_unchecked_nested_drawings() {
        let (conn, source) = fixture();
        let permit = authorize_stdio(Plan::tree(&conn, &source, true).unwrap()).unwrap();
        let actor = store::profile(&conn).unwrap().id;
        let layer = drawing::load(&conn, &source).unwrap()["scene"]["layerOrder"][0].as_str().unwrap().to_owned();
        drawing::apply(&conn,&store::Ctx::user(),&source,json!({"id":"change","actor":actor,"base":0,"at":1,"label":"Change","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":"Changed"}}]})).unwrap();
        let before = counts(&conn);
        assert!(store::duplicate_page_authorized(&conn, &store::Ctx::user(), &source, false, None, None, Some(&permit)).is_err());
        assert_eq!(counts(&conn), before);
        let mut permit = authorize_stdio(Plan::tree(&conn, &source, false).unwrap()).unwrap();
        permit.started = Instant::now() - Duration::from_secs(61);
        assert!(store::duplicate_page_authorized(&conn, &store::Ctx::user(), &source, false, None, None, Some(&permit)).is_err());
        let permit = authorize_stdio(Plan::tree(&conn, &source, true).unwrap()).unwrap();
        let nested = store::create_page(
            &conn,
            &store::Ctx::user(),
            store::NewPage { kind: Some("drawing".into()), parent_id: Some(source.clone()), ..Default::default() },
        )
        .unwrap();
        shared(&conn, &nested.id);
        let before = counts(&conn);
        assert!(store::duplicate_page_authorized(&conn, &store::Ctx::user(), &source, true, None, None, Some(&permit)).is_err());
        assert_eq!(counts(&conn), before);
    }
    #[test]
    fn materialization_can_include_existing_destination_pins_without_treating_them_as_source_pins() {
        let (conn, source) = fixture();
        let destination =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let version = drawing::save_version(&conn, &destination.id, "Existing").unwrap();
        let mut scene = drawing::load(&conn, &source).unwrap()["scene"].clone();
        scene["steps"]["step"] = json!({"id":"step","title":"Step","body":"","frameId":scene["defaultFrameId"],"camera":{"x":0,"y":0,"w":100,"h":100},"hiddenNodeIds":[],"transition":"cut","duration":null,"pinnedVersionId":version["id"]});
        scene["stepOrder"] = json!(["step"]);
        assert!(Plan::scene(&conn, &source, scene.clone()).is_err());
        let permit = authorize_stdio(Plan::materialization(&conn, &source, &destination.id, scene.clone()).unwrap()).unwrap();
        require_scene(&conn, &source, &scene, Some(&permit)).unwrap();
        let owned = drawing::materialize_scene_dependencies(&conn, &source, &destination.id, scene).unwrap();
        assert_eq!(owned["steps"]["step"]["pinnedVersionId"], version["id"]);
    }
    #[test]
    fn copying_an_original_does_not_read_unrelated_restricted_originals_in_its_source_drawing() {
        let (conn, source) = fixture();
        let destination =
            store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap();
        let denied = store::create_page(&conn, &store::Ctx::user(), store::NewPage::default()).unwrap();
        conn.execute("INSERT INTO account_workspaces(id,name,role,synced_at) VALUES ('denied','Team','member',0)", []).unwrap();
        conn.execute("UPDATE pages SET workspace_id='denied' WHERE id=?1", [&denied.id]).unwrap();
        for (id, page) in [("used", &source), ("unrelated", &denied.id)] {
            conn.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES (?1,?2,'image','original.png','image/png',1,?1,0)",rusqlite::params![id,page]).unwrap();
        }
        let asset = |id: &str| json!({"id":id,"attachmentId":id,"name":"Original","mime":"image/png","width":1,"height":1});
        let mut whole = drawing::initial_scene(&source);
        whole["assets"]["used"] = asset("used");
        whole["assets"]["unrelated"] = asset("unrelated");
        conn.execute(
            "INSERT INTO drawing_documents(page_id,revision,seed,scene,search_text,updated_at) VALUES (?1,0,?2,?2,'',0)",
            rusqlite::params![source, whole.to_string()],
        )
        .unwrap();
        assert!(Plan::scene(&conn, &source, whole).is_err());
        let mut incoming = drawing::initial_scene(&destination.id);
        incoming["assets"]["used"] = asset("used");
        let plan = Plan::originals(&conn, &destination.id, &incoming).unwrap();
        assert!(!plan.needs_token());
        let permit = authorize_stdio(plan).unwrap();
        permit.recheck(&conn).unwrap();
        let owned = drawing::materialize_scene_assets(&conn, &destination.id, incoming).unwrap();
        assert_ne!(owned["assets"]["used"]["attachmentId"], "used");
    }
    #[test]
    fn library_template_storage_failure_does_not_leave_an_empty_drawing() {
        let (conn, source) = fixture();
        let scene = drawing::load(&conn, &source).unwrap()["scene"].clone();
        let published = crate::drawing_library::publish(&conn, publication(&source, scene)).unwrap();
        let item = published["item"]["page"]["id"].as_str().unwrap();
        let before = counts(&conn);
        conn.execute_batch(
            "CREATE TRIGGER refuse_template_drawing BEFORE INSERT ON drawing_documents BEGIN SELECT RAISE(ABORT,'storage refused'); END;",
        )
        .unwrap();
        assert!(crate::drawing_library::instantiate(&conn, item, 1, None).unwrap_err().to_string().contains("storage refused"));
        assert_eq!(counts(&conn), before);
        crate::drawing_library::read(&conn, item, Some(1)).unwrap();
        conn.execute_batch("DROP TRIGGER refuse_template_drawing; CREATE TRIGGER refuse_template_metadata BEFORE UPDATE OF metadata ON pages WHEN NEW.kind='template' AND json_extract(NEW.metadata,'$.templateResourceKind')='drawing' BEGIN SELECT RAISE(ABORT,'template metadata refused'); END;").unwrap();
        assert!(store::save_as_template(&conn,&store::Ctx::user(),&source).unwrap_err().to_string().contains("template metadata refused"));assert_eq!(counts(&conn),before);
        conn.execute_batch("DROP TRIGGER refuse_template_metadata;").unwrap();
        let template=store::save_as_template(&conn,&store::Ctx::user(),&source).unwrap();let before=counts(&conn);
        conn.execute_batch("CREATE TRIGGER refuse_template_use BEFORE UPDATE OF metadata ON pages WHEN json_extract(NEW.metadata,'$.fromTemplate') IS NOT NULL BEGIN SELECT RAISE(ABORT,'template use refused'); END;").unwrap();
        assert!(store::instantiate_template(&conn,&store::Ctx::user(),&template.id,None,None).unwrap_err().to_string().contains("template use refused"));assert_eq!(counts(&conn),before);
    }
}
