//! Notices drives coming and going, and tells the windows.

use std::collections::BTreeSet;
use std::os::unix::fs::MetadataExt;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;
use crate::config::LocationKind;
use crate::locations;
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
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let now = mount_points();
                if now != known {
                    known = now;
                    let _ = app.emit(EVENT_VOLUMES_CHANGED, locations::mounted_volumes());
                }
            }
        })
        .expect("volume watcher thread");
}

/// Tests every server location in the background so its status is known.
pub fn servers(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let servers: Vec<(String, String, u16, String, String)> = {
                let state = app.state::<AppState>();
                let config = state.config.read().expect("config lock");
                config
                    .locations
                    .iter()
                    .filter_map(|location| match &location.kind {
                        LocationKind::Ssh { host, port, user, identity_file, .. } => {
                            Some((location.id.clone(), host.clone(), *port, user.clone(), identity_file.clone()))
                        }
                        _ => None,
                    })
                    .collect()
            };
            for (id, host, port, user, key) in servers {
                let result = ssh::test(&host, port, &user, &key).await.map(|_| ());
                app.state::<AppState>().server_checks.record(&id, result);
            }
            let _ = app.emit(EVENT_SERVERS_CHECKED, ());
            tokio::time::sleep(SERVER_INTERVAL).await;
        }
    });
}
