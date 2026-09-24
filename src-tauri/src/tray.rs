//! The menu bar icon: a click opens the glass popover right below it.

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, Rect};

use crate::{AppState, POPOVER};

/// Gap between the menu bar and the popover, in points.
const GAP: f64 = 6.0;

const TRAY_ID: &str = "clonq";

/// The reel in the menu bar at 0°, 40° and 80°; with three windows, 120° looks like 0° again.
const FRAMES: [&[u8]; 3] = [
    include_bytes!("../icons/tray.png"),
    include_bytes!("../icons/tray-40.png"),
    include_bytes!("../icons/tray-80.png"),
];

/// While a job runs, the reel moves like a tape drive: a kick of one window step, a hold, again.
/// Each entry is the frame to show and how long it stays, in milliseconds.
const KICKS: [(usize, u64); 6] = [(1, 260), (2, 420), (0, 180), (1, 520), (2, 240), (0, 380)];

/// How often the idle icon checks whether a job has started.
const IDLE_POLL: std::time::Duration = std::time::Duration::from_millis(400);

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(FRAMES[0])?)
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
    animate(app.clone())?;
    Ok(())
}

/// Turns the menu bar reel while any job runs and puts it back to rest afterwards.
fn animate(app: AppHandle) -> tauri::Result<()> {
    let frames = FRAMES.map(Image::from_bytes).into_iter().collect::<tauri::Result<Vec<_>>>()?;
    tauri::async_runtime::spawn(async move {
        let mut shown = 0;
        let mut step = 0;
        loop {
            let busy = app.state::<AppState>().engine.busy();
            let (frame, hold) = if busy {
                step = (step + 1) % KICKS.len();
                (KICKS[step].0, std::time::Duration::from_millis(KICKS[step].1))
            } else {
                (0, IDLE_POLL)
            };
            if frame != shown {
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    let _ = tray.set_icon(Some(frames[frame].clone()));
                    // set_icon drops the template flag; without it the reel stays black in dark mode.
                    let _ = tray.set_icon_as_template(true);
                }
                shown = frame;
            }
            tokio::time::sleep(hold).await;
        }
    });
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
