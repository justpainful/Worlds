pub mod account;
pub mod ai;
pub mod automations;
pub mod backup;
pub mod commands;
pub mod content;
pub mod db;
pub mod discord;
pub mod jobs;
pub mod mcp;
pub mod preview;
pub mod protocol;
pub mod store;
#[cfg(test)]
mod store_tests;
pub mod sync;
pub mod templates;
pub mod window_style;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

/// Human-readable size for messages to Claude.
pub fn ui_bytes(n: i64) -> String {
    if n < 1024 {
        format!("{n} B")
    } else if n < 1024 * 1024 {
        format!("{:.0} KB", n as f64 / 1024.0)
    } else {
        format!("{:.1} MB", n as f64 / 1024.0 / 1024.0)
    }
}

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub launched_hidden: bool,
    /// Set when launch restored or recovered the database (shown once in the UI).
    pub storage_note: Mutex<Option<String>>,
}

impl AppState {
    pub fn conn(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    // Backups, staged restores and recovery happen before anything opens the file.
    let storage_note = backup::prepare(&db::db_path(), &db::data_dir()).unwrap_or_else(|e| Some(format!("Backup check failed: {e:#}")));
    let conn = db::open(&db::db_path()).expect("failed to open Worlds database");
    store::profile(&conn).expect("profile");
    store::ensure_builtin_templates(&conn).expect("templates");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(AppState { db: Mutex::new(conn), launched_hidden: hidden, storage_note: Mutex::new(storage_note) })
        .register_asynchronous_uri_scheme_protocol("wfile", |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(protocol::serve(&request)));
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Daily backup, off the startup path.
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(20));
                if let Ok(conn) = db::open(&db::db_path()) {
                    let _ = backup::daily(&conn, &db::data_dir());
                }
            });

            // Tray: the process stays alive (and keeps running automations)
            // when the window is closed.
            let open = MenuItem::with_id(app, "open", "Open Worlds", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Worlds")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(w) = app.get_webview_window("main") {
                let level = window_style::level_from_settings(&app.state::<AppState>().conn());
                window_style::apply(&w, &level);
                let h = handle.clone();
                w.on_window_event(move |e| {
                    if let WindowEvent::CloseRequested { api, .. } = e {
                        let keep = {
                            let state = h.state::<AppState>();
                            let conn = state.conn();
                            db::get_setting(&conn, "app.runInBackground").ok().flatten().and_then(|v| v.as_bool()).unwrap_or(true)
                        };
                        if keep {
                            api.prevent_close();
                            if let Some(w) = h.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                    }
                });
            }

            spawn_change_watcher(handle.clone());
            automations::spawn_scheduler(handle.clone());
            account::sync::spawn(handle.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            account::commands::account,
            commands::backups_list,
            commands::attachment_import_raw,
            commands::backup_now,
            commands::backup_restore,
            commands::backup_cancel_restore,
            commands::launch_info,
            commands::pages_list,
            commands::page_get,
            commands::page_create,
            commands::page_update,
            commands::page_move,
            commands::page_delete,
            commands::page_restore,
            commands::page_purge,
            commands::page_duplicate,
            commands::blocks_save,
            commands::search,
            commands::history_list,
            commands::versions_list,
            commands::version_get,
            commands::version_restore,
            commands::op_undo,
            commands::profile_get,
            commands::profile_update,
            commands::profile_stats,
            commands::page_meta_set,
            commands::page_markdown,
            commands::media_recent,
            commands::attachment_import,
            commands::attachment_import_bytes,
            commands::attachment_get,
            commands::attachment_path,
            commands::template_instantiate,
            commands::template_save,
            commands::settings_set,
            commands::session_save,
            commands::data_dir,
            commands::client_log,
            window_style::window_set_transparency,
            commands::page_append_markdown,
            preview::preview_prepare,
            ai::ai_run,
            ai::ai_cancel,
            ai::ai_status,
            ai::ai_register_mcp,
            ai::ai_chats,
            ai::ai_chat,
            ai::ai_chat_delete,
            ai::ai_chat_rename,
            automations::automations_list,
            automations::automation_get,
            automations::automation_save,
            automations::automation_delete,
            automations::automation_run_now,
            automations::automation_runs,
            discord::discord_render,
            discord::discord_status,
            discord::discord_destinations,
            discord::discord_send,
            discord::pending_actions,
            discord::pending_resolve,
            sync::commands::sync_page_mode,
            sync::commands::sync_set_shared,
            sync::commands::sync_load,
            sync::commands::sync_append,
            sync::commands::sync_compact,
            sync::commands::sync_purge,
            sync::commands::sync_outbox,
            sync::commands::sync_outbox_ack,
            sync::commands::sync_outbox_ack_upto,
            sync::commands::sync_outbox_reject,
            sync::commands::sync_outbox_fail,
            sync::commands::sync_outbox_max,
            sync::commands::sync_cursor_set,
            sync::commands::sync_status,
            sync::commands::sync_mirror_check,
            sync::commands::sync_mirror_adopt,
            sync::commands::sync_mirror_write,
            sync::commands::sync_attachment_enqueue,
            sync::commands::sync_attachment_queue,
            sync::commands::sync_attachment_update,
            sync::commands::sync_attachment_store,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Worlds");
}

/// Watch for writes from other processes (the MCP tool server) and from the
/// in-process runner, and tell the UI which pages changed.
fn spawn_change_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Ok(conn) = db::open(&db::db_path()) else { return };
        let mut last: i64 = conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM changes", [], |r| r.get(0)).unwrap_or(0);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(600));
            let rows: Vec<(i64, Option<String>, String, String)> =
                match conn.prepare("SELECT seq, page_id, kind, origin FROM changes WHERE seq > ?1 ORDER BY seq").and_then(|mut s| {
                    s.query_map([last], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<Vec<_>>>()
                }) {
                    Ok(r) => r,
                    Err(_) => continue,
                };
            if rows.is_empty() {
                continue;
            }
            last = rows.last().map(|r| r.0).unwrap_or(last);
            let external: Vec<serde_json::Value> = rows
                .into_iter()
                .filter(|r| r.3 != "ui")
                .map(|r| serde_json::json!({ "pageId": r.1, "kind": r.2, "origin": r.3 }))
                .collect();
            if !external.is_empty() {
                let _ = app.emit("worlds://changed", external);
            }
            // Trim old change rows occasionally.
            if last % 500 == 0 {
                let _ = conn.execute("DELETE FROM changes WHERE seq < ?1", [last - 5000]);
            }
        }
    });
}
