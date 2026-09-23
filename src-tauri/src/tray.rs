//! The menu bar icon: a click opens the glass popover right below it.

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, Rect};

use crate::POPOVER;

/// Gap between the menu bar and the popover, in points.
const GAP: f64 = 6.0;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id("clonq")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("clonq")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle_popover(app: &AppHandle, icon: Rect) {
    let Some(window) = app.get_webview_window(POPOVER) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    // The tray reports its rect in physical pixels.
    let icon_position = icon.position.to_physical::<f64>(1.0);
    let icon_size = icon.size.to_physical::<f64>(1.0);
    let scale = window.scale_factor().unwrap_or(1.0);
    if let Ok(size) = window.outer_size() {
        let x = icon_position.x + icon_size.width / 2.0 - size.width as f64 / 2.0;
        let y = icon_position.y + icon_size.height + GAP * scale;
        let _ = window.set_position(PhysicalPosition::new(x.round(), y.round()));
    }
    let _ = window.show();
    let _ = window.set_focus();
}
