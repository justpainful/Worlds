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
    hide_system_caption_buttons(hwnd);
}

/// With the frame extended over the whole window, DWM draws its own minimize,
/// maximize and close buttons in the top corner of any window that has a
/// system menu, and through Mica or Acrylic they show next to Worlds' own
/// buttons. Without the system menu style DWM draws none; minimizing from
/// the taskbar and Snap keep working because the minimize and maximize
/// styles stay. Alt+F4 is handled by the page (src/shell/Window.tsx).
///
/// The window library sets the style again on many changes (showing the
/// window, focus, maximize), so the window is subclassed and every style
/// change has the system menu taken out before it lands. Checked on the
/// owner's PC on 2026-11-13: with the style kept off, the extra buttons go.
#[cfg(windows)]
fn hide_system_caption_buttons(hwnd: windows_sys::Win32::Foundation::HWND) {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, WM_STYLECHANGING, WS_SYSMENU,
    };

    unsafe extern "system" fn keep_off(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if msg == WM_STYLECHANGING && wparam as i32 == GWL_STYLE && lparam != 0 {
            let change = unsafe { &mut *(lparam as *mut STYLESTRUCT) };
            change.styleNew &= !WS_SYSMENU;
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    unsafe {
        // Only works from the thread that owns the window (setup); a later call from a command thread just keeps the first.
        SetWindowSubclass(hwnd, Some(keep_off), 0x5753_4D4E, 0);
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        if style & WS_SYSMENU as isize == 0 {
            return;
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_SYSMENU as isize));
        SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
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
