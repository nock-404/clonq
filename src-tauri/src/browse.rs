//! A file browser for any location: list, preview, download, rename, delete.
//! Local files go to the macOS Trash; servers and clouds are handled by rclone
//! (servers through its SFTP backend with clonq's key, so no shell is needed).

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

use crate::config::{Config, Place};
use crate::error::{Error, Result};
use crate::locations::{self, Resolved};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowseEntry {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    /// RFC 3339, when known.
    pub modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub mime: String,
    /// Text files come as text, images as base64.
    pub text: Option<String>,
    pub base64: Option<String>,
}

/// Largest file that is previewed; bigger ones are downloaded instead.
const PREVIEW_LIMIT: u64 = 4 * 1024 * 1024;

/// One side of a browse operation: a local path or an rclone path.
enum Target {
    Local(PathBuf),
    Rclone(String),
}

fn target(place: &Place, config: &Config) -> Result<Target> {
    if place.path.split('/').any(|part| part == "..") {
        return Err(Error::Job(format!("path {} must not climb out of its location", place.path)));
    }
    Ok(match locations::resolve(place, config, &locations::mounted_volumes())? {
        Resolved::Local(path) => Target::Local(path),
        Resolved::Cloud { spec } => Target::Rclone(spec),
        Resolved::Remote { sftp, .. } => Target::Rclone(sftp),
    })
}

async fn rclone(config: &Config, rclone_config: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new(&config.rclone_path).args(args).arg("--config").arg(rclone_config).output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let last = stderr.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("rclone failed");
        return Err(Error::Job(last.split_once(": ").map_or(last, |(_, rest)| rest).trim().to_string()));
    }
    Ok(output.stdout)
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct LsJson {
    name: String,
    size: i64,
    mod_time: Option<String>,
    is_dir: bool,
}

pub async fn list(place: &Place, config: &Config, rclone_config: &Path) -> Result<Vec<BrowseEntry>> {
    let mut entries = match target(place, config)? {
        Target::Local(dir) => {
            let mut entries = Vec::new();
            let listing = std::fs::read_dir(&dir).map_err(|_| Error::Job(format!("{} cannot be read", dir.display())))?;
            for entry in listing.flatten() {
                let Ok(meta) = entry.metadata() else { continue };
                let modified = meta.modified().ok().map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339());
                entries.push(BrowseEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    dir: meta.is_dir(),
                    size: if meta.is_dir() { 0 } else { meta.len() },
                    modified,
                });
            }
            entries
        }
        Target::Rclone(spec) => {
            let json = rclone(config, rclone_config, &["lsjson", "--max-depth", "1", "--no-mimetype", &spec]).await?;
            let listed: Vec<LsJson> = serde_json::from_slice(&json)?;
            listed
                .into_iter()
                .map(|item| BrowseEntry { name: item.name, dir: item.is_dir, size: item.size.max(0) as u64, modified: item.mod_time })
                .collect()
        }
    };
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

fn mime_of(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "pdf" => "application/pdf",
        "txt" | "md" | "log" | "csv" | "json" | "yml" | "yaml" | "toml" | "xml" | "html" | "css" | "js" | "ts" | "tsx" | "jsx"
        | "rs" | "go" | "py" | "sh" | "swift" | "vue" | "php" | "sql" | "env" | "ini" | "conf" => "text/plain",
        _ => "application/octet-stream",
    }
}

pub async fn preview(place: &Place, config: &Config, rclone_config: &Path) -> Result<Preview> {
    let name = place.path.rsplit('/').next().unwrap_or_default().to_string();
    let mime = mime_of(&name).to_string();
    let bytes = match target(place, config)? {
        Target::Local(path) => {
            let size = std::fs::metadata(&path)?.len();
            if size > PREVIEW_LIMIT {
                return Err(Error::Job("the file is too large for a preview".into()));
            }
            std::fs::read(&path)?
        }
        Target::Rclone(spec) => {
            let limit = PREVIEW_LIMIT.to_string();
            rclone(config, rclone_config, &["cat", "--count", &limit, &spec]).await?
        }
    };
    if mime.starts_with("text/") {
        return Ok(Preview { mime, text: Some(String::from_utf8_lossy(&bytes).into_owned()), base64: None });
    }
    if mime.starts_with("image/") {
        return Ok(Preview { mime, text: None, base64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)) });
    }
    Err(Error::Job("there is no preview for this kind of file".into()))
}

/// Copies a file or folder into `Downloads/clonq-dateien/<location>/` and returns the copy.
pub async fn download(place: &Place, config: &Config, rclone_config: &Path, downloads: &Path, location_name: &str) -> Result<PathBuf> {
    let name = place.path.trim_matches('/').rsplit('/').next().filter(|name| !name.is_empty()).unwrap_or(location_name);
    let folder = downloads.join("clonq-dateien").join(location_name.replace(['/', ':'], "-"));
    std::fs::create_dir_all(&folder)?;
    let destination = crate::archive::fresh_path(&folder.join(name));
    match target(place, config)? {
        Target::Local(path) => {
            let status = Command::new(&config.rsync_path)
                .arg("-a")
                .arg(if path.is_dir() { format!("{}/", path.display()) } else { path.display().to_string() })
                .arg(if path.is_dir() { format!("{}/", destination.display()) } else { destination.display().to_string() })
                .status()
                .await?;
            if !status.success() {
                return Err(Error::Job("the copy failed".into()));
            }
        }
        Target::Rclone(spec) => {
            let is_dir = rclone(config, rclone_config, &["lsjson", "--stat", &spec])
                .await
                .ok()
                .and_then(|json| serde_json::from_slice::<LsJson>(&json).ok())
                .is_some_and(|item| item.is_dir);
            let verb = if is_dir { "copy" } else { "copyto" };
            rclone(config, rclone_config, &[verb, &spec, &destination.to_string_lossy()]).await?;
        }
    }
    Ok(destination)
}

pub async fn rename(place: &Place, new_name: &str, config: &Config, rclone_config: &Path) -> Result<()> {
    if new_name.is_empty() || new_name.contains('/') || new_name == "." || new_name == ".." {
        return Err(Error::Job("the new name must be a plain name".into()));
    }
    let parent = place.path.trim_matches('/').rsplit_once('/').map_or("", |(parent, _)| parent);
    let renamed = Place { location: place.location.clone(), path: if parent.is_empty() { new_name.into() } else { format!("{parent}/{new_name}") } };
    match (target(place, config)?, target(&renamed, config)?) {
        (Target::Local(from), Target::Local(to)) => {
            if to.exists() {
                return Err(Error::Job(format!("{new_name} already exists")));
            }
            std::fs::rename(from, to)?;
        }
        (Target::Rclone(from), Target::Rclone(to)) => {
            // moveto would overwrite a file or merge into a folder of that name.
            if rclone(config, rclone_config, &["lsjson", "--stat", &to]).await.is_ok() {
                return Err(Error::Job(format!("{new_name} already exists")));
            }
            rclone(config, rclone_config, &["moveto", &from, &to]).await?;
        }
        _ => return Err(Error::Job("rename failed".into())),
    }
    Ok(())
}

/// Local entries go to the Trash; on servers and clouds they are deleted for good.
pub async fn delete(place: &Place, config: &Config, rclone_config: &Path) -> Result<()> {
    if place.path.trim_matches('/').is_empty() {
        return Err(Error::Job("the location itself cannot be deleted here".into()));
    }
    match target(place, config)? {
        Target::Local(path) => trash::delete(&path).map_err(|error| Error::Job(format!("moving to the Trash failed: {error}")))?,
        Target::Rclone(spec) => {
            let is_dir = rclone(config, rclone_config, &["lsjson", "--stat", &spec])
                .await
                .ok()
                .and_then(|json| serde_json::from_slice::<LsJson>(&json).ok())
                .is_some_and(|item| item.is_dir);
            if is_dir {
                rclone(config, rclone_config, &["purge", &spec]).await?;
            } else {
                rclone(config, rclone_config, &["deletefile", &spec]).await?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (PathBuf, Config) {
        let root = std::env::temp_dir().join(format!("clonq-browse-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("data/sub")).unwrap();
        std::fs::write(root.join("data/note.md"), "# Hallo").unwrap();
        std::fs::write(root.join("data/sub/b.txt"), "b").unwrap();
        let mut config: Config =
            serde_json::from_str(r#"{"version":2,"rsyncPath":"/opt/homebrew/bin/rsync","rclonePath":"/opt/homebrew/bin/rclone"}"#).unwrap();
        config.locations.push(crate::config::Location {
            id: "root".into(),
            name: "Root".into(),
            kind: crate::config::LocationKind::Folder { path: root.join("data").to_string_lossy().into_owned() },
        });
        (root, config)
    }

    #[tokio::test]
    async fn local_list_preview_download_rename() {
        let (root, config) = setup();
        let rclone_config = root.join("rclone.conf");
        let place = |path: &str| Place { location: "root".into(), path: path.into() };
        let entries = list(&place(""), &config, &rclone_config).await.unwrap();
        assert_eq!(entries.iter().map(|e| (e.name.as_str(), e.dir)).collect::<Vec<_>>(), vec![("sub", true), ("note.md", false)]);
        let text = preview(&place("note.md"), &config, &rclone_config).await.unwrap();
        assert_eq!(text.text.as_deref(), Some("# Hallo"));
        let copy = download(&place("sub"), &config, &rclone_config, &root.join("Downloads"), "Root").await.unwrap();
        assert_eq!(std::fs::read_to_string(copy.join("b.txt")).unwrap(), "b");
        let again = download(&place("sub"), &config, &rclone_config, &root.join("Downloads"), "Root").await.unwrap();
        assert_ne!(copy, again, "a second download gets its own folder");
        rename(&place("note.md"), "notes.md", &config, &rclone_config).await.unwrap();
        assert!(root.join("data/notes.md").exists());
        assert!(rename(&place("notes.md"), "../x", &config, &rclone_config).await.is_err());
        assert!(delete(&place(""), &config, &rclone_config).await.is_err(), "never the location itself");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn rclone_side_lists_with_a_local_remote() {
        let (root, mut config) = setup();
        let rclone_config = root.join("rclone.conf");
        let created = std::process::Command::new(&config.rclone_path).args(["config", "create", "fake", "local", "--config"]).arg(&rclone_config).output().unwrap();
        assert!(created.status.success());
        config.locations.push(crate::config::Location {
            id: "cloud".into(),
            name: "Cloud".into(),
            kind: crate::config::LocationKind::Cloud { provider: "local".into(), remote: "fake".into(), root: root.join("data").to_string_lossy().into_owned() },
        });
        let place = |path: &str| Place { location: "cloud".into(), path: path.into() };
        let entries = list(&place(""), &config, &rclone_config).await.unwrap();
        assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["sub", "note.md"]);
        std::fs::write(root.join("data/sub/taken.txt"), "keep").unwrap();
        assert!(rename(&place("sub/b.txt"), "taken.txt", &config, &rclone_config).await.is_err(), "never over an existing file");
        assert_eq!(std::fs::read_to_string(root.join("data/sub/taken.txt")).unwrap(), "keep");
        rename(&place("sub/b.txt"), "c.txt", &config, &rclone_config).await.unwrap();
        assert!(root.join("data/sub/c.txt").exists());
        delete(&place("sub/c.txt"), &config, &rclone_config).await.unwrap();
        assert!(!root.join("data/sub/c.txt").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
