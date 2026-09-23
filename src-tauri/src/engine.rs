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

use crate::config::{Config, Endpoint, Job, Mode};
use crate::error::{Error, Result};
use crate::history::{FolderChange, History, Run, RunStatus, Sample};
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
    active: Arc<Mutex<HashMap<String, Active>>>,
}

impl Engine {
    pub fn new(emit: Emit, history: Arc<History>, log_dir: PathBuf) -> Self {
        Self { emit, history, log_dir, active: Arc::default() }
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
        let plan = Plan::for_job(&job, &config.rsync_path)?;

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
        log.write_all(format!("{} {}\n", plan.program, plan.base_args.join(" ")).as_bytes()).await?;

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
                    let percent = check.stats.delete_percent();
                    let allowed = job.safety.allowed_deletions(check.stats.target_entries_before());
                    if check.stats.deleted > allowed {
                        run.status = RunStatus::Blocked;
                        run.files_deleted = check.stats.deleted;
                        run.target_entries = check.stats.target_entries_before();
                        run.message = Some(format!(
                            "would delete {} of {} entries on the target ({percent:.1} %), limit is {} %",
                            check.stats.deleted,
                            check.stats.target_entries_before(),
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
        run.target_entries = if options.dry_run {
            result.stats.target_entries_before()
        } else {
            match job.mode {
                Mode::Mirror => result.stats.files,
                _ => result.stats.target_entries_before() + result.stats.created,
            }
        };
        run.status = match (result.cancelled, result.exit_code) {
            (true, _) => RunStatus::Cancelled,
            (false, Some(0)) => RunStatus::Succeeded,
            (false, Some(23 | 24)) => RunStatus::Partial,
            (false, Some(25)) => RunStatus::Blocked,
            _ => RunStatus::Failed,
        };
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
                                    log.write_all(format!("*deleting {path}\n").as_bytes()).await?;
                                    if report {
                                        let deleted = result.deleted_lines;
                                        self.update(job_id, |live| live.files_deleted = deleted);
                                    }
                                }
                                Line::Changed { code, size, path } => {
                                    log.write_all(format!("{code} {size} {path}\n").as_bytes()).await?;
                                    let change = Change::of(code);
                                    match change {
                                        Change::NewFile => {
                                            result.files_new += 1;
                                            result.bytes_new += size;
                                        }
                                        Change::ChangedFile => {
                                            result.files_changed += 1;
                                            result.bytes_changed += size;
                                        }
                                        Change::NewOther | Change::Metadata => {}
                                    }
                                    if matches!(change, Change::NewFile | Change::ChangedFile) {
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
                                }
                                Line::Stat(stat) => {
                                    result.stats.apply(stat);
                                    log.write_all(format!("{text}\n").as_bytes()).await?;
                                }
                                Line::Other(other) => {
                                    if !other.trim().is_empty() {
                                        log.write_all(format!("{other}\n").as_bytes()).await?;
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
struct Plan {
    program: String,
    base_args: Vec<String>,
    source: String,
    target: String,
    source_path: PathBuf,
    target_path: PathBuf,
}

impl Plan {
    fn for_job(job: &Job, rsync: &str) -> Result<Self> {
        let (Endpoint::Local { path: source }, Endpoint::Local { path: target }) = (&job.source, &job.target) else {
            return Err(Error::Job("remote endpoints arrive with the Storage Box connection (step 2)".into()));
        };
        let mut args: Vec<String> = [
            "--archive",
            "--hard-links",
            "--acls",
            "--xattrs",
            "--crtimes",
            "--8-bit-output",
            "--no-inc-recursive",
            "--mkpath",
            "--info=progress2,stats2",
            "--out-format=%i %l %n%L",
            "--outbuf=L",
        ]
        .map(String::from)
        .to_vec();
        match job.mode {
            Mode::Mirror => args.push("--delete".into()),
            Mode::Backup => {}
            Mode::Blind | Mode::Bidirectional => {
                return Err(Error::Job(format!("mode {:?} is not built yet", job.mode)));
            }
        }
        args.extend(job.excludes.iter().map(|pattern| format!("--exclude={pattern}")));
        Ok(Self {
            program: rsync.to_string(),
            base_args: args,
            // The trailing slash copies the folder's contents, not the folder itself.
            source: format!("{}/", source.trim_end_matches('/')),
            target: target.trim_end_matches('/').to_string(),
            source_path: PathBuf::from(source),
            target_path: PathBuf::from(target),
        })
    }

    /// An absent or empty source must never be mirrored over a full target.
    fn check_source(&self) -> Result<()> {
        let path = &self.source_path;
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

    /// The target folder may be missing, but its parent and its volume must exist,
    /// or rsync would create the path on the system disk.
    fn check_target(&self) -> Result<()> {
        let path = &self.target_path;
        let parent = path
            .parent()
            .ok_or_else(|| Error::Job(format!("target {} has no parent folder", path.display())))?;
        if !parent.is_dir() {
            return Err(Error::Job(format!("target folder {} does not exist", parent.display())));
        }
        check_volume_mounted(path)
    }
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
}

/// What a finished run stores beside its row.
#[derive(Default)]
struct Detail {
    samples: Vec<Sample>,
    folders: Vec<FolderChange>,
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
    use crate::config::{Host, Safety};
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
            let engine = Engine::new(emit, history.clone(), root.join("logs"));
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

        fn config(&self, mode: Mode, target: PathBuf) -> Config {
            Config {
                version: 1,
                rsync_path: RSYNC.into(),
                ui: crate::config::UiSettings::default(),
                hosts: Vec::<Host>::new(),
                jobs: vec![Job {
                    id: "test".into(),
                    name: "Test".into(),
                    enabled: false,
                    source: Endpoint::Local { path: self.src().to_string_lossy().into_owned() },
                    target: Endpoint::Local { path: target.to_string_lossy().into_owned() },
                    mode,
                    excludes: vec!["node_modules/".into()],
                    safety: Safety::default(),
                    ring: None,
                }],
            }
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

        fn count_files(path: &Path) -> usize {
            fs::read_dir(path).map(|entries| entries.count()).unwrap_or(0)
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
        let run = f.run(&f.config(Mode::Mirror, f.dst()), RunOptions::default()).await;
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
        let config = f.config(Mode::Mirror, f.dst());
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

    #[tokio::test]
    async fn dry_run_changes_nothing() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        f.write("dst/stale.txt", "old");
        let run = f.run(&f.config(Mode::Mirror, f.dst()), RunOptions { dry_run: true, force: false }).await;
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
        let run = f.run(&f.config(Mode::Mirror, f.dst()), RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.message.unwrap().contains("is empty"));
        assert!(f.dst().join("keep.txt").exists());
    }

    #[tokio::test]
    async fn missing_volume_is_refused() {
        let f = Fixture::new();
        f.write("src/a.txt", "a");
        let target = PathBuf::from("/Volumes/clonq-missing-volume/WORK");
        let run = f.run(&f.config(Mode::Mirror, target), RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Failed);
        let message = run.message.unwrap();
        assert!(message.contains("does not exist") || message.contains("not connected"), "{message}");
        assert!(!Path::new("/Volumes/clonq-missing-volume").exists());
    }

    #[tokio::test]
    async fn first_mirror_that_would_wipe_the_target_is_blocked() {
        let f = Fixture::new();
        f.write("src/only.txt", "1");
        for i in 0..30 {
            f.write(&format!("dst/stale{i}.txt"), "old");
        }
        let config = f.config(Mode::Mirror, f.dst());
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
        let config = f.config(Mode::Mirror, f.dst());
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
        let run = f.run(&f.config(Mode::Backup, f.dst()), RunOptions::default()).await;
        assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.message);
        assert!(f.dst().join("a.txt").exists());
        assert!(f.dst().join("stale.txt").exists());
    }
}
