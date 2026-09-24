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
use crate::config::{ARCHIVE_DIR, Config, Job, Language, LocationKind, Mode};
use crate::engine::RunOptions;
use crate::history::{Run, RunStatus};
use crate::report;
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
    pub const VERIFY: &str = "verifyScheduled";
}

#[derive(Default)]
pub struct Scheduler {
    /// Last source change seen per job, until the quiet time has passed.
    pending_changes: Mutex<HashMap<String, DateTime<Utc>>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Automatic starts that failed (location not reachable) wait until this
    /// time, or until a drive or server check changes the picture.
    backoff: Mutex<HashMap<String, Instant>>,
}

/// How long a job whose automatic start failed is left alone.
const BACKOFF: Duration = Duration::from_secs(300);

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
    let scheduler = app.state::<Scheduler>();
    if scheduler.backoff.lock().expect("backoff").get(job_id).is_some_and(|until| Instant::now() < *until) {
        return false;
    }
    let state = app.state::<AppState>();
    let config = state.config.read().expect("config lock").clone();
    if !config.job(job_id).is_some_and(|job| job.enabled) {
        return false;
    }
    // A job stopped by its safety rule waits for a person; it never retries by itself.
    if state.history.last_real_status(job_id).ok().flatten() == Some(RunStatus::Blocked) {
        return false;
    }
    // A Pro job without a licence that covers this version says so once, instead of failing quietly.
    if let Err(refused) = crate::licence::allows(&state.config_dir, &config, job_id) {
        scheduler.backoff.lock().expect("backoff").insert(job_id.to_string(), Instant::now() + BACKOFF);
        static TOLD: std::sync::Mutex<Option<HashSet<String>>> = std::sync::Mutex::new(None);
        if TOLD.lock().expect("told").get_or_insert_with(HashSet::new).insert(job_id.to_string()) {
            let name = config.job(job_id).map_or(job_id.to_string(), |job| job.name.clone());
            let _ = app.notification().builder().title(name).body(refused.to_string()).show();
        }
        return false;
    }
    match state.engine.start(&config, job_id, why, RunOptions::default()) {
        Ok(_) => {
            scheduler.backoff.lock().expect("backoff").remove(job_id);
            true
        }
        Err(error) => {
            // A running job is fine to retry soon; anything else (a drive not
            // connected, a server down) waits instead of retrying every tick.
            if !error.to_string().contains("already running") {
                scheduler.backoff.lock().expect("backoff").insert(job_id.to_string(), Instant::now() + BACKOFF);
            }
            false
        }
    }
}

/// Starts a scheduled integrity check. It waits while the job runs, needs Pro, and like a
/// failed automatic start leaves an unreachable job alone for a while.
fn fire_verify(app: &AppHandle, job_id: &str) {
    let scheduler = app.state::<Scheduler>();
    let key = format!("verify:{job_id}");
    if scheduler.backoff.lock().expect("backoff").get(&key).is_some_and(|until| Instant::now() < *until) {
        return;
    }
    let state = app.state::<AppState>();
    if !crate::licence::Store::new(&state.config_dir).pro() {
        return;
    }
    let config = state.config.read().expect("config lock").clone();
    if let Err(error) = state.engine.start(&config, job_id, reason::VERIFY, RunOptions { verify: true, ..Default::default() })
        && !error.to_string().contains("already running")
    {
        scheduler.backoff.lock().expect("backoff").insert(key, Instant::now() + BACKOFF);
    }
}

/// Drives or servers changed: jobs that were waiting may be reachable now.
pub fn reachability_changed(app: &AppHandle) {
    app.state::<Scheduler>().backoff.lock().expect("backoff").clear();
    rewatch(app);
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

/// Watchdog notices and the weekly report (Pro), looked at once a minute.
fn look_after(app: &AppHandle, config: &Config) {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = LAST.lock().expect("look after");
        if last.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
            return;
        }
        *last = Some(Instant::now());
    }
    let state = app.state::<AppState>();
    if !crate::licence::Store::new(&state.config_dir).pro() {
        return;
    }
    let now = Utc::now();
    let german = config.ui.language.resolved() == Language::De;
    let mut memory = report::Memory::load(&state.config_dir);
    let mut changed = false;
    for job in &config.jobs {
        let last_success = state.history.last_completed(&job.id).ok().flatten().and_then(|detail| detail.run.finished_at);
        let Some(days) = report::overdue_days(job, last_success, now) else { continue };
        // One notice per silence: a new success starts the count again.
        if memory.watchdog_told.get(&job.id) == Some(&last_success) {
            continue;
        }
        let body = if german { format!("Seit {days} Tagen keine erfolgreiche Sicherung.") } else { format!("No successful backup for {days} days.") };
        let _ = app.notification().builder().title(&job.name).body(body).show();
        memory.watchdog_told.insert(job.id.clone(), last_success);
        changed = true;
    }
    if config.ui.weekly_report && !config.jobs.is_empty() && report::report_due(memory.report_sent, now.with_timezone(&Local))
        && let Ok(week) = report::weekly(&state.history, config, now)
    {
        let title = if german { "clonq – Wochenbericht" } else { "clonq – weekly report" };
        let _ = app.notification().builder().title(title).body(report::summary(&week, german)).show();
        memory.report_sent = Some(now);
        changed = true;
    }
    if changed {
        memory.save(&state.config_dir);
    }
}

fn tick(app: &AppHandle) {
    let config = config(app);
    look_after(app, &config);
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
            continue;
        }
        // The first check waits for a first real run; before it there is nothing to compare.
        if let Some(days) = job.triggers.verify_every_days.filter(|d| *d > 0)
            && history.has_completed(&job.id).unwrap_or(false)
            && every_due(history.last_verify(&job.id).ok().flatten(), days.saturating_mul(24 * 60), now)
        {
            fire_verify(app, &job.id);
        }
    }
    // Source changes whose quiet time is over.
    let scheduler = app.state::<Scheduler>();
    let due: Vec<String> = {
        let mut pending = scheduler.pending_changes.lock().expect("pending");
        // A run that started after the change (for any reason) already covered it.
        pending.retain(|job_id, seen| history.last_started(job_id).ok().flatten().is_none_or(|started| started < *seen));
        pending
            .iter()
            .filter(|(job_id, seen)| {
                config
                    .job(job_id)
                    .and_then(|job| job.triggers.on_change_after_seconds)
                    .and_then(|quiet| i64::try_from(quiet).ok())
                    .is_some_and(|quiet| now - **seen >= chrono::Duration::seconds(quiet))
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
    let Some(interval) = i64::try_from(minutes).ok().and_then(chrono::Duration::try_minutes) else { return false };
    match last {
        None => true,
        Some(last) => now - last >= interval,
    }
}

/// Daily at a local time: due once the time has passed today and the job has
/// not started since. A Mac that slept through the time catches up on waking.
pub fn daily_due(last: Option<DateTime<Utc>>, at: NaiveTime, now: DateTime<Local>) -> bool {
    let naive = now.date_naive().and_time(at);
    // In the spring-forward gap the time does not exist; the first valid moment after it counts.
    let Some(today_at) = Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&(naive + chrono::Duration::hours(1))).earliest())
    else {
        return false;
    };
    if now < today_at {
        return false;
    }
    last.is_none_or(|last| last < today_at.with_timezone(&Utc))
}

/// Rebuilds the watchers for jobs with a change trigger: the source, and for a two-way
/// job the target as well, since changes there must reach the source too.
///
/// No event is ever dropped, not even while the job runs: a change made during a run
/// would otherwise wait for the next trigger. The run's own writes therefore cause one
/// follow-up run, which finds nothing to do and writes nothing (measured with rclone
/// bisync 1.75.1: an idle run touches no file and no folder), so it does not loop.
fn rewatch(app: &AppHandle) {
    let config = config(app);
    let watched = watch_roots(&config, &locations::mounted_volumes());
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
                pending.insert(job_id.clone(), Utc::now());
            }
        }
    });
    let Ok(mut watcher) = watcher else { return };
    for (_, path, _) in &watched {
        let _ = watcher.watch(path, RecursiveMode::Recursive);
    }
    *slot = Some(watcher);
}

/// The folders to watch: (job, folder, excluded folder names) for every enabled job with a
/// change trigger, both ends of a two-way job, only those on this Mac.
fn watch_roots(config: &Config, volumes: &[locations::MountedVolume]) -> Vec<(String, PathBuf, Vec<String>)> {
    let mut watched = Vec::new();
    for job in config.jobs.iter().filter(|job| job.enabled && job.triggers.on_change_after_seconds.is_some()) {
        let mut sides = vec![&job.source];
        if job.mode == Mode::Bidirectional {
            sides.push(&job.target);
        }
        for side in sides {
            if let Ok(Resolved::Local(path)) = locations::resolve(side, config, volumes)
                && path.is_dir()
            {
                watched.push((job.id.clone(), path, excluded_folders(job)));
            }
        }
    }
    watched
}

/// Folder names from exclude patterns like `node_modules/` or `/WORK/`, and always the
/// archive, which only runs write to.
fn excluded_folders(job: &Job) -> Vec<String> {
    job.excludes
        .iter()
        .filter(|pattern| pattern.ends_with('/') && !pattern.contains('*'))
        .map(|pattern| pattern.trim_matches('/').to_string())
        .filter(|name| !name.is_empty())
        .chain([ARCHIVE_DIR.to_string()])
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
    let config = config(app);
    // Every finished real run measures its target, for the report's "full in N days".
    if !run.dry_run && run.status.completed()
        && let Some(job) = config.job(&run.job_id).cloned()
    {
        let state = app.state::<AppState>();
        let (history, rclone_config, measured) = (state.history.clone(), state.config_dir.join("rclone.conf"), config.clone());
        tauri::async_runtime::spawn(async move {
            report::record_space(&history, &job, &measured, &rclone_config, Utc::now()).await;
        });
    }
    let german = config.ui.language.resolved() == Language::De;
    // A scheduled integrity check speaks up only when it found something or could not finish.
    if run.trigger == reason::VERIFY {
        let body = match (run.status, german) {
            (RunStatus::Partial, false) => "Integrity check: files differ in content. Please check in clonq.",
            (RunStatus::Partial, true) => "Prüflauf: Dateien unterscheiden sich im Inhalt. Bitte in clonq nachsehen.",
            (RunStatus::Failed, false) => "Integrity check failed. The reason is in the history.",
            (RunStatus::Failed, true) => "Prüflauf fehlgeschlagen. Der Grund steht im Verlauf.",
            _ => return,
        };
        let name = config.job(&run.job_id).map_or(run.job_id.clone(), |job| job.name.clone());
        let _ = app.notification().builder().title(name).body(body).show();
        return;
    }
    if run.dry_run {
        return;
    }
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
    let body = match (run.status, german) {
        (RunStatus::Blocked, false) => "Stopped: the deletion limit was reached. Please check in clonq.",
        (RunStatus::Blocked, true) => "Gestoppt: Die Schutzschwelle hat angeschlagen. Bitte in clonq nachsehen.",
        (RunStatus::Failed, false) => "Failed. The reason is in the history.",
        (RunStatus::Failed, true) => "Fehlgeschlagen. Der Grund steht im Verlauf.",
        (RunStatus::Partial, false) => "Finished with warnings. Some files were skipped.",
        (RunStatus::Partial, true) => "Mit Warnungen beendet. Einzelne Dateien wurden übersprungen.",
        (RunStatus::Succeeded, false) if config.ui.notify_success => "Finished successfully.",
        (RunStatus::Succeeded, true) if config.ui.notify_success => "Erfolgreich abgeschlossen.",
        _ => return,
    };
    let _ = app.notification().builder().title(name).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_way_jobs_watch_both_ends_one_way_jobs_only_the_source() {
        let root = std::env::temp_dir().join(format!("clonq-watch-{}", uuid::Uuid::new_v4()));
        for dir in ["a", "b", "c", "d"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        let mut config: Config = serde_json::from_str(r#"{"version":2,"rsyncPath":"/opt/homebrew/bin/rsync"}"#).unwrap();
        config.locations.push(crate::config::Location {
            id: "root".into(),
            name: "Root".into(),
            kind: LocationKind::Folder { path: root.to_string_lossy().into_owned() },
        });
        let job = |id: &str, mode: Mode, source: &str, target: &str| -> Job {
            let mut job: Job = serde_json::from_value(serde_json::json!({
                "id": id, "name": id, "enabled": true,
                "source": { "location": "root", "path": source },
                "target": { "location": "root", "path": target },
                "mode": mode, "excludes": [], "ring": null, "safety": { "maxDeletePercent": 10, "alwaysAllowedDeletions": 10 },
                "triggers": { "onMount": false, "onChangeAfterSeconds": 10, "everyMinutes": null, "dailyAt": null, "afterJob": null }
            }))
            .unwrap();
            job.enabled = true;
            job
        };
        config.jobs.push(job("two", Mode::Bidirectional, "a", "b"));
        config.jobs.push(job("one", Mode::Mirror, "c", "d"));
        let roots = watch_roots(&config, &[]);
        let of = |id: &str| roots.iter().filter(|(job, _, _)| job == id).map(|(_, path, _)| path.clone()).collect::<Vec<_>>();
        assert_eq!(of("two"), vec![root.join("a"), root.join("b")]);
        assert_eq!(of("one"), vec![root.join("c")]);
        // The archive is written by runs only; changes in it never start one.
        assert!(roots.iter().all(|(_, _, excluded)| excluded.iter().any(|name| name == ARCHIVE_DIR)));
        assert!(is_excluded(&root.join("b/.clonq-archiv/2026/x.txt"), &root.join("b"), &roots[1].2));
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn every_counts_from_the_last_start() {
        let now = utc("2026-09-23T12:00:00Z");
        assert!(!every_due(Some(now), u64::MAX, now), "a huge interval is never due and never panics");
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
    fn daily_time_in_the_spring_forward_gap_still_fires() {
        // Europe/Berlin skips 02:00–03:00 on 2027-03-28; only meaningful in such a zone.
        let at = NaiveTime::from_hms_opt(2, 30, 0).unwrap();
        let naive = chrono::NaiveDate::from_ymd_opt(2027, 3, 28).unwrap().and_hms_opt(10, 0, 0).unwrap();
        let Some(later) = Local.from_local_datetime(&naive).earliest() else { return };
        assert!(daily_due(None, at, later));
    }

    #[test]
    fn excluded_folders_do_not_count_as_changes() {
        let root = Path::new("/Users/m/Desktop/WORK");
        let excluded = vec!["node_modules".to_string(), "WORK".to_string()];
        assert!(is_excluded(Path::new("/Users/m/Desktop/WORK/app/node_modules/x/y.js"), root, &excluded));
        assert!(!is_excluded(Path::new("/Users/m/Desktop/WORK/app/src/main.rs"), root, &excluded));
    }
}
