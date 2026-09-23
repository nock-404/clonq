//! Servers over SSH: a key per server, a one-time key install with the password,
//! and a connection test. The password is only held for the install call.

use serde::Serialize;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::{Error, Result};
use crate::locations::ssh_command;

/// clonq's own known_hosts: a server's key goes in only after the user confirmed
/// its fingerprint, and every later connection insists on exactly that key.
static KNOWN_HOSTS: OnceLock<PathBuf> = OnceLock::new();

pub fn set_known_hosts(path: PathBuf) {
    let _ = KNOWN_HOSTS.set(path);
}

pub fn known_hosts() -> PathBuf {
    KNOWN_HOSTS.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("clonq-test-known_hosts"))
}

/// A server's public host key as `ssh-keyscan` saw it, with its fingerprint for the user.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostKey {
    #[serde(skip)]
    pub line: String,
    pub kind: String,
    pub fingerprint: String,
}

/// Reads the server's host keys without logging in.
pub async fn scan(host: &str, port: u16) -> Result<Vec<HostKey>> {
    let output = Command::new("/usr/bin/ssh-keyscan").args(["-p", &port.to_string(), "-T", "10", host]).output().await?;
    let lines: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.starts_with('#') && !line.trim().is_empty())
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Measured on macOS 27: "getaddrinfo x: nodename nor servname provided", and for a
        // closed port "write (127.0.0.1): Broken pipe".
        if stderr.contains("getaddrinfo") {
            return Err(Error::Job("host name not found".into()));
        }
        if stderr.contains("Broken pipe") || stderr.contains("Connection refused") {
            return Err(Error::Job("the server refused the connection on this port".into()));
        }
        return Err(Error::Job("no answer from the server (timeout)".into()));
    }
    let mut keys = Vec::new();
    for line in lines {
        let mut child = Command::new("/usr/bin/ssh-keygen").args(["-l", "-f", "-"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(format!("{line}\n").as_bytes()).await?;
        }
        let printed = String::from_utf8_lossy(&child.wait_with_output().await?.stdout).into_owned();
        // "256 SHA256:abc… [host]:23 (ED25519)"
        let mut fields = printed.split_whitespace();
        let fingerprint = fields.nth(1).unwrap_or_default().to_string();
        let kind = printed.trim().rsplit(' ').next().unwrap_or_default().trim_matches(['(', ')']).to_string();
        if !fingerprint.is_empty() {
            keys.push(HostKey { line, kind, fingerprint });
        }
    }
    Ok(keys)
}

/// Pins confirmed host keys in clonq's known_hosts. Keys pinned earlier for the same
/// host and port are replaced, so an old key is not accepted any more once the user
/// confirmed a new one.
pub fn trust(keys: &[HostKey]) -> Result<()> {
    let path = known_hosts();
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    std::fs::write(&path, pinned(&existing, keys))?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

/// known_hosts text with `keys` in place of every earlier line for their hosts.
/// ssh-keyscan writes the host as the first field ("host" or "[host]:port"), unhashed.
fn pinned(existing: &str, keys: &[HostKey]) -> String {
    let hosts: Vec<&str> = keys.iter().filter_map(|key| key.line.split_whitespace().next()).collect();
    let mut text: String = existing
        .lines()
        .filter(|line| !line.split_whitespace().next().is_some_and(|host| hosts.contains(&host)))
        .map(|line| format!("{line}\n"))
        .collect();
    for key in keys {
        text.push_str(&key.line);
        text.push('\n');
    }
    text
}

/// Hetzner Storage Boxes install keys with their own command on port 23.
pub fn is_storage_box(host: &str) -> bool {
    host.ends_with(".your-storagebox.de")
}

/// Creates an ed25519 key pair for one server unless it exists; returns the private key path.
pub async fn ensure_key(keys_dir: &Path, location_id: &str) -> Result<PathBuf> {
    tokio::fs::create_dir_all(keys_dir).await?;
    tokio::fs::set_permissions(keys_dir, std::fs::Permissions::from_mode(0o700)).await?;
    let key = keys_dir.join(format!("{location_id}_ed25519"));
    if key.exists() {
        return Ok(key);
    }
    let output = Command::new("/usr/bin/ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-C", &format!("clonq {location_id}"), "-f"])
        .arg(&key)
        .stdin(Stdio::null())
        .output()
        .await?;
    if !output.status.success() {
        return Err(Error::Job(format!("ssh-keygen failed: {}", String::from_utf8_lossy(&output.stderr).trim())));
    }
    Ok(key)
}

/// Runs a harmless command with the key; Ok means clonq can reach the server unattended.
pub async fn test(host: &str, port: u16, user: &str, identity_file: &str) -> std::result::Result<String, String> {
    let mut command = ssh_command(port, identity_file);
    command.push(format!("{user}@{host}"));
    command.push("pwd".into());
    let output = Command::new(&command[0])
        .args(&command[1..])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(explain(&String::from_utf8_lossy(&output.stderr)))
    }
}

/// Puts the public key on the server, logging in once with the password.
/// ssh reads the password from a tiny askpass script that echoes it from the
/// environment of this one process; nothing is written to disk but the script.
pub async fn install_key(
    askpass_dir: &Path,
    host: &str,
    port: u16,
    user: &str,
    identity_file: &str,
    password: &str,
) -> Result<()> {
    let public_key = tokio::fs::read_to_string(format!("{identity_file}.pub")).await?;
    let askpass = write_askpass(askpass_dir).await?;
    let remote_command = if is_storage_box(host) {
        "install-ssh-key".to_string()
    } else {
        // A last line without a newline would glue the new key onto it; a key already there is not added twice.
        "umask 077; mkdir -p .ssh && touch .ssh/authorized_keys && { [ -n \"$(tail -c1 .ssh/authorized_keys)\" ] && echo >> .ssh/authorized_keys; KEY=$(cat); grep -qxF \"$KEY\" .ssh/authorized_keys || printf '%s\\n' \"$KEY\" >> .ssh/authorized_keys; }".to_string()
    };
    let known_hosts = known_hosts();
    let mut child = Command::new("/usr/bin/ssh")
        .args(["-p", &port.to_string()])
        .arg("-o")
        .arg(format!("UserKnownHostsFile={}", known_hosts.display()))
        .args(["-o", "StrictHostKeyChecking=yes"])
        .args(["-o", "ForwardAgent=no"])
        .args(["-o", "ClearAllForwardings=yes"])
        .args(["-o", "PreferredAuthentications=password,keyboard-interactive"])
        .args(["-o", "PubkeyAuthentication=no"])
        .args(["-o", "NumberOfPasswordPrompts=1"])
        .args(["-o", "ConnectTimeout=15"])
        .arg(format!("{user}@{host}"))
        .arg(remote_command)
        .env("SSH_ASKPASS", &askpass)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("CLONQ_ASKPASS_SECRET", password)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(public_key.as_bytes()).await?;
    }
    let output = child.wait_with_output().await?;
    if output.status.success() {
        Ok(())
    } else {
        Err(Error::Job(explain(&String::from_utf8_lossy(&output.stderr))))
    }
}

async fn write_askpass(dir: &Path) -> Result<PathBuf> {
    tokio::fs::create_dir_all(dir).await?;
    let path = dir.join("askpass.sh");
    tokio::fs::write(&path, "#!/bin/sh\nprintf '%s\\n' \"$CLONQ_ASKPASS_SECRET\"\n").await?;
    tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(path)
}

/// Turns ssh's stderr into one line the user can act on.
pub(crate) fn explain(stderr: &str) -> String {
    let text = stderr.trim();
    if text.contains("Permission denied") {
        return "login refused: wrong user, password or key".into();
    }
    if text.contains("Could not resolve hostname") {
        return "host name not found".into();
    }
    if text.contains("Connection refused") {
        return "the server refused the connection on this port".into();
    }
    if text.contains("timed out") || text.contains("Operation timed out") {
        return "no answer from the server (timeout)".into();
    }
    // ssh says "No ED25519 host key is known for …" when nothing is pinned for this host yet.
    if text.contains("host key is known for") {
        return "the server's host key is not confirmed yet".into();
    }
    if text.contains("Host key verification failed") || text.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        return "the server's host key changed; check it before trusting it again".into();
    }
    text.lines().last().unwrap_or("ssh failed").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_confirmation_replaces_the_old_keys_of_that_host() {
        let key = |line: &str| HostKey { line: line.into(), kind: String::new(), fingerprint: String::new() };
        let existing = "[box]:23 ssh-ed25519 OLD\n[box]:23 ssh-rsa OLDRSA\nother ssh-ed25519 KEEP\n";
        let text = pinned(existing, &[key("[box]:23 ssh-ed25519 NEW")]);
        assert_eq!(text, "other ssh-ed25519 KEEP\n[box]:23 ssh-ed25519 NEW\n");
        // A file without a final newline still gets one line per key.
        assert_eq!(pinned("a k1", &[key("b k2")]), "a k1\nb k2\n");
    }

    #[test]
    fn storage_boxes_are_recognised() {
        assert!(is_storage_box("u123456.your-storagebox.de"));
        assert!(!is_storage_box("example.com"));
    }

    #[test]
    fn errors_are_explained() {
        assert_eq!(explain("u1@x: Permission denied (publickey,password)."), "login refused: wrong user, password or key");
        assert_eq!(explain("ssh: Could not resolve hostname nope: nodename nor servname provided"), "host name not found");
    }

    #[tokio::test]
    async fn keys_are_created_once_with_private_permissions() {
        let dir = std::env::temp_dir().join(format!("clonq-keys-{}", uuid::Uuid::new_v4()));
        let key = ensure_key(&dir, "box").await.unwrap();
        assert!(key.exists());
        assert!(key.with_extension("").exists() || std::path::Path::new(&format!("{}.pub", key.display())).exists());
        let again = ensure_key(&dir, "box").await.unwrap();
        assert_eq!(key, again);
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
