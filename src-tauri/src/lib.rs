mod archive;
mod browse;
mod cloud;
mod commands;
mod config;
mod engine;
mod error;
mod glass;
mod history;
mod licence;
mod locations;
mod report;
#[cfg(test)]
mod box_tests;
#[cfg(test)]
mod matrix_tests;
mod rclone_output;
mod rsync_output;
mod runlog;
mod scheduler;
mod setup;
mod smb;
mod ssh;
mod stats;
mod tray;
mod versions;
mod watch;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

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
    /// Host keys seen while adding a server, until the user confirms them.
    pub pending_host_keys: std::sync::Mutex<std::collections::HashMap<String, Vec<ssh::HostKey>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            ssh::set_known_hosts(data_dir.join("known_hosts"));
            let mut config = Config::load_or_init(&data_dir)?;
            use_bundled_tools(&mut config);
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
                pending_host_keys: std::sync::Mutex::default(),
            });
            scheduler::start(app.handle().clone());
            watch::volumes(app.handle().clone());
            watch::servers(app.handle().clone());
            watch::licence(app.handle().clone());

            if let Some(popover) = app.get_webview_window(POPOVER) {
                glass::apply(&popover, POPOVER_RADIUS)?;
            }
            if let Some(main) = app.get_webview_window(MAIN) {
                glass::apply(&main, 0.0)?;
                // While developing, the window comes up right away instead of
                // waiting for a click on the menu bar icon.
                #[cfg(debug_assertions)]
                show_main(app.handle())?;
                // After an update the window comes back if it was open when the update began.
                let marker = app.path().app_data_dir()?.join(commands::REOPEN_MARKER);
                if marker.exists() {
                    let _ = std::fs::remove_file(&marker);
                    show_main(app.handle())?;
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
            // Closing the main window hides it; clonq keeps running in the menu bar
            // and leaves the Dock until the window comes back.
            WindowEvent::CloseRequested { api, .. } if window.label() == MAIN => {
                api.prevent_close();
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                let _ = window.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
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
            commands::verify_job,
            commands::repair_job,
            commands::weekly_report,
            commands::encryption_key,
            commands::licence_covers_update,
            commands::licence_pro,
            commands::cancel_job,
            commands::open_main_window,
            commands::quit,
            commands::prepare_restart,
            commands::licence_status,
            commands::enter_licence,
            commands::remove_licence,
            commands::run_entries,
            commands::archive_snapshots,
            commands::archive_files,
            commands::restore_archive,
            commands::version_snapshots,
            commands::browse_list,
            commands::browse_preview,
            commands::browse_download,
            commands::browse_rename,
            commands::browse_delete,
            setup::mounted_volumes,
            setup::location_statuses,
            setup::add_folder_location,
            setup::add_volume_location,
            setup::prepare_server,
            setup::trust_server,
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
        .build(tauri::generate_context!())
        .expect("error while building clonq")
        .run(|app, event| {
            // A click on the Dock icon brings the window back, e.g. after it was minimised.
            if let tauri::RunEvent::Reopen { .. } = event {
                let _ = show_main(app);
            }
        });
}

/// rsync and rclone ship inside clonq.app next to the main program; they win over the paths
/// in the config, which point at Homebrew for configs written before they were bundled.
fn use_bundled_tools(config: &mut Config) {
    let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(PathBuf::from)) else { return };
    for (name, path) in [("rsync", &mut config.rsync_path), ("rclone", &mut config.rclone_path)] {
        let bundled = dir.join(name);
        if bundled.is_file() {
            *path = bundled.to_string_lossy().into_owned();
        }
    }
}

/// Shows the main window. While it is open, clonq also sits in the Dock and in ⌘Tab.
pub fn show_main(app: &AppHandle) -> tauri::Result<()> {
    let Some(main) = app.get_webview_window(MAIN) else { return Ok(()) };
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Regular)?;
    main.show()?;
    main.set_focus()
}
