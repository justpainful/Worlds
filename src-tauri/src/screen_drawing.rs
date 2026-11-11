use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::WebviewWindow;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCapture {
    data_url: String,
    width: u32,
    height: u32,
    was_fullscreen: bool,
}

/// Capture stays in memory and is returned only to the invoking local window.
#[tauri::command]
pub async fn capture_screen_for_drawing(window: WebviewWindow) -> Result<ScreenCapture, String> {
    let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("Cannot locate the current monitor")?;
    let pos = *monitor.position();
    let size = *monitor.size();
    if size.width == 0 || size.height == 0 || u64::from(size.width) * u64::from(size.height) > 16_000_000 {
        return Err("Screen size exceeds the capture limit".into());
    }
    let was_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    // Let Windows present the underlying application before capturing it.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let result = tauri::async_runtime::spawn_blocking(move || capture(pos.x, pos.y, size.width, size.height))
        .await
        .map_err(|e| e.to_string())
        .and_then(|v| v);
    let png = match result {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = window.show();
            let _ = window.set_focus();
            return Err(error);
        }
    };
    if let Err(error) = window.set_fullscreen(true) {
        let _ = window.show();
        let _ = window.set_focus();
        return Err(error.to_string());
    }
    if let Err(error) = window.show() {
        let _ = window.set_fullscreen(was_fullscreen);
        return Err(error.to_string());
    }
    let _ = window.set_focus();
    Ok(ScreenCapture {
        data_url: format!("data:image/png;base64,{}", STANDARD.encode(png)),
        width: size.width,
        height: size.height,
        was_fullscreen,
    })
}

#[tauri::command]
pub fn end_screen_drawing(window: WebviewWindow, was_fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(was_fullscreen).map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[cfg(windows)]
fn capture(x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>, String> {
    use std::{mem::size_of, ptr::null_mut};
    use windows_sys::Win32::Graphics::Gdi::*;
    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("Cannot access the screen".into());
        }
        let memory = CreateCompatibleDC(screen);
        if memory.is_null() {
            ReleaseDC(null_mut(), screen);
            return Err("Cannot create the capture surface".into());
        }
        let bitmap = CreateCompatibleBitmap(screen, width as i32, height as i32);
        if bitmap.is_null() {
            DeleteDC(memory);
            ReleaseDC(null_mut(), screen);
            return Err("Cannot create the screen image".into());
        }
        let previous = SelectObject(memory, bitmap);
        let copied = BitBlt(memory, 0, 0, width as i32, height as i32, screen, x, y, SRCCOPY | CAPTUREBLT);
        SelectObject(memory, previous);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width as i32;
        info.bmiHeader.biHeight = -(height as i32);
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let rows =
            if copied != 0 { GetDIBits(memory, bitmap, 0, height, pixels.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS) } else { 0 };
        DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(null_mut(), screen);
        if rows != height as i32 {
            return Err("Could not capture the screen".into());
        }
        for p in pixels.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
            p[3] = 255;
        }
        let mut result = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut result, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
            writer.write_image_data(&pixels).map_err(|e| e.to_string())?;
        }
        Ok(result)
    }
}

#[cfg(not(windows))]
fn capture(_: i32, _: i32, _: u32, _: u32) -> Result<Vec<u8>, String> {
    Err("Screen drawing is currently available on Windows".into())
}
