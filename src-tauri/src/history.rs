//! Every run lands in SQLite: when, why, how it ended and what it moved.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Running,
    Succeeded,
    /// Finished, but rsync reported files it could not handle.
    Partial,
    /// Stopped by a safety rule.
    Blocked,
    Failed,
    Cancelled,
}

impl RunStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Partial => "partial",
            Self::Blocked => "blocked",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "running" => Self::Running,
            "succeeded" => Self::Succeeded,
            "partial" => Self::Partial,
            "blocked" => Self::Blocked,
            "cancelled" => Self::Cancelled,
            _ => Self::Failed,
        }
    }

    pub fn completed(self) -> bool {
        matches!(self, Self::Succeeded | Self::Partial)
    }
}

/// Throughput at one moment of a run: milliseconds since start, bytes and files so far.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Sample(pub i64, pub i64, pub i64);

/// What changed below one folder during a run.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderChange {
    pub folder: String,
    pub files: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub job_id: String,
    pub trigger: String,
    pub dry_run: bool,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: RunStatus,
    /// Entries the source holds after excludes.
    pub files_total: i64,
    pub files_transferred: i64,
    pub files_new: i64,
    pub files_changed: i64,
    pub files_deleted: i64,
    /// Two-way sync: files that changed on both sides.
    pub files_conflicted: i64,
    /// Size of the sent files, counted whole.
    pub bytes_transferred: i64,
    pub bytes_new: i64,
    pub bytes_changed: i64,
    /// Size of everything the source holds after excludes.
    pub source_bytes: i64,
    /// Bytes that crossed as new data, and bytes rebuilt from the target's own blocks.
    pub literal_bytes: i64,
    pub matched_bytes: i64,
    /// Bytes that went over the pipe in both directions, protocol included.
    pub wire_bytes: i64,
    /// Estimated number of entries on the target after the run.
    pub target_entries: i64,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
    pub log_path: String,
    /// What the run actually moved between: resolved source, target and mode.
    /// A measured target size only counts for runs with the same key.
    #[serde(skip)]
    pub plan_key: String,
}

/// A run with the detail that only the job view needs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    #[serde(flatten)]
    pub run: Run,
    pub samples: Vec<Sample>,
    pub folders: Vec<FolderChange>,
}

pub struct History {
    connection: Mutex<Connection>,
}

/// Schema steps, applied in order; `PRAGMA user_version` counts how many ran.
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE runs (
         id TEXT PRIMARY KEY,
         job_id TEXT NOT NULL,
         trigger TEXT NOT NULL,
         dry_run INTEGER NOT NULL,
         started_at TEXT NOT NULL,
         finished_at TEXT,
         status TEXT NOT NULL,
         files_total INTEGER NOT NULL DEFAULT 0,
         files_transferred INTEGER NOT NULL DEFAULT 0,
         files_deleted INTEGER NOT NULL DEFAULT 0,
         bytes_transferred INTEGER NOT NULL DEFAULT 0,
         target_entries INTEGER NOT NULL DEFAULT 0,
         exit_code INTEGER,
         message TEXT,
         log_path TEXT NOT NULL
     );
     CREATE INDEX runs_job_started ON runs (job_id, started_at DESC);
     CREATE INDEX runs_started ON runs (started_at DESC);",
    "ALTER TABLE runs ADD COLUMN files_new INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN files_changed INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN bytes_new INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN bytes_changed INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN source_bytes INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN literal_bytes INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN matched_bytes INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN wire_bytes INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE runs ADD COLUMN samples TEXT NOT NULL DEFAULT '[]';
     CREATE TABLE run_folders (
         run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
         folder TEXT NOT NULL,
         files INTEGER NOT NULL,
         bytes INTEGER NOT NULL,
         PRIMARY KEY (run_id, folder)
     );",
    "ALTER TABLE runs ADD COLUMN files_conflicted INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE runs ADD COLUMN plan_key TEXT NOT NULL DEFAULT '';",
];

impl History {
    pub fn open(path: &Path) -> Result<Self> {
        let mut connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        migrate(&mut connection)?;
        // A run still marked as running belongs to a process that no longer exists.
        connection.execute(
            "UPDATE runs SET status = 'failed', message = 'the app quit during this run'
             WHERE status = 'running'",
            [],
        )?;
        Ok(Self { connection: Mutex::new(connection) })
    }

    pub fn insert(&self, run: &Run) -> Result<()> {
        let connection = self.connection.lock().expect("history lock");
        connection.execute(
            "INSERT INTO runs (id, job_id, trigger, dry_run, started_at, status, log_path, plan_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                run.id,
                run.job_id,
                run.trigger,
                run.dry_run,
                run.started_at.to_rfc3339(),
                run.status.as_str(),
                run.log_path,
                run.plan_key,
            ],
        )?;
        Ok(())
    }

    pub fn finish(&self, run: &Run, samples: &[Sample], folders: &[FolderChange]) -> Result<()> {
        let mut connection = self.connection.lock().expect("history lock");
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE runs SET finished_at = ?2, status = ?3, files_total = ?4,
                 files_transferred = ?5, files_new = ?6, files_changed = ?7, files_deleted = ?8,
                 bytes_transferred = ?9, bytes_new = ?10, bytes_changed = ?11, source_bytes = ?12,
                 literal_bytes = ?13, matched_bytes = ?14, wire_bytes = ?15, target_entries = ?16,
                 exit_code = ?17, message = ?18, samples = ?19, files_conflicted = ?20
             WHERE id = ?1",
            params![
                run.id,
                run.finished_at.map(|at| at.to_rfc3339()),
                run.status.as_str(),
                run.files_total,
                run.files_transferred,
                run.files_new,
                run.files_changed,
                run.files_deleted,
                run.bytes_transferred,
                run.bytes_new,
                run.bytes_changed,
                run.source_bytes,
                run.literal_bytes,
                run.matched_bytes,
                run.wire_bytes,
                run.target_entries,
                run.exit_code,
                run.message,
                serde_json::to_string(samples)?,
                run.files_conflicted,
            ],
        )?;
        {
            let mut insert = transaction
                .prepare("INSERT INTO run_folders (run_id, folder, files, bytes) VALUES (?1, ?2, ?3, ?4)")?;
            for folder in folders {
                insert.execute(params![run.id, folder.folder, folder.files, folder.bytes])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn recent(&self, limit: i64) -> Result<Vec<Run>> {
        let connection = self.connection.lock().expect("history lock");
        let mut statement =
            connection.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?1")?;
        let runs = statement
            .query_map([limit], row_to_run)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(runs)
    }

    /// Real (not dry) runs of one job since `since`, newest first.
    pub fn job_runs_since(&self, job_id: &str, since: DateTime<Utc>) -> Result<Vec<Run>> {
        let connection = self.connection.lock().expect("history lock");
        let mut statement = connection.prepare(
            "SELECT * FROM runs WHERE job_id = ?1 AND dry_run = 0 AND started_at >= ?2
             ORDER BY started_at DESC",
        )?;
        let runs = statement
            .query_map(params![job_id, since.to_rfc3339()], row_to_run)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(runs)
    }

    /// All real runs of one job, newest first, statuses only (for streaks).
    pub fn job_statuses(&self, job_id: &str) -> Result<Vec<RunStatus>> {
        let connection = self.connection.lock().expect("history lock");
        let mut statement = connection.prepare(
            "SELECT status FROM runs WHERE job_id = ?1 AND dry_run = 0 AND status != 'running'
             ORDER BY started_at DESC",
        )?;
        let statuses = statement
            .query_map([job_id], |row| row.get::<_, String>(0))?
            .map(|status| status.map(|status| RunStatus::parse(&status)))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(statuses)
    }

    /// Sums over every completed real run of one job (or of all jobs with `None`).
    pub fn totals(&self, job_id: Option<&str>) -> Result<Totals> {
        let connection = self.connection.lock().expect("history lock");
        let totals = connection.query_row(
            "SELECT COUNT(*), COALESCE(SUM(files_new + files_changed), 0),
                    COALESCE(SUM(bytes_new + bytes_changed), 0), COALESCE(SUM(wire_bytes), 0),
                    COALESCE(SUM(files_deleted), 0)
             FROM runs WHERE dry_run = 0 AND status IN ('succeeded', 'partial')
               AND (?1 IS NULL OR job_id = ?1)",
            [job_id],
            |row| {
                Ok(Totals {
                    runs: row.get(0)?,
                    files: row.get(1)?,
                    bytes: row.get(2)?,
                    wire_bytes: row.get(3)?,
                    deleted: row.get(4)?,
                })
            },
        )?;
        Ok(totals)
    }

    /// The newest real run of every job.
    pub fn latest_per_job(&self) -> Result<Vec<Run>> {
        let connection = self.connection.lock().expect("history lock");
        let mut statement = connection.prepare(
            "SELECT * FROM runs r WHERE dry_run = 0 AND started_at = (
                 SELECT MAX(started_at) FROM runs WHERE job_id = r.job_id AND dry_run = 0
             )",
        )?;
        let runs = statement
            .query_map([], row_to_run)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(runs)
    }

    /// The newest completed real run of one job, with samples and folders.
    pub fn last_completed(&self, job_id: &str) -> Result<Option<RunDetail>> {
        let connection = self.connection.lock().expect("history lock");
        let found = connection
            .query_row(
                "SELECT * FROM runs WHERE job_id = ?1 AND dry_run = 0
                   AND status IN ('succeeded', 'partial')
                 ORDER BY started_at DESC LIMIT 1",
                [job_id],
                |row| Ok((row_to_run(row)?, row.get::<_, String>("samples")?)),
            )
            .optional()?;
        let Some((run, samples)) = found else { return Ok(None) };
        let samples: Vec<Sample> = serde_json::from_str(&samples).unwrap_or_default();
        let mut statement = connection.prepare(
            "SELECT folder, files, bytes FROM run_folders WHERE run_id = ?1 ORDER BY bytes DESC",
        )?;
        let folders = statement
            .query_map([&run.id], |row| {
                Ok(FolderChange { folder: row.get(0)?, files: row.get(1)?, bytes: row.get(2)? })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Some(RunDetail { run, samples, folders }))
    }

    /// Folder changes of one job's real runs since `since`, summed per folder.
    pub fn folders_since(&self, job_id: &str, since: DateTime<Utc>, limit: i64) -> Result<Vec<FolderChange>> {
        let connection = self.connection.lock().expect("history lock");
        let mut statement = connection.prepare(
            "SELECT f.folder, SUM(f.files), SUM(f.bytes) FROM run_folders f
             JOIN runs r ON r.id = f.run_id
             WHERE r.job_id = ?1 AND r.dry_run = 0 AND r.started_at >= ?2
             GROUP BY f.folder ORDER BY SUM(f.bytes) DESC, SUM(f.files) DESC LIMIT ?3",
        )?;
        let folders = statement
            .query_map(params![job_id, since.to_rfc3339(), limit], |row| {
                Ok(FolderChange { folder: row.get(0)?, files: row.get(1)?, bytes: row.get(2)? })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(folders)
    }

    pub fn log_path(&self, run_id: &str) -> Result<Option<String>> {
        let connection = self.connection.lock().expect("history lock");
        Ok(connection.query_row("SELECT log_path FROM runs WHERE id = ?1", [run_id], |row| row.get(0)).optional()?)
    }

    /// Whether the job ever finished a real run.
    pub fn has_completed(&self, job_id: &str) -> Result<bool> {
        let connection = self.connection.lock().expect("history lock");
        Ok(connection.query_row(
            "SELECT EXISTS (SELECT 1 FROM runs WHERE job_id = ?1 AND dry_run = 0 AND status IN ('succeeded', 'partial'))",
            [job_id],
            |row| row.get(0),
        )?)
    }

    /// When the job last started a real run, whatever the trigger or outcome.
    pub fn last_started(&self, job_id: &str) -> Result<Option<DateTime<Utc>>> {
        let connection = self.connection.lock().expect("history lock");
        let started: Option<String> = connection
            .query_row(
                "SELECT started_at FROM runs WHERE job_id = ?1 AND dry_run = 0 ORDER BY started_at DESC LIMIT 1",
                [job_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(started.as_deref().map(parse_time))
    }

    /// When the job last started an integrity check, by hand or on schedule.
    pub fn last_verify(&self, job_id: &str) -> Result<Option<DateTime<Utc>>> {
        let connection = self.connection.lock().expect("history lock");
        let started: Option<String> = connection
            .query_row(
                "SELECT started_at FROM runs WHERE job_id = ?1 AND trigger IN ('verify', 'verifyScheduled') ORDER BY started_at DESC LIMIT 1",
                [job_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(started.as_deref().map(parse_time))
    }

    /// The log of the job's newest integrity check.
    pub fn last_verify_log(&self, job_id: &str) -> Result<Option<String>> {
        let connection = self.connection.lock().expect("history lock");
        Ok(connection
            .query_row(
                "SELECT log_path FROM runs WHERE job_id = ?1 AND trigger IN ('verify', 'verifyScheduled') AND status != 'running' ORDER BY started_at DESC LIMIT 1",
                [job_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// Target size from the newest successful real run with the same plan, if any.
    pub fn last_target_entries(&self, job_id: &str, plan_key: &str) -> Result<Option<i64>> {
        let connection = self.connection.lock().expect("history lock");
        let entries = connection
            .query_row(
                "SELECT target_entries FROM runs
                 WHERE job_id = ?1 AND plan_key = ?2 AND dry_run = 0 AND status IN ('succeeded', 'partial')
                 ORDER BY started_at DESC LIMIT 1",
                params![job_id, plan_key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(entries)
    }

    /// How the newest finished real run of a job ended.
    pub fn last_real_status(&self, job_id: &str) -> Result<Option<RunStatus>> {
        let connection = self.connection.lock().expect("history lock");
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM runs WHERE job_id = ?1 AND dry_run = 0 AND status != 'running'
                 ORDER BY started_at DESC LIMIT 1",
                [job_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(status.as_deref().map(RunStatus::parse))
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub runs: i64,
    /// New and changed files, summed over all runs.
    pub files: i64,
    /// Size of new and changed files, summed over all runs.
    pub bytes: i64,
    /// What actually went over the pipe.
    pub wire_bytes: i64,
    pub deleted: i64,
}

fn migrate(connection: &mut Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let mut done = usize::try_from(version).unwrap_or(0);
    // The first builds created the runs table without counting versions.
    let has_runs: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs')",
        [],
        |row| row.get(0),
    )?;
    if done == 0 && has_runs {
        connection.execute_batch("PRAGMA user_version = 1")?;
        done = 1;
    }
    for (index, step) in MIGRATIONS.iter().enumerate().skip(done) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(step)?;
        transaction.execute_batch(&format!("PRAGMA user_version = {}", index + 1))?;
        transaction.commit()?;
    }
    Ok(())
}

fn row_to_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<Run> {
    let started: String = row.get("started_at")?;
    let finished: Option<String> = row.get("finished_at")?;
    let status: String = row.get("status")?;
    Ok(Run {
        id: row.get("id")?,
        job_id: row.get("job_id")?,
        trigger: row.get("trigger")?,
        dry_run: row.get("dry_run")?,
        started_at: parse_time(&started),
        finished_at: finished.as_deref().map(parse_time),
        status: RunStatus::parse(&status),
        files_total: row.get("files_total")?,
        files_transferred: row.get("files_transferred")?,
        files_new: row.get("files_new")?,
        files_changed: row.get("files_changed")?,
        files_deleted: row.get("files_deleted")?,
        files_conflicted: row.get("files_conflicted")?,
        bytes_transferred: row.get("bytes_transferred")?,
        bytes_new: row.get("bytes_new")?,
        bytes_changed: row.get("bytes_changed")?,
        source_bytes: row.get("source_bytes")?,
        literal_bytes: row.get("literal_bytes")?,
        matched_bytes: row.get("matched_bytes")?,
        wire_bytes: row.get("wire_bytes")?,
        target_entries: row.get("target_entries")?,
        exit_code: row.get("exit_code")?,
        message: row.get("message")?,
        log_path: row.get("log_path")?,
        plan_key: row.get("plan_key")?,
    })
}

fn parse_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|at| at.with_timezone(&Utc))
        .unwrap_or_default()
}
