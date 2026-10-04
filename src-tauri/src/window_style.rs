//! Native window styling on Windows 11.
//!
//! The window is undecorated but keeps a real DWM frame (shadow, rounded
//! corners, native resize borders, Snap, per-monitor DPI moves). Its
//! backdrop can be a system material so the desktop shows through:
//!   off      opaque
//!   mica     Mica: the wallpaper, heavily blurred and tinted (subtle)
//!   acrylic  Acrylic: whatever is behind the window, blurred (strong)

use crate::commands::CmdResult;
use crate::{db, AppState};
use tauri::{Manager, State, WebviewWindow};

pub fn level_from_settings(conn: &rusqlite::Connection) -> String {
    db::get_setting(conn, "appearance.transparency")
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "off".into())
}

#[cfg(windows)]
pub fn apply(window: &WebviewWindow, level: &str) {
    use windows_sys::Win32::Graphics::Dwm::{DwmExtendFrameIntoClientArea, DwmSetWindowAttribute};
    use windows_sys::Win32::UI::Controls::MARGINS;

    let Ok(h) = window.hwnd() else { return };
    let hwnd = h.0 as windows_sys::Win32::Foundation::HWND;
    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
    const DWMWCP_ROUND: u32 = 2;
    const DWMSBT_NONE: u32 = 1;
    const DWMSBT_MAINWINDOW: u32 = 2; // Mica
    const DWMSBT_TRANSIENTWINDOW: u32 = 3; // Acrylic

    let set = |attr: u32, value: u32| unsafe {
        DwmSetWindowAttribute(hwnd, attr, &value as *const u32 as *const core::ffi::c_void, 4);
    };
    set(DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
    set(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND);
    // A barely-there edge (COLORREF is 0x00BBGGRR).
    set(DWMWA_BORDER_COLOR, 0x0030_2E2E);
    let backdrop = match level {
        "mica" => DWMSBT_MAINWINDOW,
        "acrylic" => DWMSBT_TRANSIENTWINDOW,
        _ => DWMSBT_NONE,
    };
    // The system backdrop draws behind the whole client area.
    let margins = MARGINS { cxLeftWidth: -1, cxRightWidth: -1, cyTopHeight: -1, cyBottomHeight: -1 };
    unsafe {
        DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
    set(DWMWA_SYSTEMBACKDROP_TYPE, backdrop);
}

#[cfg(not(windows))]
pub fn apply(_window: &WebviewWindow, _level: &str) {}

#[tauri::command]
pub async fn window_set_transparency(app: tauri::AppHandle, state: State<'_, AppState>, level: String) -> CmdResult<()> {
    let level = match level.as_str() {
        "mica" | "acrylic" => level,
        _ => "off".to_string(),
    };
    db::set_setting(&state.conn(), "appearance.transparency", &serde_json::json!(level)).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window("main") {
        apply(&w, &level);
    }
    Ok(())
}
