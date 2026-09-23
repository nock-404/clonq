//! Jobs, hosts and app settings, stored as one JSON file in the app data dir.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::error::{Error, Result};

const FILE_NAME: &str = "config.json";
const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    pub rsync_path: String,
    #[serde(default)]
    pub ui: UiSettings,
    pub hosts: Vec<Host>,
    pub jobs: Vec<Job>,
}

/// Look and feel, shared by both windows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    pub accent: Accent,
    /// The row of activity lamps in the job detail.
    pub lamps: bool,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self { accent: Accent::Amber, lamps: true }
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

/// An SSH host that remote endpoints point at, e.g. the Storage Box.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub name: String,
    /// Automatic triggers only fire for enabled jobs; a manual run is always possible.
    pub enabled: bool,
    pub source: Endpoint,
    pub target: Endpoint,
    pub mode: Mode,
    /// rsync exclude patterns, applied in order.
    pub excludes: Vec<String>,
    pub safety: Safety,
    /// Unset means the UI picks one by the job's position.
    #[serde(default)]
    pub ring: Option<Ring>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Endpoint {
    Local { path: String },
    Remote { host: String, path: String },
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

fn default_always_allowed() -> i64 {
    10
}

impl Config {
    /// Reads the config, or writes and returns the defaults on first start.
    pub fn load_or_init(dir: &Path, home: &Path) -> Result<Self> {
        let path = dir.join(FILE_NAME);
        if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            let config: Config = serde_json::from_str(&raw)?;
            if config.version > CURRENT_VERSION {
                return Err(Error::Config(format!(
                    "config version {} is newer than this app understands ({CURRENT_VERSION})",
                    config.version
                )));
            }
            return Ok(config);
        }
        let config = Self::defaults(home);
        config.save(dir)?;
        Ok(config)
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

    fn defaults(home: &Path) -> Self {
        let work = home.join("Desktop").join("WORK");
        let work = path_string(&work);
        let volume_system = [
            "/.Spotlight-V100/",
            "/.fseventsd/",
            "/.Trashes/",
            "/.DocumentRevisions-V100/",
            "/.TemporaryItems/",
        ];
        let mut volume_excludes = default_excludes();
        volume_excludes.extend(volume_system.iter().map(|s| s.to_string()));
        // WORK reaches the Box from the Mac, so the volume mirror leaves it out.
        volume_excludes.push("/WORK/".into());

        Self {
            version: CURRENT_VERSION,
            rsync_path: "/opt/homebrew/bin/rsync".into(),
            ui: UiSettings::default(),
            hosts: vec![],
            jobs: vec![
                Job {
                    id: "work-to-m2mini".into(),
                    name: "WORK → M2mini".into(),
                    enabled: false,
                    source: Endpoint::Local { path: work.clone() },
                    target: Endpoint::Local { path: "/Volumes/M2mini/WORK".into() },
                    mode: Mode::Mirror,
                    excludes: default_excludes(),
                    safety: Safety::default(),
                    ring: Some(Ring::Blue),
                },
                Job {
                    id: "work-to-storagebox".into(),
                    name: "WORK → Storage Box".into(),
                    enabled: false,
                    source: Endpoint::Local { path: work },
                    target: Endpoint::Remote { host: "storagebox".into(), path: "M2mini/WORK".into() },
                    mode: Mode::Mirror,
                    excludes: default_excludes(),
                    safety: Safety::default(),
                    ring: Some(Ring::Green),
                },
                Job {
                    id: "m2mini-to-storagebox".into(),
                    name: "M2mini → Storage Box".into(),
                    enabled: false,
                    source: Endpoint::Local { path: "/Volumes/M2mini".into() },
                    target: Endpoint::Remote { host: "storagebox".into(), path: "M2mini".into() },
                    mode: Mode::Mirror,
                    excludes: volume_excludes,
                    safety: Safety::default(),
                    ring: Some(Ring::Red),
                },
            ],
        }
    }
}

pub fn default_excludes() -> Vec<String> {
    vec!["node_modules/".into()]
}

pub fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
