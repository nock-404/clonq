//! Notices drives coming and going, and tells the windows.

use std::collections::{BTreeSet, HashSet};
use std::os::unix::fs::MetadataExt;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;
use crate::cloud;
use crate::config::LocationKind;
use crate::locations;
use crate::scheduler;
use crate::ssh;

pub const EVENT_VOLUMES_CHANGED: &str = "volumes-changed";
pub const EVENT_SERVERS_CHECKED: &str = "servers-checked";

/// Servers are tested at start and then every ten minutes.
const SERVER_INTERVAL: Duration = Duration::from_secs(600);

/// Mount points under /Volumes, told apart from plain folders by their device.
/// Cheap enough to check every two seconds; `diskutil` only runs on a change.
fn mount_points() -> BTreeSet<(String, u64)> {
    let Ok(volumes_dev) = std::fs::metadata("/Volumes").map(|m| m.dev()) else { return BTreeSet::new() };
    let Ok(entries) = std::fs::read_dir("/Volumes") else { return BTreeSet::new() };
    entries
        .flatten()
        .filter_map(|entry| {
            let meta = std::fs::symlink_metadata(entry.path()).ok()?;
            (!meta.file_type().is_symlink() && meta.dev() != volumes_dev)
                .then(|| (entry.file_name().to_string_lossy().into_owned(), meta.dev()))
        })
        .collect()
}

pub fn volumes(app: AppHandle) {
    std::thread::Builder::new()
        .name("clonq-volumes".into())
        .spawn(move || {
            let mut known = mount_points();
            let mut uuids: HashSet<String> = locations::mounted_volumes().into_iter().map(|v| v.uuid).collect();
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let now = mount_points();
                if now == known {
                    continue;
                }
                known = now;
                let volumes = locations::mounted_volumes();
                let current: HashSet<String> = volumes.iter().map(|v| v.uuid.clone()).collect();
                let appeared: HashSet<String> = current.difference(&uuids).cloned().collect();
                uuids = current;
                let _ = app.emit(EVENT_VOLUMES_CHANGED, volumes);
                // Change watchers on a drive that just came or went must be rebuilt.
                scheduler::reachability_changed(&app);
                if !appeared.is_empty() {
                    scheduler::volumes_mounted(&app, &appeared);
                }
            }
        })
        .expect("volume watcher thread");
}

/// Tests every server and cloud location in the background so its status is known.
pub fn servers(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let (locations, rclone, rclone_config) = {
                let state = app.state::<AppState>();
                let config = state.config.read().expect("config lock");
                (config.locations.clone(), config.rclone_path.clone(), state.config_dir.join("rclone.conf"))
            };
            for location in locations {
                let result = match &location.kind {
                    LocationKind::Ssh { host, port, user, identity_file, .. } => ssh::test(host, *port, user, identity_file).await.map(|_| ()),
                    LocationKind::Cloud { remote, root, .. } => cloud::test(&rclone, &rclone_config, &format!("{remote}:{root}")).await,
                    _ => continue,
                };
                app.state::<AppState>().server_checks.record(&location.id, result);
            }
            let _ = app.emit(EVENT_SERVERS_CHECKED, ());
            scheduler::reachability_changed(&app);
            tokio::time::sleep(SERVER_INTERVAL).await;
        }
    });
}

/// Fetches the licence revocation list at start and once a day; offline keeps the last one.
pub fn licence(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let dir = app.state::<AppState>().config_dir.clone();
            crate::licence::refresh(&crate::licence::Store::new(&dir)).await;
            tokio::time::sleep(std::time::Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}
