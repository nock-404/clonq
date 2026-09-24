//! Commands behind "add a location" and "create a job". Every change is
//! validated against the real machine before it is saved.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::AppState;
use crate::commands::EVENT_CONFIG_CHANGED;
use crate::config::{Archive, Config, Conflicts, Job, Location, LocationKind, Mode, Place, Ring, Safety, Triggers, default_excludes, volume_system_excludes};
use crate::error::{Error, Result};
use crate::locations::{self, LocationStatus, MountedVolume, Reach, Resolved};
use crate::{cloud, smb, ssh};
use std::collections::HashMap;

fn keys_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("keys"))
}

/// Saves the config and tells both windows.
fn commit(app: &AppHandle, state: &AppState, change: impl FnOnce(&mut Config) -> Result<()>) -> Result<Config> {
    let config = {
        let mut config = state.config.write().expect("config lock");
        let mut draft = config.clone();
        change(&mut draft)?;
        draft.save(&state.config_dir)?;
        *config = draft.clone();
        draft
    };
    app.emit(EVENT_CONFIG_CHANGED, &config)?;
    Ok(config)
}

fn new_id(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let short = &uuid::Uuid::new_v4().simple().to_string()[..6];
    if slug.is_empty() { short.to_string() } else { format!("{slug}-{short}") }
}

fn require_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Job("a name is required".into()));
    }
    Ok(name.to_string())
}

#[tauri::command]
pub fn mounted_volumes() -> Vec<MountedVolume> {
    locations::mounted_volumes()
}

#[tauri::command]
pub fn location_statuses(state: State<'_, AppState>) -> Vec<LocationStatus> {
    let config = state.config.read().expect("config lock").clone();
    let volumes = locations::mounted_volumes();
    config
        .locations
        .iter()
        .map(|location| locations::status_of(location, &config, &volumes, &state.server_checks))
        .collect()
}

#[tauri::command]
pub fn add_folder_location(app: AppHandle, state: State<'_, AppState>, name: String, path: String) -> Result<Location> {
    let name = require_name(&name)?;
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() || !path.is_dir() {
        return Err(Error::Job(format!("{} is not an existing folder", path.display())));
    }
    if path.starts_with("/Volumes") {
        return Err(Error::Job("folders on external drives are added as a drive, not as a folder".into()));
    }
    let path = path.to_string_lossy().trim_end_matches('/').to_string();
    let location = Location { id: new_id(&name), name, kind: LocationKind::Folder { path: path.clone() } };
    let added = location.clone();
    commit(&app, &state, |config| {
        if config.locations.iter().any(|l| l.kind == LocationKind::Folder { path: path.clone() }) {
            return Err(Error::Job(format!("{path} is already a location")));
        }
        config.locations.push(added);
        Ok(())
    })?;
    Ok(location)
}

#[tauri::command]
pub fn add_volume_location(app: AppHandle, state: State<'_, AppState>, name: String, volume_uuid: String) -> Result<Location> {
    let name = require_name(&name)?;
    let volume = locations::mounted_volumes()
        .into_iter()
        .find(|volume| volume.uuid == volume_uuid)
        .ok_or_else(|| Error::Job("this drive is not connected".into()))?;
    let kind = LocationKind::Volume { volume_uuid: volume.uuid.clone(), volume_name: volume.name.clone() };
    let location = Location { id: new_id(&name), name, kind: kind.clone() };
    let added = location.clone();
    commit(&app, &state, |config| {
        if config.locations.iter().any(|l| matches!(&l.kind, LocationKind::Volume { volume_uuid, .. } if volume_uuid == &volume.uuid)) {
            return Err(Error::Job(format!("{} is already a location", volume.name)));
        }
        config.locations.push(added);
        Ok(())
    })?;
    Ok(location)
}

/// First step for a server: a key pair clonq will log in with.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDraft {
    pub location_id: String,
    pub public_key: String,
    pub storage_box: bool,
    /// The server's host keys; the user compares a fingerprint before anything is sent.
    pub host_keys: Vec<ssh::HostKey>,
}

/// `location_id` is set when the address of a draft changed: the key stays, the host keys are read again.
#[tauri::command]
pub async fn prepare_server(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    host: String,
    port: u16,
    location_id: Option<String>,
) -> Result<ServerDraft> {
    let name = require_name(&name)?;
    let host = host.trim().to_string();
    let host_keys = ssh::scan(&host, port).await?;
    let location_id = match location_id {
        // The id names the key file, so it must look like one we made.
        Some(id) if !id.is_empty() && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') => id,
        Some(_) => return Err(Error::Job("unknown server draft; start again".into())),
        None => new_id(&name),
    };
    let key = ssh::ensure_key(&keys_dir(&app)?, &location_id).await?;
    let public_key = tokio::fs::read_to_string(format!("{}.pub", key.display())).await?;
    state.pending_host_keys.lock().expect("pending keys").insert(location_id.clone(), host_keys.clone());
    Ok(ServerDraft { location_id, public_key: public_key.trim().to_string(), storage_box: ssh::is_storage_box(&host), host_keys })
}

/// The user compared the fingerprint and trusts this server from now on.
#[tauri::command]
pub fn trust_server(state: State<'_, AppState>, location_id: String) -> Result<()> {
    let keys = state
        .pending_host_keys
        .lock()
        .expect("pending keys")
        .remove(&location_id)
        .ok_or_else(|| Error::Job("the server's key was not read; start again".into()))?;
    ssh::trust(&keys)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub location_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub base_path: String,
}

fn key_path(app: &AppHandle, location_id: &str) -> Result<String> {
    let key = keys_dir(app)?.join(format!("{location_id}_ed25519"));
    if !key.exists() {
        return Err(Error::Job("the key for this server is missing; start again".into()));
    }
    Ok(key.to_string_lossy().into_owned())
}

/// Logs in once with the password to put clonq's key on the server.
#[tauri::command]
pub async fn install_server_key(app: AppHandle, server: ServerInput, password: String) -> Result<()> {
    let key = key_path(&app, &server.location_id)?;
    let askpass_dir = app.path().app_data_dir()?.join("run");
    ssh::install_key(&askpass_dir, server.host.trim(), server.port, server.user.trim(), &key, &password).await
}

/// Tests the key login; on success returns the server's login folder.
#[tauri::command]
pub async fn test_server(app: AppHandle, server: ServerInput) -> Result<String> {
    let key = key_path(&app, &server.location_id)?;
    ssh::test(server.host.trim(), server.port, server.user.trim(), &key).await.map_err(Error::Job)
}

/// Saves a server as a location, but only after a successful key login.
#[tauri::command]
pub async fn add_server_location(app: AppHandle, state: State<'_, AppState>, server: ServerInput) -> Result<Location> {
    let name = require_name(&server.name)?;
    let key = key_path(&app, &server.location_id)?;
    let (host, user) = (server.host.trim().to_string(), server.user.trim().to_string());
    ssh::test(&host, server.port, &user, &key).await.map_err(Error::Job)?;
    state.server_checks.record(&server.location_id, Ok(()));
    let location = Location {
        id: server.location_id.clone(),
        name,
        kind: LocationKind::Ssh {
            host,
            port: server.port,
            user,
            identity_file: key,
            base_path: server.base_path.trim().trim_end_matches('/').to_string(),
        },
    };
    let added = location.clone();
    commit(&app, &state, |config| {
        config.locations.push(added);
        Ok(())
    })?;
    Ok(location)
}

/// Re-tests a server location and returns its fresh status.
#[tauri::command]
pub async fn test_location(state: State<'_, AppState>, id: String) -> Result<LocationStatus> {
    let config = state.config.read().expect("config lock").clone();
    let location = config.location(&id).ok_or_else(|| Error::Job(format!("location {id} does not exist")))?.clone();
    if let LocationKind::Ssh { host, port, user, identity_file, .. } = &location.kind {
        let result = ssh::test(host, *port, user, identity_file).await.map(|_| ());
        state.server_checks.record(&id, result);
    }
    let volumes = locations::mounted_volumes();
    Ok(locations::status_of(&location, &config, &volumes, &state.server_checks))
}

#[tauri::command]
pub fn rename_location(app: AppHandle, state: State<'_, AppState>, id: String, name: String) -> Result<Config> {
    let name = require_name(&name)?;
    commit(&app, &state, |config| {
        let location = config.locations.iter_mut().find(|l| l.id == id).ok_or_else(|| Error::Job(format!("location {id} does not exist")))?;
        location.name = name;
        Ok(())
    })
}

#[tauri::command]
pub fn remove_location(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<Config> {
    let mut key_to_delete: Option<Cleanup> = None;
    let config = commit(&app, &state, |config| {
        let users: Vec<String> = config.jobs_using(&id).iter().map(|job| job.name.clone()).collect();
        if !users.is_empty() {
            return Err(Error::Job(format!("still used by {}", users.join(", "))));
        }
        let index = config.locations.iter().position(|l| l.id == id).ok_or_else(|| Error::Job(format!("location {id} does not exist")))?;
        match &config.locations[index].kind {
            LocationKind::Ssh { identity_file, .. } => key_to_delete = Some(Cleanup::Key(identity_file.clone())),
            LocationKind::Smb { url, user } => {
                if let Ok(share) = smb::parse(url) {
                    key_to_delete = Some(Cleanup::Keychain(share.host, user.clone()));
                }
            }
            LocationKind::Cloud { remote, .. } => key_to_delete = Some(Cleanup::Remote(remote.clone())),
            _ => {}
        }
        config.locations.remove(index);
        Ok(())
    })?;
    match key_to_delete {
        Some(Cleanup::Key(key)) => {
            let _ = std::fs::remove_file(&key);
            let _ = std::fs::remove_file(format!("{key}.pub"));
        }
        Some(Cleanup::Keychain(host, user)) => {
            let still_used = config.locations.iter().any(|location| {
                matches!(&location.kind, LocationKind::Smb { url, user: other }
                    if other == &user && smb::parse(url).is_ok_and(|share| share.host.eq_ignore_ascii_case(&host)))
            });
            if !still_used {
                smb::delete_password(&host, &user);
            }
        }
        Some(Cleanup::Remote(remote)) => {
            let rclone = config.rclone_path.clone();
            let file = state.config_dir.join("rclone.conf");
            tauri::async_runtime::spawn(async move { cloud::delete_remote(&rclone, &file, &remote).await });
        }
        None => {}
    }
    Ok(config)
}

/// What else goes when a location is removed.
enum Cleanup {
    Key(String),
    Keychain(String, String),
    Remote(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub hidden: bool,
}

/// Sub-folders of a place, for the folder picker inside a location.
#[tauri::command]
pub async fn list_folders(state: State<'_, AppState>, location: String, path: String) -> Result<Vec<FolderEntry>> {
    let config = state.config.read().expect("config lock").clone();
    let place = Place { location, path };
    let resolved = locations::resolve(&place, &config, &locations::mounted_volumes())?;
    let mut entries = match resolved {
        Resolved::Local(dir) => {
            let mut entries = Vec::new();
            for entry in std::fs::read_dir(&dir).map_err(|_| Error::Job(format!("{} cannot be read", dir.display())))?.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    entries.push(FolderEntry { hidden: name.starts_with('.'), name });
                }
            }
            entries
        }
        Resolved::Cloud { spec } => cloud::list_dirs(&config.rclone_path, &state.config_dir.join("rclone.conf"), &spec)
            .await?
            .into_iter()
            .map(|name| FolderEntry { hidden: name.starts_with('.'), name })
            .collect(),
        Resolved::Remote { destination, ssh, .. } => {
            let (login, remote_path) = destination.split_once(':').unwrap_or((&destination, "."));
            let mut command = ssh.clone();
            command.push(login.to_string());
            command.push(format!("ls -1ap {}", quote_remote(remote_path)));
            let output = tokio::process::Command::new(&command[0]).args(&command[1..]).output().await?;
            if !output.status.success() {
                return Err(Error::Job(format!("cannot list {remote_path} on the server")));
            }
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| line.strip_suffix('/'))
                .filter(|name| *name != "." && *name != "..")
                .map(|name| FolderEntry { name: name.to_string(), hidden: name.starts_with('.') })
                .collect()
        }
    };
    entries.sort_by_key(|entry| (entry.hidden, entry.name.to_lowercase()));
    Ok(entries)
}

fn quote_remote(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

/// Creates one new folder inside a place (for "create folder" in the picker).
#[tauri::command]
pub async fn create_folder(state: State<'_, AppState>, location: String, path: String) -> Result<()> {
    let config = state.config.read().expect("config lock").clone();
    let place = Place { location, path };
    match locations::resolve(&place, &config, &locations::mounted_volumes())? {
        Resolved::Local(dir) => {
            let parent = dir.parent().ok_or_else(|| Error::Job("no parent folder".into()))?;
            if !parent.is_dir() {
                return Err(Error::Job(format!("{} does not exist", parent.display())));
            }
            std::fs::create_dir(&dir).map_err(|error| Error::Job(format!("{} cannot be created: {error}", dir.display())))?;
        }
        Resolved::Cloud { spec } => cloud::make_dir(&config.rclone_path, &state.config_dir.join("rclone.conf"), &spec).await?,
        Resolved::Remote { destination, ssh, .. } => {
            let (login, remote_path) = destination.split_once(':').unwrap_or((&destination, "."));
            let mut command = ssh.clone();
            command.push(login.to_string());
            command.push(format!("mkdir {}", quote_remote(remote_path)));
            let output = tokio::process::Command::new(&command[0]).args(&command[1..]).output().await?;
            if !output.status.success() {
                return Err(Error::Job(format!("{remote_path} cannot be created on the server")));
            }
        }
    }
    Ok(())
}

/// Saves a network share: password into the keychain, then one mount to prove it works.
#[tauri::command]
pub async fn add_smb_location(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    url: String,
    user: String,
    password: String,
) -> Result<Location> {
    let name = require_name(&name)?;
    let share = smb::parse(&url)?;
    let user = user.trim().to_string();
    if user.is_empty() {
        return Err(Error::Job("a user is required".into()));
    }
    // Another share on the same server may use this keychain entry; keep its password if this one fails.
    let previous = smb::read_password(&share.host, &user);
    smb::store_password(&share.host, &user, &password)?;
    if let Err(error) = smb::mount(&share, &user).await {
        match previous {
            Some(old) => {
                let _ = smb::store_password(&share.host, &user, &old);
            }
            None => smb::delete_password(&share.host, &user),
        }
        return Err(error);
    }
    let url = format!("smb://{}/{}", share.host, share.share);
    let location = Location { id: new_id(&name), name, kind: LocationKind::Smb { url, user } };
    let added = location.clone();
    commit(&app, &state, |config| {
        config.locations.push(added);
        Ok(())
    })?;
    Ok(location)
}

/// Brings a location online where that is possible: mounts a network share.
#[tauri::command]
pub async fn connect_location(state: State<'_, AppState>, id: String) -> Result<LocationStatus> {
    let config = state.config.read().expect("config lock").clone();
    let location = config.location(&id).ok_or_else(|| Error::Job(format!("location {id} does not exist")))?.clone();
    if let LocationKind::Smb { url, user } = &location.kind {
        smb::mount(&smb::parse(url)?, user).await?;
    }
    Ok(locations::status_of(&location, &config, &locations::mounted_volumes(), &state.server_checks))
}

#[tauri::command]
pub fn cloud_providers() -> Vec<cloud::Provider> {
    cloud::providers()
}

/// Creates the rclone remote (for browser providers this waits for the sign-in),
/// tests it, and only then saves the location.
#[tauri::command]
pub async fn add_cloud_location(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    provider: String,
    fields: HashMap<String, String>,
    root: String,
) -> Result<Location> {
    let name = require_name(&name)?;
    let id = new_id(&name);
    let remote = format!("clonq-{id}");
    let rclone = state.config.read().expect("config lock").rclone_path.clone();
    let file = state.config_dir.join("rclone.conf");
    cloud::create_remote(&rclone, &file, &remote, &provider, &fields).await?;
    let root = root.trim().trim_end_matches('/').to_string();
    if let Err(message) = cloud::test(&rclone, &file, &format!("{remote}:{root}")).await {
        cloud::delete_remote(&rclone, &file, &remote).await;
        return Err(Error::Job(message));
    }
    state.server_checks.record(&id, Ok(()));
    let location = Location { id, name, kind: LocationKind::Cloud { provider, remote, root } };
    let added = location.clone();
    commit(&app, &state, |config| {
        config.locations.push(added);
        Ok(())
    })?;
    Ok(location)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInput {
    /// Set when an existing job is edited.
    pub id: Option<String>,
    pub name: String,
    pub source: Place,
    pub target: Place,
    pub mode: Mode,
    pub excludes: Vec<String>,
    pub max_delete_percent: f64,
    pub ring: Option<Ring>,
    pub triggers: Triggers,
    pub enabled: bool,
    #[serde(default)]
    pub archive: Archive,
    #[serde(default)]
    pub conflicts: Conflicts,
    #[serde(default)]
    pub encrypted: bool,
}

/// Whether two places are the same folder or one lies inside the other.
fn nested(a: &Place, b: &Place) -> bool {
    if a.location != b.location {
        return false;
    }
    let (a, b) = (a.path.trim_matches('/'), b.path.trim_matches('/'));
    a.is_empty() || b.is_empty() || a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

/// Why two places cannot be a job, or None when they can.
pub fn conflict(source: &Resolved, target: &Resolved) -> Option<String> {
    let (Resolved::Local(a), Resolved::Local(b)) = (source, target) else {
        return None;
    };
    if a == b {
        return Some("source and target are the same folder".into());
    }
    if b.starts_with(a) {
        return Some("the target lies inside the source; it would copy itself".into());
    }
    if a.starts_with(b) {
        return Some("the source lies inside the target; a mirror would delete everything around it".into());
    }
    None
}

fn reachable(place: &Place, config: &Config, volumes: &[MountedVolume], state: &AppState) -> Result<Resolved> {
    let location = config.location(&place.location).ok_or_else(|| Error::Job("choose a location".into()))?;
    let status = locations::status_of(location, config, volumes, &state.server_checks);
    match status.reach {
        Reach::Connected { .. } => locations::resolve(place, config, volumes),
        Reach::Disconnected => Err(Error::Job(format!("{} is not connected", location.name))),
        Reach::Missing => Err(Error::Job(format!("{} no longer exists", location.name))),
        Reach::Untested => Err(Error::Job(format!("{} has not been tested yet", location.name))),
        Reach::Failed { message } => Err(Error::Job(format!("{}: {message}", location.name))),
    }
}

/// Creates or updates a job. Both places must be reachable now, and they must not overlap.
#[tauri::command]
pub async fn save_job(app: AppHandle, state: State<'_, AppState>, job: JobInput) -> Result<Job> {
    let name = require_name(&job.name)?;
    let config = state.config.read().expect("config lock").clone();
    // Pro features are needed to start using them; a job that already uses them stays editable
    // when the licence ends (Pro never takes away what exists).
    let existing = job.id.as_deref().and_then(|id| config.job(id));
    let pro = crate::licence::Store::new(&state.config_dir).pro();
    if job.mode == crate::config::Mode::Versioned && !pro && existing.is_none_or(|old| old.mode != crate::config::Mode::Versioned) {
        return Err(Error::Job("versioned backups are part of clonq Pro: enter a licence in Settings".into()));
    }
    let volumes = locations::mounted_volumes();
    let source = reachable(&job.source, &config, &volumes, &state)?;
    let target = reachable(&job.target, &config, &volumes, &state)?;
    if let Resolved::Local(path) = &source
        && !path.is_dir()
    {
        return Err(Error::Job(format!("source folder {} does not exist", path.display())));
    }
    if let Some(reason) = conflict(&source, &target) {
        return Err(Error::Job(reason));
    }
    if !(0.0..=100.0).contains(&job.max_delete_percent) {
        return Err(Error::Job("the deletion limit must be between 0 and 100 %".into()));
    }
    if job.triggers.every_minutes.is_some_and(|minutes| minutes == 0 || minutes > 525_600) {
        return Err(Error::Job("the interval must be between 1 minute and one year".into()));
    }
    if let Some(time) = &job.triggers.daily_at
        && chrono::NaiveTime::parse_from_str(time, "%H:%M").is_err()
    {
        return Err(Error::Job(format!("{time} is not a time like 02:30")));
    }
    let mut excludes: Vec<String> = job.excludes.iter().map(|e| e.trim().to_string()).filter(|e| !e.is_empty()).collect();
    // A whole drive as the source carries macOS bookkeeping that must stay out.
    let whole_drive = job.source.path.trim_matches('/').is_empty()
        && matches!(config.location(&job.source.location).map(|l| &l.kind), Some(LocationKind::Volume { .. }));
    if whole_drive {
        for system in volume_system_excludes() {
            if !excludes.contains(&system) {
                excludes.push(system);
            }
        }
    }
    let id = job.id.clone().unwrap_or_else(|| new_id(&name));
    let rclone_config = state.config_dir.join("rclone.conf");
    let before = config.job(&id).cloned();
    let was_encrypted = before.as_ref().is_some_and(|existing| existing.encrypted);
    let target_place = Place { location: job.target.location.clone(), path: job.target.path.trim_matches('/').to_string() };
    let same_target = before.as_ref().is_some_and(|existing| existing.target == target_place);
    let versioned = job.mode == crate::config::Mode::Versioned;
    let was_versioned = before.as_ref().is_some_and(|existing| existing.mode == crate::config::Mode::Versioned);
    // Snapshots are thinned and unfinished ones removed: their folder belongs to one job alone.
    for other in config.jobs.iter().filter(|other| other.id != id) {
        if (versioned || other.mode == crate::config::Mode::Versioned) && nested(&other.target, &target_place) {
            return Err(Error::Job(format!("the target folder overlaps with the job {}; a versioned job needs a folder of its own", other.name)));
        }
    }
    if versioned && !(was_versioned && same_target) {
        let fit = match &target {
            Resolved::Local(path) => crate::versions::only_snapshots_local(path),
            Resolved::Remote { destination, ssh, .. } => {
                let rsh = vec![format!("--rsh={}", crate::engine::shell_join(ssh))];
                crate::versions::only_snapshots_remote(&config.rsync_path, &rsh, &format!("{}/", destination.trim_end_matches('/'))).await?
            }
            Resolved::Cloud { .. } => true,
        };
        if !fit {
            return Err(Error::Job("versioned backups need an empty target folder; choose a new one".into()));
        }
    }
    // The snapshots stay where they are; another mode would mirror them away or merge them in.
    if was_versioned && !versioned && same_target {
        return Err(Error::Job("this folder holds the snapshots; choose another folder for the new mode".into()));
    }
    if job.encrypted {
        if !pro && !was_encrypted {
            return Err(Error::Job("encrypted cloud copies are part of clonq Pro: enter a licence in Settings".into()));
        }
        if !matches!(target, Resolved::Cloud { .. }) {
            return Err(Error::Job("encryption needs a cloud as the target".into()));
        }
    }
    // Encrypted and plain files must never share a folder: a mirror would take the others for
    // leftovers. An encrypted job goes into an empty folder or one that opens with its own
    // password (edited, moved to a new sign-in, or restored after deleting); a job without
    // encryption never goes into a folder that holds its encrypted copy.
    if let Resolved::Cloud { spec } = &target
        && (job.encrypted || was_encrypted)
        && !cloud::is_empty(&config.rclone_path, &rclone_config, spec).await?
    {
        let own = match cloud::crypt_password(&config.rclone_path, &rclone_config, &id).await? {
            Some(password) => cloud::decrypts(&config.rclone_path, &rclone_config, spec, &password).await?,
            None => false,
        };
        if job.encrypted && was_encrypted && cloud::crypt_password(&config.rclone_path, &rclone_config, &id).await?.is_none() {
            return Err(Error::Job("the encryption password of this job is missing on this Mac; without it the copy cannot be read, so clonq does not make a new one".into()));
        }
        if job.encrypted && !own {
            return Err(Error::Job("encryption needs an empty target folder; choose a new one".into()));
        }
        if !job.encrypted && own {
            return Err(Error::Job("this folder holds the encrypted copy; choose an empty folder for a copy without encryption".into()));
        }
    }
    if job.encrypted
        && let Resolved::Cloud { spec } = &target
    {
        cloud::ensure_crypt(&config.rclone_path, &rclone_config, &id, spec).await?;
    }
    if let Some(first) = &job.triggers.after_job {
        // Following the "after job" links from here must never come back to this job.
        let mut current = Some(first.clone());
        let mut seen = std::collections::HashSet::new();
        while let Some(next) = current {
            if next == id || !seen.insert(next.clone()) {
                return Err(Error::Job("the jobs would start each other in a circle".into()));
            }
            current = config.job(&next).and_then(|job| job.triggers.after_job.clone());
        }
    }
    let saved = Job {
        id: id.clone(),
        name,
        enabled: job.enabled,
        source: Place { location: job.source.location.clone(), path: job.source.path.trim_matches('/').to_string() },
        target: Place { location: job.target.location.clone(), path: job.target.path.trim_matches('/').to_string() },
        mode: job.mode,
        excludes,
        safety: Safety { max_delete_percent: job.max_delete_percent, ..Safety::default() },
        ring: job.ring,
        triggers: job.triggers.clone(),
        archive: job.archive.clone(),
        conflicts: job.conflicts.clone(),
        encrypted: job.encrypted,
    };
    let stored = saved.clone();
    commit(&app, &state, |config| {
        match config.jobs.iter_mut().find(|existing| existing.id == id) {
            Some(existing) => *existing = stored,
            None => config.jobs.push(stored),
        }
        Ok(())
    })?;
    Ok(saved)
}

#[tauri::command]
pub fn delete_job(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<Config> {
    commit(&app, &state, |config| {
        let before = config.jobs.len();
        config.jobs.retain(|job| job.id != id);
        if config.jobs.len() == before {
            return Err(Error::Job(format!("job {id} does not exist")));
        }
        Ok(())
    })
}

#[tauri::command]
pub fn set_job_enabled(app: AppHandle, state: State<'_, AppState>, id: String, enabled: bool) -> Result<Config> {
    commit(&app, &state, |config| {
        let job = config.jobs.iter_mut().find(|job| job.id == id).ok_or_else(|| Error::Job(format!("job {id} does not exist")))?;
        job.enabled = enabled;
        Ok(())
    })
}

/// Default excludes the job form starts with.
#[tauri::command]
pub fn job_defaults() -> Vec<String> {
    default_excludes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn overlapping_places_are_refused() {
        let local = |p: &str| Resolved::Local(Path::new(p).to_path_buf());
        assert!(conflict(&local("/a/WORK"), &local("/a/WORK")).is_some());
        assert!(conflict(&local("/a"), &local("/a/b")).unwrap().contains("inside the source"));
        assert!(conflict(&local("/a/b"), &local("/a")).unwrap().contains("inside the target"));
        assert!(conflict(&local("/a/b"), &local("/a/bc")).is_none());
        assert!(conflict(&local("/Users/m/Desktop/WORK"), &local("/Volumes/M2mini/WORK")).is_none());
    }

    #[test]
    fn ids_are_slugs_with_a_suffix() {
        let id = new_id("WORK → M2mini");
        assert!(id.starts_with("work-m2mini-"), "{id}");
        assert_eq!(new_id("→").len(), 6);
    }

    #[test]
    fn places_overlap_when_one_holds_the_other() {
        let place = |location: &str, path: &str| Place { location: location.into(), path: path.into() };
        assert!(nested(&place("box", "Backups"), &place("box", "Backups")));
        assert!(nested(&place("box", "Backups"), &place("box", "Backups/Photos")));
        assert!(nested(&place("box", "Backups/Photos"), &place("box", "Backups")));
        assert!(nested(&place("box", ""), &place("box", "Backups")), "the location's root holds everything");
        assert!(!nested(&place("box", "Backups"), &place("box", "Backups2")), "a common prefix is not a folder");
        assert!(!nested(&place("box", "Backups"), &place("nas", "Backups")));
    }
}
