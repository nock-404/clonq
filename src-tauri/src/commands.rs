//! What the frontend can call. Every command goes through `AppState`.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::config::{Config, UiSettings};
use crate::engine::{LiveRun, RunOptions};
use crate::error::{Error, Result};
use crate::history::Run;
use crate::stats::{self, JobStats, Overview};

pub const EVENT_CONFIG_CHANGED: &str = "config-changed";
use crate::{AppState, MAIN, POPOVER};

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Config {
    state.config.read().expect("config lock").clone()
}

#[tauri::command]
pub fn live_runs(state: State<'_, AppState>) -> Vec<LiveRun> {
    state.engine.live_runs()
}

#[tauri::command]
pub fn latest_runs(state: State<'_, AppState>) -> Result<Vec<Run>> {
    state.history.latest_per_job()
}

#[tauri::command]
pub fn recent_runs(state: State<'_, AppState>, limit: i64) -> Result<Vec<Run>> {
    state.history.recent(limit.clamp(1, 1000))
}

#[tauri::command]
pub fn job_stats(state: State<'_, AppState>, job_id: String) -> Result<JobStats> {
    stats::job_stats(&state.history, &job_id, chrono::Utc::now())
}

#[tauri::command]
pub fn overview(state: State<'_, AppState>) -> Result<Overview> {
    let job_ids: Vec<String> = state.config.read().expect("config lock").jobs.iter().map(|job| job.id.clone()).collect();
    stats::overview(&state.history, &job_ids, chrono::Utc::now())
}

#[tauri::command]
pub fn set_ui_settings(app: AppHandle, state: State<'_, AppState>, settings: UiSettings) -> Result<Config> {
    let config = {
        let mut config = state.config.write().expect("config lock");
        config.ui = settings;
        config.save(&state.config_dir)?;
        config.clone()
    };
    app.emit(EVENT_CONFIG_CHANGED, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn run_job(state: State<'_, AppState>, job_id: String, dry_run: bool, force: bool) -> Result<String> {
    let config = state.config.read().expect("config lock").clone();
    state.engine.start(&config, &job_id, "manual", RunOptions { dry_run, force })
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<()> {
    if state.engine.cancel(&job_id) {
        Ok(())
    } else {
        Err(Error::Job(format!("{job_id} is not running")))
    }
}

#[tauri::command]
pub fn open_main_window(app: AppHandle) -> Result<()> {
    if let Some(popover) = app.get_webview_window(POPOVER) {
        popover.hide()?;
    }
    let main = app
        .get_webview_window(MAIN)
        .ok_or_else(|| Error::Job("main window missing".into()))?;
    main.show()?;
    main.set_focus()?;
    Ok(())
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
