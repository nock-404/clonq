//! Reads a run's log back as entries: what was new, changed, deleted or failed.

use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    New,
    Changed,
    Deleted,
    /// Would have been deleted; kept for a run the safety rule stopped.
    Planned,
    Error,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub kind: EntryKind,
    pub size: Option<i64>,
    pub path: String,
    /// For a planned deletion: whether it was due on the source rather than the target.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub on_source: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub entries: Vec<Entry>,
    /// Matching entries in the whole log.
    pub total: usize,
}

/// Log markers of a deletion the run planned, on the target or on the source.
pub const PLANNED_ON_TARGET: &str = "x ";
pub const PLANNED_ON_SOURCE: &str = "X ";

pub fn parse_line(line: &str) -> Option<Entry> {
    let (marker, rest) = line.split_at_checked(2)?;
    let sized = |kind| {
        let (size, path) = rest.split_once(' ')?;
        Some(Entry { kind, size: size.parse().ok(), path: path.to_string(), on_source: false })
    };
    let bare = |kind, on_source| Some(Entry { kind, size: None, path: rest.to_string(), on_source });
    match marker {
        "+ " => sized(EntryKind::New),
        "~ " => sized(EntryKind::Changed),
        "- " => bare(EntryKind::Deleted, false),
        PLANNED_ON_TARGET => bare(EntryKind::Planned, false),
        PLANNED_ON_SOURCE => bare(EntryKind::Planned, true),
        "! " => bare(EntryKind::Error, false),
        _ => None,
    }
}

/// One page of entries, optionally of one kind and containing `query`. Planned
/// deletions are listed only for a run that was stopped before deleting
/// (`planned`); otherwise the real deletions stand for them.
pub fn read(path: &Path, kind: Option<EntryKind>, query: &str, offset: usize, limit: usize, planned: bool) -> Result<Page> {
    let file = std::fs::File::open(path)?;
    let needle = query.trim().to_lowercase();
    let mut entries = Vec::new();
    let mut total = 0;
    for line in BufReader::new(file).lines() {
        let Some(entry) = parse_line(&line?) else { continue };
        if entry.kind == EntryKind::Planned && !planned {
            continue;
        }
        if kind.is_some_and(|kind| entry.kind != kind) {
            continue;
        }
        if !needle.is_empty() && !entry.path.to_lowercase().contains(&needle) {
            continue;
        }
        if total >= offset && entries.len() < limit {
            entries.push(entry);
        }
        total += 1;
    }
    Ok(Page { entries, total })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_become_entries() {
        assert_eq!(parse_line("+ 5000 a/new.bin"), Some(Entry { kind: EntryKind::New, size: Some(5000), path: "a/new.bin".into(), on_source: false }));
        assert_eq!(parse_line("~ 12 a b/c d.txt"), Some(Entry { kind: EntryKind::Changed, size: Some(12), path: "a b/c d.txt".into(), on_source: false }));
        assert_eq!(parse_line("- old.txt"), Some(Entry { kind: EntryKind::Deleted, size: None, path: "old.txt".into(), on_source: false }));
        assert_eq!(parse_line("! rsync: permission denied").map(|e| e.kind), Some(EntryKind::Error));
        assert_eq!(parse_line("X out/a.js"), Some(Entry { kind: EntryKind::Planned, size: None, path: "out/a.js".into(), on_source: true }));
        assert_eq!(parse_line("x out/a.js").map(|e| e.on_source), Some(false));
        assert_eq!(parse_line("# Number of files: 3"), None);
        assert_eq!(parse_line(""), None);
    }

    #[test]
    fn pages_filter_and_count() {
        let path = std::env::temp_dir().join(format!("clonq-log-{}.log", uuid::Uuid::new_v4()));
        std::fs::write(&path, "# rsync …\n+ 1 a.txt\n~ 2 b.txt\n- c.txt\n+ 3 d.txt\n! oops\n").unwrap();
        let all = read(&path, None, "", 0, 2, false).unwrap();
        assert_eq!(all.total, 5);
        assert_eq!(all.entries.len(), 2);
        let new = read(&path, Some(EntryKind::New), "", 0, 10, false).unwrap();
        assert_eq!(new.total, 2);
        let found = read(&path, None, "D.TXT", 0, 10, false).unwrap();
        assert_eq!(found.entries, vec![Entry { kind: EntryKind::New, size: Some(3), path: "d.txt".into(), on_source: false }]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn planned_deletions_only_for_a_stopped_run() {
        let path = std::env::temp_dir().join(format!("clonq-log-{}.log", uuid::Uuid::new_v4()));
        std::fs::write(&path, "x out/a.js\nX out/b.js\n- out/a.js\n").unwrap();
        assert_eq!(read(&path, None, "", 0, 10, false).unwrap().total, 1);
        let stopped = read(&path, Some(EntryKind::Planned), "b.js", 0, 10, true).unwrap();
        assert_eq!(stopped.total, 1);
        assert!(stopped.entries[0].on_source);
        std::fs::remove_file(path).unwrap();
    }
}
