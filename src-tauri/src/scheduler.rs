//! Starts enabled jobs by themselves: on a schedule, daily at a time, when a
//! drive is connected, when the source changes, or after another job.

use chrono::{DateTime, Local, NaiveTime, TimeZone, Utc};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Listener, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::AppState;
use crate::commands::EVENT_CONFIG_CHANGED;
use crate::config::{Config, Job, LocationKind};
use crate::engine::RunOptions;
use crate::history::{Run, RunStatus};
use crate::locations::{self, Resolved};

const TICK: Duration = Duration::from_secs(2);
/// A drive gets a moment to settle before a job touches it.
const MOUNT_SETTLE: Duration = Duration::from_secs(3);

/// Why a job started; stored with the run and shown in the history.
pub mod reason {
    pub const SCHEDULE: &str = "schedule";
    pub const DAILY: &str = "daily";
    pub const MOUNT: &str = "mount";
    pub const CHANGE: &str = "change";
    pub const CHAIN: &str = "chain";
}

#[derive(Default)]
pub struct Scheduler {
    /// Source change seen at, per job, until the quiet time has passed.
    pending_changes: Mutex<HashMap<String, Instant>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

pub fn start(app: AppHandle) {
    app.manage(Scheduler::default());
    rewatch(&app);
    let listener = app.clone();
    app.listen_any(EVENT_CONFIG_CHANGED, move |_| rewatch(&listener));

    let ticker = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tick(&ticker);
            tokio::time::sleep(TICK).await;
        }
    });

    let follower = app.clone();
    let mut finished = app.state::<AppState>().engine.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(run) = finished.recv().await {
            after_run(&follower, &run);
        }
    });
}

fn config(app: &AppHandle) -> Config {
    app.state::<AppState>().config.read().expect("config lock").clone()
}

/// Starts a job if it is enabled; a job that is running or unreachable is skipped quietly.
fn fire(app: &AppHandle, job_id: &str, why: &str) -> bool {
    let state = app.state::<AppState>();
    let config = state.config.read().expect("config lock").clone();
    if !config.job(job_id).is_some_and(|job| job.enabled) {
        return false;
    }
    // A job stopped by its safety rule waits for a person; it never retries by itself.
    if state.history.last_real_status(job_id).ok().flatten() == Some(RunStatus::Blocked) {
        return false;
    }
    state.engine.start(&config, job_id, why, RunOptions::default()).is_ok()
}

/// Called by the volume watcher with the drives that just appeared.
pub fn volumes_mounted(app: &AppHandle, uuids: &HashSet<String>) {
    let config = config(app);
    let jobs: Vec<String> = config
        .jobs
        .iter()
        .filter(|job| job.enabled && job.triggers.on_mount)
        .filter(|job| {
            [&job.source, &job.target].iter().any(|place| {
                matches!(config.location(&place.location).map(|l| &l.kind),
                    Some(LocationKind::Volume { volume_uuid, .. }) if uuids.contains(volume_uuid))
            })
        })
        .map(|job| job.id.clone())
        .collect();
    if jobs.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(MOUNT_SETTLE).await;
        for job in jobs {
            fire(&app, &job, reason::MOUNT);
        }
    });
}

fn tick(app: &AppHandle) {
    let config = config(app);
    let now = Utc::now();
    let history = app.state::<AppState>().history.clone();
    for job in config.jobs.iter().filter(|job| job.enabled) {
        let last = history.last_started(&job.id).ok().flatten();
        if let Some(minutes) = job.triggers.every_minutes.filter(|m| *m > 0)
            && every_due(last, minutes, now)
        {
            fire(app, &job.id, reason::SCHEDULE);
            continue;
        }
        if let Some(at) = job.triggers.daily_at.as_deref().and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok())
            && daily_due(last, at, now.with_timezone(&Local))
        {
            fire(app, &job.id, reason::DAILY);
        }
    }
    // Source changes whose quiet time is over.
    let scheduler = app.state::<Scheduler>();
    let due: Vec<String> = {
        let pending = scheduler.pending_changes.lock().expect("pending");
        pending
            .iter()
            .filter(|(job_id, seen)| {
                config
                    .job(job_id)
                    .and_then(|job| job.triggers.on_change_after_seconds)
                    .is_some_and(|quiet| seen.elapsed() >= Duration::from_secs(quiet))
            })
            .map(|(job_id, _)| job_id.clone())
            .collect()
    };
    for job_id in due {
        // Keep it pending while the job is busy; it runs once the current run ends.
        if fire(app, &job_id, reason::CHANGE) || config.job(&job_id).is_none_or(|job| !job.enabled) {
            scheduler.pending_changes.lock().expect("pending").remove(&job_id);
        }
    }
}

/// Every N minutes, counted from the last start of the job (any trigger).
pub fn every_due(last: Option<DateTime<Utc>>, minutes: u64, now: DateTime<Utc>) -> bool {
    match last {
        None => true,
        Some(last) => now - last >= chrono::Duration::minutes(minutes as i64),
    }
}

/// Daily at a local time: due once the time has passed today and the job has
/// not started since. A Mac that slept through the time catches up on waking.
pub fn daily_due(last: Option<DateTime<Utc>>, at: NaiveTime, now: DateTime<Local>) -> bool {
    let Some(today_at) = Local.from_local_datetime(&now.date_naive().and_time(at)).earliest() else { return false };
    if now < today_at {
        return false;
    }
    last.is_none_or(|last| last < today_at.with_timezone(&Utc))
}

/// Rebuilds the source watchers for jobs with a change trigger.
fn rewatch(app: &AppHandle) {
    let config = config(app);
    let volumes = locations::mounted_volumes();
    let mut watched: Vec<(String, PathBuf, Vec<String>)> = Vec::new();
    for job in config.jobs.iter().filter(|job| job.enabled && job.triggers.on_change_after_seconds.is_some()) {
        if let Ok(Resolved::Local(path)) = locations::resolve(&job.source, &config, &volumes)
            && path.is_dir()
        {
            watched.push((job.id.clone(), path, excluded_folders(job)));
        }
    }
    let scheduler = app.state::<Scheduler>();
    let mut slot = scheduler.watcher.lock().expect("watcher");
    *slot = None;
    if watched.is_empty() {
        return;
    }
    let handler_app = app.clone();
    let targets = watched.clone();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let scheduler = handler_app.state::<Scheduler>();
        let mut pending = scheduler.pending_changes.lock().expect("pending");
        for (job_id, root, excluded) in &targets {
            if event.paths.iter().any(|path| path.starts_with(root) && !is_excluded(path, root, excluded)) {
                pending.insert(job_id.clone(), Instant::now());
            }
        }
    });
    let Ok(mut watcher) = watcher else { return };
    for (_, path, _) in &watched {
        let _ = watcher.watch(path, RecursiveMode::Recursive);
    }
    *slot = Some(watcher);
}

/// Folder names from exclude patterns like `node_modules/` or `/WORK/`.
fn excluded_folders(job: &Job) -> Vec<String> {
    job.excludes
        .iter()
        .filter(|pattern| pattern.ends_with('/') && !pattern.contains('*'))
        .map(|pattern| pattern.trim_matches('/').to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

fn is_excluded(path: &Path, root: &Path, excluded: &[String]) -> bool {
    let Ok(relative) = path.strip_prefix(root) else { return false };
    let relative = relative.to_string_lossy();
    excluded.iter().any(|folder| {
        let folder = folder.as_str();
        relative.split('/').any(|part| part == folder) || relative.starts_with(&format!("{folder}/"))
    })
}

/// Chained jobs and notifications once a run has ended.
fn after_run(app: &AppHandle, run: &Run) {
    if run.dry_run {
        return;
    }
    let config = config(app);
    if run.status.completed() {
        for job in config.jobs.iter().filter(|job| job.enabled && job.triggers.after_job.as_deref() == Some(run.job_id.as_str())) {
            fire(app, &job.id, reason::CHAIN);
        }
    }
    // A run someone started by hand is watched anyway; automatic ones are announced.
    if run.trigger == "manual" {
        return;
    }
    let name = config.job(&run.job_id).map_or(run.job_id.clone(), |job| job.name.clone());
    let body = match run.status {
        RunStatus::Blocked => "Gestoppt: Die Schutzschwelle hat angeschlagen. Bitte in clonq nachsehen.",
        RunStatus::Failed => "Fehlgeschlagen. Der Grund steht im Verlauf.",
        RunStatus::Partial => "Mit Warnungen beendet. Einzelne Dateien wurden übersprungen.",
        RunStatus::Succeeded if config.ui.notify_success => "Erfolgreich abgeschlossen.",
        _ => return,
    };
    let _ = app.notification().builder().title(name).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn every_counts_from_the_last_start() {
        let now = utc("2026-09-23T12:00:00Z");
        assert!(every_due(None, 60, now));
        assert!(!every_due(Some(utc("2026-09-23T11:30:00Z")), 60, now));
        assert!(every_due(Some(utc("2026-09-23T11:00:00Z")), 60, now));
    }

    #[test]
    fn daily_runs_once_after_its_time_and_catches_up() {
        let at = NaiveTime::from_hms_opt(2, 0, 0).unwrap();
        let before = Local.with_ymd_and_hms(2026, 9, 23, 1, 30, 0).unwrap();
        let after = Local.with_ymd_and_hms(2026, 9, 23, 9, 0, 0).unwrap();
        let today_2 = Local.with_ymd_and_hms(2026, 9, 23, 2, 0, 5).unwrap().with_timezone(&Utc);
        let yesterday = Local.with_ymd_and_hms(2026, 9, 22, 2, 0, 5).unwrap().with_timezone(&Utc);
        assert!(!daily_due(Some(yesterday), at, before));
        assert!(daily_due(Some(yesterday), at, after), "slept through 02:00, runs at 09:00");
        assert!(!daily_due(Some(today_2), at, after), "already ran today");
        assert!(daily_due(None, at, after));
    }

    #[test]
    fn excluded_folders_do_not_count_as_changes() {
        let root = Path::new("/Users/m/Desktop/WORK");
        let excluded = vec!["node_modules".to_string(), "WORK".to_string()];
        assert!(is_excluded(Path::new("/Users/m/Desktop/WORK/app/node_modules/x/y.js"), root, &excluded));
        assert!(!is_excluded(Path::new("/Users/m/Desktop/WORK/app/src/main.rs"), root, &excluded));
    }
}
