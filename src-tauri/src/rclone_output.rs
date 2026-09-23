//! Reads what rclone prints with `--use-json-log -v --stats 1s --stats-log-level NOTICE`:
//! one JSON object per line, file events at level info, a stats block every second.

use serde::Deserialize;

use crate::rsync_output::{Change, Progress};

#[derive(Debug, PartialEq)]
pub enum Event {
    /// A file was copied (or, in a dry run, would be).
    File { change: Change, size: i64, path: String },
    Deleted(String),
    /// A stats block: progress for the live view and the counters so far.
    Stats { progress: Progress, totals: Totals },
    Error(String),
    Other,
}

/// The counters of the latest stats block.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Totals {
    pub bytes: i64,
    pub total_bytes: i64,
    pub transfers: i64,
    pub deletes: i64,
    pub errors: i64,
    pub listed: i64,
}

#[derive(Deserialize)]
struct Line {
    #[serde(default)]
    level: String,
    #[serde(default)]
    msg: String,
    #[serde(default)]
    object: Option<String>,
    #[serde(default)]
    size: Option<i64>,
    #[serde(default)]
    skipped: Option<String>,
    #[serde(default)]
    stats: Option<Stats>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    #[serde(default)]
    bytes: i64,
    #[serde(default)]
    total_bytes: i64,
    #[serde(default)]
    transfers: i64,
    #[serde(default)]
    total_transfers: i64,
    #[serde(default)]
    deletes: i64,
    #[serde(default)]
    errors: i64,
    #[serde(default)]
    listed: i64,
    #[serde(default)]
    eta: Option<f64>,
}

pub fn parse(text: &str) -> Event {
    let Ok(line) = serde_json::from_str::<Line>(text) else {
        return if text.trim().is_empty() { Event::Other } else { Event::Error(text.trim().to_string()) };
    };
    if let Some(stats) = line.stats {
        let percent = if stats.total_bytes > 0 { stats.bytes as f64 * 100.0 / stats.total_bytes as f64 } else { 0.0 };
        return Event::Stats {
            progress: Progress {
                bytes: stats.bytes,
                percent: percent.min(100.0),
                eta_seconds: stats.eta.map_or(0, |eta| eta.round() as i64),
                transferred_files: Some(stats.transfers),
                remaining_files: Some((stats.total_transfers - stats.transfers).max(0)),
                total_files: Some(stats.total_transfers),
            },
            totals: Totals {
                bytes: stats.bytes,
                total_bytes: stats.total_bytes,
                transfers: stats.transfers,
                deletes: stats.deletes,
                errors: stats.errors,
                listed: stats.listed,
            },
        };
    }
    let path = line.object.unwrap_or_default();
    match (line.msg.as_str(), line.skipped.as_deref()) {
        ("Copied (new)", _) | ("Copied (server-side copy)", _) => Event::File { change: Change::NewFile, size: line.size.unwrap_or(0), path },
        ("Copied (replaced existing)", _) => Event::File { change: Change::ChangedFile, size: line.size.unwrap_or(0), path },
        ("Deleted", _) => Event::Deleted(path),
        // In a dry run rclone does not tell new from changed; both count as a transfer.
        (_, Some("copy")) => Event::File { change: Change::NewFile, size: line.size.unwrap_or(0), path },
        (_, Some("delete")) => Event::Deleted(path),
        _ if line.level == "error" => Event::Error(if path.is_empty() { line.msg } else { format!("{path}: {}", line.msg) }),
        _ => Event::Other,
    }
}

/// Whether rclone stopped because `--max-delete` was reached.
pub fn is_delete_limit(error: &str) -> bool {
    error.contains("--max-delete threshold reached")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines copied from a real rclone v1.75.1 run on macOS 27.

    #[test]
    fn copied_and_deleted() {
        let new = r#"{"time":"2026-09-23T11:43:07+02:00","level":"info","msg":"Copied (new)","size":100,"object":"a/new.bin","objectType":"*s3.Object","source":"operations/copy.go:380"}"#;
        assert_eq!(parse(new), Event::File { change: Change::NewFile, size: 100, path: "a/new.bin".into() });
        let replaced = r#"{"level":"info","msg":"Copied (replaced existing)","size":1000,"object":"a/f1.bin"}"#;
        assert_eq!(parse(replaced), Event::File { change: Change::ChangedFile, size: 1000, path: "a/f1.bin".into() });
        let deleted = r#"{"level":"info","msg":"Deleted","object":"extra.txt","objectType":"*local.Object","source":"operations/operations.go:581"}"#;
        assert_eq!(parse(deleted), Event::Deleted("extra.txt".into()));
    }

    #[test]
    fn dry_run_lines() {
        let copy = r#"{"level":"notice","msg":"Skipped copy as --dry-run is set (size 1000)","skipped":"copy","size":1000,"object":"a/f1.bin"}"#;
        assert_eq!(parse(copy), Event::File { change: Change::NewFile, size: 1000, path: "a/f1.bin".into() });
        let delete = r#"{"level":"notice","msg":"Skipped delete as --dry-run is set (size 5)","skipped":"delete","size":5,"object":"extra.txt"}"#;
        assert_eq!(parse(delete), Event::Deleted("extra.txt".into()));
        let dir = r#"{"level":"notice","msg":"Skipped set directory modification time as --dry-run is set (size 1Ki)","skipped":"set directory modification time","size":1024,"object":"a"}"#;
        assert_eq!(parse(dir), Event::Other);
    }

    #[test]
    fn stats_block_carries_progress_and_totals() {
        let stats = r#"{"level":"notice","msg":"\nTransferred: ...","stats":{"bytes":6000000,"checks":3,"deletedDirs":0,"deletes":2,"elapsedTime":0.008,"errors":2,"eta":null,"fatalError":true,"lastError":"failed to delete 1 files","listed":35,"totalBytes":6000000,"totalChecks":3,"totalTransfers":30,"transfers":30},"source":"accounting/stats.go:549"}"#;
        let Event::Stats { progress, totals } = parse(stats) else { panic!("not stats") };
        assert_eq!(progress.percent, 100.0);
        assert_eq!(progress.total_files, Some(30));
        assert_eq!(totals, Totals { bytes: 6_000_000, total_bytes: 6_000_000, transfers: 30, deletes: 2, errors: 2, listed: 35 });
    }

    #[test]
    fn errors_and_the_delete_limit() {
        let line = r#"{"level":"error","msg":"Got fatal error on delete: --max-delete threshold reached","object":"x"}"#;
        let Event::Error(message) = parse(line) else { panic!("not an error") };
        assert!(is_delete_limit(&message));
        assert_eq!(parse("plain text"), Event::Error("plain text".into()));
    }
}
