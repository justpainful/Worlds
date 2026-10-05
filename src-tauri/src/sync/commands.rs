//! Tauri commands for live sync. Binary Yjs data travels as base64.

use super::*;
use crate::commands::CmdResult;
use crate::AppState;
use tauri::State;

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{e:#}")
}

fn with<T>(state: &State<'_, AppState>, f: impl FnOnce(&Connection) -> Result<T>) -> CmdResult<T> {
    let c = state.conn();
    f(&c).map_err(err)
}

#[tauri::command]
pub async fn sync_page_mode(state: State<'_, AppState>, page_id: String) -> CmdResult<PageMode> {
    with(&state, |c| page_mode(c, &page_id))
}

#[tauri::command]
pub async fn sync_set_shared(state: State<'_, AppState>, page_id: String, shared: bool) -> CmdResult<PageMode> {
    with(&state, |c| set_shared(c, &page_id, shared))
}

#[tauri::command]
pub async fn sync_load(state: State<'_, AppState>, page_id: String, channel: i64) -> CmdResult<Loaded> {
    with(&state, |c| load(c, &page_id, channel))
}

#[tauri::command]
pub async fn sync_append(
    state: State<'_, AppState>,
    page_id: String,
    channel: i64,
    data: String,
    origin: String,
    outbox: bool,
) -> CmdResult<Appended> {
    with(&state, |c| append(c, &page_id, channel, &unb64(&data)?, &origin, outbox))
}

#[tauri::command]
pub async fn sync_compact(state: State<'_, AppState>, page_id: String, channel: i64, data: String, upto: i64) -> CmdResult<()> {
    with(&state, |c| compact(c, &page_id, channel, &unb64(&data)?, upto))
}

#[tauri::command]
pub async fn sync_purge(state: State<'_, AppState>, page_id: String) -> CmdResult<()> {
    with(&state, |c| purge(c, &page_id))
}

#[tauri::command]
pub async fn sync_outbox(state: State<'_, AppState>, page_id: Option<String>, limit: Option<i64>) -> CmdResult<Vec<OutboxItem>> {
    with(&state, |c| outbox_list(c, page_id.as_deref(), limit.unwrap_or(500)))
}

#[tauri::command]
pub async fn sync_outbox_ack(state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<usize> {
    with(&state, |c| outbox_ack(c, &ids))
}

#[tauri::command]
pub async fn sync_outbox_ack_upto(state: State<'_, AppState>, page_id: String, channel: i64, upto: i64) -> CmdResult<usize> {
    with(&state, |c| outbox_ack_upto(c, &page_id, channel, upto))
}

#[tauri::command]
pub async fn sync_outbox_reject(state: State<'_, AppState>, ids: Vec<i64>, reason: String) -> CmdResult<usize> {
    with(&state, |c| outbox_reject(c, &ids, &reason))
}

#[tauri::command]
pub async fn sync_outbox_fail(state: State<'_, AppState>, ids: Vec<i64>, error: String) -> CmdResult<usize> {
    with(&state, |c| outbox_fail(c, &ids, &error))
}

#[tauri::command]
pub async fn sync_outbox_max(state: State<'_, AppState>, page_id: String, channel: i64) -> CmdResult<i64> {
    with(&state, |c| outbox_max_id(c, &page_id, channel))
}

#[tauri::command]
pub async fn sync_cursor_set(state: State<'_, AppState>, page_id: String, channel: i64, cursor: CursorInput) -> CmdResult<()> {
    with(&state, |c| cursor_set(c, &page_id, channel, &cursor))
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>, page_id: Option<String>) -> CmdResult<Value> {
    with(&state, |c| match page_id {
        Some(id) => Ok(serde_json::to_value(page_status(c, &id)?)?),
        None => Ok(serde_json::to_value(status(c)?)?),
    })
}

#[tauri::command]
pub async fn sync_mirror_check(state: State<'_, AppState>, page_id: String) -> CmdResult<MirrorCheck> {
    with(&state, |c| mirror_check(c, &page_id))
}

#[tauri::command]
pub async fn sync_mirror_adopt(
    state: State<'_, AppState>,
    page_id: String,
    base_rev: String,
    state_b64: String,
) -> CmdResult<MirrorOutcome> {
    with(&state, |c| mirror_adopt(c, &page_id, &base_rev, &unb64(&state_b64)?))
}

#[tauri::command]
pub async fn sync_mirror_write(
    state: State<'_, AppState>,
    page_id: String,
    blocks: Vec<BlockInput>,
    base_rev: String,
    state_b64: String,
) -> CmdResult<MirrorOutcome> {
    with(&state, |c| mirror_write(c, &page_id, blocks, &base_rev, &unb64(&state_b64)?))
}

#[tauri::command]
pub async fn sync_attachment_enqueue(
    state: State<'_, AppState>,
    attachment_id: String,
    page_id: Option<String>,
    workspace_id: Option<String>,
) -> CmdResult<()> {
    with(&state, |c| attachment_enqueue(c, &attachment_id, page_id.as_deref(), workspace_id.as_deref()))
}

#[tauri::command]
pub async fn sync_attachment_queue(state: State<'_, AppState>) -> CmdResult<Vec<QueuedAttachment>> {
    with(&state, |c| attachment_queue(c, 8))
}

#[tauri::command]
pub async fn sync_attachment_update(state: State<'_, AppState>, attachment_id: String, progress: AttachmentProgress) -> CmdResult<()> {
    with(&state, |c| attachment_update(c, &attachment_id, &progress))
}

/// An attachment from another computer, as the raw request body; id, page,
/// name and type travel in percent-encoded headers.
#[tauri::command]
pub async fn sync_attachment_store(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<store::Attachment> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file bytes as the request body".into());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().to_string())
            .filter(|v| !v.is_empty())
    };
    let id = header("x-worlds-id").unwrap_or_default();
    let page_id = header("x-worlds-page");
    let name = header("x-worlds-name").unwrap_or_else(|| "file".into());
    let mime = header("x-worlds-mime").unwrap_or_default();
    with(&state, |c| store_attachment(c, &id, page_id.as_deref(), &name, &mime, bytes))
}

/// An access token for the sync service, from the signed-in account (the
/// accounts work keeps the refresh token in the OS credential store). With
/// `force`, a new one is minted even if the cached one is still valid.
#[tauri::command]
pub async fn sync_access_token(state: State<'_, AppState>, force: bool) -> CmdResult<Value> {
    let secrets = crate::account::secrets::KeyringStore;
    match crate::account::client::access_token(&state.db, &secrets, force).await {
        Ok((_identity_url, token)) => {
            let user_id = {
                let c = state.conn();
                c.query_row("SELECT user_id FROM account WHERE id = 1", [], |r| r.get::<_, String>(0)).optional().map_err(err)?
            };
            Ok(serde_json::json!({ "token": token, "userId": user_id }))
        }
        Err(e) => Err(format!("{e}")),
    }
}
