//! Network shares: the password goes to the macOS keychain, Finder's own
//! mechanism mounts the share, and clonq finds the mount point afterwards.

use std::path::PathBuf;
use std::process::Command;

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq)]
pub struct Share {
    pub host: String,
    pub share: String,
}

/// Reads `smb://host/share` (a path after the share is not part of the share).
pub fn parse(url: &str) -> Result<Share> {
    let rest = url
        .trim()
        .strip_prefix("smb://")
        .ok_or_else(|| Error::Job("the address must start with smb://".into()))?;
    let rest = rest.split_once('@').map_or(rest, |(_, host)| host);
    let mut parts = rest.split('/').filter(|part| !part.is_empty());
    let host = parts.next().ok_or_else(|| Error::Job("the address has no server".into()))?;
    let share = parts.next().ok_or_else(|| Error::Job("the address has no share name, e.g. smb://nas/daten".into()))?;
    Ok(Share { host: host.to_string(), share: share.to_string() })
}

#[cfg(target_os = "macos")]
pub fn store_password(host: &str, user: &str, password: &str) -> Result<()> {
    use security_framework::passwords::set_internet_password;
    use security_framework_sys::keychain::{SecAuthenticationType, SecProtocolType};
    set_internet_password(host, None, user, "", None, SecProtocolType::SMB, SecAuthenticationType::Default, password.as_bytes())
        .map_err(|error| Error::Job(format!("the keychain refused the password: {error}")))
}

#[cfg(target_os = "macos")]
pub fn read_password(host: &str, user: &str) -> Option<String> {
    use security_framework::passwords::get_internet_password;
    use security_framework_sys::keychain::{SecAuthenticationType, SecProtocolType};
    get_internet_password(host, None, user, "", None, SecProtocolType::SMB, SecAuthenticationType::Default)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

#[cfg(target_os = "macos")]
pub fn delete_password(host: &str, user: &str) {
    use security_framework::passwords::delete_internet_password;
    use security_framework_sys::keychain::{SecAuthenticationType, SecProtocolType};
    let _ = delete_internet_password(host, None, user, "", None, SecProtocolType::SMB, SecAuthenticationType::Default);
}

/// Where the share is mounted now, read from `mount`: `//user@host/share on /Volumes/x (smbfs, …)`.
pub fn mount_point(share: &Share) -> Option<PathBuf> {
    let output = Command::new("/sbin/mount").output().ok()?;
    find_mount(&String::from_utf8_lossy(&output.stdout), share)
}

fn find_mount(table: &str, share: &Share) -> Option<PathBuf> {
    let wanted_share = decode(&share.share).to_lowercase();
    for line in table.lines() {
        let Some((device, rest)) = line.split_once(" on ") else { continue };
        let Some((point, options)) = rest.rsplit_once(" (") else { continue };
        if !options.starts_with("smbfs") {
            continue;
        }
        let device = device.trim_start_matches("//");
        let device = device.split_once('@').map_or(device, |(_, host)| host);
        let Some((host, name)) = device.split_once('/') else { continue };
        if host.eq_ignore_ascii_case(&share.host) && decode(name).to_lowercase() == wanted_share {
            return Some(PathBuf::from(point));
        }
    }
    None
}

/// `%20` and friends in share names as `mount` prints them.
fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(value) = u8::from_str_radix(&text[i + 1..i + 3], 16)
        {
            out.push(value);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Mounts the share the way Finder does, using the keychain password.
pub async fn mount(share: &Share, user: &str) -> Result<PathBuf> {
    if let Some(point) = mount_point(share) {
        return Ok(point);
    }
    let url = format!("smb://{}@{}/{}", user, share.host, share.share);
    let script = format!("mount volume \"{}\"", url.replace('"', ""));
    let output = tokio::process::Command::new("/usr/bin/osascript").arg("-e").arg(script).output().await?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Job(format!("the share could not be connected: {}", message.trim())));
    }
    mount_point(share).ok_or_else(|| Error::Job("the share was connected but its folder was not found".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_parsed() {
        assert_eq!(parse("smb://nas.local/Daten").unwrap(), Share { host: "nas.local".into(), share: "Daten".into() });
        assert_eq!(parse("smb://me@nas/Daten/Unterordner").unwrap(), Share { host: "nas".into(), share: "Daten".into() });
        assert!(parse("afp://nas/Daten").is_err());
        assert!(parse("smb://nas").is_err());
    }

    #[test]
    fn mount_table_is_matched_by_host_and_share() {
        let table = "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n\
                     //matthias@nas.local/Meine%20Daten on /Volumes/Meine Daten (smbfs, nodev, nosuid, mounted by matthias)\n";
        let share = Share { host: "NAS.local".into(), share: "Meine Daten".into() };
        assert_eq!(find_mount(table, &share), Some(PathBuf::from("/Volumes/Meine Daten")));
        let other = Share { host: "nas.local".into(), share: "Andere".into() };
        assert_eq!(find_mount(table, &other), None);
    }
}
