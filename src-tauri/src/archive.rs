//! Browsing and restoring the archive a job keeps on its target.
//! Restores never overwrite anything: files land in a new folder in Downloads.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::process::Command;

use crate::config::{ARCHIVE_DIR, Config, Job};
use crate::error::{Error, Result};
use crate::locations::{self, Resolved};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Folder name, e.g. `2026-09-23_14-05-09`.
    pub stamp: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedFile {
    pub path: String,
    pub size: u64,
}

/// `2026-09-23_14-05-09-123`, or without milliseconds as written before 0.3.2.
pub(crate) fn is_stamp(name: &str) -> bool {
    match name.len() {
        19 => chrono::NaiveDateTime::parse_from_str(name, "%Y-%m-%d_%H-%M-%S").is_ok(),
        23 => chrono::NaiveDateTime::parse_from_str(name, "%Y-%m-%d_%H-%M-%S-%3f").is_ok(),
        _ => false,
    }
}

/// Where the job's archive lives, resolved against the machine as it is now.
/// Which end of a job the archive is read from. Only a two-way job archives on its source too.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Source,
    #[default]
    Target,
    /// The snapshots of a versioned job, which lie in the target itself.
    Snapshots,
}

fn archive_root(job: &Job, config: &Config, side: Side) -> Result<Resolved> {
    let place = match side {
        Side::Target => &job.target,
        Side::Source if job.mode == crate::config::Mode::Bidirectional => &job.source,
        Side::Source => return Err(Error::Job("only two-way jobs keep an archive on the source".into())),
        Side::Snapshots if job.mode == crate::config::Mode::Versioned => {
            return locations::resolve(&job.target, config, &locations::mounted_volumes());
        }
        Side::Snapshots => return Err(Error::Job("only versioned jobs keep snapshots".into())),
    };
    let target = if side == Side::Target {
        locations::resolve_target(job, config, &locations::mounted_volumes())?
    } else {
        locations::resolve(place, config, &locations::mounted_volumes())?
    };
    Ok(match target {
        Resolved::Local(path) => Resolved::Local(path.join(ARCHIVE_DIR)),
        Resolved::Remote { destination, ssh, display, sftp } => Resolved::Remote {
            destination: format!("{}/{ARCHIVE_DIR}", destination.trim_end_matches('/')),
            ssh,
            display,
            sftp: format!("{}/{ARCHIVE_DIR}", sftp.trim_end_matches('/')),
        },
        Resolved::Cloud { spec } => Resolved::Cloud { spec: format!("{}/{ARCHIVE_DIR}", spec.trim_end_matches('/')) },
    })
}

/// Every file under a folder with its size, paths relative to the folder.
async fn list_files(root: &Resolved, config: &Config, rclone_config: &Path) -> Result<Vec<ArchivedFile>> {
    match root {
        Resolved::Local(path) => {
            let mut files = Vec::new();
            walk(path, path, &mut files);
            Ok(files)
        }
        Resolved::Remote { destination, ssh, .. } => {
            let output = Command::new(&config.rsync_path)
                .env("LC_ALL", "C")
                .arg(format!("--rsh={}", crate::engine::shell_join(ssh)))
                .args(["--list-only", "-r"])
                .arg(format!("{destination}/"))
                .output()
                .await?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // No archive folder yet is an empty archive; anything else is a real failure
                // and must not read as "nothing kept".
                if output.status.code() == Some(23) && stderr.contains("No such file or directory") {
                    return Ok(vec![]);
                }
                return Err(Error::Job(crate::ssh::explain(&stderr)));
            }
            Ok(parse_list_only(&String::from_utf8_lossy(&output.stdout)))
        }
        Resolved::Cloud { spec } => {
            let output = Command::new(&config.rclone_path)
                .args(["lsf", "-R", "--files-only", "--format", "sp", "--separator", "\t", spec, "--config"])
                .arg(rclone_config)
                .output()
                .await?;
            if !output.status.success() {
                // rclone exits with 3 when the directory does not exist: no archive yet.
                if output.status.code() == Some(3) {
                    return Ok(vec![]);
                }
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(Error::Job(stderr.lines().last().unwrap_or("rclone failed").trim().to_string()));
            }
            Ok(String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| {
                    let (size, path) = line.split_once('\t')?;
                    Some(ArchivedFile { path: path.to_string(), size: size.parse().ok()? })
                })
                .collect())
        }
    }
}

fn walk(root: &Path, dir: &Path, files: &mut Vec<ArchivedFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            walk(root, &path, files);
        } else if let Ok(relative) = path.strip_prefix(root) {
            files.push(ArchivedFile { path: relative.to_string_lossy().into_owned(), size: meta.len() });
        }
    }
}

/// `-rw-r--r--          5 2026/09/23 14:05:09 a/b.txt`, directories skipped.
fn parse_list_only(text: &str) -> Vec<ArchivedFile> {
    text.lines()
        .filter(|line| line.starts_with('-'))
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let _mode = fields.next()?;
            let size = fields.next()?.replace(',', "").parse().ok()?;
            let _date = fields.next()?;
            let _time = fields.next()?;
            // The rest is the path, which may contain spaces.
            let start = line.find(_time)? + _time.len();
            Some(ArchivedFile { path: line[start..].trim_start().to_string(), size })
        })
        .collect()
}

/// The archive's snapshots, newest first, with their file counts and sizes.
pub async fn snapshots(job: &Job, config: &Config, rclone_config: &Path, side: Side) -> Result<Vec<Snapshot>> {
    let root = archive_root(job, config, side)?;
    let files = list_files(&root, config, rclone_config).await?;
    let mut by_stamp: std::collections::BTreeMap<String, (usize, u64)> = std::collections::BTreeMap::new();
    for file in files {
        let Some((stamp, _)) = file.path.split_once('/') else { continue };
        if is_stamp(stamp) {
            let entry = by_stamp.entry(stamp.to_string()).or_default();
            entry.0 += 1;
            entry.1 += file.size;
        }
    }
    Ok(by_stamp.into_iter().rev().map(|(stamp, (files, bytes))| Snapshot { stamp, files, bytes }).collect())
}

/// Files of one snapshot, paths relative to the snapshot.
pub async fn files(job: &Job, config: &Config, rclone_config: &Path, side: Side, stamp: &str) -> Result<Vec<ArchivedFile>> {
    if !is_stamp(stamp) {
        return Err(Error::Job(format!("{stamp} is not an archive folder")));
    }
    let root = archive_root(job, config, side)?;
    let mut files: Vec<ArchivedFile> = list_files(&root, config, rclone_config)
        .await?
        .into_iter()
        .filter_map(|file| {
            let rest = file.path.strip_prefix(&format!("{stamp}/"))?;
            Some(ArchivedFile { path: rest.to_string(), size: file.size })
        })
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Copies a snapshot (or one path inside it) to a new folder; returns that folder.
pub async fn restore(job: &Job, config: &Config, rclone_config: &Path, side: Side, downloads: &Path, stamp: &str, only: Option<&str>) -> Result<PathBuf> {
    if !is_stamp(stamp) {
        return Err(Error::Job(format!("{stamp} is not an archive folder")));
    }
    if only.is_some_and(|path| path.split('/').any(|part| part == "..")) {
        return Err(Error::Job("path must not climb out of the archive".into()));
    }
    // Both ends of a two-way job share the time stamps; the source's restores are marked.
    let folder = if side == Side::Source { format!("{stamp} source") } else { stamp.to_string() };
    let destination = fresh_path(&downloads.join("clonq-wiederhergestellt").join(sanitize(&job.name)).join(folder));
    std::fs::create_dir_all(&destination)?;
    let inner = only.map(|path| path.trim_matches('/').to_string()).filter(|path| !path.is_empty());
    let root = archive_root(job, config, side)?;
    let status = match &root {
        Resolved::Local(path) => {
            let source = inner.as_ref().map_or(path.join(stamp), |inner| path.join(stamp).join(inner));
            Command::new(&config.rsync_path)
                .args(["-a", "--mkpath", &format!("--exclude=/{}", crate::versions::MARKER)])
                .arg(rsync_source(&source))
                .arg(format!("{}/", destination.display()))
                .status()
                .await?
        }
        Resolved::Remote { destination: remote, ssh, .. } => {
            let source = inner.as_ref().map_or(format!("{remote}/{stamp}"), |inner| format!("{remote}/{stamp}/{inner}"));
            Command::new(&config.rsync_path)
                .arg(format!("--rsh={}", crate::engine::shell_join(ssh)))
                .args(["-a", "--secluded-args", &format!("--exclude=/{}", crate::versions::MARKER)])
                .arg(format!("{source}{}", if inner.is_none() { "/" } else { "" }))
                .arg(format!("{}/", destination.display()))
                .status()
                .await?
        }
        Resolved::Cloud { spec } => {
            let source = inner.as_ref().map_or(format!("{spec}/{stamp}"), |inner| format!("{spec}/{stamp}/{inner}"));
            let target = match &inner {
                // A single file keeps its name inside the destination.
                Some(inner) => destination.join(inner.rsplit('/').next().unwrap_or(inner)),
                None => destination.clone(),
            };
            let verb = if inner.is_some() { "copyto" } else { "copy" };
            Command::new(&config.rclone_path).arg(verb).arg(&source).arg(&target).arg("--config").arg(rclone_config).status().await?
        }
    };
    if !status.success() {
        return Err(Error::Job("restoring from the archive failed".into()));
    }
    Ok(destination)
}

/// `path` itself if nothing is there yet, otherwise `path (2)`, `path (3)` …
pub fn fresh_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    (2..)
        .map(|n| path.with_file_name(format!("{name} ({n})")))
        .find(|candidate| !candidate.exists())
        .expect("a free name")
}

/// A whole folder is copied by its contents, a single file as itself.
fn rsync_source(path: &Path) -> String {
    if path.is_dir() { format!("{}/", path.display()) } else { path.display().to_string() }
}

fn sanitize(name: &str) -> String {
    name.chars().map(|c| if c == '/' || c == ':' { '-' } else { c }).collect()
}

/// The complete snapshots of a versioned job, newest first.
pub async fn version_list(job: &Job, config: &Config) -> Result<Vec<String>> {
    if job.mode != crate::config::Mode::Versioned {
        return Err(Error::Job("only versioned jobs keep snapshots".into()));
    }
    let (mut complete, _) = match locations::resolve(&job.target, config, &locations::mounted_volumes())? {
        Resolved::Local(path) => crate::versions::list_local(&path),
        Resolved::Remote { destination, ssh, .. } => {
            let rsh = vec![format!("--rsh={}", crate::engine::shell_join(&ssh))];
            crate::versions::list_remote(&config.rsync_path, &rsh, &format!("{}/", destination.trim_end_matches('/'))).await?
        }
        Resolved::Cloud { .. } => return Err(Error::Job("versioned backups need a folder, drive or server as the target".into())),
    };
    complete.reverse();
    Ok(complete)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rsync_listing_is_parsed() {
        let text = "drwxr-xr-x             96 2026/09/23 14:05:09 .\n\
                    -rw-r--r--              5 2026/09/23 14:05:09 2026-09-23_14-05-09/a b.txt\n\
                    -rw-r--r--          1,024 2026/09/23 14:05:09 2026-09-23_14-05-09/sub/c.txt\n";
        assert_eq!(
            parse_list_only(text),
            vec![
                ArchivedFile { path: "2026-09-23_14-05-09/a b.txt".into(), size: 5 },
                ArchivedFile { path: "2026-09-23_14-05-09/sub/c.txt".into(), size: 1024 },
            ]
        );
    }

    #[tokio::test]
    async fn local_archive_lists_and_restores_into_a_new_folder() {
        let root = std::env::temp_dir().join(format!("clonq-archive-{}", uuid::Uuid::new_v4()));
        let stamp = "2026-09-23_14-05-09";
        let snapshot = root.join("target").join(ARCHIVE_DIR).join(stamp);
        std::fs::create_dir_all(snapshot.join("sub")).unwrap();
        std::fs::create_dir_all(root.join("source")).unwrap();
        std::fs::write(snapshot.join("a.txt"), "old a").unwrap();
        std::fs::write(snapshot.join("sub/b.txt"), "old b").unwrap();
        let mut config: Config = serde_json::from_str(r#"{"version":2,"rsyncPath":"/opt/homebrew/bin/rsync"}"#).unwrap();
        config.locations.push(crate::config::Location {
            id: "root".into(),
            name: "Root".into(),
            kind: crate::config::LocationKind::Folder { path: root.to_string_lossy().into_owned() },
        });
        let job: Job = serde_json::from_value(serde_json::json!({
            "id": "j", "name": "WORK → M2mini", "enabled": false,
            "source": {"location": "root", "path": "source"}, "target": {"location": "root", "path": "target"},
            "mode": "mirror", "excludes": [], "safety": {"maxDeletePercent": 10.0}
        }))
        .unwrap();
        let rclone_config = root.join("rclone.conf");

        let list = snapshots(&job, &config, &rclone_config, Side::Target).await.unwrap();
        assert_eq!(list, vec![Snapshot { stamp: stamp.into(), files: 2, bytes: 10 }]);
        let inside = files(&job, &config, &rclone_config, Side::Target, stamp).await.unwrap();
        assert_eq!(inside.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["a.txt", "sub/b.txt"]);

        let downloads = root.join("Downloads");
        let whole = restore(&job, &config, &rclone_config, Side::Target, &downloads, stamp, None).await.unwrap();
        assert_eq!(std::fs::read_to_string(whole.join("sub/b.txt")).unwrap(), "old b");
        assert!(whole.starts_with(downloads.join("clonq-wiederhergestellt")));
        std::fs::write(whole.join("a.txt"), "edited after restore").unwrap();
        let second = restore(&job, &config, &rclone_config, Side::Target, &downloads, stamp, None).await.unwrap();
        assert_ne!(whole, second, "a second restore gets its own folder");
        assert_eq!(std::fs::read_to_string(whole.join("a.txt")).unwrap(), "edited after restore");
        let single = restore(&job, &config, &rclone_config, Side::Target, &downloads, stamp, Some("sub/b.txt")).await.unwrap();
        assert_eq!(std::fs::read_to_string(single.join("b.txt")).unwrap(), "old b");
        assert!(restore(&job, &config, &rclone_config, Side::Target, &downloads, stamp, Some("../x")).await.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn names_are_safe_folder_names() {
        assert_eq!(sanitize("WORK → M2mini/Box"), "WORK → M2mini-Box");
    }
}

