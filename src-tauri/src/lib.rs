mod cloud;
mod commands;
mod config;
mod engine;
mod error;
mod glass;
mod history;
mod locations;
mod rclone_output;
mod rsync_output;
mod runlog;
mod scheduler;
mod setup;
mod smb;
mod ssh;
mod stats;
mod tray;
mod watch;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::{Emitter, Manager, WindowEvent};

use crate::config::Config;
use crate::engine::Engine;
use crate::history::History;

pub const POPOVER: &str = "popover";
pub const MAIN: &str = "main";

/// Corner radius of the glass popover, in points.
const POPOVER_RADIUS: f64 = 12.0;

pub struct AppState {
    pub config: RwLock<Config>,
    pub config_dir: PathBuf,
    pub history: Arc<History>,
    pub engine: Engine,
    pub server_checks: locations::ServerChecks,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let config = Config::load_or_init(&data_dir)?;
            let history = Arc::new(History::open(&data_dir.join("history.sqlite"))?);
            let handle = app.handle().clone();
            let emit: engine::Emit = Arc::new(move |event, payload| {
                let _ = handle.emit(event, payload);
            });
            let engine = Engine::new(emit, history.clone(), data_dir.join("logs"), data_dir.join("rclone.conf"));
            app.manage(AppState {
                config: RwLock::new(config),
                config_dir: data_dir,
                history,
                engine,
                server_checks: locations::ServerChecks::default(),
            });
            scheduler::start(app.handle().clone());
            watch::volumes(app.handle().clone());
            watch::servers(app.handle().clone());

            if let Some(popover) = app.get_webview_window(POPOVER) {
                glass::apply(&popover, POPOVER_RADIUS)?;
            }
            if let Some(main) = app.get_webview_window(MAIN) {
                glass::apply(&main, 0.0)?;
                // While developing, the window comes up right away instead of
                // waiting for a click on the menu bar icon.
                #[cfg(debug_assertions)]
                {
                    main.show()?;
                    main.set_focus()?;
                }
            }
            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // The popover behaves like a menu: it goes away when it loses focus.
            WindowEvent::Focused(false) if window.label() == POPOVER => {
                let _ = window.hide();
            }
            // Closing the main window hides it; clonq keeps running in the menu bar.
            WindowEvent::CloseRequested { api, .. } if window.label() == MAIN => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::live_runs,
            commands::latest_runs,
            commands::recent_runs,
            commands::job_stats,
            commands::overview,
            commands::set_ui_settings,
            commands::run_job,
            commands::cancel_job,
            commands::open_main_window,
            commands::quit,
            commands::run_entries,
            setup::mounted_volumes,
            setup::location_statuses,
            setup::add_folder_location,
            setup::add_volume_location,
            setup::prepare_server,
            setup::install_server_key,
            setup::test_server,
            setup::add_smb_location,
            setup::connect_location,
            setup::cloud_providers,
            setup::add_cloud_location,
            setup::add_server_location,
            setup::test_location,
            setup::rename_location,
            setup::remove_location,
            setup::list_folders,
            setup::create_folder,
            setup::save_job,
            setup::delete_job,
            setup::set_job_enabled,
            setup::job_defaults,
        ])
        .run(tauri::generate_context!())
        .expect("error while running clonq");
}
