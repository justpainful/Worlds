pub mod account;
pub mod ai;
pub mod automations;
pub mod backup;
pub mod commands;
pub mod content;
pub mod db;
pub mod discord;
pub mod drawing;
pub mod drawing_copy;
pub mod drawing_export;
pub mod drawing_library;
pub mod drawing_package;
pub mod drawing_references;
pub mod drawing_sync;
pub mod jobs;
pub mod mcp;
pub mod preview;
pub mod protocol;
pub mod providers;
mod screen_drawing;
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

/// The tray menu lives outside the web page, so it follows the interface
/// language here: Arabic when chosen, or automatic on an Arabic Windows.
fn tray_in_arabic() -> bool {
    let language = db::open(&db::db_path())
        .ok()
        .and_then(|c| c.query_row("SELECT language FROM profile LIMIT 1", [], |r| r.get::<_, String>(0)).ok())
        .unwrap_or_else(|| "auto".into());
    match language.as_str() {
        "ar" => true,
        "auto" => system_is_arabic(),
        _ => false,
    }
}

/// The tray menu's two items, in Arabic or English.
fn tray_menu(app: &tauri::AppHandle, arabic: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", if arabic { "فتح Worlds" } else { "Open Worlds" }, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", if arabic { "إنهاء" } else { "Quit" }, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &quit])
}

/// The interface language changed: the tray menu follows without a restart.
#[tauri::command]
fn tray_language(app: tauri::AppHandle, arabic: bool) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main") else { return Ok(()) };
    let menu = tray_menu(&app, arabic).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn system_is_arabic() -> bool {
    // The primary language id of LANG_ARABIC is 0x01.
    let id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    id & 0x3ff == 0x01
}

#[cfg(not(windows))]
fn system_is_arabic() -> bool {
    false
}

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Where a window of `want` fits inside a work area at `origin` of `area`,
/// keeping `margin` free on every side: `None` when it already fits.
fn fitted(want: (u32, u32), origin: (i32, i32), area: (u32, u32), margin: u32) -> Option<((u32, u32), (i32, i32))> {
    let max_w = area.0.saturating_sub(margin * 2);
    let max_h = area.1.saturating_sub(margin * 2);
    if want.0 <= max_w && want.1 <= max_h {
        return None;
    }
    let size = (want.0.min(max_w), want.1.min(max_h));
    let x = origin.0 + i32::try_from((area.0 - size.0) / 2).unwrap_or(0);
    let y = origin.1 + i32::try_from((area.1 - size.1) / 2).unwrap_or(0);
    Some((size, (x, y)))
}

/// A 1080p laptop at 150 % leaves about 1280 by 690 points, so the default
/// 1380 by 880 window would run under the taskbar. Shrink it to the screen's
/// work area and centre it there before it is first shown.
fn fit_to_screen(w: &tauri::WebviewWindow) {
    let monitor = match w.current_monitor() {
        Ok(Some(m)) => m,
        _ => match w.primary_monitor() {
            Ok(Some(m)) => m,
            _ => return,
        },
    };
    let Ok(size) = w.outer_size() else { return };
    let area = monitor.work_area();
    // Rounded to whole pixels; the factor is a small positive number.
    let margin = (16.0 * monitor.scale_factor()).round().clamp(0.0, 256.0) as u32;
    let origin = (area.position.x, area.position.y);
    if let Some(((width, height), (x, y))) = fitted((size.width, size.height), origin, (area.size.width, area.size.height), margin) {
        let _ = w.set_size(tauri::PhysicalSize::new(width, height));
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
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
            let menu = tray_menu(&handle, tray_in_arabic())?;
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
                fit_to_screen(&w);
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
            tray_language,
            screen_drawing::capture_screen_for_drawing,
            screen_drawing::end_screen_drawing,
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
            drawing::drawing_load,
            drawing::drawing_apply,
            drawing::drawing_history_toggle,
            drawing::drawing_history_import,
            drawing_package::drawing_package_stage,
            drawing_package::drawing_package_abort,
            drawing_package::drawing_package_install,
            drawing_export::drawing_export_raw,
            drawing_export::drawing_export_requirements,
            drawing_export::drawing_export_policy,
            drawing_export::drawing_export_policy_cached,
            drawing_export::drawing_export_check,
            drawing::drawing_versions,
            drawing::drawing_version_save,
            drawing::drawing_version_import,
            drawing::drawing_version_scene,
            drawing::drawing_version_restore,
            drawing::drawing_materialize_assets,
            drawing::drawing_experiment_create,
            drawing::drawing_experiments,
            drawing_library::drawing_library_list,
            drawing_library::drawing_library_read,
            drawing_library::drawing_library_publish,
            drawing_library::drawing_library_instantiate,
            drawing_library::drawing_library_remove,
            drawing_references::drawing_reference_read,
            drawing_references::drawing_reference_task,
            drawing_references::drawing_embed_insert,
            drawing_references::drawing_reference_search,
            drawing_sync::drawing_sync_open,
            drawing_sync::drawing_sync_recover,
            drawing_sync::drawing_sync_pending_pages,
            drawing_sync::drawing_sync_snapshot,
            drawing_sync::drawing_sync_accept,
            drawing_sync::drawing_sync_error,
            drawing_sync::drawing_sync_store_original,
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
            ai::ai_token_status,
            ai::ai_token_open_setup,
            ai::ai_token_save,
            ai::ai_token_clear,
            ai::ai_chats,
            ai::ai_chat,
            ai::ai_chat_delete,
            ai::ai_chat_rename,
            providers::ai_providers,
            providers::ai_provider_save,
            providers::ai_provider_models,
            providers::ai_local_detect,
            providers::ai_codex_status,
            providers::ai_codex_login,
            providers::ai_claude_login,
            providers::ai_claude_auth_status,
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
            sync::commands::sync_archive_rejection,
            sync::commands::sync_rejected_list,
            sync::commands::sync_rejected_read,
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
            sync::commands::sync_access_token,
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

#[cfg(test)]
mod window_fit_tests {
    use super::fitted;

    #[test]
    fn a_window_that_fits_is_left_alone() {
        // 1380 by 880 points at 100 % on a 1920 by 1032 work area.
        assert_eq!(fitted((1380, 880), (0, 0), (1920, 1032), 16), None);
    }

    #[test]
    fn a_tall_window_on_a_scaled_laptop_is_shrunk_and_centred() {
        // 1380 by 880 points at 150 % is 2070 by 1320 pixels; the work area is 1920 by 1032.
        assert_eq!(fitted((2070, 1320), (0, 0), (1920, 1032), 24), Some(((1872, 984), (24, 24))));
    }

    #[test]
    fn a_second_monitor_keeps_its_own_origin() {
        assert_eq!(fitted((1600, 1000), (1920, 0), (1280, 680), 16), Some(((1248, 648), (1936, 16))));
    }
}
