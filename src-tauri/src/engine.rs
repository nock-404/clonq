//! Runs jobs through rsync: safety checks, the run itself, live progress, history.

use chrono::Utc;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::process::Command;
use tokio::sync::watch;

use crate::config::{ARCHIVE_DIR, Config, Job, Mode};
use crate::locations::{self, Resolved};
use crate::error::{Error, Result};
use crate::history::{FolderChange, History, Run, RunStatus, Sample};
use crate::cloud;
use crate::rclone_output::{self, Event};
use crate::rsync_output::{self, Change, Line, Stats};

pub const EVENT_RUN_UPDATE: &str = "run-update";
pub const EVENT_RUNS_CHANGED: &str = "runs-changed";

const EMIT_INTERVAL: Duration = Duration::from_millis(120);
/// One throughput sample per second while a run is going.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
/// The live curve shows the last minute.
const LIVE_SAMPLES: usize = 60;
/// Stored samples per run; longer runs are thinned to this many.
const STORED_SAMPLES: usize = 240;
/// Changed folders kept per run.
const STORED_FOLDERS: usize = 25;
/// The newest transferred paths the UI lists while a run is going.
const RECENT_PATHS: usize = 8;

/// What the UI sees of a run while it is going.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRun {
    pub run_id: String,
    pub job_id: String,
    pub dry_run: bool,
    pub phase: Phase,
    pub percent: f64,
    pub bytes: i64,
    pub bytes_per_second: f64,
    pub eta_seconds: Option<i64>,
    pub files_done: i64,
    pub files_total: Option<i64>,
    pub files_deleted: i64,
    pub files_new: i64,
    pub files_changed: i64,
    pub files_per_second: f64,
    /// Bytes per second, one value per second, oldest first.
    pub throughput: Vec<f64>,
    /// The newest transferred paths, newest first.
    pub recent_paths: Vec<String>,
    pub current_path: Option<String>,
    pub status: Option<RunStatus>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Dry run that decides whether the safety threshold allows the real run.
    Checking,
    Transferring,
    Finished,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RunOptions {
    pub dry_run: bool,
    /// Skips the deletion threshold, after the user saw what would be deleted.
    pub force: bool,
}

struct Active {
    live: LiveRun,
    cancel: watch::Sender<bool>,
}

/// Where the engine reports to: the app's event bus, or a collector in tests.
pub type Emit = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

#[derive(Clone)]
pub struct Engine {
    emit: Emit,
    history: Arc<History>,
    log_dir: PathBuf,
    /// clonq's own rclone config with one remote per cloud location.
    rclone_config: PathBuf,
    /// Every finished run, for chained jobs and notifications.
    finished: tokio::sync::broadcast::Sender<Run>,
    active: Arc<Mutex<HashMap<String, Active>>>,
}

impl Engine {
    pub fn new(emit: Emit, history: Arc<History>, log_dir: PathBuf, rclone_config: PathBuf) -> Self {
        let (finished, _) = tokio::sync::broadcast::channel(64);
        Self { emit, history, log_dir, rclone_config, finished, active: Arc::default() }
    }

    /// Finished runs, in order, as they end.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<Run> {
        self.finished.subscribe()
    }

    pub fn live_runs(&self) -> Vec<LiveRun> {
        let active = self.active.lock().expect("active lock");
        active.values().map(|entry| entry.live.clone()).collect()
    }

    pub fn cancel(&self, job_id: &str) -> bool {
        let active = self.active.lock().expect("active lock");
        match active.get(job_id) {
            Some(entry) => entry.cancel.send(true).is_ok(),
            None => false,
        }
    }

    /// Validates, registers and starts a run; returns its id right away.
    pub fn start(&self, config: &Config, job_id: &str, trigger: &str, options: RunOptions) -> Result<String> {
        let job = config
            .job(job_id)
            .ok_or_else(|| Error::Job(format!("no job with id {job_id}")))?
            .clone();
        let volumes = locations::mounted_volumes();
        let source = locations::resolve(&job.source, config, &volumes)?;
        let target = locations::resolve(&job.target, config, &volumes)?;
        let plan = Plan::new(&job, config, &self.rclone_config, &source, &target)?;

        let run_id = uuid::Uuid::new_v4().to_string();
        let run = Run {
            log_path: self.log_dir.join(format!("{run_id}.log")).to_string_lossy().into_owned(),
            id: run_id,
            job_id: job.id.clone(),
            trigger: trigger.to_string(),
            dry_run: options.dry_run,
            started_at: Utc::now(),
            finished_at: None,
            status: RunStatus::Running,
            files_total: 0,
            files_transferred: 0,
            files_new: 0,
            files_changed: 0,
            files_deleted: 0,
            bytes_transferred: 0,
            bytes_new: 0,
            bytes_changed: 0,
            source_bytes: 0,
            literal_bytes: 0,
            matched_bytes: 0,
            wire_bytes: 0,
            target_entries: 0,
            exit_code: None,
            message: None,
        };

        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut active = self.active.lock().expect("active lock");
            if active.contains_key(&job.id) {
                return Err(Error::Job(format!("{} is already running", job.name)));
            }
            let live = LiveRun {
                run_id: run.id.clone(),
                job_id: job.id.clone(),
                dry_run: options.dry_run,
                phase: Phase::Transferring,
                percent: 0.0,
                bytes: 0,
                bytes_per_second: 0.0,
                eta_seconds: None,
                files_done: 0,
                files_total: None,
                files_deleted: 0,
                files_new: 0,
                files_changed: 0,
                files_per_second: 0.0,
                throughput: Vec::new(),
                recent_paths: Vec::new(),
                current_path: None,
                status: Some(RunStatus::Running),
                message: None,
            };
            active.insert(job.id.clone(), Active { live, cancel: cancel_tx });
        }
        self.history.insert(&run)?;
        (self.emit)(EVENT_RUNS_CHANGED, serde_json::Value::Null);

        let engine = self.clone();
        let run_id = run.id.clone();
        tauri::async_runtime::spawn(async move {
            engine.execute(job, plan, run, options, cancel_rx).await;
        });
        Ok(run_id)
    }

    async fn execute(&self, job: Job, plan: Plan, mut run: Run, options: RunOptions, cancel: watch::Receiver<bool>) {
        let mut detail = Detail::default();
        let outcome = self.execute_inner(&job, &plan, &mut run, &mut detail, options, cancel).await;
        if let Err(error) = outcome {
            run.status = RunStatus::Failed;
            run.message = Some(error.to_string());
        }
        run.finished_at = Some(Utc::now());
        if let Err(error) = self.history.finish(&run, &detail.samples, &detail.folders) {
            run.message = Some(format!("{} (history not saved: {error})", run.message.unwrap_or_default()));
        }
        self.update(&job.id, |live| {
            live.phase = Phase::Finished;
            live.status = Some(run.status);
            live.message = run.message.clone();
            live.current_path = None;
            live.files_done = run.files_transferred;
            live.files_new = run.files_new;
            live.files_changed = run.files_changed;
            live.files_deleted = run.files_deleted;
            live.bytes = run.bytes_transferred;
        });
        self.emit(&job.id);
        self.active.lock().expect("active lock").remove(&job.id);
        (self.emit)(EVENT_RUNS_CHANGED, serde_json::Value::Null);
        let _ = self.finished.send(run);
    }

    async fn execute_inner(
        &self,
        job: &Job,
        plan: &Plan,
        run: &mut Run,
        detail: &mut Detail,
        options: RunOptions,
        mut cancel: watch::Receiver<bool>,
    ) -> Result<()> {
        plan.check_source()?;
        plan.check_target()?;
        tokio::fs::create_dir_all(&self.log_dir).await?;
        let log_file = tokio::fs::File::create(&run.log_path).await?;
        let mut log = BufWriter::new(log_file);
        log.write_all(format!("# {} {}\n", plan.program, plan.base_args.join(" ")).as_bytes()).await?;

        let mut max_delete = None;
        if job.mode == Mode::Mirror && !options.dry_run && !options.force {
            match self.history.last_target_entries(&job.id)? {
                Some(entries) => max_delete = Some(job.safety.allowed_deletions(entries)),
                None => {
                    // No earlier run to compare with: a dry run measures what would go.
                    self.update(&job.id, |live| live.phase = Phase::Checking);
                    self.emit(&job.id);
                    log.write_all(b"# safety check (dry run)\n").await?;
                    let check = self.rsync(&job.id, plan, &["--dry-run".into()], &mut log, &mut cancel, false).await?;
                    if check.cancelled {
                        run.status = RunStatus::Cancelled;
                        return Ok(());
                    }
                    if check.exit_code != Some(0) {
                        run.status = RunStatus::Failed;
                        run.exit_code = check.exit_code;
                        run.message = Some(check.error_summary());
                        return Ok(());
                    }
                    let (deleted, before) = match &plan.tool {
                        Tool::Rsync => (check.stats.deleted, check.stats.target_entries_before()),
                        Tool::Rclone { config } => {
                            (check.deleted_lines, cloud::count(&plan.program, config, &plan.target).await?)
                        }
                    };
                    let percent = if before > 0 { deleted as f64 * 100.0 / before as f64 } else { 0.0 };
                    let allowed = job.safety.allowed_deletions(before);
                    if deleted > allowed {
                        run.status = RunStatus::Blocked;
                        run.files_deleted = deleted;
                        run.target_entries = before;
                        run.message = Some(format!(
                            "would delete {deleted} of {before} entries on the target ({percent:.1} %), limit is {} %",
                            job.safety.max_delete_percent
                        ));
                        return Ok(());
                    }
                    self.update(&job.id, |live| live.phase = Phase::Transferring);
                }
            }
        }

        let mut extra = Vec::new();
        if options.dry_run {
            extra.push("--dry-run".to_string());
        } else if job.archive.enabled {
            extra.extend(plan.archive_args(&archive_stamp(run.started_at)));
        }
        if let Some(limit) = max_delete {
            extra.push(format!("--max-delete={limit}"));
        }
        let mut result = self.rsync(&job.id, plan, &extra, &mut log, &mut cancel, true).await?;
        log.flush().await?;

        run.exit_code = result.exit_code;
        run.files_total = result.stats.files;
        run.files_transferred = result.stats.regular_transferred;
        run.files_new = result.files_new;
        run.files_changed = result.files_changed;
        run.files_deleted = result.deleted_lines;
        run.bytes_transferred = result.stats.transferred_size;
        run.bytes_new = result.bytes_new;
        run.bytes_changed = result.bytes_changed;
        run.source_bytes = result.stats.total_size;
        run.literal_bytes = result.stats.literal;
        run.matched_bytes = result.stats.matched;
        run.wire_bytes = result.stats.sent + result.stats.received;
        detail.samples = thin(&result.samples, STORED_SAMPLES);
        detail.folders = top_folders(std::mem::take(&mut result.folders), STORED_FOLDERS);
        run.target_entries = match (&plan.tool, options.dry_run, job.mode) {
            (Tool::Rsync, true, _) => result.stats.target_entries_before(),
            (Tool::Rsync, false, Mode::Mirror) => result.stats.files,
            (Tool::Rsync, false, _) => result.stats.target_entries_before() + result.stats.created,
            // rclone does not count the target itself; ask it once the run is over.
            (Tool::Rclone { config }, _, _) => cloud::count(&plan.program, config, &plan.target).await.unwrap_or(0),
        };
        run.status = match (&plan.tool, result.cancelled, result.exit_code) {
            (_, true, _) => RunStatus::Cancelled,
            (_, false, Some(0)) => RunStatus::Succeeded,
            (Tool::Rsync, false, Some(23 | 24)) => RunStatus::Partial,
            (Tool::Rsync, false, Some(25)) => RunStatus::Blocked,
            (Tool::Rclone { .. }, false, Some(7)) if result.delete_limit_hit => RunStatus::Blocked,
            (Tool::Rclone { .. }, false, Some(6)) => RunStatus::Partial,
            _ => RunStatus::Failed,
        };
        if !options.dry_run && run.status.completed() && job.archive.enabled {
            self.prune_archive(plan, job.archive.keep_days, &mut log).await;
            log.flush().await?;
        }
        run.message = match run.status {
            RunStatus::Succeeded | RunStatus::Cancelled => None,
            RunStatus::Blocked => Some(format!(
                "deletion limit reached ({} allowed), the remaining deletions were skipped",
                max_delete.unwrap_or_default()
            )),
            _ => Some(result.error_summary()),
        };
        Ok(())
    }

    /// Runs rsync once with the plan's arguments plus `extra`, streaming its output.
    async fn rsync(
        &self,
        job_id: &str,
        plan: &Plan,
        extra: &[String],
        log: &mut BufWriter<tokio::fs::File>,
        cancel: &mut watch::Receiver<bool>,
        report: bool,
    ) -> Result<RsyncResult> {
        let mut command = Command::new(&plan.program);
        command
            .args(&plan.base_args)
            .args(extra)
            .arg(&plan.source)
            .arg(&plan.target)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|error| Error::Job(format!("could not start {}: {error}", plan.program)))?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");

        // The child lives in its own task, so waiting and killing never compete for it.
        // Besides waiting for the exit signal it asks the kernel directly every
        // quarter second, so a missed wake-up cannot leave a run hanging.
        let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();
        let mut waiter = tauri::async_runtime::spawn(async move {
            let mut killed = false;
            loop {
                tokio::select! {
                    status = child.wait() => return status,
                    _ = &mut kill_rx, if !killed => {
                        killed = true;
                        let _ = child.start_kill();
                    }
                    _ = tokio::time::sleep(Duration::from_millis(250)) => {
                        if let Some(status) = child.try_wait()? {
                            return Ok(status);
                        }
                    }
                }
            }
        });
        let mut kill_tx = Some(kill_tx);

        let (line_tx, mut line_rx) = tokio::sync::mpsc::channel::<Output>(1024);
        tauri::async_runtime::spawn(read_lines(stdout, line_tx.clone(), Output::Stdout));
        tauri::async_runtime::spawn(read_lines(stderr, line_tx, Output::Stderr));

        let mut result = RsyncResult::default();
        let started = Instant::now();
        let mut last_emit = started - EMIT_INTERVAL;
        let mut last_sample = started;
        let mut rate = Rate::default();
        let mut file_rate = Rate::default();
        let mut bytes_now = 0_i64;
        let mut throughput: VecDeque<f64> = VecDeque::with_capacity(LIVE_SAMPLES);
        let mut recent: VecDeque<String> = VecDeque::with_capacity(RECENT_PATHS);
        let mut moved_aside: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut exit = None;
        let mut streams_open = true;
        let mut cancel_open = true;

        loop {
            tokio::select! {
                line = line_rx.recv(), if streams_open => {
                    // Both pipes closed; the check below the select decides whether we are done.
                    let Some(line) = line else {
                        streams_open = false;
                        if exit.is_some() {
                            break;
                        }
                        continue;
                    };
                    match line {
                        Output::Stdout(text) | Output::Stderr(text) if plan.tool.is_rclone() => {
                            match rclone_output::parse(&text) {
                                Event::Stats { progress, totals } => {
                                    bytes_now = progress.bytes;
                                    result.stats.transferred_size = totals.bytes;
                                    result.stats.literal = totals.bytes;
                                    result.stats.sent = totals.bytes;
                                    result.stats.regular_transferred = totals.transfers;
                                    result.stats.deleted = totals.deletes;
                                    if report {
                                        let speed = rate.sample(progress.bytes);
                                        self.update(job_id, |live| {
                                            live.percent = progress.percent;
                                            live.bytes = progress.bytes;
                                            live.bytes_per_second = speed;
                                            live.eta_seconds = Some(progress.eta_seconds);
                                            live.files_total = progress.total_files;
                                            live.files_done = progress.transferred_files.unwrap_or(0);
                                        });
                                    }
                                }
                                Event::MovedAside(path) => {
                                    moved_aside.insert(path);
                                }
                                Event::File { change, size, path } => {
                                    // With an archive, an overwritten file is first moved aside, then copied anew.
                                    let change = if moved_aside.remove(&path) { Change::ChangedFile } else { change };
                                    // The safety check's would-be changes stay out of the log.
                                    if report && let Some(line) = log_entry(change, size, &path) {
                                        log.write_all(line.as_bytes()).await?;
                                    }
                                    self.count_file(job_id, &mut result, &mut recent, change, size, &path, report);
                                }
                                Event::Deleted(path) => {
                                    moved_aside.remove(&path);
                                    result.deleted_lines += 1;
                                    if report {
                                        log.write_all(format!("- {path}\n").as_bytes()).await?;
                                    }
                                    if report {
                                        let deleted = result.deleted_lines;
                                        self.update(job_id, |live| live.files_deleted = deleted);
                                    }
                                }
                                Event::Error(message) => {
                                    log.write_all(format!("! {message}\n").as_bytes()).await?;
                                    if rclone_output::is_delete_limit(&message) {
                                        result.delete_limit_hit = true;
                                    }
                                    result.errors.push(message);
                                    if result.errors.len() > 20 {
                                        result.errors.remove(0);
                                    }
                                }
                                Event::Other => {}
                            }
                        }
                        Output::Stdout(text) => {
                            match rsync_output::parse(&text) {
                                Line::Progress(progress) => {
                                    bytes_now = progress.bytes;
                                    if report {
                                        let speed = rate.sample(progress.bytes);
                                        self.update(job_id, |live| {
                                            live.percent = progress.percent;
                                            live.bytes = progress.bytes;
                                            live.bytes_per_second = speed;
                                            live.eta_seconds = Some(progress.eta_seconds);
                                            if let (Some(total), Some(remaining)) = (progress.total_files, progress.remaining_files) {
                                                live.files_total = Some(total);
                                                live.files_done = total - remaining;
                                            }
                                        });
                                    }
                                }
                                Line::Deleted(path) => {
                                    result.deleted_lines += 1;
                                    if report {
                                        log.write_all(format!("- {path}\n").as_bytes()).await?;
                                    }
                                    if report {
                                        let deleted = result.deleted_lines;
                                        self.update(job_id, |live| live.files_deleted = deleted);
                                    }
                                }
                                Line::Changed { code, size, path } => {
                                    if report && let Some(line) = log_entry(Change::of(code), size, path) {
                                        log.write_all(line.as_bytes()).await?;
                                    }
                                    self.count_file(job_id, &mut result, &mut recent, Change::of(code), size, path, report);
                                }
                                Line::Stat(stat) => {
                                    result.stats.apply(stat);
                                    log.write_all(format!("# {text}\n").as_bytes()).await?;
                                }
                                Line::Other(other) => {
                                    if !other.trim().is_empty() {
                                        log.write_all(format!("# {other}\n").as_bytes()).await?;
                                    }
                                }
                            }
                        }
                        Output::Stderr(text) => {
                            log.write_all(format!("! {text}\n").as_bytes()).await?;
                            result.errors.push(text);
                            if result.errors.len() > 20 {
                                result.errors.remove(0);
                            }
                        }
                    }
                    if report && last_sample.elapsed() >= SAMPLE_INTERVAL {
                        last_sample = Instant::now();
                        let files = result.files_new + result.files_changed;
                        result.samples.push(Sample(started.elapsed().as_millis() as i64, bytes_now, files));
                        let speed = rate.sample(bytes_now);
                        let files_speed = file_rate.sample(files);
                        if throughput.len() == LIVE_SAMPLES {
                            throughput.pop_front();
                        }
                        throughput.push_back(speed);
                        let curve: Vec<f64> = throughput.iter().copied().collect();
                        self.update(job_id, |live| {
                            live.throughput = curve;
                            live.files_per_second = files_speed;
                        });
                    }
                    if report && last_emit.elapsed() >= EMIT_INTERVAL {
                        self.emit(job_id);
                        last_emit = Instant::now();
                    }
                }
                joined = &mut waiter, if exit.is_none() => {
                    let status = joined
                        .map_err(|error| Error::Job(format!("rsync task failed: {error}")))??;
                    exit = Some(status);
                }
                changed = cancel.changed(), if cancel_open => {
                    if changed.is_err() {
                        cancel_open = false;
                    } else if *cancel.borrow() {
                        result.cancelled = true;
                        if let Some(kill) = kill_tx.take() {
                            let _ = kill.send(());
                        }
                    }
                }
            }
            if exit.is_some() && !streams_open {
                break;
            }
        }
        result.exit_code = exit.and_then(|status| status.code());
        if report {
            self.emit(job_id);
        }
        Ok(result)
    }

    /// Removes archive folders older than `keep_days`; failures only end up in the log.
    async fn prune_archive(&self, plan: &Plan, keep_days: u32, log: &mut BufWriter<tokio::fs::File>) {
        let cutoff = archive_stamp(Utc::now() - chrono::Duration::days(i64::from(keep_days)));
        let outcome = match (&plan.tool, &plan.target_path) {
            (Tool::Rsync, Some(target)) => prune_local(&target.join(ARCHIVE_DIR), &cutoff),
            (Tool::Rclone { config }, _) => {
                let archive = format!("{}/{ARCHIVE_DIR}", plan.target.trim_end_matches('/'));
                prune_rclone(&plan.program, config, &archive, &cutoff).await
            }
            // A server over SSH: an empty folder synced with a filter deletes only the old ones.
            (Tool::Rsync, None) => prune_ssh(plan, &cutoff).await,
        };
        let line = match outcome {
            Ok(0) => return,
            Ok(removed) => format!("# archive: removed {removed} folders older than {cutoff}\n"),
            Err(error) => format!("! archive cleanup failed: {error}\n"),
        };
        let _ = log.write_all(line.as_bytes()).await;
    }

    /// Counts one transferred file for the numbers and the live list.
    #[allow(clippy::too_many_arguments)]
    fn count_file(
        &self,
        job_id: &str,
        result: &mut RsyncResult,
        recent: &mut VecDeque<String>,
        change: Change,
        size: i64,
        path: &str,
        report: bool,
    ) {
        match change {
            Change::NewFile => {
                result.files_new += 1;
                result.bytes_new += size;
            }
            Change::ChangedFile => {
                result.files_changed += 1;
                result.bytes_changed += size;
            }
            Change::NewOther | Change::Metadata => return,
        }
        let entry = result.folders.entry(folder_of(path)).or_default();
        entry.0 += 1;
        entry.1 += size;
        if report {
            if recent.len() == RECENT_PATHS {
                recent.pop_back();
            }
            recent.push_front(path.to_string());
            let (new, changed) = (result.files_new, result.files_changed);
            let (current, paths) = (path.to_string(), recent.iter().cloned().collect());
            self.update(job_id, |live| {
                live.current_path = Some(current);
                live.recent_paths = paths;
                live.files_new = new;
                live.files_changed = changed;
            });
        }
    }

    fn update(&self, job_id: &str, change: impl FnOnce(&mut LiveRun)) {
        if let Some(entry) = self.active.lock().expect("active lock").get_mut(job_id) {
            change(&mut entry.live);
        }
    }

    fn emit(&self, job_id: &str) {
        let live = self.active.lock().expect("active lock").get(job_id).map(|entry| entry.live.clone());
        if let Some(live) = live.and_then(|live| serde_json::to_value(live).ok()) {
            (self.emit)(EVENT_RUN_UPDATE, live);
        }
    }
}

/// Everything rsync needs for one job, resolved from the config.
/// Which program moves the data.
enum Tool {
    Rsync,
    Rclone { config: PathBuf },
}

impl Tool {
    fn is_rclone(&self) -> bool {
        matches!(self, Self::Rclone { .. })
    }
}

struct Plan {
    tool: Tool,
    program: String,
    base_args: Vec<String>,
    source: String,
    target: String,
    /// Only set when the source is on this Mac.
    source_path: Option<PathBuf>,
    /// Only set when the target is on this Mac.
    target_path: Option<PathBuf>,
}

impl Plan {
    fn new(job: &Job, config: &Config, rclone_config: &Path, source: &Resolved, target: &Resolved) -> Result<Self> {
        if matches!(job.mode, Mode::Blind | Mode::Bidirectional) {
            return Err(Error::Job(format!("mode {:?} is not built yet", job.mode)));
        }
        let uses_cloud = matches!(source, Resolved::Cloud { .. }) || matches!(target, Resolved::Cloud { .. });
        if uses_cloud {
            return Self::rclone(job, &config.rclone_path, rclone_config, source, target);
        }
        let Resolved::Local(source_path) = source else {
            return Err(Error::Job("a server as the source is not built yet".into()));
        };
        let mut args: Vec<String> = match target {
            Resolved::Local(_) => ["--archive", "--hard-links", "--acls", "--xattrs", "--crtimes", "--mkpath"]
                .map(String::from)
                .to_vec(),
            // A server keeps its own owners and cannot take macOS metadata.
            Resolved::Remote { ssh, .. } => {
                let mut remote: Vec<String> = ["--archive", "--hard-links", "--no-owner", "--no-group", "--mkpath", "--secluded-args"]
                    .map(String::from)
                    .to_vec();
                remote.push(format!("--rsh={}", shell_join(ssh)));
                remote
            }
            Resolved::Cloud { .. } => unreachable!("cloud targets go through rclone"),
        };
        args.extend(
            ["--8-bit-output", "--no-inc-recursive", "--info=progress2,stats2", "--out-format=%i %l %n%L", "--outbuf=L"]
                .map(String::from),
        );
        if job.mode == Mode::Mirror {
            args.push("--delete".into());
        }
        args.extend(job.excludes.iter().map(|pattern| format!("--exclude={pattern}")));
        // The archive lives inside the target and must never be mirrored away.
        args.push(format!("--exclude=/{ARCHIVE_DIR}/"));
        let (target_arg, target_path) = match target {
            Resolved::Local(path) => (path.to_string_lossy().trim_end_matches('/').to_string(), Some(path.clone())),
            Resolved::Remote { destination, .. } => (destination.trim_end_matches('/').to_string(), None),
            Resolved::Cloud { .. } => unreachable!("cloud targets go through rclone"),
        };
        Ok(Self {
            tool: Tool::Rsync,
            program: config.rsync_path.clone(),
            base_args: args,
            // The trailing slash copies the folder's contents, not the folder itself.
            source: format!("{}/", source_path.to_string_lossy().trim_end_matches('/')),
            target: target_arg,
            source_path: Some(source_path.clone()),
            target_path,
        })
    }

    /// rclone copies the contents of the source into the target; `sync` also deletes.
    fn rclone(job: &Job, program: &str, rclone_config: &Path, source: &Resolved, target: &Resolved) -> Result<Self> {
        let side = |resolved: &Resolved| -> Result<(String, Option<PathBuf>)> {
            match resolved {
                Resolved::Local(path) => Ok((path.to_string_lossy().into_owned(), Some(path.clone()))),
                Resolved::Cloud { spec } => Ok((spec.clone(), None)),
                Resolved::Remote { .. } => Err(Error::Job("an SSH server and a cloud cannot be paired in one job yet".into())),
            }
        };
        let (source_arg, source_path) = side(source)?;
        let (target_arg, target_path) = side(target)?;
        let mut args: Vec<String> = vec![
            if job.mode == Mode::Mirror { "sync".into() } else { "copy".into() },
            "--config".into(),
            rclone_config.to_string_lossy().into_owned(),
            "--use-json-log".into(),
            "-v".into(),
            "--stats".into(),
            "1s".into(),
            "--stats-log-level".into(),
            "NOTICE".into(),
        ];
        args.extend(job.excludes.iter().map(|pattern| format!("--exclude={}", rclone_pattern(pattern))));
        args.push(format!("--exclude=/{ARCHIVE_DIR}/**"));
        Ok(Self {
            tool: Tool::Rclone { config: rclone_config.to_path_buf() },
            program: program.to_string(),
            base_args: args,
            source: source_arg,
            target: target_arg,
            source_path,
            target_path,
        })
    }

    /// Arguments that move deleted and overwritten files into this run's archive folder.
    fn archive_args(&self, stamp: &str) -> Vec<String> {
        match &self.tool {
            // Relative to the target; works the same on a server over SSH.
            Tool::Rsync => vec!["--backup".into(), format!("--backup-dir={ARCHIVE_DIR}/{stamp}")],
            // rclone wants the full path on the same remote.
            Tool::Rclone { .. } => vec!["--backup-dir".into(), format!("{}/{ARCHIVE_DIR}/{stamp}", self.target.trim_end_matches('/'))],
        }
    }

    /// An absent or empty source must never be mirrored over a full target.
    fn check_source(&self) -> Result<()> {
        let Some(path) = &self.source_path else { return Ok(()) };
        let metadata = std::fs::metadata(path)
            .map_err(|_| Error::Job(format!("source {} does not exist", path.display())))?;
        if !metadata.is_dir() {
            return Err(Error::Job(format!("source {} is not a folder", path.display())));
        }
        check_volume_mounted(path)?;
        let empty = std::fs::read_dir(path)?.next().is_none();
        if empty {
            return Err(Error::Job(format!("source {} is empty, nothing is changed", path.display())));
        }
        Ok(())
    }

    /// A local target folder may be missing, but its parent and its volume must
    /// exist, or rsync would create the path on the system disk.
    fn check_target(&self) -> Result<()> {
        let Some(path) = &self.target_path else { return Ok(()) };
        let parent = path
            .parent()
            .ok_or_else(|| Error::Job(format!("target {} has no parent folder", path.display())))?;
        if !parent.is_dir() {
            return Err(Error::Job(format!("target folder {} does not exist", parent.display())));
        }
        check_volume_mounted(path)
    }
}

fn prune_local(archive: &Path, cutoff: &str) -> Result<usize> {
    let Ok(entries) = std::fs::read_dir(archive) else { return Ok(0) };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_dir() && is_stamp(&name) && name.as_str() < cutoff {
            std::fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

async fn prune_rclone(program: &str, config: &Path, archive: &str, cutoff: &str) -> Result<usize> {
    let listed = cloud::list_dirs(program, config, archive).await.unwrap_or_default();
    let mut removed = 0;
    for name in listed.into_iter().filter(|name| is_stamp(name) && name.as_str() < cutoff) {
        let output = Command::new(program).args(["purge", &format!("{archive}/{name}"), "--config"]).arg(config).output().await?;
        if output.status.success() {
            removed += 1;
        }
    }
    Ok(removed)
}

async fn prune_ssh(plan: &Plan, cutoff: &str) -> Result<usize> {
    // Lists the archive with rsync itself (no shell needed on the server), then
    // syncs an empty folder over it with a filter that only matches old stamps.
    let archive = format!("{}/{ARCHIVE_DIR}/", plan.target.trim_end_matches('/'));
    let rsh: Vec<String> = plan.base_args.iter().filter(|arg| arg.starts_with("--rsh=")).cloned().collect();
    let listing = Command::new(&plan.program).args(&rsh).arg("--list-only").arg(&archive).output().await?;
    if !listing.status.success() {
        return Ok(0);
    }
    let old: Vec<String> = String::from_utf8_lossy(&listing.stdout)
        .lines()
        .filter_map(|line| line.split_whitespace().last())
        .filter(|name| is_stamp(name) && *name < cutoff)
        .map(str::to_string)
        .collect();
    if old.is_empty() {
        return Ok(0);
    }
    let empty = std::env::temp_dir().join(format!("clonq-empty-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&empty)?;
    let mut command = Command::new(&plan.program);
    command.args(&rsh).args(["-r", "--delete"]);
    for name in &old {
        command.arg(format!("--include=/{name}/***"));
    }
    command.arg("--exclude=*").arg(format!("{}/", empty.display())).arg(&archive);
    let output = command.output().await;
    let _ = std::fs::remove_dir_all(&empty);
    if output?.status.success() { Ok(old.len()) } else { Ok(0) }
}

/// `2026-09-23_14-05-09`
fn is_stamp(name: &str) -> bool {
    name.len() == 19 && chrono::NaiveDateTime::parse_from_str(name, "%Y-%m-%d_%H-%M-%S").is_ok()
}

/// rsync patterns name a folder with a trailing slash; rclone wants `/**` for its contents.
fn rclone_pattern(pattern: &str) -> String {
    match pattern.strip_suffix('/') {
        Some(folder) => format!("{folder}/**"),
        None => pattern.to_string(),
    }
}

/// rsync splits `--rsh` on spaces and honours single quotes (see rsync(1), -e).
fn shell_join(parts: &[String]) -> String {
    parts
        .iter()
        .map(|part| {
            if part.chars().all(|c| c.is_ascii_alphanumeric() || "-_=./:@".contains(c)) {
                part.clone()
            } else if part.contains('\'') {
                format!("\"{part}\"")
            } else {
                format!("'{part}'")
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// For paths under /Volumes/<name>, the volume has to be mounted, not just a folder.
fn check_volume_mounted(path: &Path) -> Result<()> {
    let mut components = path.components();
    let is_volume = matches!(
        (components.next(), components.next()),
        (Some(std::path::Component::RootDir), Some(std::path::Component::Normal(first))) if first == "Volumes"
    );
    let Some(std::path::Component::Normal(name)) = components.next().filter(|_| is_volume) else {
        return Ok(());
    };
    let volume = Path::new("/Volumes").join(name);
    let not_mounted = || Error::Job(format!("volume {} is not connected", volume.display()));
    let volume_dev = std::fs::metadata(&volume).map_err(|_| not_mounted())?.dev();
    let parent_dev = std::fs::metadata("/Volumes")?.dev();
    if volume_dev == parent_dev {
        return Err(not_mounted());
    }
    Ok(())
}

#[derive(Default)]
struct RsyncResult {
    exit_code: Option<i32>,
    cancelled: bool,
    stats: Stats,
    deleted_lines: i64,
    files_new: i64,
    files_changed: i64,
    bytes_new: i64,
    bytes_changed: i64,
    /// Files and bytes per folder, for the "changes most" list.
    folders: HashMap<String, (i64, i64)>,
    samples: Vec<Sample>,
    errors: Vec<String>,
    /// rclone stopped at `--max-delete`.
    delete_limit_hit: bool,
}

/// What a finished run stores beside its row.
#[derive(Default)]
struct Detail {
    samples: Vec<Sample>,
    folders: Vec<FolderChange>,
}

/// Archive folder names sort by time: `2026-09-23_14-05-09`.
pub fn archive_stamp(at: chrono::DateTime<Utc>) -> String {
    at.with_timezone(&chrono::Local).format("%Y-%m-%d_%H-%M-%S").to_string()
}

/// One line of the run log: `+ size path` new, `~ size path` changed.
/// Deletions are `- path`, errors `! text`, everything else `# text`.
fn log_entry(change: Change, size: i64, path: &str) -> Option<String> {
    match change {
        Change::NewFile => Some(format!("+ {size} {path}\n")),
        Change::ChangedFile => Some(format!("~ {size} {path}\n")),
        Change::NewOther | Change::Metadata => None,
    }
}

/// The first two levels of a path's folder: `GM8/clonq/src/main.rs` → `GM8/clonq`.
fn folder_of(path: &str) -> String {
    let path = path.split(" -> ").next().unwrap_or(path);
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let segments: Vec<&str> = parts.by_ref().take(3).collect();
    match segments.len() {
        0 | 1 => ".".into(),
        2 => segments[0].into(),
        _ => format!("{}/{}", segments[0], segments[1]),
    }
}

fn top_folders(folders: HashMap<String, (i64, i64)>, limit: usize) -> Vec<FolderChange> {
    let mut list: Vec<FolderChange> = folders
        .into_iter()
        .map(|(folder, (files, bytes))| FolderChange { folder, files, bytes })
        .collect();
    list.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(b.files.cmp(&a.files)));
    list.truncate(limit);
    list
}

/// Keeps every n-th sample so a long run still fits, always keeping the last.
fn thin(samples: &[Sample], limit: usize) -> Vec<Sample> {
    if samples.len() <= limit {
        return samples.to_vec();
    }
    let step = samples.len().div_ceil(limit);
    let mut kept: Vec<Sample> = samples.iter().step_by(step).copied().collect();
    if let (Some(last), Some(kept_last)) = (samples.last(), kept.last())
        && last != kept_last
    {
        kept.push(*last);
    }
    kept
}

impl RsyncResult {
    fn error_summary(&self) -> String {
        match self.errors.last() {
            Some(last) => last.clone(),
            None => format!("rsync ended with code {}", self.exit_code.map_or("?".into(), |code| code.to_string())),
        }
    }
}

enum Output {
    Stdout(String),
    Stderr(String),
}

/// rsync ends progress lines with `\r` and everything else with `\n`.
async fn read_lines<R: AsyncRead + Unpin>(
    mut reader: R,
    sender: tokio::sync::mpsc::Sender<Output>,
    wrap: fn(String) -> Output,
) {
    let mut buffer = [0u8; 16 * 1024];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        let read = match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        for &byte in &buffer[..read] {
            if byte == b'\n' || byte == b'\r' {
                if !pending.is_empty() {
                    let line = String::from_utf8_lossy(&pending).into_owned();
                    pending.clear();
                    if sender.send(wrap(line)).await.is_err() {
                        return;
                    }
                }
            } else {
                pending.push(byte);
            }
        }
    }
    if !pending.is_empty() {
        let _ = sender.send(wrap(String::from_utf8_lossy(&pending).into_owned())).await;
    }
}

/// Transfer speed over a sliding window of about three seconds.
#[derive(Default)]
struct Rate {
    samples: Vec<(Instant, i64)>,
}

impl Rate {
    fn sample(&mut self, bytes: i64) -> f64 {
        let now = Instant::now();
        self.samples.push((now, bytes));
        self.samples.retain(|(at, _)| now.duration_since(*at) <= Duration::from_secs(3));
        let (first_at, first_bytes) = self.samples[0];
        let seconds = now.duration_since(first_at).as_secs_f64();
        if seconds < 0.2 {
            return 0.0;
        }
        ((bytes - first_bytes).max(0) as f64) / seconds
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Location, LocationKind, Place, Safety, Triggers};
    use std::fs;

    const RSYNC: &str = "/opt/homebrew/bin/rsync";

    struct Fixture {
        root: PathBuf,
        engine: Engine,
        history: Arc<History>,
        events: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("clonq-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(root.join("src")).unwrap();
            fs::create_dir_all(root.join("dst")).unwrap();
            let history = Arc::new(History::open(&root.join("history.sqlite")).unwrap());
            let events: Arc<Mutex<Vec<(String, serde_json::Value)>>> = Arc::default();
            let sink = events.clone();
            let emit: Emit = Arc::new(move |name, payload| sink.lock().unwrap().push((name.to_string(), payload)));
            let engine = Engine::new(emit, history.clone(), root.join("logs"), root.join("rclone.conf"));
            Self { root, engine, history, events }
        }

        fn src(&self) -> PathBuf {
            self.root.join("src")
        }

        fn dst(&self) -> PathBuf {
            self.root.join("dst")
        }

        fn write(&self, relative: &str, content: &str) {
            let path = self.root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }

        /// One folder location at the fixture root; the job copies `src` to `target`.
        fn config(&self, mode: Mode, target: &str) -> Config {
            let mut config: Config =
                serde_json::from_str(&format!(r#"{{"version":2,"rsyncPath":"{RSYNC}"}}"#)).unwrap();
            config.locations.push(Location {
                id: "root".into(),
                name: "Root".into(),
                kind: LocationKind::Folder { path: self.root.to_string_lossy().into_owned() },
            });
            // A local-type rclone remote stands in for a cloud.
            config.locations.push(Location {
                id: "cloud".into(),
                name: "Cloud".into(),
                kind: LocationKind::Cloud { provider: "local".into(), remote: "fake".into(), root: self.root.to_string_lossy().into_owned() },
            });
            config.locations.push(Location {
                id: "gone".into(),
                name: "Gone".into(),
                kind: LocationKind::Volume { volume_uuid: "no-such-volume".into(), volume_name: "clonq-missing".into() },
            });
            let (location, path) = target.split_once(':').unwrap_or(("root", target));
            config.jobs.push(Job {
                id: "test".into(),
                name: "Test".into(),
                enabled: false,
                source: Place { location: "root".into(), path: "src".into() },
                target: Place { location: location.into(), path: path.into() },
                mode,
                excludes: vec!["node_modules/".into()],
                safety: Safety::default(),
                ring: None,
                triggers: Triggers::default(),
                archive: crate::config::Archive::default(),
            });
            config
        }

        /// Starts a run and waits until the engine has let go of it.
        async fn run(&self, config: &Config, options: RunOptions) -> Run {
            let run_id = self.engine.start(config, "test", "manual", options).unwrap();
            for _ in 0..600 {
                if self.engine.live_runs().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }

            self.history.recent(50).unwrap().into_iter().find(|run| run.id == run_id).unwrap()
        }

        /// Entries in a folder, not counting clonq's archive.
        fn count_files(path: &Path) -> usize {
            fs::read_dir(path)
                .map(|entries| entries.flatten().filter(|entry| entry.file_name() != ARCHIVE_DIR).count())
                .unwrap_or(0)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[tokio::test]
    async fn mirror_copies_and_skips_excluded() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        f.write("src/b/c.txt", "c");
        f.write("src/node_modules/x.js", "x");
        let run = f.run(&f.config(Mode::Mirror, "dst"), RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.message);
        assert!(f.dst().join("a.txt").exists());
        assert!(f.dst().join("b/c.txt").exists());
        assert!(!f.dst().join("node_modules").exists());
        assert_eq!(run.files_transferred, 2);
        let events = f.events.lock().unwrap();
        assert!(events.iter().any(|(name, _)| name == EVENT_RUN_UPDATE));
    }

    #[tokio::test]
    async fn counts_new_changed_and_folders() {
        let f = Fixture::new();
        f.write("src/GM8/clonq/a.txt", "12345");
        f.write("src/GM8/clonq/b.txt", "1234567890");
        f.write("src/top.txt", "x");
        let config = f.config(Mode::Mirror, "dst");
        let first = f.run(&config, RunOptions::default()).await;
        assert_eq!(first.status, RunStatus::Succeeded, "{:?}", first.message);
        assert_eq!(first.files_new, 3);
        assert_eq!(first.files_changed, 0);
        assert_eq!(first.bytes_new, 16);
        assert_eq!(first.source_bytes, 16);

        // Different content and a later time, so the quick check sees a change.
        std::thread::sleep(Duration::from_millis(1100));
        f.write("src/GM8/clonq/a.txt", "abcdefgh");
        let second = f.run(&config, RunOptions::default()).await;
        assert_eq!(second.status, RunStatus::Succeeded, "{:?}", second.message);
        assert_eq!(second.files_new, 0);
        assert_eq!(second.files_changed, 1);
        assert_eq!(second.bytes_changed, 8);

        let detail = f.history.last_completed("test").unwrap().unwrap();
        assert_eq!(detail.run.id, second.id);
        assert_eq!(detail.folders, vec![FolderChange { folder: "GM8/clonq".into(), files: 1, bytes: 8 }]);

        // The first run went through the safety check; its would-be list must not repeat in the log.
        let first_log = crate::runlog::read(Path::new(&first.log_path), None, "", 0, 100).unwrap();
        assert_eq!(first_log.total, 3, "{:?}", first_log.entries);
        let second_log = crate::runlog::read(Path::new(&second.log_path), None, "", 0, 100).unwrap();
        assert_eq!(second_log.entries.len(), 1);
        assert_eq!(second_log.entries[0].kind, crate::runlog::EntryKind::Changed);
        assert_eq!(second_log.entries[0].path, "GM8/clonq/a.txt");

        let totals = f.history.totals(Some("test")).unwrap();
        assert_eq!(totals.runs, 2);
        assert_eq!(totals.files, 4);
        assert_eq!(totals.bytes, 24);
    }

    #[test]
    fn folder_keys() {
        assert_eq!(folder_of("GM8/clonq/src/main.rs"), "GM8/clonq");
        assert_eq!(folder_of("GM8/readme.md"), "GM8");
        assert_eq!(folder_of("top.txt"), ".");
        assert_eq!(folder_of("a/link -> ../b"), "a");
    }

    #[test]
    fn thinning_keeps_the_last_sample() {
        let samples: Vec<Sample> = (0..1000).map(|i| Sample(i, i * 10, i)).collect();
        let kept = thin(&samples, 240);
        assert!(kept.len() <= 241);
        assert_eq!(kept.first(), samples.first());
        assert_eq!(kept.last(), samples.last());
    }

    fn fake_cloud(f: &Fixture) {
        let status = std::process::Command::new("/opt/homebrew/bin/rclone")
            .args(["config", "create", "fake", "local", "--config"])
            .arg(f.root.join("rclone.conf"))
            .output()
            .unwrap()
            .status;
        assert!(status.success());
    }

    #[test]
    fn cloud_paths_keep_their_leading_slash() {
        let f = Fixture::new();
        let config = f.config(Mode::Mirror, "cloud:cloudroot");
        let place = Place { location: "cloud".into(), path: "cloudroot".into() };
        let Resolved::Cloud { spec } = locations::resolve(&place, &config, &[]).unwrap() else { panic!() };
        assert_eq!(spec, format!("fake:{}/cloudroot", f.root.display()));
    }

    #[tokio::test]
    async fn cloud_mirror_through_rclone() {
        let f = Fixture::new();
        fake_cloud(&f);
        f.write("src/GM8/a.txt", "12345");
        f.write("src/b.txt", "1");
        f.write("src/node_modules/x.js", "x");
        f.write("cloudroot/stale.txt", "old");
        let config = f.config(Mode::Mirror, "cloud:cloudroot");
        let first = f.run(&config, RunOptions::default()).await;
        assert_eq!(first.status, RunStatus::Succeeded, "{:?}", first.message);
        assert_eq!(first.files_new, 2);
        assert_eq!(first.bytes_new, 6);
        assert_eq!(first.files_deleted, 1);
        assert!(f.root.join("cloudroot/GM8/a.txt").exists());
        assert!(!f.root.join("cloudroot/node_modules").exists());
        assert!(!f.root.join("cloudroot/stale.txt").exists());
        assert_eq!(first.target_entries, 2);

        std::thread::sleep(Duration::from_millis(1100));
        f.write("src/b.txt", "changed");
        let second = f.run(&config, RunOptions::default()).await;
        assert_eq!(second.status, RunStatus::Succeeded, "{:?}", second.message);
        assert_eq!(second.files_new + second.files_changed, 1);
    }

    #[tokio::test]
    async fn cloud_first_run_that_would_wipe_is_blocked() {
        let f = Fixture::new();
        fake_cloud(&f);
        f.write("src/only.txt", "1");
        for i in 0..30 {
            f.write(&format!("cloudroot/stale{i}.txt"), "old");
        }
        let run = f.run(&f.config(Mode::Mirror, "cloud:cloudroot"), RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Blocked, "{:?}", run.message);
        assert_eq!(Fixture::count_files(&f.root.join("cloudroot")), 30);
    }

    #[tokio::test]
    async fn deleted_and_overwritten_files_go_to_the_archive() {
        let f = Fixture::new();
        f.write("src/keep.txt", "v1");
        f.write("src/gone.txt", "bye");
        let config = f.config(Mode::Mirror, "dst");
        let first = f.run(&config, RunOptions::default()).await;
        assert_eq!(first.status, RunStatus::Succeeded, "{:?}", first.message);
        std::thread::sleep(Duration::from_millis(1100));
        f.write("src/keep.txt", "v2");
        fs::remove_file(f.src().join("gone.txt")).unwrap();
        let second = f.run(&config, RunOptions::default()).await;
        assert_eq!(second.status, RunStatus::Succeeded, "{:?}", second.message);
        let stamp = archive_stamp(second.started_at);
        let archived = f.dst().join(ARCHIVE_DIR).join(&stamp);
        assert_eq!(fs::read_to_string(archived.join("keep.txt")).unwrap(), "v1");
        assert_eq!(fs::read_to_string(archived.join("gone.txt")).unwrap(), "bye");
        // A third run must leave the earlier archive alone.
        std::thread::sleep(Duration::from_millis(1100));
        f.write("src/keep.txt", "v3");
        let third = f.run(&config, RunOptions::default()).await;
        assert_eq!(third.status, RunStatus::Succeeded, "{:?}", third.message);
        assert!(archived.join("gone.txt").exists());
    }

    #[test]
    fn old_archive_folders_are_pruned() {
        let dir = std::env::temp_dir().join(format!("clonq-prune-{}", uuid::Uuid::new_v4()));
        for name in ["2026-08-01_10-00-00", "2026-09-20_10-00-00", "notes"] {
            fs::create_dir_all(dir.join(name)).unwrap();
        }
        assert_eq!(prune_local(&dir, "2026-09-01_00-00-00").unwrap(), 1);
        assert!(!dir.join("2026-08-01_10-00-00").exists());
        assert!(dir.join("2026-09-20_10-00-00").exists());
        assert!(dir.join("notes").exists(), "only stamped folders are touched");
        fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn dry_run_changes_nothing() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        f.write("dst/stale.txt", "old");
        let run = f.run(&f.config(Mode::Mirror, "dst"), RunOptions { dry_run: true, force: false }).await;
        assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.message);
        assert!(run.dry_run);
        assert_eq!(run.files_transferred, 1);
        assert_eq!(run.files_deleted, 1);
        assert!(!f.dst().join("a.txt").exists());
        assert!(f.dst().join("stale.txt").exists());
    }

    #[tokio::test]
    async fn empty_source_is_refused() {
        let f = Fixture::new();
        f.write("dst/keep.txt", "keep");
        let run = f.run(&f.config(Mode::Mirror, "dst"), RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.message.unwrap().contains("is empty"));
        assert!(f.dst().join("keep.txt").exists());
    }

    #[tokio::test]
    async fn missing_volume_is_refused() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        let error = f.engine.start(&f.config(Mode::Mirror, "gone:WORK"), "test", "manual", RunOptions::default()).unwrap_err();
        assert!(error.to_string().contains("not connected"), "{error}");
        assert!(!Path::new("/Volumes/clonq-missing").exists());
    }

    #[tokio::test]
    async fn first_mirror_that_would_wipe_the_target_is_blocked() {
        let f = Fixture::new();
        f.write("src/only.txt", "1");
        for i in 0..30 {
            f.write(&format!("dst/stale{i}.txt"), "old");
        }
        let config = f.config(Mode::Mirror, "dst");
        let run = f.run(&config, RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Blocked, "{:?}", run.message);
        assert_eq!(Fixture::count_files(&f.dst()), 30, "nothing may change while blocked");

        let forced = f.run(&config, RunOptions { dry_run: false, force: true }).await;
        assert_eq!(forced.status, RunStatus::Succeeded, "{:?}", forced.message);
        assert_eq!(Fixture::count_files(&f.dst()), 1);
    }

    #[tokio::test]
    async fn later_mirror_stops_at_the_deletion_limit() {
        let f = Fixture::new();
        for i in 0..40 {
            f.write(&format!("src/file{i}.txt"), "x");
        }
        let config = f.config(Mode::Mirror, "dst");
        let first = f.run(&config, RunOptions::default()).await;
        assert_eq!(first.status, RunStatus::Succeeded, "{:?}", first.message);

        for i in 0..30 {
            fs::remove_file(f.src().join(format!("file{i}.txt"))).unwrap();
        }
        let second = f.run(&config, RunOptions::default()).await;
        assert_eq!(second.status, RunStatus::Blocked, "{:?}", second.message);
        // 41 entries on the target, 10 % would be 4, the floor of 10 applies.
        assert_eq!(Fixture::count_files(&f.dst()), 40 - 10);
    }

    #[tokio::test]
    async fn backup_never_deletes() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        f.write("dst/stale.txt", "old");
        let run = f.run(&f.config(Mode::Backup, "dst"), RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.message);
        assert!(f.dst().join("a.txt").exists());
        assert!(f.dst().join("stale.txt").exists());
    }
}

#[cfg(test)]
mod plan_tests {
    use super::*;

    #[test]
    fn rsh_quotes_paths_with_spaces() {
        let joined = shell_join(&["/usr/bin/ssh".into(), "-i".into(), "/Users/m/Library/Application Support/k".into()]);
        assert_eq!(joined, "/usr/bin/ssh -i '/Users/m/Library/Application Support/k'");
    }
}
