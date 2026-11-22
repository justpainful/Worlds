//! Updates for Worlds on Windows (Tauri's updater). The account service
//! answers at login.enterworlds.space/updates with the newest installer the
//! team offers (services/identity/src/routes/updates.ts), and every installer
//! is checked against the Worlds update key in tauri.conf.json before it runs.
//!
//! The UI (src/account/appUpdate.ts) checks, downloads in the background and
//! asks before installing, which closes Worlds and opens the new version.

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, and its installer once downloaded.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Option<Vec<u8>>)>>);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// action: "check" (returns the update or null), "download" (fetches and verifies the
/// installer), "install" (runs it; Worlds closes and the new version opens).
#[tauri::command]
pub async fn app_update(app: AppHandle, pending: State<'_, Pending>, action: String, channel: Option<String>) -> Result<Value, String> {
    match action.as_str() {
        "check" => {
            // Testers get the beta channel; everyone else the stable one.
            let mut builder = app.updater_builder();
            if channel.as_deref() == Some("beta") {
                builder = builder.header("x-worlds-channel", "beta").map_err(|e| e.to_string())?;
            }
            let found = builder.build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
            let view = found.as_ref().map(
                |u| json!({ "version": u.version, "current": u.current_version, "notes": u.body, "date": u.date.map(|d| d.to_string()) }),
            );
            *lock(&pending.0) = found.map(|u| (u, None));
            Ok(view.unwrap_or(Value::Null))
        }
        "download" => {
            let update = lock(&pending.0).as_ref().map(|(u, _)| u.clone()).ok_or("No update to download.")?;
            // download() checks the signature against the Worlds update key.
            let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
            *lock(&pending.0) = Some((update, Some(bytes)));
            Ok(json!({ "ready": true }))
        }
        "install" => {
            let (update, bytes) = lock(&pending.0).take().ok_or("No update to install.")?;
            let bytes = match bytes {
                Some(b) => b,
                None => update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?,
            };
            update.install(bytes).map_err(|e| e.to_string())?;
            // On Windows the installer closes Worlds itself; elsewhere start the new version.
            app.restart();
        }
        _ => Err(format!("unknown update action {action}")),
    }
}
