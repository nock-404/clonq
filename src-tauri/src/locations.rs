//! Where locations are right now: folders on disk, drives by UUID, servers by test.

use serde::Serialize;
use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use crate::config::{Config, Location, LocationKind, Place};
use crate::error::{Error, Result};
use crate::smb;

/// A drive that is mounted right now.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MountedVolume {
    pub uuid: String,
    pub name: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub file_system: String,
    pub internal: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Reach {
    /// Usable now; `path` is where it lives on this Mac (local kinds only).
    #[serde(rename_all = "camelCase")]
    Connected { path: Option<String>, free_bytes: Option<u64>, total_bytes: Option<u64> },
    /// A drive that is not plugged in.
    Disconnected,
    /// A folder that no longer exists.
    Missing,
    /// A server that has not been tested since the app started.
    Untested,
    #[serde(rename_all = "camelCase")]
    Failed { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationStatus {
    pub id: String,
    pub reach: Reach,
    /// Names of the jobs that use this location.
    pub used_by: Vec<String>,
}

/// Remembers the outcome of the last SSH test per location.
#[derive(Default)]
pub struct ServerChecks {
    results: Mutex<HashMap<String, std::result::Result<(), String>>>,
}

impl ServerChecks {
    pub fn record(&self, location_id: &str, result: std::result::Result<(), String>) {
        self.results.lock().expect("server checks").insert(location_id.to_string(), result);
    }

    fn get(&self, location_id: &str) -> Option<std::result::Result<(), String>> {
        self.results.lock().expect("server checks").get(location_id).cloned()
    }
}

/// External and other browsable drives mounted under /Volumes, read via `diskutil`.
pub fn mounted_volumes() -> Vec<MountedVolume> {
    let Ok(entries) = std::fs::read_dir("/Volumes") else { return vec![] };
    let Ok(volumes_dev) = std::fs::metadata("/Volumes").map(|m| m.dev()) else { return vec![] };
    let mut volumes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        // "Macintosh HD" is a symlink to /; a plain folder is not a mount point.
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        if meta.file_type().is_symlink() || !meta.is_dir() || meta.dev() == volumes_dev {
            continue;
        }
        if let Some(volume) = describe_volume(&path) {
            volumes.push(volume);
        }
    }
    volumes.sort_by(|a, b| a.name.cmp(&b.name));
    volumes
}

fn describe_volume(mount_point: &Path) -> Option<MountedVolume> {
    let output = Command::new("/usr/sbin/diskutil").arg("info").arg("-plist").arg(mount_point).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let info: plist::Dictionary = plist::from_bytes(&output.stdout).ok()?;
    let text = |key: &str| info.get(key).and_then(plist::Value::as_string).map(str::to_string);
    let number = |key: &str| info.get(key).and_then(plist::Value::as_unsigned_integer);
    let flag = |key: &str| info.get(key).and_then(plist::Value::as_boolean).unwrap_or(false);
    let uuid = text("VolumeUUID")?;
    let internal = flag("Internal");
    // Internal system volumes such as Recovery are not places for data.
    if internal && !flag("Ejectable") {
        return None;
    }
    let free = number("APFSContainerFree").filter(|free| *free > 0).or_else(|| number("FreeSpace")).unwrap_or(0);
    Some(MountedVolume {
        uuid,
        name: text("VolumeName").unwrap_or_else(|| mount_point.display().to_string()),
        mount_point: mount_point.to_string_lossy().into_owned(),
        total_bytes: number("TotalSize").unwrap_or(0),
        free_bytes: free,
        file_system: text("FilesystemType").unwrap_or_default(),
        internal,
    })
}

fn free_space(path: &Path) -> (Option<u64>, Option<u64>) {
    // `df -k` works for any local path and needs no extra crate.
    let Ok(output) = Command::new("/bin/df").arg("-k").arg(path).output() else { return (None, None) };
    let text = String::from_utf8_lossy(&output.stdout);
    let Some(line) = text.lines().nth(1) else { return (None, None) };
    let fields: Vec<&str> = line.split_whitespace().collect();
    let kb = |i: usize| fields.get(i).and_then(|v| v.parse::<u64>().ok()).map(|v| v * 1024);
    (kb(3), kb(1))
}

pub fn status_of(location: &Location, config: &Config, volumes: &[MountedVolume], checks: &ServerChecks) -> LocationStatus {
    let reach = match &location.kind {
        LocationKind::Folder { path } => {
            if Path::new(path).is_dir() {
                let (free, total) = free_space(Path::new(path));
                Reach::Connected { path: Some(path.clone()), free_bytes: free, total_bytes: total }
            } else {
                Reach::Missing
            }
        }
        LocationKind::Volume { volume_uuid, .. } => match volumes.iter().find(|v| &v.uuid == volume_uuid) {
            Some(volume) => Reach::Connected {
                path: Some(volume.mount_point.clone()),
                free_bytes: Some(volume.free_bytes),
                total_bytes: Some(volume.total_bytes),
            },
            None => Reach::Disconnected,
        },
        LocationKind::Smb { url, .. } => match smb::parse(url).ok().and_then(|share| smb::mount_point(&share)) {
            Some(point) => {
                let (free, total) = free_space(&point);
                Reach::Connected { path: Some(point.to_string_lossy().into_owned()), free_bytes: free, total_bytes: total }
            }
            None => Reach::Disconnected,
        },
        LocationKind::Ssh { .. } | LocationKind::Cloud { .. } => match checks.get(&location.id) {
            Some(Ok(())) => Reach::Connected { path: None, free_bytes: None, total_bytes: None },
            Some(Err(message)) => Reach::Failed { message },
            None => Reach::Untested,
        },
    };
    LocationStatus {
        id: location.id.clone(),
        reach,
        used_by: config.jobs_using(&location.id).iter().map(|job| job.name.clone()).collect(),
    }
}

/// A place turned into something rsync can use.
#[derive(Debug, Clone, PartialEq)]
pub enum Resolved {
    Local(PathBuf),
    /// `sftp` is the same place as an rclone connection string, for two-way sync.
    Remote { destination: String, ssh: Vec<String>, display: String, sftp: String },
    /// An rclone path such as `clonq-box:bucket/folder`.
    Cloud { spec: String },
}

/// Resolves a place against the current state of the machine; fails with a
/// message the UI can show when the location is not reachable.
pub fn resolve(place: &Place, config: &Config, volumes: &[MountedVolume]) -> Result<Resolved> {
    let location = config
        .location(&place.location)
        .ok_or_else(|| Error::Job(format!("location {} does not exist", place.location)))?;
    let relative = place.path.trim_matches('/');
    if relative.split('/').any(|part| part == "..") {
        return Err(Error::Job(format!("path {} must not climb out of its location", place.path)));
    }
    match &location.kind {
        LocationKind::Folder { path } => {
            if !Path::new(path).is_dir() {
                return Err(Error::Job(format!("folder {path} does not exist")));
            }
            Ok(Resolved::Local(join(Path::new(path), relative)))
        }
        LocationKind::Volume { volume_uuid, volume_name } => {
            let volume = volumes
                .iter()
                .find(|v| &v.uuid == volume_uuid)
                .ok_or_else(|| Error::Job(format!("volume /Volumes/{volume_name} is not connected")))?;
            Ok(Resolved::Local(join(Path::new(&volume.mount_point), relative)))
        }
        LocationKind::Smb { url, .. } => {
            let share = smb::parse(url)?;
            let point = smb::mount_point(&share)
                .ok_or_else(|| Error::Job(format!("share {} is not connected", location.name)))?;
            Ok(Resolved::Local(join(&point, relative)))
        }
        LocationKind::Cloud { remote, root, .. } => {
            // A leading slash is meaningful (absolute paths on some backends); only the end is trimmed.
            let root = root.trim_end_matches('/');
            let path = match (root.is_empty(), relative.is_empty()) {
                (true, true) => String::new(),
                (true, false) => relative.to_string(),
                (false, true) => root.to_string(),
                (false, false) => format!("{root}/{relative}"),
            };
            Ok(Resolved::Cloud { spec: format!("{remote}:{path}") })
        }
        LocationKind::Ssh { host, port, user, identity_file, base_path } => {
            let base = base_path.trim_end_matches('/');
            let remote_path = match (base.is_empty(), relative.is_empty()) {
                (true, true) => ".".to_string(),
                (true, false) => relative.to_string(),
                (false, true) => base.to_string(),
                (false, false) => format!("{base}/{relative}"),
            };
            Ok(Resolved::Remote {
                destination: format!("{user}@{host}:{remote_path}"),
                ssh: ssh_command(*port, identity_file),
                display: format!("{}:{remote_path}", location.name),
                sftp: format!(
                    ":sftp,host={host},user={user},port={port},key_file='{}':{remote_path}",
                    identity_file.replace('\'', "")
                ),
            })
        }
    }
}

fn join(base: &Path, relative: &str) -> PathBuf {
    if relative.is_empty() { base.to_path_buf() } else { base.join(relative) }
}

/// The ssh invocation clonq uses everywhere: its own key, no password prompts,
/// host keys learned on first contact.
pub fn ssh_command(port: u16, identity_file: &str) -> Vec<String> {
    vec![
        "/usr/bin/ssh".into(),
        "-p".into(),
        port.to_string(),
        "-i".into(),
        identity_file.into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "IdentitiesOnly=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        // A dead connection is noticed within a minute instead of hanging.
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=4".into(),
        "-o".into(),
        "ForwardAgent=no".into(),
        "-o".into(),
        "ClearAllForwardings=yes".into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Job, Mode, Safety, Triggers};

    fn config_with(locations: Vec<Location>) -> Config {
        let mut config: Config = serde_json::from_str(r#"{"version":2,"rsyncPath":"/opt/homebrew/bin/rsync"}"#).unwrap();
        config.locations = locations;
        config
    }

    #[test]
    fn folder_resolves_and_reports_missing() {
        let dir = std::env::temp_dir();
        let config = config_with(vec![
            Location { id: "tmp".into(), name: "Tmp".into(), kind: LocationKind::Folder { path: dir.to_string_lossy().into() } },
            Location { id: "gone".into(), name: "Gone".into(), kind: LocationKind::Folder { path: "/nope/nope".into() } },
        ]);
        let place = Place { location: "tmp".into(), path: "/a/b/".into() };
        assert_eq!(resolve(&place, &config, &[]).unwrap(), Resolved::Local(dir.join("a/b")));
        let missing = Place { location: "gone".into(), path: "".into() };
        assert!(resolve(&missing, &config, &[]).is_err());
        let status = status_of(&config.locations[1], &config, &[], &ServerChecks::default());
        assert!(matches!(status.reach, Reach::Missing));
    }

    #[test]
    fn paths_cannot_climb_out() {
        let config = config_with(vec![Location {
            id: "tmp".into(),
            name: "Tmp".into(),
            kind: LocationKind::Folder { path: std::env::temp_dir().to_string_lossy().into() },
        }]);
        let place = Place { location: "tmp".into(), path: "a/../../etc".into() };
        assert!(resolve(&place, &config, &[]).is_err());
    }

    #[test]
    fn volume_is_found_by_uuid_not_by_name() {
        let config = config_with(vec![Location {
            id: "m2".into(),
            name: "M2mini".into(),
            kind: LocationKind::Volume { volume_uuid: "U-1".into(), volume_name: "M2mini".into() },
        }]);
        let renamed = MountedVolume {
            uuid: "U-1".into(),
            name: "Renamed".into(),
            mount_point: "/Volumes/Renamed".into(),
            total_bytes: 1,
            free_bytes: 1,
            file_system: "apfs".into(),
            internal: false,
        };
        let place = Place { location: "m2".into(), path: "WORK".into() };
        assert_eq!(resolve(&place, &config, &[renamed]).unwrap(), Resolved::Local(PathBuf::from("/Volumes/Renamed/WORK")));
        let error = resolve(&place, &config, &[]).unwrap_err().to_string();
        assert!(error.contains("not connected"), "{error}");
    }

    #[test]
    fn ssh_places_become_rsync_destinations() {
        let config = config_with(vec![Location {
            id: "box".into(),
            name: "Storage Box".into(),
            kind: LocationKind::Ssh {
                host: "u1.your-storagebox.de".into(),
                port: 23,
                user: "u1".into(),
                identity_file: "/k".into(),
                base_path: "".into(),
            },
        }]);
        let place = Place { location: "box".into(), path: "M2mini/WORK".into() };
        let Resolved::Remote { destination, ssh, display, sftp } = resolve(&place, &config, &[]).unwrap() else { panic!() };
        assert_eq!(sftp, ":sftp,host=u1.your-storagebox.de,user=u1,port=23,key_file='/k':M2mini/WORK");
        assert_eq!(destination, "u1@u1.your-storagebox.de:M2mini/WORK");
        assert!(ssh.contains(&"23".to_string()));
        assert_eq!(display, "Storage Box:M2mini/WORK");
    }

    #[test]
    fn used_by_lists_job_names() {
        let mut config = config_with(vec![Location {
            id: "tmp".into(),
            name: "Tmp".into(),
            kind: LocationKind::Folder { path: "/tmp".into() },
        }]);
        config.jobs.push(Job {
            id: "j".into(),
            name: "Tmp → Tmp".into(),
            enabled: false,
            source: Place { location: "tmp".into(), path: "a".into() },
            target: Place { location: "tmp".into(), path: "b".into() },
            mode: Mode::Mirror,
            excludes: vec![],
            safety: Safety::default(),
            ring: None,
            triggers: Triggers::default(),
            archive: crate::config::Archive::default(),
            conflicts: crate::config::Conflicts::default(),
        });
        let status = status_of(&config.locations[0], &config, &[], &ServerChecks::default());
        assert_eq!(status.used_by, vec!["Tmp → Tmp".to_string()]);
    }

    #[test]
    fn this_mac_lists_its_external_drives() {
        // Runs against the real machine: every entry must carry a UUID and a mount point.
        for volume in mounted_volumes() {
            assert!(!volume.uuid.is_empty());
            assert!(volume.mount_point.starts_with("/Volumes/"));
        }
    }
}
