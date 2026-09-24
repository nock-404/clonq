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

use crate::config::{ARCHIVE_DIR, Config, ConflictLoser, ConflictPrefer, Job, Mode};
use crate::locations::{self, Resolved};
use crate::error::{Error, Result};
use crate::history::{FolderChange, History, Run, RunStatus, Sample};
use crate::cloud;
use crate::versions;
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
    /// An integrity check: compares by content, changes nothing.
    pub verify: bool,
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
    pub files_conflicted: i64,
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
    /// Compares source and target by content instead of copying; changes nothing.
    pub verify: bool,
    /// Repairs what the last integrity check found. One-way: a run that compares by content
    /// and always archives what it replaces. Versioned: a new snapshot compared by content.
    /// Two-way: the source version is copied over, the target version kept beside it.
    pub repair: bool,
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

    /// Whether any job is running right now.
    pub fn busy(&self) -> bool {
        !self.active.lock().expect("active lock").is_empty()
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
            dry_run: options.dry_run || options.verify,
            started_at: Utc::now(),
            finished_at: None,
            status: RunStatus::Running,
            files_total: 0,
            files_transferred: 0,
            files_new: 0,
            files_changed: 0,
            files_deleted: 0,
            files_conflicted: 0,
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
            plan_key: plan.key(&job),
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
                dry_run: options.dry_run || options.verify,
                verify: options.verify,
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
                files_conflicted: 0,
                files_per_second: 0.0,
                throughput: Vec::new(),
                recent_paths: Vec::new(),
                current_path: None,
                status: Some(RunStatus::Running),
                message: None,
            };
            active.insert(job.id.clone(), Active { live, cancel: cancel_tx });
        }
        if let Err(error) = self.history.insert(&run) {
            self.active.lock().expect("active lock").remove(&job.id);
            return Err(error);
        }
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
        // The log is opened here and flushed on every way out, early returns included.
        let outcome = match self.open_log(&run, &plan).await {
            Ok(mut log) => {
                let outcome = self.execute_inner(&job, &plan, &mut run, &mut detail, options, cancel, &mut log).await;
                if let Err(error) = &outcome {
                    let _ = log.write_all(format!("! {error}\n").as_bytes()).await;
                }
                let _ = log.flush().await;
                outcome
            }
            Err(error) => Err(error),
        };
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
            live.files_conflicted = run.files_conflicted;
            live.files_deleted = run.files_deleted;
            live.bytes = run.bytes_transferred;
        });
        self.emit(&job.id);
        self.active.lock().expect("active lock").remove(&job.id);
        (self.emit)(EVENT_RUNS_CHANGED, serde_json::Value::Null);
        let _ = self.finished.send(run);
    }

    async fn open_log(&self, run: &Run, plan: &Plan) -> Result<BufWriter<tokio::fs::File>> {
        tokio::fs::create_dir_all(&self.log_dir).await?;
        let mut log = BufWriter::new(tokio::fs::File::create(&run.log_path).await?);
        log.write_all(format!("# {} {}\n", plan.program, plan.base_args.join(" ")).as_bytes()).await?;
        Ok(log)
    }

    #[allow(clippy::too_many_arguments)]
    async fn execute_inner(
        &self,
        job: &Job,
        plan: &Plan,
        run: &mut Run,
        detail: &mut Detail,
        options: RunOptions,
        mut cancel: watch::Receiver<bool>,
        log: &mut BufWriter<tokio::fs::File>,
    ) -> Result<()> {
        plan.check_source()?;
        plan.check_target()?;
        if options.verify {
            return self.verify(job, plan, run, &mut cancel, log).await;
        }
        let two_way = matches!(plan.tool, Tool::Bisync { .. });
        if options.repair && two_way {
            return self.repair_two_way(job, plan, run, log).await;
        }
        if job.mode == Mode::Mirror && !two_way {
            self.check_remote_source(plan).await?;
        }

        let mut max_delete = None;
        if job.mode == Mode::Mirror && !two_way && !options.dry_run && !options.force {
            // With an archive, rclone counts every overwrite against --max-delete.
            let rclone_archive = matches!(plan.tool, Tool::Rclone { .. }) && (job.archive.enabled || options.repair);
            // Every mirror run is checked by a dry run first. --max-delete alone is not enough:
            // rsync and rclone delete up to the limit before they stop, and without an archive
            // those files would be gone although the run counts as stopped.
            {
                {
                    self.update(&job.id, |live| live.phase = Phase::Checking);
                    self.emit(&job.id);
                    log.write_all(b"# safety check (dry run)\n").await?;
                    let check = self.rsync(&job.id, plan, &["--dry-run".into()], log, &mut cancel, false, false).await?;
                    if check.cancelled {
                        run.status = RunStatus::Cancelled;
                        return Ok(());
                    }
                    // 23/24: some files could not be read; the listing is still complete enough to count.
                    let usable = match plan.tool {
                        Tool::Rsync => matches!(check.exit_code, Some(0 | 23 | 24)),
                        _ => check.exit_code == Some(0),
                    };
                    if !usable {
                        run.status = RunStatus::Failed;
                        run.exit_code = check.exit_code;
                        run.message = Some(check.error_summary());
                        return Ok(());
                    }
                    let (deleted, before) = match &plan.tool {
                        Tool::Rsync => (check.stats.deleted, check.stats.target_entries_before()),
                        Tool::Rclone { config } | Tool::Bisync { config } => {
                            (check.deleted_lines, cloud::count(&plan.program, config, &plan.target, &job.excludes).await?)
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
                    // A second guard for files that vanish between the check and the run.
                    if !rclone_archive {
                        max_delete = Some(allowed);
                    }
                    self.update(&job.id, |live| live.phase = Phase::Transferring);
                }
            }
        }

        // A versioned run writes into a new dated folder, linked against the newest complete one.
        let base_plan = plan;
        let snapshot = if job.mode == Mode::Versioned { Some(self.prepare_snapshot(plan, run, options, log).await?) } else { None };
        let plan = snapshot.as_ref().map_or(plan, |snapshot| &snapshot.plan);

        let mut extra = Vec::new();
        if options.dry_run {
            extra.push("--dry-run".to_string());
        } else if (job.archive.enabled || options.repair) && snapshot.is_none() {
            // Snapshots are their own history; an archive next to them would only double it.
            // A repair always archives: the version it replaces may be the only intact one.
            extra.extend(plan.archive_args(&archive_stamp(run.started_at)));
        }
        if options.repair {
            // Size and date match on damaged files; only the content tells them apart.
            extra.push("--checksum".into());
            log.write_all(b"# repair: comparing by content, replaced files go to the archive\n").await?;
        }
        if let Some(limit) = max_delete {
            extra.push(format!("--max-delete={limit}"));
        }
        if two_way && !options.dry_run
            && let Tool::Bisync { config } = &plan.tool
        {
            // bisync needs both roots to exist; a new job's target folder may not yet
            // (rsync creates it with --mkpath, rclone copy by itself, bisync does not).
            let made = Command::new(&plan.program).arg("mkdir").arg(&plan.target).arg("--config").arg(config).env("LC_ALL", "C").output().await?;
            if !made.status.success() {
                run.status = RunStatus::Failed;
                run.message = Some(String::from_utf8_lossy(&made.stderr).lines().last().unwrap_or("could not create the target folder").trim().to_string());
                return Ok(());
            }
        }
        if two_way {
            // Only one run per job exists (the engine's active map), so a lock file
            // here is left over from an interrupted run and would block every run.
            let workdir = self.rclone_config.with_file_name("bisync").join(&job.id);
            if let Ok(entries) = std::fs::read_dir(&workdir) {
                for entry in entries.flatten() {
                    if entry.path().extension().is_some_and(|ext| ext == "lck") {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
            if options.force {
                extra.push("--force".into());
            }
            // bisync only knows a percentage; small folders get the always-allowed floor as a share.
            if let Some(entries) = self.history.last_target_entries(&job.id, &run.plan_key)?.filter(|n| *n > 0) {
                let floor = (job.safety.always_allowed_deletions as f64 * 100.0 / entries as f64).ceil();
                let percent = job.safety.max_delete_percent.max(floor).min(100.0);
                extra.push("--max-delete".into());
                extra.push(format!("{}", percent.round() as i64));
            }
            // Without an earlier two-way run there is nothing to compare with: the
            // first run merges both sides and deletes nothing.
            if !self.history.has_completed(&job.id)? {
                extra.extend(plan.resync_args(job));
            }
        }
        let mut result = self.rsync(&job.id, plan, &extra, log, &mut cancel, true, false).await?;
        if two_way && !result.cancelled && result.errors.iter().any(|error| rclone_output::needs_resync(error)) {
            log.write_all(b"# no earlier listings, merging both sides first\n").await?;
            extra.extend(plan.resync_args(job));
            result = self.rsync(&job.id, plan, &extra, log, &mut cancel, true, false).await?;
        }

        run.exit_code = result.exit_code;
        run.files_total = result.stats.files;
        run.files_transferred = result.stats.regular_transferred;
        run.files_new = result.files_new;
        run.files_changed = result.files_changed;
        run.files_deleted = result.deleted_lines;
        run.files_conflicted = result.conflicts;
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
            (Tool::Rclone { config } | Tool::Bisync { config }, _, _) => {
                cloud::count(&plan.program, config, &plan.target, &job.excludes).await.unwrap_or(0)
            }
        };
        run.status = match (&plan.tool, result.cancelled, result.exit_code) {
            (_, true, _) => RunStatus::Cancelled,
            (_, false, Some(0)) => RunStatus::Succeeded,
            (Tool::Rsync, false, Some(23 | 24)) => RunStatus::Partial,
            (Tool::Rsync, false, Some(25)) => RunStatus::Blocked,
            (Tool::Rclone { .. }, false, Some(7)) if result.delete_limit_hit => RunStatus::Blocked,
            (Tool::Rclone { .. }, false, Some(6)) => RunStatus::Partial,
            (Tool::Bisync { .. }, false, Some(_)) if result.delete_limit_hit => RunStatus::Blocked,
            _ => RunStatus::Failed,
        };
        if let Some(snapshot) = &snapshot
            && !options.dry_run
            && run.status.completed()
        {
            self.finish_snapshot(base_plan, snapshot, log).await?;
        }
        if !options.dry_run && run.status.completed() && job.archive.enabled && snapshot.is_none() {
            self.prune_archive(plan, job.archive.keep_days, log).await;
        }
        run.message = match run.status {
            RunStatus::Succeeded | RunStatus::Cancelled => None,
            RunStatus::Blocked if two_way => Some(format!(
                "two-way sync stopped: {}",
                result.errors.iter().find(|error| rclone_output::is_delete_limit(error)).cloned().unwrap_or_default()
            )),
            RunStatus::Blocked => Some(format!(
                "deletion limit reached ({} allowed), the remaining deletions were skipped",
                max_delete.unwrap_or_default()
            )),
            _ => Some(result.error_summary()),
        };
        Ok(())
    }

    /// Runs rsync once with the plan's arguments plus `extra`, streaming its output.
    #[allow(clippy::too_many_arguments)]
    async fn rsync(
        &self,
        job_id: &str,
        plan: &Plan,
        extra: &[String],
        log: &mut BufWriter<tokio::fs::File>,
        cancel: &mut watch::Receiver<bool>,
        report: bool,
        // Keeps every changed path in the result; only the integrity check needs them.
        collect: bool,
    ) -> Result<RsyncResult> {
        let mut command = Command::new(&plan.program);
        command
            // Numbers in rsync's statistics follow the locale; the parser reads the C locale.
            .env("LC_ALL", "C")
            .args(&plan.base_args)
            .args(extra)
            .arg(&plan.source)
            .arg(&plan.target)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            // Its own process group, so a cancel also reaches the ssh child rsync starts.
            .process_group(0);
        let mut child = command
            .spawn()
            .map_err(|error| Error::Job(format!("could not start {}: {error}", plan.program)))?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let group = child.id().and_then(|pid| i32::try_from(pid).ok());

        // The child lives in its own task, so waiting and killing never compete for it.
        // Besides waiting for the exit signal it asks the kernel directly every
        // quarter second, so a missed wake-up cannot leave a run hanging.
        // A cancel first interrupts the whole group, so rsync and bisync can clean
        // up (bisync removes its lock); only if that does not end it in ten
        // seconds is the group killed.
        let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();
        let mut waiter = tauri::async_runtime::spawn(async move {
            let mut interrupted_at: Option<Instant> = None;
            loop {
                tokio::select! {
                    status = child.wait() => return status,
                    _ = &mut kill_rx, if interrupted_at.is_none() => {
                        interrupted_at = Some(Instant::now());
                        signal_group(group, libc::SIGINT);
                    }
                    _ = tokio::time::sleep(Duration::from_millis(250)) => {
                        if let Some(status) = child.try_wait()? {
                            return Ok(status);
                        }
                        if interrupted_at.is_some_and(|at| at.elapsed() > Duration::from_secs(10)) {
                            signal_group(group, libc::SIGKILL);
                            let _ = child.start_kill();
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
        let mut server_copies: HashMap<String, i64> = HashMap::new();
        let mut open_conflicts: std::collections::HashSet<String> = std::collections::HashSet::new();
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
                                Event::ServerCopy { size, path } => {
                                    server_copies.insert(path, size);
                                }
                                Event::Conflict(path) => {
                                    // Counted once bisync resolves it; files that turn out equal are not conflicts.
                                    open_conflicts.insert(path);
                                }
                                Event::ConflictWinner(path) | Event::ConflictRenamed(path) => {
                                    let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                                    let matched = open_conflicts.iter().find(|open| open.rsplit('/').next() == Some(name.as_str())).cloned();
                                    if let Some(open) = matched {
                                        open_conflicts.remove(&open);
                                        result.conflicts += 1;
                                        log.write_all(format!("? {open}\n").as_bytes()).await?;
                                        if report {
                                            let conflicts = result.conflicts;
                                            self.update(job_id, |live| live.files_conflicted = conflicts);
                                        }
                                    }
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
                                Event::Deleted(path) if server_copies.remove(&path).is_some() => {
                                    // Copied aside, then deleted: the backend has no move, so this is the
                                    // archive step. A copy of the same path afterwards means it changed.
                                    moved_aside.insert(path);
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
                                    if collect {
                                        result.paths.push((Change::of(code), path.to_string()));
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
                // After a cancel the pipes may be held by a straggler; do not wait for them forever.
                _ = tokio::time::sleep(Duration::from_secs(5)), if exit.is_some() && result.cancelled => {
                    break;
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
        // Server-side copies with no deletion after them were real copies; a path
        // that was moved aside first was replaced, so it changed.
        for (path, size) in server_copies {
            let change = if moved_aside.remove(&path) { Change::ChangedFile } else { Change::NewFile };
            if report && let Some(line) = log_entry(change, size, &path) {
                log.write_all(line.as_bytes()).await?;
            }
            self.count_file(job_id, &mut result, &mut recent, change, size, &path, report);
        }
        // Moved into the archive and never replaced: those were deletions.
        for path in moved_aside {
            result.deleted_lines += 1;
            if report {
                log.write_all(format!("- {path}\n").as_bytes()).await?;
            }
        }
        result.exit_code = exit.and_then(|status| status.code());
        if report {
            self.emit(job_id);
        }
        Ok(result)
    }

    /// The integrity check: finds files whose content differs between source and target although
    /// a normal run would leave them alone, the sign of silent damage (a flipped bit on a dying
    /// disk, a file changed behind clonq's back). Changes nothing on either side.
    ///
    /// rsync: one dry run by size and date, one by checksum; what only the second one finds has
    /// the same size and date but other content. On a server rsync computes the checksums
    /// there, so no file data crosses the line. rclone (clouds, two-way): `rclone check`.
    async fn verify(&self, job: &Job, plan: &Plan, run: &mut Run, cancel: &mut watch::Receiver<bool>, log: &mut BufWriter<tokio::fs::File>) -> Result<()> {
        self.update(&job.id, |live| live.phase = Phase::Checking);
        self.emit(&job.id);
        match &plan.tool {
            Tool::Rsync => {
                // A versioned job is checked against its newest complete snapshot.
                let mut checked = plan.clone();
                if job.mode == Mode::Versioned {
                    let base = format!("{}/", plan.target.trim_end_matches('/'));
                    let (complete, _) = match &plan.target_path {
                        Some(path) => versions::list_local(path),
                        None => versions::list_remote(&plan.program, &plan.rsh(), &base).await?,
                    };
                    let Some(newest) = complete.last() else {
                        run.status = RunStatus::Failed;
                        run.message = Some("there is no snapshot to check yet".into());
                        return Ok(());
                    };
                    checked.target = format!("{base}{newest}");
                    checked.target_path = plan.target_path.as_ref().map(|path| path.join(newest));
                    log.write_all(format!("# integrity check against snapshot {newest}\n").as_bytes()).await?;
                }
                // Deletions are no damage; the check only reads what both sides hold.
                checked.base_args.retain(|arg| arg != "--delete");
                log.write_all(b"# integrity check, pass 1: by size and date\n").await?;
                let quick = self.rsync(&job.id, &checked, &["--dry-run".into()], log, cancel, false, true).await?;
                if quick.cancelled {
                    run.status = RunStatus::Cancelled;
                    return Ok(());
                }
                log.write_all(b"# integrity check, pass 2: by content (checksums)\n").await?;
                let deep = self.rsync(&job.id, &checked, &["--dry-run".into(), "--checksum".into()], log, cancel, false, true).await?;
                if deep.cancelled {
                    run.status = RunStatus::Cancelled;
                    return Ok(());
                }
                let usable = |code: Option<i32>| matches!(code, Some(0 | 23 | 24));
                if !usable(quick.exit_code) || !usable(deep.exit_code) {
                    run.status = RunStatus::Failed;
                    run.exit_code = if usable(quick.exit_code) { deep.exit_code } else { quick.exit_code };
                    run.message = Some(if usable(quick.exit_code) { deep.error_summary() } else { quick.error_summary() });
                    return Ok(());
                }
                let is_file = |change: &Change| matches!(change, Change::NewFile | Change::ChangedFile);
                let known: std::collections::HashSet<&str> = quick.paths.iter().filter(|(change, _)| is_file(change)).map(|(_, path)| path.as_str()).collect();
                let silent: Vec<&str> = deep.paths.iter().filter(|(change, path)| is_file(change) && !known.contains(path.as_str())).map(|(_, path)| path.as_str()).collect();
                let missing = quick.paths.iter().filter(|(change, _)| *change == Change::NewFile).count();
                for path in &silent {
                    log.write_all(format!("{DIFFERS}{path}\n").as_bytes()).await?;
                }
                run.files_total = deep.stats.files;
                run.files_conflicted = silent.len() as i64;
                run.files_new = missing as i64;
                run.files_changed = quick.paths.iter().filter(|(change, _)| *change == Change::ChangedFile).count() as i64;
                run.source_bytes = deep.stats.total_size;
                run.exit_code = deep.exit_code;
                run.status = if silent.is_empty() { RunStatus::Succeeded } else { RunStatus::Partial };
                run.message = (!silent.is_empty()).then(|| format!("{} file(s) differ in content although size and date match", silent.len()));
            }
            Tool::Rclone { config } | Tool::Bisync { config } => {
                let mut command = Command::new(&plan.program);
                command.arg("check").arg(&plan.source).arg(&plan.target).arg("--config").arg(config).args(["--combined", "-"]);
                if !matches!(plan.tool, Tool::Bisync { .. }) {
                    command.arg("--one-way");
                }
                command.args(job.excludes.iter().map(|pattern| format!("--exclude={}", rclone_pattern(pattern))));
                command.arg(format!("--exclude=/{ARCHIVE_DIR}/**"));
                command.env("LC_ALL", "C").stdin(Stdio::null()).kill_on_drop(true);
                let output = tokio::select! {
                    output = command.output() => output?,
                    _ = cancel.changed() => {
                        run.status = RunStatus::Cancelled;
                        return Ok(());
                    }
                };
                // One line per file: "= same", "* differs", "- missing in target", "+ only in target", "! error".
                let text = String::from_utf8_lossy(&output.stdout);
                let mut differ = 0_i64;
                let mut missing = 0_i64;
                let mut errors = 0_i64;
                for line in text.lines() {
                    let (mark, path) = line.split_at(line.len().min(2));
                    match mark.trim() {
                        "*" => {
                            differ += 1;
                            log.write_all(format!("{DIFFERS}{path}\n").as_bytes()).await?;
                        }
                        "-" => missing += 1,
                        "!" => {
                            errors += 1;
                            log.write_all(format!("! could not check: {path}\n").as_bytes()).await?;
                        }
                        _ => {}
                    }
                }
                run.files_conflicted = differ;
                run.files_new = missing;
                run.exit_code = output.status.code();
                // rclone check exits 1 when it found differences; that is a result, not a failure.
                let failed = !matches!(output.status.code(), Some(0 | 1)) || errors > 0 && differ == 0 && missing == 0;
                run.status = if failed { RunStatus::Failed } else if differ > 0 { RunStatus::Partial } else { RunStatus::Succeeded };
                run.message = if failed {
                    Some(String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or("rclone check failed").trim().to_string())
                } else {
                    (differ > 0).then(|| format!("{differ} file(s) differ in content between source and target"))
                };
            }
        }
        Ok(())
    }

    /// Repairs a two-way job: for every file the last integrity check found, the target's
    /// version is renamed to "<name>.target-<time>.<ext>" and the source's version copied
    /// in its place. Nothing is lost, whichever side was damaged; the next sync brings the
    /// kept version to the source as well, so both sides show both versions.
    async fn repair_two_way(&self, job: &Job, plan: &Plan, run: &mut Run, log: &mut BufWriter<tokio::fs::File>) -> Result<()> {
        let Tool::Bisync { config } = &plan.tool else { unreachable!("two-way jobs use bisync") };
        let paths = self.damaged_paths(&job.id)?;
        let stamp = archive_stamp(run.started_at);
        let join = |base: &str, path: &str| {
            let base = base.trim_end_matches('/');
            if base.ends_with(':') { format!("{base}{path}") } else { format!("{base}/{path}") }
        };
        let mut repaired = 0_i64;
        for path in &paths {
            let kept = kept_name(path, "target", &stamp);
            for (verb, from, to) in [("moveto", join(&plan.target, path), join(&plan.target, &kept)), ("copyto", join(&plan.source, path), join(&plan.target, path))] {
                let output = Command::new(&plan.program)
                    .arg(verb)
                    .arg(&from)
                    .arg(&to)
                    .arg("--config")
                    .arg(config)
                    .env("LC_ALL", "C")
                    .stdin(Stdio::null())
                    .kill_on_drop(true)
                    .output()
                    .await?;
                if !output.status.success() {
                    let reason = String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or_default().trim().to_string();
                    log.write_all(format!("! could not repair {path}: {reason}\n").as_bytes()).await?;
                    run.status = RunStatus::Failed;
                    run.files_changed = repaired;
                    run.message = Some(format!("could not repair {path}: {reason}"));
                    return Ok(());
                }
            }
            log.write_all(format!("> repaired: {path} (the target's version is kept as {kept})\n").as_bytes()).await?;
            repaired += 1;
        }
        run.files_changed = repaired;
        run.status = RunStatus::Succeeded;
        Ok(())
    }

    /// The files the job's last integrity check found damaged, from its log.
    fn damaged_paths(&self, job_id: &str) -> Result<Vec<String>> {
        let Some(log) = self.history.last_verify_log(job_id)? else { return Ok(Vec::new()) };
        let text = std::fs::read_to_string(log).unwrap_or_default();
        Ok(text.lines().filter_map(|line| line.strip_prefix(DIFFERS)).map(|path| path.trim().to_string()).filter(|path| !path.is_empty()).collect())
    }

    /// Lists the snapshots, removes unfinished ones (not in a dry run), and plans this run into a
    /// new folder named after its start, hard-linked against the newest complete snapshot.
    async fn prepare_snapshot(&self, plan: &Plan, run: &Run, options: RunOptions, log: &mut BufWriter<tokio::fs::File>) -> Result<Snapshot> {
        let stamp = archive_stamp(run.started_at);
        let base = format!("{}/", plan.target.trim_end_matches('/'));
        let (complete, incomplete) = match &plan.target_path {
            Some(path) => versions::list_local(path),
            None => versions::list_remote(&plan.program, &plan.rsh(), &base).await?,
        };
        if !options.dry_run && !incomplete.is_empty() {
            log.write_all(format!("# versions: removing {} unfinished snapshot(s)\n", incomplete.len()).as_bytes()).await?;
            delete_snapshots(plan, &incomplete).await?;
        }
        let previous = complete.last().cloned();
        let mut snapshot = plan.clone();
        snapshot.target = format!("{base}{stamp}");
        snapshot.target_path = plan.target_path.as_ref().map(|path| path.join(&stamp));
        if let Some(previous) = &previous {
            // Relative to the new folder, which is how rsync reads a relative --link-dest.
            snapshot.base_args.push(format!("--link-dest=../{previous}"));
        }
        log.write_all(format!("# versions: snapshot {stamp}, linked to {}\n", previous.as_deref().unwrap_or("nothing (first snapshot)")).as_bytes()).await?;
        Ok(Snapshot { plan: snapshot, stamp, complete })
    }

    /// Marks the new snapshot complete, then thins out older ones.
    async fn finish_snapshot(&self, base: &Plan, snapshot: &Snapshot, log: &mut BufWriter<tokio::fs::File>) -> Result<()> {
        match &snapshot.plan.target_path {
            Some(path) => std::fs::write(path.join(versions::MARKER), &snapshot.stamp)?,
            None => {
                let marker = std::env::temp_dir().join(format!("clonq-marker-{}", uuid::Uuid::new_v4()));
                std::fs::write(&marker, &snapshot.stamp)?;
                let output = Command::new(&base.program)
                    .env("LC_ALL", "C")
                    .args(base.rsh())
                    .arg(&marker)
                    .arg(format!("{}/{}", snapshot.plan.target, versions::MARKER))
                    .output()
                    .await;
                let _ = std::fs::remove_file(&marker);
                let output = output?;
                if !output.status.success() {
                    return Err(Error::Job(crate::ssh::explain(&String::from_utf8_lossy(&output.stderr))));
                }
            }
        }
        let mut all = snapshot.complete.clone();
        all.push(snapshot.stamp.clone());
        let kept = versions::keep(&all, versions::now());
        let old: Vec<String> = all.into_iter().filter(|stamp| !kept.contains(stamp)).collect();
        if !old.is_empty() {
            log.write_all(format!("# versions: thinned out {} older snapshot(s)\n", old.len()).as_bytes()).await?;
            delete_snapshots(base, &old).await?;
        }
        Ok(())
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
            (Tool::Bisync { config }, _) => {
                let mut removed = 0;
                for side in [&plan.source, &plan.target] {
                    let archive = format!("{}/{ARCHIVE_DIR}", side.trim_end_matches('/'));
                    removed += prune_rclone(&plan.program, config, &archive, &cutoff).await.unwrap_or(0);
                }
                Ok(removed)
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

    /// A mirror from a cloud or server must not run from an empty or missing source.
    async fn check_remote_source(&self, plan: &Plan) -> Result<()> {
        if plan.source_path.is_some() {
            return Ok(());
        }
        let Tool::Rclone { config } = &plan.tool else { return Ok(()) };
        let output = Command::new(&plan.program)
            .args(["lsf", "--max-depth", "1", &plan.source, "--config"])
            .arg(config)
            .env("LC_ALL", "C")
            .output()
            .await?;
        if !output.status.success() {
            return Err(Error::Job(format!("source {} does not exist", plan.source)));
        }
        if output.stdout.iter().all(u8::is_ascii_whitespace) {
            return Err(Error::Job(format!("source {} is empty, nothing is changed", plan.source)));
        }
        Ok(())
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
#[derive(Clone)]
enum Tool {
    Rsync,
    Rclone { config: PathBuf },
    /// rclone bisync for two-way jobs; its listings live in a workdir per job.
    Bisync { config: PathBuf },
}

impl Tool {
    /// rclone and bisync share the JSON log format.
    fn is_rclone(&self) -> bool {
        matches!(self, Self::Rclone { .. } | Self::Bisync { .. })
    }

}

#[derive(Clone)]
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

/// A place as rclone names it, and its path when it is on this Mac.
fn rclone_side(resolved: &Resolved) -> (String, Option<PathBuf>) {
    match resolved {
        Resolved::Local(path) => (path.to_string_lossy().into_owned(), Some(path.clone())),
        Resolved::Cloud { spec } => (spec.clone(), None),
        // A server joins through rclone's SFTP backend with clonq's key and pinned host keys.
        Resolved::Remote { sftp, .. } => (sftp.clone(), None),
    }
}

impl Plan {
    fn new(job: &Job, config: &Config, rclone_config: &Path, source: &Resolved, target: &Resolved) -> Result<Self> {
        if job.mode == Mode::Blind {
            return Err(Error::Job(format!("mode {:?} is not built yet", job.mode)));
        }
        if job.mode == Mode::Bidirectional {
            return Self::bisync(job, &config.rclone_path, rclone_config, source, target);
        }
        // Snapshots need hard links, which only rsync into a folder, a drive or a server makes.
        if job.mode == Mode::Versioned && (!matches!(source, Resolved::Local(_)) || matches!(target, Resolved::Cloud { .. })) {
            return Err(Error::Job("versioned backups need a source on this Mac and a folder, drive or server as the target".into()));
        }
        // rsync pushes from this Mac to a disk or a server; everything else goes through rclone:
        // clouds on either side, and a server as the source (rclone reads it over SFTP).
        let uses_cloud = matches!(source, Resolved::Cloud { .. }) || matches!(target, Resolved::Cloud { .. });
        let Resolved::Local(source_path) = source else {
            return Self::rclone(job, &config.rclone_path, rclone_config, source, target);
        };
        if uses_cloud {
            return Self::rclone(job, &config.rclone_path, rclone_config, source, target);
        }
        let mut args: Vec<String> = match target {
            Resolved::Local(_) => ["--archive", "--hard-links", "--acls", "--xattrs", "--crtimes", "--mkpath"]
                .map(String::from)
                .to_vec(),
            // A server keeps its own owners and cannot take macOS metadata.
            Resolved::Remote { ssh, .. } => {
                // --timeout ends a transfer that has stalled for five minutes.
                let mut remote: Vec<String> =
                    ["--archive", "--hard-links", "--no-owner", "--no-group", "--mkpath", "--secluded-args", "--timeout=300"]
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

    /// Two-way sync with rclone bisync. Path1 is the source, Path2 the target.
    fn bisync(job: &Job, program: &str, rclone_config: &Path, source: &Resolved, target: &Resolved) -> Result<Self> {
        let (path1, source_path) = rclone_side(source);
        let (path2, target_path) = rclone_side(target);
        let prefer = match job.conflicts.prefer {
            ConflictPrefer::Newer => "newer",
            ConflictPrefer::Older => "older",
            ConflictPrefer::Larger => "larger",
            ConflictPrefer::Smaller => "smaller",
            ConflictPrefer::Source => "path1",
            ConflictPrefer::Target => "path2",
            ConflictPrefer::None => "none",
        };
        let loser = match job.conflicts.loser {
            ConflictLoser::Keep => "num",
            ConflictLoser::Delete => "delete",
        };
        let workdir = rclone_config.with_file_name("bisync").join(&job.id);
        let mut args: Vec<String> = vec![
            "bisync".into(),
            "--config".into(),
            rclone_config.to_string_lossy().into_owned(),
            "--workdir".into(),
            workdir.to_string_lossy().into_owned(),
            "--use-json-log".into(),
            "-v".into(),
            "--color".into(),
            "NEVER".into(),
            "--stats".into(),
            "1s".into(),
            "--stats-log-level".into(),
            "NOTICE".into(),
            "--resilient".into(),
            "--recover".into(),
            "--max-lock".into(),
            "2m".into(),
            "--conflict-resolve".into(),
            prefer.into(),
            "--conflict-loser".into(),
            loser.into(),
            // bisync takes the deletion limit as a percentage of each side.
            "--max-delete".into(),
            format!("{}", job.safety.max_delete_percent.round() as i64),
        ];
        args.extend(job.excludes.iter().map(|pattern| format!("--exclude={}", rclone_pattern(pattern))));
        args.push(format!("--exclude=/{ARCHIVE_DIR}/**"));
        Ok(Self {
            tool: Tool::Bisync { config: rclone_config.to_path_buf() },
            program: program.to_string(),
            base_args: args,
            source: path1,
            target: path2,
            source_path,
            target_path,
        })
    }

    /// rclone copies the contents of the source into the target; `sync` also deletes.
    fn rclone(job: &Job, program: &str, rclone_config: &Path, source: &Resolved, target: &Resolved) -> Result<Self> {
        let (source_arg, source_path) = rclone_side(source);
        let (target_arg, target_path) = rclone_side(target);
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

    /// What a measured target size belongs to: the tool, both ends and the mode.
    fn key(&self, job: &Job) -> String {
        let tool = match self.tool {
            Tool::Rsync => "rsync",
            Tool::Rclone { .. } => "rclone",
            Tool::Bisync { .. } => "bisync",
        };
        format!("{tool}|{:?}|{}|{}", job.mode, self.source, self.target)
    }

    /// Arguments that move deleted and overwritten files into this run's archive folder.
    fn archive_args(&self, stamp: &str) -> Vec<String> {
        match &self.tool {
            // Relative to the target; works the same on a server over SSH.
            Tool::Rsync => vec!["--backup".into(), format!("--backup-dir={ARCHIVE_DIR}/{stamp}")],
            // rclone wants the full path on the same remote.
            Tool::Rclone { .. } => vec!["--backup-dir".into(), format!("{}/{ARCHIVE_DIR}/{stamp}", self.target.trim_end_matches('/'))],
            // Both sides lose files in a two-way sync, so both keep an archive.
            Tool::Bisync { .. } => vec![
                "--backup-dir1".into(),
                format!("{}/{ARCHIVE_DIR}/{stamp}", self.source.trim_end_matches('/')),
                "--backup-dir2".into(),
                format!("{}/{ARCHIVE_DIR}/{stamp}", self.target.trim_end_matches('/')),
            ],
        }
    }

    /// bisync's first-run merge: copies what is missing both ways, keeps the preferred version.
    fn resync_args(&self, job: &Job) -> Vec<String> {
        let mode = match job.conflicts.prefer {
            ConflictPrefer::Source => "path1",
            ConflictPrefer::Target => "path2",
            ConflictPrefer::Older => "older",
            ConflictPrefer::Larger => "larger",
            ConflictPrefer::Smaller => "smaller",
            ConflictPrefer::Newer | ConflictPrefer::None => "newer",
        };
        vec!["--resync".into(), "--resync-mode".into(), mode.into()]
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
    /// The `--rsh=` argument for a server target, empty for everything else.
    fn rsh(&self) -> Vec<String> {
        self.base_args.iter().filter(|arg| arg.starts_with("--rsh=")).cloned().collect()
    }

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

/// A snapshot being written: the plan into its folder, its name, the complete ones before it.
struct Snapshot {
    plan: Plan,
    stamp: String,
    complete: Vec<String>,
}

/// Deletes snapshot folders from the target. Only names that are snapshot stamps are touched.
async fn delete_snapshots(plan: &Plan, names: &[String]) -> Result<()> {
    let names: Vec<&String> = names.iter().filter(|name| crate::archive::is_stamp(name)).collect();
    if names.is_empty() {
        return Ok(());
    }
    if let Some(target) = &plan.target_path {
        for name in names {
            std::fs::remove_dir_all(target.join(name))?;
        }
        return Ok(());
    }
    // A server: an empty folder synced over the target with a filter that matches only these
    // folders deletes exactly them, without a shell on the server.
    let empty = std::env::temp_dir().join(format!("clonq-empty-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&empty)?;
    let mut command = Command::new(&plan.program);
    command.env("LC_ALL", "C").args(plan.rsh()).args(["-r", "--delete"]);
    for name in &names {
        command.arg(format!("--include=/{name}/***"));
    }
    command.arg("--exclude=*").arg(format!("{}/", empty.display())).arg(format!("{}/", plan.target.trim_end_matches('/')));
    let output = command.output().await;
    let _ = std::fs::remove_dir_all(&empty);
    let output = output?;
    if !output.status.success() {
        return Err(Error::Job(crate::ssh::explain(&String::from_utf8_lossy(&output.stderr))));
    }
    Ok(())
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
    let listing = Command::new(&plan.program).env("LC_ALL", "C").args(&rsh).arg("--list-only").arg(&archive).output().await?;
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
    command.env("LC_ALL", "C").args(&rsh).args(["-r", "--delete"]);
    for name in &old {
        command.arg(format!("--include=/{name}/***"));
    }
    command.arg("--exclude=*").arg(format!("{}/", empty.display())).arg(&archive);
    let output = command.output().await;
    let _ = std::fs::remove_dir_all(&empty);
    if output?.status.success() { Ok(old.len()) } else { Ok(0) }
}

/// `2026-09-23_14-05-09`
/// An archive folder name, with milliseconds since 0.3.2 or without them before.
fn is_stamp(name: &str) -> bool {
    crate::archive::is_stamp(name)
}

/// rsync patterns name a folder with a trailing slash; rclone wants `/**` for its contents.
fn rclone_pattern(pattern: &str) -> String {
    match pattern.strip_suffix('/') {
        Some(folder) => format!("{folder}/**"),
        None => pattern.to_string(),
    }
}

/// rsync splits `--rsh` on spaces and honours single quotes (see rsync(1), -e).
pub(crate) fn shell_join(parts: &[String]) -> String {
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
    /// Two-way sync: files changed on both sides.
    conflicts: i64,
    /// Changed paths, when asked for (integrity check).
    paths: Vec<(Change, String)>,
}

/// What a finished run stores beside its row.
#[derive(Default)]
struct Detail {
    samples: Vec<Sample>,
    folders: Vec<FolderChange>,
}

fn signal_group(group: Option<i32>, signal: i32) {
    if let Some(group) = group.filter(|group| *group > 0) {
        // SAFETY: killpg only sends a signal; the group id is the child's own pid,
        // which leads the process group created with process_group(0).
        unsafe {
            libc::killpg(group, signal);
        }
    }
}

/// Archive folder names sort by time: `2026-09-23_14-05-09`.
/// Milliseconds are part of the name: two runs in the same second must never share a folder,
/// or the second would overwrite what the first kept.
/// How the integrity check marks a damaged file in its log; a repair reads it back.
const DIFFERS: &str = "! content differs: ";

/// "report.pdf" → "report.target-<stamp>.pdf": a kept version beside the file, still openable.
fn kept_name(path: &str, side: &str, stamp: &str) -> String {
    let (dir, name) = path.rsplit_once('/').map_or(("", path), |(dir, name)| (dir, name));
    let kept = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}.{side}-{stamp}.{ext}"),
        _ => format!("{name}.{side}-{stamp}"),
    };
    if dir.is_empty() { kept } else { format!("{dir}/{kept}") }
}

pub fn archive_stamp(at: chrono::DateTime<Utc>) -> String {
    at.with_timezone(&chrono::Local).format("%Y-%m-%d_%H-%M-%S-%3f").to_string()
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
                conflicts: crate::config::Conflicts::default(),
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
        assert_eq!(folder_of("a/name -> with arrow.txt"), "a");
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
    async fn two_way_merges_first_then_resolves_conflicts() {
        let f = Fixture::new();
        for i in 0..12 {
            f.write(&format!("src/keep{i}.txt"), "k");
        }
        f.write("src/same.txt", "one");
        f.write("src/only-source.txt", "s");
        f.write("dst/only-target.txt", "t");
        let config = f.config(Mode::Bidirectional, "dst");

        // First run: nothing to compare with, so both sides are merged; nothing is deleted.
        let first = f.run(&config, RunOptions::default()).await;
        assert_eq!(first.status, RunStatus::Succeeded, "{:?}", first.message);
        assert!(f.dst().join("only-source.txt").exists());
        assert!(f.src().join("only-target.txt").exists());

        // Both sides change the same file; the target's version is newer and wins.
        std::thread::sleep(Duration::from_millis(1200));
        f.write("src/same.txt", "from source");
        std::thread::sleep(Duration::from_millis(1200));
        f.write("dst/same.txt", "from target, newer");
        fs::remove_file(f.src().join("only-source.txt")).unwrap();
        let second = f.run(&config, RunOptions::default()).await;
        assert_eq!(second.status, RunStatus::Succeeded, "{:?}", second.message);
        assert_eq!(second.files_conflicted, 1);
        assert_eq!(second.files_deleted, 1, "only-source.txt; the conflict loser is renamed, not deleted");
        assert_eq!(fs::read_to_string(f.src().join("same.txt")).unwrap(), "from target, newer");
        assert!(f.src().join("same.txt.conflict1").exists(), "the loser is kept");
        assert!(!f.dst().join("only-source.txt").exists(), "deletions travel across");
    }

    #[tokio::test]
    async fn two_way_stops_at_too_many_deletions_unless_forced() {
        let f = Fixture::new();
        for i in 0..40 {
            f.write(&format!("src/keep{i}.txt"), "k");
        }
        let config = f.config(Mode::Bidirectional, "dst");
        let first = f.run(&config, RunOptions::default()).await;
        assert_eq!(first.status, RunStatus::Succeeded, "{:?}", first.message);
        // 30 of 40 is above both the 10 % limit and the floor of 10 always-allowed deletions.
        for i in 0..30 {
            fs::remove_file(f.src().join(format!("keep{i}.txt"))).unwrap();
        }
        let blocked = f.run(&config, RunOptions::default()).await;
        assert_eq!(blocked.status, RunStatus::Blocked, "{:?}", blocked.message);
        assert_eq!(Fixture::count_files(&f.dst()), 40);
        let forced = f.run(&config, RunOptions { force: true, ..Default::default() }).await;
        assert_eq!(forced.status, RunStatus::Succeeded, "{:?}", forced.message);
        assert_eq!(Fixture::count_files(&f.dst()), 10);
    }

    #[tokio::test]
    async fn two_way_small_folders_may_always_delete_a_few() {
        let f = Fixture::new();
        for i in 0..12 {
            f.write(&format!("src/keep{i}.txt"), "k");
        }
        let config = f.config(Mode::Bidirectional, "dst");
        assert_eq!(f.run(&config, RunOptions::default()).await.status, RunStatus::Succeeded);
        for i in 0..3 {
            fs::remove_file(f.src().join(format!("keep{i}.txt"))).unwrap();
        }
        let run = f.run(&config, RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.message);
        assert_eq!(Fixture::count_files(&f.dst()), 9);
    }

    #[tokio::test]
    async fn a_stopped_mirror_does_not_keep_deleting() {
        let f = Fixture::new();
        for i in 0..40 {
            f.write(&format!("src/file{i}.txt"), "x");
        }
        let config = f.config(Mode::Mirror, "dst");
        assert_eq!(f.run(&config, RunOptions::default()).await.status, RunStatus::Succeeded);
        for i in 0..35 {
            fs::remove_file(f.src().join(format!("file{i}.txt"))).unwrap();
        }
        let first = f.run(&config, RunOptions::default()).await;
        assert_eq!(first.status, RunStatus::Blocked, "{:?}", first.message);
        let left = Fixture::count_files(&f.dst());
        for _ in 0..3 {
            let again = f.run(&config, RunOptions::default()).await;
            assert_eq!(again.status, RunStatus::Blocked, "{:?}", again.message);
            assert_eq!(Fixture::count_files(&f.dst()), left, "a stopped job must not delete another batch");
        }
        let forced = f.run(&config, RunOptions { force: true, ..Default::default() }).await;
        assert_eq!(forced.status, RunStatus::Succeeded);
        assert_eq!(Fixture::count_files(&f.dst()), 5);
    }

    #[tokio::test]
    async fn a_new_target_is_measured_again() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        let config = f.config(Mode::Mirror, "dst");
        assert_eq!(f.run(&config, RunOptions::default()).await.status, RunStatus::Succeeded);
        // The job now points at a folder full of other files.
        for i in 0..30 {
            f.write(&format!("other/keep{i}.txt"), "mine");
        }
        let moved = f.config(Mode::Mirror, "other");
        let run = f.run(&moved, RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Blocked, "{:?}", run.message);
        assert_eq!(Fixture::count_files(&f.root.join("other")), 30);
    }

    #[tokio::test]
    async fn an_empty_cloud_source_is_refused() {
        let f = Fixture::new();
        fake_cloud(&f);
        fs::create_dir_all(f.root.join("cloudroot/empty")).unwrap();
        f.write("dst/keep.txt", "keep");
        let mut config = f.config(Mode::Mirror, "dst");
        config.jobs[0].source = Place { location: "cloud".into(), path: "cloudroot/empty".into() };
        let run = f.run(&config, RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.message.unwrap_or_default().contains("is empty"));
        assert!(f.dst().join("keep.txt").exists());
    }

    #[tokio::test]
    async fn a_cancelled_two_way_run_leaves_no_lock_behind() {
        let f = Fixture::new();
        for i in 0..400 {
            f.write(&format!("src/dir{}/file{i}.bin", i % 20), &"x".repeat(4096));
        }
        let config = f.config(Mode::Bidirectional, "dst");
        let run_id = f.engine.start(&config, "test", "manual", RunOptions::default()).unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        f.engine.cancel("test");
        for _ in 0..800 {
            if f.engine.live_runs().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(f.engine.live_runs().is_empty(), "the cancel must end the run");
        let cancelled = f.history.recent(10).unwrap().into_iter().find(|run| run.id == run_id).unwrap();
        assert!(matches!(cancelled.status, RunStatus::Cancelled | RunStatus::Succeeded), "{:?}", cancelled.status);
        // The next run starts cleanly instead of failing on a stale lock.
        let next = f.run(&config, RunOptions::default()).await;
        assert_eq!(next.status, RunStatus::Succeeded, "{:?}", next.message);
    }

    #[tokio::test]
    async fn dry_run_changes_nothing() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        f.write("dst/stale.txt", "old");
        let run = f.run(&f.config(Mode::Mirror, "dst"), RunOptions { dry_run: true, ..Default::default() }).await;
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

        let forced = f.run(&config, RunOptions { force: true, ..Default::default() }).await;
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
        // 30 deletions, far over the limit (10 % of 40, at least 10): the dry run stops the
        // job before anything is deleted, not after the first ten are gone.
        assert_eq!(Fixture::count_files(&f.dst()), 40);
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
    #[test]
    fn a_server_source_goes_through_rclone() {
        let f = Fixture::new();
        let config = f.config(Mode::Mirror, "dst");
        let job = &config.jobs[0];
        let server = Resolved::Remote {
            destination: "u@box:/home/work/".into(),
            ssh: vec!["ssh".into()],
            display: "box:/home/work".into(),
            sftp: ":sftp,host=box:/home/work".into(),
        };
        let cloud = Resolved::Cloud { spec: "fake:bucket".into() };
        let local = Resolved::Local(f.dst());
        for (source, target) in [(&server, &local), (&server, &cloud), (&local, &server)] {
            let plan = Plan::new(job, &config, Path::new("rclone.conf"), source, target).unwrap();
            let rclone = matches!(plan.tool, Tool::Rclone { .. });
            // Only a push from this Mac to a server stays with rsync.
            assert_eq!(rclone, !matches!(source, Resolved::Local(_)), "{} -> {}", plan.source, plan.target);
        }
        let plan = Plan::new(job, &config, Path::new("rclone.conf"), &server, &local).unwrap();
        assert_eq!(plan.source, ":sftp,host=box:/home/work");
        assert_eq!(plan.target_path.as_deref(), Some(f.dst().as_path()));
        let plan = Plan::new(job, &config, Path::new("rclone.conf"), &cloud, &server).unwrap();
        assert!(matches!(plan.tool, Tool::Rclone { .. }));
        assert_eq!(plan.target, ":sftp,host=box:/home/work");
    }
}

#[cfg(test)]
mod plan_tests {
    use super::*;

    /// The server path of delete_snapshots (rsync syncing an empty folder with a filter) run
    /// against a local folder: it must remove exactly the named snapshots and nothing else.
    #[tokio::test]
    async fn deleting_snapshots_on_a_server_removes_only_those_folders() {
        let root = std::env::temp_dir().join(format!("clonq-delete-{}", uuid::Uuid::new_v4()));
        for dir in ["2026-01-01_10-00-00-000", "2026-01-02_10-00-00-000", "2026-01-03_10-00-00-000", "Photos"] {
            std::fs::create_dir_all(root.join(dir).join("inner")).unwrap();
            std::fs::write(root.join(dir).join("inner/f.txt"), dir).unwrap();
        }
        std::fs::write(root.join("notes.txt"), "user file").unwrap();
        let rsync = format!("{}/binaries/rsync-aarch64-apple-darwin", env!("CARGO_MANIFEST_DIR"));
        let plan = Plan {
            tool: Tool::Rsync,
            program: rsync,
            base_args: vec![],
            source: String::new(),
            target: root.to_string_lossy().into_owned(),
            source_path: None,
            target_path: None,
        };
        // "Photos" is no snapshot name and must be ignored even if asked for.
        let names = vec!["2026-01-01_10-00-00-000".to_string(), "2026-01-02_10-00-00-000".to_string(), "Photos".to_string()];
        delete_snapshots(&plan, &names).await.unwrap();
        assert!(!root.join("2026-01-01_10-00-00-000").exists());
        assert!(!root.join("2026-01-02_10-00-00-000").exists());
        assert!(root.join("2026-01-03_10-00-00-000/inner/f.txt").exists(), "a snapshot not named must stay");
        assert!(root.join("Photos/inner/f.txt").exists(), "a user folder must stay");
        assert_eq!(std::fs::read_to_string(root.join("notes.txt")).unwrap(), "user file");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rsh_quotes_paths_with_spaces() {
        let joined = shell_join(&["/usr/bin/ssh".into(), "-i".into(), "/Users/m/Library/Application Support/k".into()]);
        assert_eq!(joined, "/usr/bin/ssh -i '/Users/m/Library/Application Support/k'");
    }
}
