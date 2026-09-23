//! Liquid Glass behind a window's web page (macOS 26+, frosted fallback before).

use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn clonq_apply_glass(ns_window: *mut std::ffi::c_void, corner_radius: f64);
}

/// Must run on the main thread; `corner_radius` is in points.
pub fn apply<R: Runtime>(window: &WebviewWindow<R>, corner_radius: f64) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window()?;
        // SAFETY: ns_window is the live NSWindow of this webview window, and the
        // caller guarantees the main thread, which AppKit requires.
        unsafe { clonq_apply_glass(ns_window, corner_radius) };
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, corner_radius);
    Ok(())
}
