//! Locations, jobs and app settings, stored as one JSON file in the app data dir.
//!
//! A job never points at a raw path or host: it names two places, each a
//! location the user created (a folder, a drive, a server) plus a path inside it.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::error::{Error, Result};

const FILE_NAME: &str = "config.json";
const CURRENT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    pub rsync_path: String,
    #[serde(default = "default_rclone")]
    pub rclone_path: String,
    #[serde(default)]
    pub ui: UiSettings,
    #[serde(default)]
    pub locations: Vec<Location>,
    #[serde(default)]
    pub jobs: Vec<Job>,
}

/// Look and feel, shared by both windows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    pub accent: Accent,
    /// The row of activity lamps in the job detail.
    pub lamps: bool,
    /// Also announce automatic runs that went well, not only problems.
    #[serde(default)]
    pub notify_success: bool,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self { accent: Accent::Amber, lamps: true, notify_success: false }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Accent {
    /// The red of a tape's write-enable ring.
    Ring,
    /// The brown-gold of magnetic tape oxide.
    Amber,
    /// Mainframe blue.
    Blue,
}

/// Colour of a job's write-enable ring, the job's mark everywhere in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Ring {
    Red,
    Yellow,
    Blue,
    Green,
    White,
}

/// Somewhere data can live: a folder on this Mac, an external drive, or an SSH server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: String,
    pub name: String,
    pub kind: LocationKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LocationKind {
    /// A folder on the Mac's own disk.
    #[serde(rename_all = "camelCase")]
    Folder { path: String },
    /// An external drive, recognised by its volume UUID wherever it is mounted.
    #[serde(rename_all = "camelCase")]
    Volume { volume_uuid: String, volume_name: String },
    /// A server reached over SSH, e.g. a Hetzner Storage Box.
    #[serde(rename_all = "camelCase")]
    Ssh {
        host: String,
        port: u16,
        user: String,
        /// Private key clonq created for this server.
        identity_file: String,
        /// Folder on the server that paths are relative to; empty means the login folder.
        base_path: String,
    },
    /// A network share (SMB), mounted the way Finder does; the password is in the keychain.
    #[serde(rename_all = "camelCase")]
    Smb { url: String, user: String },
    /// Cloud storage through rclone: `remote` is a section in clonq's own rclone config.
    #[serde(rename_all = "camelCase")]
    Cloud { provider: String, remote: String, root: String },
}

/// One end of a job: a location and a path inside it ("" is the location itself).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub location: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub name: String,
    /// Automatic triggers only fire for enabled jobs; a manual run is always possible.
    pub enabled: bool,
    pub source: Place,
    pub target: Place,
    pub mode: Mode,
    /// rsync exclude patterns, applied in order.
    pub excludes: Vec<String>,
    pub safety: Safety,
    #[serde(default)]
    pub ring: Option<Ring>,
    #[serde(default)]
    pub triggers: Triggers,
}

/// When a job starts by itself (only while it is enabled).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Triggers {
    /// When a drive the job uses is connected.
    #[serde(default)]
    pub on_mount: bool,
    /// When files in the source change, after this many quiet seconds.
    #[serde(default)]
    pub on_change_after_seconds: Option<u64>,
    /// Every this many minutes.
    #[serde(default)]
    pub every_minutes: Option<u64>,
    /// Daily at this local time, "HH:MM".
    #[serde(default)]
    pub daily_at: Option<String>,
    /// After this job finished successfully.
    #[serde(default)]
    pub after_job: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Target becomes an exact copy of the source, deletions included.
    Mirror,
    /// Copies new and changed files, never deletes on the target.
    Backup,
    /// Like backup, but never reads the target (for slow remote targets).
    Blind,
    /// Changes flow both ways, conflicts are resolved by rules.
    Bidirectional,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Safety {
    /// A mirror stops before deleting more than this share of the target's entries.
    pub max_delete_percent: f64,
    /// Deletions that are always fine, so small targets do not stop on every change.
    #[serde(default = "default_always_allowed")]
    pub always_allowed_deletions: i64,
}

impl Default for Safety {
    fn default() -> Self {
        Self { max_delete_percent: 10.0, always_allowed_deletions: default_always_allowed() }
    }
}

impl Safety {
    /// How many deletions a run may make on a target with `entries` entries.
    pub fn allowed_deletions(&self, entries: i64) -> i64 {
        let share = (entries as f64 * self.max_delete_percent / 100.0).floor() as i64;
        share.max(self.always_allowed_deletions)
    }
}

fn default_rclone() -> String {
    "/opt/homebrew/bin/rclone".into()
}

fn default_always_allowed() -> i64 {
    10
}

impl Config {
    /// Reads the config, or writes and returns an empty one on first start.
    pub fn load_or_init(dir: &Path) -> Result<Self> {
        let path = dir.join(FILE_NAME);
        if !path.exists() {
            let config = Self::empty();
            config.save(dir)?;
            return Ok(config);
        }
        let raw = std::fs::read_to_string(&path)?;
        let value: serde_json::Value = serde_json::from_str(&raw)?;
        let version = value.get("version").and_then(serde_json::Value::as_u64).unwrap_or(0) as u32;
        if version > CURRENT_VERSION {
            return Err(Error::Config(format!(
                "config version {version} is newer than this app understands ({CURRENT_VERSION})"
            )));
        }
        if version < 2 {
            // Version 1 held jobs with raw paths and hosts that were never set up.
            // Under the rule that a job needs two real locations they cannot be
            // carried over; the look settings can.
            let mut config = Self::empty();
            if let Some(ui) = value.get("ui").cloned().and_then(|ui| serde_json::from_value(ui).ok()) {
                config.ui = ui;
            }
            if let Some(rsync) = value.get("rsyncPath").and_then(serde_json::Value::as_str) {
                config.rsync_path = rsync.to_string();
            }
            let backup = dir.join(format!("{FILE_NAME}.v{version}.bak"));
            std::fs::copy(&path, backup)?;
            config.save(dir)?;
            return Ok(config);
        }
        Ok(serde_json::from_value(value)?)
    }

    /// Writes atomically: a temp file first, then a rename over the old one.
    pub fn save(&self, dir: &Path) -> Result<()> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(FILE_NAME);
        let tmp = dir.join(format!("{FILE_NAME}.tmp"));
        std::fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    pub fn job(&self, id: &str) -> Option<&Job> {
        self.jobs.iter().find(|job| job.id == id)
    }

    pub fn location(&self, id: &str) -> Option<&Location> {
        self.locations.iter().find(|location| location.id == id)
    }

    /// Jobs that use a location on either side.
    pub fn jobs_using(&self, location_id: &str) -> Vec<&Job> {
        self.jobs
            .iter()
            .filter(|job| job.source.location == location_id || job.target.location == location_id)
            .collect()
    }

    fn empty() -> Self {
        Self {
            version: CURRENT_VERSION,
            rsync_path: "/opt/homebrew/bin/rsync".into(),
            rclone_path: default_rclone(),
            ui: UiSettings::default(),
            locations: vec![],
            jobs: vec![],
        }
    }
}

pub fn default_excludes() -> Vec<String> {
    vec!["node_modules/".into()]
}

/// Excludes a whole-drive job needs so macOS's own bookkeeping stays out.
pub fn volume_system_excludes() -> Vec<String> {
    ["/.Spotlight-V100/", "/.fseventsd/", "/.Trashes/", "/.DocumentRevisions-V100/", "/.TemporaryItems/"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_one_is_replaced_but_keeps_the_look() {
        let dir = std::env::temp_dir().join(format!("clonq-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(FILE_NAME),
            r#"{"version":1,"rsyncPath":"/opt/homebrew/bin/rsync","ui":{"accent":"blue","lamps":false},"hosts":[],"jobs":[{"id":"x"}]}"#,
        )
        .unwrap();
        let config = Config::load_or_init(&dir).unwrap();
        assert_eq!(config.version, 2);
        assert!(config.jobs.is_empty());
        assert_eq!(config.ui.accent, Accent::Blue);
        assert!(!config.ui.lamps);
        assert!(dir.join("config.json.v1.bak").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn location_kinds_round_trip() {
        let location = Location {
            id: "box".into(),
            name: "Storage Box".into(),
            kind: LocationKind::Ssh {
                host: "u1.your-storagebox.de".into(),
                port: 23,
                user: "u1".into(),
                identity_file: "/k".into(),
                base_path: "".into(),
            },
        };
        let json = serde_json::to_string(&location).unwrap();
        assert!(json.contains(r#""type":"ssh""#), "{json}");
        let back: Location = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, location.kind);
    }
}
