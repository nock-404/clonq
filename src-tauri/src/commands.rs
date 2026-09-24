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

/// The last seven days: runs, data and space per target, with the watchdog's verdict.
#[tauri::command]
pub fn weekly_report(state: State<'_, AppState>) -> Result<crate::report::WeeklyReport> {
    let config = state.config.read().expect("config lock").clone();
    crate::report::weekly(&state.history, &config, chrono::Utc::now())
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
    crate::licence::allows(&state.config_dir, &config, &job_id)?;
    state.engine.start(&config, &job_id, "manual", RunOptions { dry_run, force, ..Default::default() })
}

/// Compares source and target by content (Pro); changes nothing on either side.
#[tauri::command]
pub fn verify_job(state: State<'_, AppState>, job_id: String) -> Result<String> {
    let config = state.config.read().expect("config lock").clone();
    crate::licence::allows_check(&state.config_dir)?;
    crate::licence::allows(&state.config_dir, &config, &job_id)?;
    state.engine.start(&config, &job_id, "verify", RunOptions { verify: true, ..Default::default() })
}

/// Repairs what the last integrity check found (Pro); nothing is lost, see RunOptions::repair.
#[tauri::command]
pub fn repair_job(state: State<'_, AppState>, job_id: String) -> Result<String> {
    let config = state.config.read().expect("config lock").clone();
    crate::licence::allows_check(&state.config_dir)?;
    crate::licence::allows(&state.config_dir, &config, &job_id)?;
    state.engine.start(&config, &job_id, "repair", RunOptions { repair: true, ..Default::default() })
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<()> {
    if state.engine.cancel(&job_id) {
        Ok(())
    } else {
        Err(Error::Job(format!("{job_id} is not running")))
    }
}

pub const EVENT_SHOW_JOB: &str = "show-job";

/// Brings up the main window, optionally with one job selected.
#[tauri::command]
pub fn open_main_window(app: AppHandle, job_id: Option<String>) -> Result<()> {
    if let Some(popover) = app.get_webview_window(POPOVER) {
        popover.hide()?;
    }
    crate::show_main(&app)?;
    if let Some(job_id) = job_id {
        app.emit_to(MAIN, EVENT_SHOW_JOB, job_id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

/// What the settings show about clonq Pro.
#[tauri::command]
pub fn licence_status(state: State<'_, AppState>) -> crate::licence::Status {
    crate::licence::Store::new(&state.config_dir).status()
}

/// Checks and saves a pasted licence key.
#[tauri::command]
pub fn enter_licence(state: State<'_, AppState>, key: String) -> Result<crate::licence::Status> {
    crate::licence::Store::new(&state.config_dir).enter(&key).map_err(|error| Error::Job(error.message().into()))
}

#[tauri::command]
pub fn remove_licence(state: State<'_, AppState>) -> crate::licence::Status {
    let store = crate::licence::Store::new(&state.config_dir);
    store.remove();
    store.status()
}

/// File in the app data folder that asks the next start to open the main window.
pub const REOPEN_MARKER: &str = "reopen-main-window";

/// Called right before an update restarts clonq: remembers whether the main window was open.
#[tauri::command]
pub fn prepare_restart(app: AppHandle) -> Result<()> {
    let open = app.get_webview_window(MAIN).is_some_and(|main| main.is_visible().unwrap_or(false));
    let marker = app.path().app_data_dir()?.join(REOPEN_MARKER);
    if open {
        std::fs::write(marker, b"")?;
    }
    Ok(())
}

/// One page of a run's file list, for the run sheet in the history.
#[tauri::command]
pub fn run_entries(
    state: State<'_, AppState>,
    run_id: String,
    kind: Option<crate::runlog::EntryKind>,
    query: String,
    offset: usize,
    limit: usize,
) -> Result<crate::runlog::Page> {
    let path = state.history.log_path(&run_id)?.ok_or_else(|| Error::Job(format!("run {run_id} does not exist")))?;
    let path = std::path::PathBuf::from(path);
    if !path.exists() {
        return Ok(crate::runlog::Page { entries: vec![], total: 0 });
    }
    crate::runlog::read(&path, kind, &query, offset, limit.clamp(1, 2000))
}

fn job_and_config(state: &AppState, job_id: &str) -> Result<(crate::config::Job, crate::config::Config)> {
    let config = state.config.read().expect("config lock").clone();
    let job = config.job(job_id).ok_or_else(|| Error::Job(format!("job {job_id} does not exist")))?.clone();
    Ok((job, config))
}

#[tauri::command]
pub async fn archive_snapshots(state: State<'_, AppState>, job_id: String, side: Option<crate::archive::Side>) -> Result<Vec<crate::archive::Snapshot>> {
    let (job, config) = job_and_config(&state, &job_id)?;
    crate::archive::snapshots(&job, &config, &state.config_dir.join("rclone.conf"), side.unwrap_or_default()).await
}

#[tauri::command]
pub async fn archive_files(state: State<'_, AppState>, job_id: String, side: Option<crate::archive::Side>, stamp: String) -> Result<Vec<crate::archive::ArchivedFile>> {
    let (job, config) = job_and_config(&state, &job_id)?;
    crate::archive::files(&job, &config, &state.config_dir.join("rclone.conf"), side.unwrap_or_default(), &stamp).await
}

/// The snapshots of a versioned job, newest first.
#[tauri::command]
pub async fn version_snapshots(state: State<'_, AppState>, job_id: String) -> Result<Vec<String>> {
    let (job, config) = job_and_config(&state, &job_id)?;
    crate::archive::version_list(&job, &config).await
}

/// Restores a snapshot or one file of it into a new folder in Downloads and returns that folder.
#[tauri::command]
pub async fn restore_archive(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    side: Option<crate::archive::Side>,
    stamp: String,
    path: Option<String>,
) -> Result<String> {
    let (job, config) = job_and_config(&state, &job_id)?;
    let downloads = app.path().download_dir()?;
    let rclone = state.config_dir.join("rclone.conf");
    let folder = crate::archive::restore(&job, &config, &rclone, side.unwrap_or_default(), &downloads, &stamp, path.as_deref()).await?;
    Ok(folder.to_string_lossy().into_owned())
}

fn browse_context(state: &AppState) -> (crate::config::Config, std::path::PathBuf) {
    (state.config.read().expect("config lock").clone(), state.config_dir.join("rclone.conf"))
}

#[tauri::command]
pub async fn browse_list(state: State<'_, AppState>, location: String, path: String) -> Result<Vec<crate::browse::BrowseEntry>> {
    let (config, rclone) = browse_context(&state);
    crate::browse::list(&crate::config::Place { location, path }, &config, &rclone).await
}

#[tauri::command]
pub async fn browse_preview(state: State<'_, AppState>, location: String, path: String) -> Result<crate::browse::Preview> {
    let (config, rclone) = browse_context(&state);
    crate::browse::preview(&crate::config::Place { location, path }, &config, &rclone).await
}

/// Copies into Downloads/clonq-dateien and returns the copy's path.
#[tauri::command]
pub async fn browse_download(app: AppHandle, state: State<'_, AppState>, location: String, path: String) -> Result<String> {
    let (config, rclone) = browse_context(&state);
    let name = config.location(&location).map(|l| l.name.clone()).unwrap_or_else(|| location.clone());
    let downloads = app.path().download_dir()?;
    let copy = crate::browse::download(&crate::config::Place { location, path }, &config, &rclone, &downloads, &name).await?;
    Ok(copy.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn browse_rename(state: State<'_, AppState>, location: String, path: String, new_name: String) -> Result<()> {
    let (config, rclone) = browse_context(&state);
    crate::browse::rename(&crate::config::Place { location, path }, new_name.trim(), &config, &rclone).await
}

#[tauri::command]
pub async fn browse_delete(state: State<'_, AppState>, location: String, path: String) -> Result<()> {
    let (config, rclone) = browse_context(&state);
    crate::browse::delete(&crate::config::Place { location, path }, &config, &rclone).await
}
