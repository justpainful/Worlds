//! Tauri commands for the UI. Thin wrappers over `store`.

use crate::store::{self, Ctx};
use crate::{db, AppState};
use serde_json::{json, Value};
use tauri::State;

pub type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{e:#}")
}

macro_rules! with_conn {
    ($state:expr, |$c:ident| $body:expr) => {{
        let $c = $state.conn();
        // The closure lets `$body` use `?`.
        #[allow(clippy::redundant_closure_call)]
        let r: anyhow::Result<_> = (|| $body)();
        r.map_err(err)
    }};
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> CmdResult<Value> {
    with_conn!(state, |c| {
        let profile = store::profile(&c)?;
        let pages = store::list_pages(&c, true)?;
        let mut settings = serde_json::Map::new();
        let mut stmt = c.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (k, v) = row?;
            settings.insert(k, serde_json::from_str(&v).unwrap_or(Value::Null));
        }
        Ok(json!({
            "profile": profile,
            "pages": pages,
            "settings": settings,
            "dataDir": db::data_dir(),
        }))
    })
}

#[tauri::command]
pub async fn backups_list(state: State<'_, AppState>) -> CmdResult<Value> {
    let note = state.storage_note.lock().unwrap_or_else(|e| e.into_inner()).take();
    let dir = db::data_dir();
    Ok(json!({
        "backups": crate::backup::list(&dir),
        "pendingRestore": crate::backup::pending_restore(&dir),
        "note": note,
        "folder": crate::backup::backups_dir(&dir),
    }))
}

#[tauri::command]
pub async fn backup_now(state: State<'_, AppState>) -> CmdResult<Value> {
    let c = state.conn();
    crate::backup::backup_conn(&c, &db::data_dir(), "manual").map(|b| json!(b)).map_err(err)
}

/// Stage a restore; it is applied at the next launch.
#[tauri::command]
pub async fn backup_restore(file: String) -> CmdResult<()> {
    crate::backup::schedule_restore(&db::data_dir(), &file).map_err(err)
}

#[tauri::command]
pub async fn backup_cancel_restore() -> CmdResult<()> {
    crate::backup::cancel_restore(&db::data_dir());
    Ok(())
}

#[tauri::command]
pub async fn launch_info(state: State<'_, AppState>) -> CmdResult<Value> {
    Ok(json!({ "hidden": state.launched_hidden }))
}

#[tauri::command]
pub async fn pages_list(state: State<'_, AppState>) -> CmdResult<Vec<store::PageMeta>> {
    with_conn!(state, |c| store::list_pages(&c, true))
}

#[tauri::command]
pub async fn page_get(state: State<'_, AppState>, id: String, touch: Option<bool>) -> CmdResult<Option<store::Page>> {
    with_conn!(state, |c| {
        if touch.unwrap_or(false) {
            store::touch_opened(&c, &id)?;
        }
        store::get_page(&c, &id)
    })
}

#[tauri::command]
pub async fn page_create(state: State<'_, AppState>, page: store::NewPage) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| store::create_page(&c, &Ctx::user(), page))
}

#[tauri::command]
pub async fn page_markdown(state: State<'_, AppState>, id: String) -> CmdResult<String> {
    with_conn!(state, |c| {
        let page = store::get_page(&c, &id)?.ok_or_else(|| anyhow::anyhow!("page not found"))?;
        let body: Vec<String> =
            page.blocks.iter().map(|b| crate::content::to_markdown(&b.content)).filter(|m| !m.trim().is_empty()).collect();
        Ok::<String, anyhow::Error>(format!(
            "# {}

{}
",
            page.meta.title,
            body.join(
                "

"
            )
        ))
    })
}

#[tauri::command]
pub async fn page_meta_set(state: State<'_, AppState>, id: String, key: String, value: Value) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| store::set_page_meta(&c, &Ctx::user(), &id, &key, value))
}

#[tauri::command]
pub async fn page_update(state: State<'_, AppState>, id: String, patch: store::PagePatch) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| store::update_page(&c, &Ctx::user(), &id, patch))
}

#[tauri::command]
pub async fn page_move(
    state: State<'_, AppState>,
    id: String,
    parent_id: Option<String>,
    before_id: Option<String>,
) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| store::move_page(&c, &Ctx::user(), &id, parent_id.as_deref(), before_id.as_deref()))
}

#[tauri::command]
pub async fn page_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    with_conn!(state, |c| store::delete_page(&c, &Ctx::user(), &id))
}

#[tauri::command]
pub async fn page_restore(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    with_conn!(state, |c| store::restore_page(&c, &Ctx::user(), &id))
}

#[tauri::command]
pub async fn page_purge(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    with_conn!(state, |c| store::purge_page(&c, &id))
}

#[tauri::command]
pub async fn page_duplicate(state: State<'_, AppState>, id: String, deep: Option<bool>) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| store::duplicate_page(&c, &Ctx::user(), &id, deep.unwrap_or(true), None, None))
}

#[tauri::command]
pub async fn blocks_save(
    state: State<'_, AppState>,
    page_id: String,
    blocks: Vec<store::BlockInput>,
    base: Option<i64>,
) -> CmdResult<store::SaveResult> {
    with_conn!(state, |c| {
        store::snapshot_before_user_edit(&c, &page_id)?;
        let tx = c.unchecked_transaction()?;
        // The editor saves its whole block list. If someone else wrote the page
        // since this editor last synced (Claude, an automation, another pane),
        // that list would delete their blocks: refuse, and let the editor merge.
        if let Some(base) = base {
            if store::page_changed_since(&tx, &page_id, base)? {
                anyhow::bail!("conflict: the page changed since it was loaded");
            }
        }
        let r = store::save_blocks(&tx, &Ctx::user(), &page_id, blocks)?;
        tx.commit()?;
        Ok(r)
    })
}

#[tauri::command]
pub async fn search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
    include_templates: Option<bool>,
) -> CmdResult<Vec<store::SearchHit>> {
    with_conn!(state, |c| store::search(&c, &query, limit.unwrap_or(30), include_templates.unwrap_or(true)))
}

#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    page_id: Option<String>,
    op_id: Option<String>,
    limit: Option<i64>,
) -> CmdResult<Vec<store::HistoryEntry>> {
    with_conn!(state, |c| store::list_history(&c, page_id.as_deref(), op_id.as_deref(), limit.unwrap_or(100)))
}

#[tauri::command]
pub async fn versions_list(state: State<'_, AppState>, page_id: String) -> CmdResult<Vec<store::Version>> {
    with_conn!(state, |c| store::list_versions(&c, &page_id))
}

#[tauri::command]
pub async fn version_get(state: State<'_, AppState>, version_id: String) -> CmdResult<Value> {
    with_conn!(state, |c| Ok(store::version_snapshot(&c, &version_id)?.1))
}

#[tauri::command]
pub async fn version_restore(state: State<'_, AppState>, version_id: String) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| store::restore_version(&c, &Ctx::user(), &version_id))
}

#[tauri::command]
pub async fn op_undo(state: State<'_, AppState>, op_id: String) -> CmdResult<Vec<String>> {
    with_conn!(state, |c| store::undo_op(&c, &Ctx::user(), &op_id))
}

#[tauri::command]
pub async fn profile_get(state: State<'_, AppState>) -> CmdResult<store::Profile> {
    with_conn!(state, |c| store::profile(&c))
}

#[tauri::command]
pub async fn profile_stats(state: State<'_, AppState>) -> CmdResult<Value> {
    with_conn!(state, |c| store::profile_stats(&c))
}

#[tauri::command]
pub async fn profile_update(state: State<'_, AppState>, patch: store::ProfilePatch) -> CmdResult<store::Profile> {
    with_conn!(state, |c| store::update_profile(&c, patch))
}

#[tauri::command]
pub async fn attachment_import(state: State<'_, AppState>, page_id: Option<String>, path: String) -> CmdResult<store::Attachment> {
    with_conn!(state, |c| store::add_attachment_path(&c, page_id.as_deref(), std::path::Path::new(&path)))
}

#[tauri::command]
pub async fn attachment_import_bytes(
    state: State<'_, AppState>,
    page_id: Option<String>,
    name: String,
    bytes: Vec<u8>,
) -> CmdResult<store::Attachment> {
    with_conn!(state, |c| store::add_attachment_bytes(&c, page_id.as_deref(), &name, &bytes))
}

#[tauri::command]
pub async fn media_recent(state: State<'_, AppState>, limit: Option<i64>) -> CmdResult<Vec<store::Attachment>> {
    with_conn!(state, |c| store::recent_media(&c, limit.unwrap_or(60)))
}

#[tauri::command]
pub async fn attachment_get(state: State<'_, AppState>, id: String) -> CmdResult<Option<store::Attachment>> {
    with_conn!(state, |c| store::get_attachment(&c, &id))
}

#[tauri::command]
pub async fn attachment_path(state: State<'_, AppState>, id: String) -> CmdResult<String> {
    with_conn!(state, |c| {
        let a = store::get_attachment(&c, &id)?.ok_or_else(|| anyhow::anyhow!("attachment not found"))?;
        Ok(store::attachment_abs_path(&a).to_string_lossy().to_string())
    })
}

#[tauri::command]
pub async fn template_instantiate(
    state: State<'_, AppState>,
    template_id: String,
    parent_id: Option<String>,
    title: Option<String>,
) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| {
        let tx = c.unchecked_transaction()?;
        let p = store::instantiate_template(&tx, &Ctx::user(), &template_id, parent_id.as_deref(), title.as_deref())?;
        tx.commit()?;
        Ok(p)
    })
}

#[tauri::command]
pub async fn template_save(state: State<'_, AppState>, page_id: String) -> CmdResult<store::PageMeta> {
    with_conn!(state, |c| store::save_as_template(&c, &Ctx::user(), &page_id))
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, key: String, value: Value) -> CmdResult<()> {
    with_conn!(state, |c| db::set_setting(&c, &key, &value))
}

#[tauri::command]
pub async fn session_save(state: State<'_, AppState>, session: Value) -> CmdResult<()> {
    with_conn!(state, |c| db::set_setting(&c, "session", &session))
}

/// Append Markdown (e.g. a Claude answer) to the end of a page as real blocks.
#[tauri::command]
pub async fn page_append_markdown(state: State<'_, AppState>, page_id: String, markdown: String) -> CmdResult<usize> {
    with_conn!(state, |c| {
        let nodes = crate::content::from_markdown(&markdown);
        if nodes.is_empty() {
            anyhow::bail!("nothing to add");
        }
        let n = nodes.len();
        store::snapshot_before_user_edit(&c, &page_id)?;
        store::insert_blocks(&c, &Ctx::user(), &page_id, None, nodes)?;
        Ok(n)
    })
}

#[tauri::command]
pub async fn client_log(message: String) -> CmdResult<()> {
    eprintln!("[webview] {message}");
    Ok(())
}

#[tauri::command]
pub async fn data_dir() -> CmdResult<String> {
    Ok(db::data_dir().to_string_lossy().to_string())
}
