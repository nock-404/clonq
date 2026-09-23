//! Servers over SSH: a key per server, a one-time key install with the password,
//! and a connection test. The password is only held for the install call.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::{Error, Result};
use crate::locations::ssh_command;

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
        "umask 077; mkdir -p .ssh && cat >> .ssh/authorized_keys".to_string()
    };
    let mut child = Command::new("/usr/bin/ssh")
        .args(["-p", &port.to_string()])
        .args(["-o", "StrictHostKeyChecking=accept-new"])
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
fn explain(stderr: &str) -> String {
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
    if text.contains("Host key verification failed") || text.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        return "the server's host key changed; check it before trusting it again".into();
    }
    text.lines().last().unwrap_or("ssh failed").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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
