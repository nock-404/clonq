//! Versioned backups: every run becomes a dated snapshot folder in the target, and files that
//! did not change are hard links to the previous snapshot (`rsync --link-dest`), so they take
//! no extra space. A snapshot counts only once its marker file exists; a run that stopped
//! halfway leaves a folder without it, which the next run removes.
//!
//! Thinning keeps every snapshot of the last day, the newest of each day for a month, and the
//! newest of each week after that. The newest snapshot is never removed.

use std::collections::BTreeSet;
use std::path::Path;

use chrono::{Datelike, Duration, Local, NaiveDateTime};
use tokio::process::Command;

use crate::error::Result;

/// Written into a snapshot when its run has finished.
pub const MARKER: &str = ".clonq-snapshot";

fn parse(stamp: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d_%H-%M-%S-%3f")
        .or_else(|_| NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d_%H-%M-%S"))
        .ok()
}

/// The snapshots to keep among `stamps` (complete ones only), seen from `now`.
pub fn keep(stamps: &[String], now: NaiveDateTime) -> BTreeSet<String> {
    let mut dated: Vec<(NaiveDateTime, &String)> = stamps.iter().filter_map(|stamp| parse(stamp).map(|at| (at, stamp))).collect();
    // Newest first, so the first one seen in a day or week is the one kept.
    dated.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    let mut kept = BTreeSet::new();
    let mut days = BTreeSet::new();
    let mut weeks = BTreeSet::new();
    for (index, (at, stamp)) in dated.iter().enumerate() {
        let age = now - *at;
        let keep = if index == 0 || age < Duration::days(1) {
            true
        } else if age < Duration::days(30) {
            days.insert(at.date())
        } else {
            let week = at.iso_week();
            weeks.insert((week.year(), week.week()))
        };
        if keep {
            kept.insert((*stamp).clone());
        }
    }
    kept
}

/// The local time `now` as the snapshots name it.
pub fn now() -> NaiveDateTime {
    Local::now().naive_local()
}

/// Snapshot folders directly in a local target: (complete, incomplete).
pub fn list_local(target: &Path) -> (Vec<String>, Vec<String>) {
    let mut complete = Vec::new();
    let mut incomplete = Vec::new();
    if let Ok(entries) = std::fs::read_dir(target) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !entry.path().is_dir() || !crate::archive::is_stamp(&name) {
                continue;
            }
            if entry.path().join(MARKER).is_file() { complete.push(name) } else { incomplete.push(name) }
        }
    }
    complete.sort();
    incomplete.sort();
    (complete, incomplete)
}

/// The same for a server, listed with rsync itself: no shell is needed there.
/// `rsh` is the `--rsh=` argument, `base` the target with a trailing slash.
pub async fn list_remote(rsync: &str, rsh: &[String], base: &str) -> Result<(Vec<String>, Vec<String>)> {
    let output = Command::new(rsync)
        .env("LC_ALL", "C")
        .args(rsh)
        .args(["--list-only", "-r", "--include=/*/", &format!("--include=/*/{MARKER}"), "--exclude=*"])
        .arg(base)
        .output()
        .await?;
    // No target folder yet means no snapshots yet.
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("No such file or directory") {
            return Ok((Vec::new(), Vec::new()));
        }
        return Err(crate::error::Error::Job(crate::ssh::explain(&stderr)));
    }
    let mut folders = BTreeSet::new();
    let mut marked = BTreeSet::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(path) = line.split_whitespace().last() else { continue };
        match path.split_once('/') {
            Some((folder, MARKER)) => {
                marked.insert(folder.to_string());
            }
            None if line.starts_with('d') && crate::archive::is_stamp(path) => {
                folders.insert(path.to_string());
            }
            _ => {}
        }
    }
    let complete = folders.iter().filter(|name| marked.contains(*name)).cloned().collect();
    let incomplete = folders.iter().filter(|name| !marked.contains(*name)).cloned().collect();
    Ok((complete, incomplete))
}

/// A stamp as a date and time, for tests that need a fixed "now".
#[cfg(test)]
fn at(stamp: &str) -> NaiveDateTime {
    parse(stamp).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamps(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_last_day_keeps_everything() {
        let list = stamps(&["2026-09-24_08-00-00-000", "2026-09-24_09-00-00-000", "2026-09-24_10-00-00-000"]);
        assert_eq!(keep(&list, at("2026-09-24_12-00-00-000")).len(), 3);
    }

    #[test]
    fn older_than_a_day_keeps_the_newest_per_day() {
        let list = stamps(&["2026-09-20_08-00-00-000", "2026-09-20_18-00-00-000", "2026-09-21_09-00-00-000", "2026-09-24_10-00-00-000"]);
        let kept = keep(&list, at("2026-09-24_12-00-00-000"));
        assert!(kept.contains("2026-09-20_18-00-00-000"));
        assert!(!kept.contains("2026-09-20_08-00-00-000"), "only the newest of that day");
        assert!(kept.contains("2026-09-21_09-00-00-000"));
        assert!(kept.contains("2026-09-24_10-00-00-000"));
    }

    #[test]
    fn older_than_a_month_keeps_the_newest_per_week() {
        // 2026-06-01 is a Monday; the week runs to Sunday 2026-06-07.
        let list = stamps(&["2026-06-01_10-00-00-000", "2026-06-03_10-00-00-000", "2026-06-07_10-00-00-000", "2026-06-08_10-00-00-000", "2026-09-24_10-00-00-000"]);
        let kept = keep(&list, at("2026-09-24_12-00-00-000"));
        assert!(kept.contains("2026-06-07_10-00-00-000"), "newest of its week");
        assert!(!kept.contains("2026-06-03_10-00-00-000"));
        assert!(!kept.contains("2026-06-01_10-00-00-000"));
        assert!(kept.contains("2026-06-08_10-00-00-000"), "the next week has its own");
    }

    #[test]
    fn the_newest_is_kept_however_old() {
        let list = stamps(&["2020-01-01_10-00-00", "2020-01-02_10-00-00"]);
        let kept = keep(&list, at("2026-09-24_12-00-00-000"));
        assert!(kept.contains("2020-01-02_10-00-00"));
        assert_eq!(kept.len(), 2, "different weeks, both kept");
    }

    #[test]
    fn names_that_are_no_snapshot_are_never_touched() {
        let list = stamps(&["Photos", "2026-09-24_10-00-00-000"]);
        let kept = keep(&list, at("2026-09-24_12-00-00-000"));
        assert_eq!(kept.len(), 1, "keep() only speaks about snapshots; callers never delete other names");
    }
}
