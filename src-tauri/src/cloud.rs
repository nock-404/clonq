//! Cloud storage through rclone. Each cloud location is one remote in clonq's
//! own rclone config file; nothing touches the user's personal rclone setup.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;

use crate::config::ARCHIVE_DIR;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub key: &'static str,
    pub label: &'static str,
    pub secret: bool,
    pub required: bool,
    pub placeholder: &'static str,
    pub hint: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: &'static str,
    pub label: &'static str,
    /// Connected by signing in through the browser (OAuth).
    pub browser_login: bool,
    pub fields: Vec<Field>,
}

const fn field(key: &'static str, label: &'static str, secret: bool, required: bool, placeholder: &'static str) -> Field {
    Field { key, label, secret, required, placeholder, hint: None }
}

pub fn providers() -> Vec<Provider> {
    vec![
        Provider {
            id: "s3",
            label: "Amazon S3 und kompatible",
            browser_login: false,
            fields: vec![
                Field {
                    hint: Some("Leer lassen für Amazon S3; sonst die Adresse des Anbieters, z. B. fsn1.your-objectstorage.com"),
                    ..field("endpoint", "Endpoint", false, false, "https://…")
                },
                field("region", "Region", false, false, "eu-central-1"),
                field("access_key_id", "Access Key ID", false, true, ""),
                field("secret_access_key", "Secret Access Key", true, true, ""),
            ],
        },
        Provider {
            id: "b2",
            label: "Backblaze B2",
            browser_login: false,
            fields: vec![field("account", "Key ID", false, true, ""), field("key", "Application Key", true, true, "")],
        },
        Provider { id: "drive", label: "Google Drive", browser_login: true, fields: vec![] },
        Provider { id: "onedrive", label: "Microsoft OneDrive", browser_login: true, fields: vec![] },
        Provider { id: "dropbox", label: "Dropbox", browser_login: true, fields: vec![] },
        Provider {
            id: "webdav",
            label: "WebDAV",
            browser_login: false,
            fields: vec![
                field("url", "Adresse", false, true, "https://…"),
                field("user", "Benutzer", false, true, ""),
                field("pass", "Passwort", true, true, ""),
            ],
        },
    ]
}

/// The `rclone config create` arguments for one provider and the user's inputs.
pub fn create_args(provider: &str, fields: &HashMap<String, String>) -> Result<Vec<String>> {
    let known = providers();
    let spec = known
        .iter()
        .find(|p| p.id == provider)
        .ok_or_else(|| Error::Job(format!("unknown cloud provider {provider}")))?;
    let value = |key: &str| fields.get(key).map(|v| v.trim().to_string()).unwrap_or_default();
    for field in &spec.fields {
        if field.required && value(field.key).is_empty() {
            return Err(Error::Job(format!("{} is required", field.label)));
        }
    }
    let mut args: Vec<String> = Vec::new();
    let mut pair = |key: &str, value: String| {
        if !value.is_empty() {
            args.push(format!("{key}={value}"));
        }
    };
    match provider {
        "s3" => {
            let endpoint = value("endpoint");
            if endpoint.is_empty() {
                pair("provider", "AWS".into());
                pair("region", value("region"));
            } else {
                pair("provider", "Other".into());
                pair("endpoint", endpoint);
                pair("region", value("region"));
            }
            pair("access_key_id", value("access_key_id"));
            pair("secret_access_key", value("secret_access_key"));
        }
        "b2" => {
            pair("account", value("account"));
            pair("key", value("key"));
        }
        "webdav" => {
            pair("url", value("url"));
            pair("vendor", "other".into());
            pair("user", value("user"));
            pair("pass", value("pass"));
        }
        // Browser sign-in: rclone opens the browser itself and waits for the token.
        _ => {}
    }
    Ok(args)
}

/// Fields that are secrets: never on a command line, where other users could read them.
fn is_secret(provider: &str, key: &str) -> bool {
    providers().iter().any(|p| p.id == provider && p.fields.iter().any(|field| field.key == key && field.secret))
}

/// Creates the remote; for browser providers this waits until the sign-in is done.
/// Secrets are written into clonq's rclone config file directly afterwards
/// (passwords obscured through rclone's stdin), so they never appear in argv.
pub async fn create_remote(rclone: &str, config_file: &Path, remote: &str, provider: &str, fields: &HashMap<String, String>) -> Result<()> {
    let args = create_args(provider, fields)?;
    let (secrets, plain): (Vec<String>, Vec<String>) =
        args.into_iter().partition(|arg| arg.split_once('=').is_some_and(|(key, _)| is_secret(provider, key)));
    let mut command = Command::new(rclone);
    command
        .arg("config")
        .arg("create")
        .arg(remote)
        .arg(provider)
        .args(&plain)
        .arg("--config")
        .arg(config_file)
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(300), command.output())
        .await
        .map_err(|_| Error::Job("the sign-in did not finish within five minutes".into()))??;
    if !output.status.success() {
        return Err(Error::Job(last_error(&String::from_utf8_lossy(&output.stderr))));
    }
    let mut lines = Vec::new();
    for secret in secrets {
        let (key, value) = secret.split_once('=').expect("key=value");
        if value.contains(['\n', '\r']) {
            return Err(Error::Job(format!("{key} must be a single line")));
        }
        // rclone keeps passwords obscured in its config; keys it keeps as they are.
        let value = if key == "pass" { obscure(rclone, value).await? } else { value.to_string() };
        lines.push(format!("{key} = {value}"));
    }
    if !lines.is_empty() {
        insert_into_section(config_file, remote, &lines)?;
    }
    Ok(())
}

async fn obscure(rclone: &str, secret: &str) -> Result<String> {
    let mut child = Command::new(rclone)
        .args(["obscure", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(format!("{secret}\n").as_bytes()).await?;
    }
    let output = child.wait_with_output().await?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Adds `key = value` lines at the end of the `[remote]` section of an rclone config.
fn insert_into_section(config_file: &Path, remote: &str, lines: &[String]) -> Result<()> {
    let text = std::fs::read_to_string(config_file)?;
    let header = format!("[{remote}]");
    let mut out: Vec<String> = Vec::new();
    let mut inside = false;
    let mut inserted = false;
    for line in text.lines() {
        if line.trim_start().starts_with('[') {
            if inside && !inserted {
                while out.last().is_some_and(|last| last.trim().is_empty()) {
                    out.pop();
                }
                out.extend(lines.iter().cloned());
                out.push(String::new());
                inserted = true;
            }
            inside = line.trim() == header;
        }
        out.push(line.to_string());
    }
    if inside && !inserted {
        while out.last().is_some_and(|last| last.trim().is_empty()) {
            out.pop();
        }
        out.extend(lines.iter().cloned());
        inserted = true;
    }
    if !inserted {
        return Err(Error::Job(format!("remote {remote} is missing in the rclone config")));
    }
    std::fs::write(config_file, out.join("\n") + "\n")?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(config_file, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

pub async fn delete_remote(rclone: &str, config_file: &Path, remote: &str) {
    let _ = Command::new(rclone).args(["config", "delete", remote, "--config"]).arg(config_file).output().await;
}

/// Lists the top level of a remote path; Ok means clonq can reach it.
pub async fn test(rclone: &str, config_file: &Path, spec: &str) -> std::result::Result<(), String> {
    let run = Command::new(rclone)
        .args(["lsf", "--max-depth", "1", "--dirs-only", spec, "--config"])
        .arg(config_file)
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(Duration::from_secs(30), run).await {
        Err(_) => Err("no answer from the cloud (timeout)".into()),
        Ok(Err(error)) => Err(error.to_string()),
        Ok(Ok(output)) if output.status.success() => Ok(()),
        Ok(Ok(output)) => Err(last_error(&String::from_utf8_lossy(&output.stderr))),
    }
}

/// Sub-folders of a remote path.
pub async fn list_dirs(rclone: &str, config_file: &Path, spec: &str) -> Result<Vec<String>> {
    let output = Command::new(rclone)
        .args(["lsf", "--max-depth", "1", "--dirs-only", spec, "--config"])
        .arg(config_file)
        .output()
        .await?;
    if !output.status.success() {
        return Err(Error::Job(last_error(&String::from_utf8_lossy(&output.stderr))));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.strip_suffix('/'))
        .map(str::to_string)
        .collect())
}

pub async fn make_dir(rclone: &str, config_file: &Path, spec: &str) -> Result<()> {
    let output = Command::new(rclone).args(["mkdir", spec, "--config"]).arg(config_file).output().await?;
    if !output.status.success() {
        return Err(Error::Job(last_error(&String::from_utf8_lossy(&output.stderr))));
    }
    Ok(())
}

/// Number of objects under a remote path, not counting clonq's archive
/// (for the deletion check and the next run's limit).
pub async fn count(rclone: &str, config_file: &Path, spec: &str, excludes: &[String]) -> Result<i64> {
    // Only what a sync could delete counts: the job's excludes and the archive stay out.
    let mut command = Command::new(rclone);
    command.args(["size", "--json", spec, "--exclude", &format!("/{ARCHIVE_DIR}/**")]);
    for pattern in excludes {
        let pattern = pattern.strip_suffix('/').map_or(pattern.clone(), |folder| format!("{folder}/**"));
        command.arg("--exclude").arg(pattern);
    }
    let output = command.arg("--config").arg(config_file).output().await?;
    if !output.status.success() {
        // A target that does not exist yet holds nothing.
        return Ok(0);
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    Ok(value.get("count").and_then(serde_json::Value::as_i64).unwrap_or(0))
}

fn last_error(stderr: &str) -> String {
    stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.split_once(": ").map_or(line, |(_, rest)| rest).trim().to_string())
        .unwrap_or_else(|| "rclone failed".into())
}

/// The rclone crypt remote that wraps an encrypted job's cloud folder.
pub fn crypt_name(job_id: &str) -> String {
    format!("clonq-crypt-{job_id}")
}

pub fn is_crypt(spec: &str) -> bool {
    spec.starts_with("clonq-crypt-")
}

/// A strong password a person can still copy by hand: 25 characters in five groups, 125 bits.
fn new_password() -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    // uuid v4 bytes are random except byte 6 (version) and 8 (variant).
    let bytes: Vec<u8> = [uuid::Uuid::new_v4(), uuid::Uuid::new_v4()]
        .iter()
        .flat_map(|id| id.as_bytes().iter().enumerate().filter(|(i, _)| *i != 6 && *i != 8).map(|(_, b)| *b).collect::<Vec<_>>())
        .collect();
    let symbols: Vec<char> = bytes.iter().take(25).map(|b| ALPHABET[(*b % 32) as usize] as char).collect();
    symbols.chunks(5).map(|group| group.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

/// Creates the job's crypt remote around `wrapped`, or points an existing one there; an
/// existing remote keeps its password, so the data already encrypted stays readable.
pub async fn ensure_crypt(rclone: &str, config_file: &Path, job_id: &str, wrapped: &str) -> Result<()> {
    let name = crypt_name(job_id);
    let exists = crypt_password(rclone, config_file, job_id).await?.is_some();
    let mut command = Command::new(rclone);
    if exists {
        command.args(["config", "update", &name, &format!("remote={wrapped}"), "--non-interactive"]);
    } else {
        command.args([
            "config",
            "create",
            &name,
            "crypt",
            &format!("remote={wrapped}"),
            &format!("password={}", new_password()),
            "filename_encryption=standard",
            "directory_name_encryption=true",
            "--obscure",
            "--non-interactive",
        ]);
    }
    let output = command.arg("--config").arg(config_file).output().await?;
    if !output.status.success() {
        return Err(Error::Job(last_error(&String::from_utf8_lossy(&output.stderr))));
    }
    Ok(())
}

/// The password of a job's crypt remote in plain text, or None when the job has none.
pub async fn crypt_password(rclone: &str, config_file: &Path, job_id: &str) -> Result<Option<String>> {
    let output = Command::new(rclone).args(["config", "dump", "--config"]).arg(config_file).output().await?;
    if !output.status.success() {
        return Err(Error::Job(last_error(&String::from_utf8_lossy(&output.stderr))));
    }
    let dump: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap_or_default();
    let Some(obscured) = dump.get(crypt_name(job_id)).and_then(|remote| remote.get("password")).and_then(|value| value.as_str()) else {
        return Ok(None);
    };
    let revealed = Command::new(rclone).args(["reveal", obscured]).output().await?;
    if !revealed.status.success() {
        return Err(Error::Job("the encryption password could not be read".into()));
    }
    Ok(Some(String::from_utf8_lossy(&revealed.stdout).trim().to_string()))
}

/// Whether a remote folder holds nothing yet (a folder that does not exist counts as empty).
pub async fn is_empty(rclone: &str, config_file: &Path, spec: &str) -> Result<bool> {
    let output = Command::new(rclone).args(["lsf", "--max-depth", "1", spec, "--config"]).arg(config_file).output().await?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("directory not found") || error.contains("not found") {
            return Ok(true);
        }
        return Err(Error::Job(last_error(&error)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn s3_without_endpoint_is_aws() {
        let args = create_args("s3", &fields(&[("access_key_id", "A"), ("secret_access_key", "S"), ("region", "eu-central-1")])).unwrap();
        assert_eq!(args, vec!["provider=AWS", "region=eu-central-1", "access_key_id=A", "secret_access_key=S"]);
    }

    #[test]
    fn s3_with_endpoint_is_other() {
        let args = create_args("s3", &fields(&[("endpoint", "fsn1.your-objectstorage.com"), ("access_key_id", "A"), ("secret_access_key", "S")])).unwrap();
        assert!(args.contains(&"provider=Other".to_string()));
        assert!(args.contains(&"endpoint=fsn1.your-objectstorage.com".to_string()));
    }

    #[test]
    fn required_fields_are_enforced() {
        let error = create_args("webdav", &fields(&[("url", "https://x")])).unwrap_err().to_string();
        assert!(error.contains("Benutzer is required"), "{error}");
        assert!(create_args("drive", &fields(&[])).unwrap().is_empty());
    }

    #[test]
    fn secrets_go_into_the_right_section() {
        let dir = std::env::temp_dir().join(format!("clonq-ini-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("rclone.conf");
        std::fs::write(&file, "[a]\ntype = s3\n\n[b]\ntype = webdav\nurl = https://x\n").unwrap();
        insert_into_section(&file, "a", &["secret_access_key = S".into()]).unwrap();
        insert_into_section(&file, "b", &["pass = P".into()]).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert_eq!(text, "[a]\ntype = s3\nsecret_access_key = S\n\n[b]\ntype = webdav\nurl = https://x\npass = P\n");
        assert!(insert_into_section(&file, "missing", &["x = 1".into()]).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn webdav_password_is_obscured_and_readable_by_rclone() {
        let rclone = "/opt/homebrew/bin/rclone";
        if !Path::new(rclone).exists() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("clonq-webdav-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("rclone.conf");
        let fields: HashMap<String, String> =
            [("url", "https://dav.example"), ("user", "me"), ("pass", "geheim")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        create_remote(rclone, &file, "dav", "webdav", &fields).await.unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(!text.contains("geheim"), "stored obscured: {text}");
        let revealed = Command::new(rclone).args(["config", "dump", "--config"]).arg(&file).output().await.unwrap();
        assert!(String::from_utf8_lossy(&revealed.stdout).contains("\"pass\""));
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Against the real rclone: a remote of type "local" stands in for a cloud.
    #[tokio::test]
    async fn remote_round_trip_with_the_real_rclone() {
        let rclone = "/opt/homebrew/bin/rclone";
        if !Path::new(rclone).exists() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("clonq-rclone-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("data/a")).unwrap();
        let config = dir.join("rclone.conf");
        let output = Command::new(rclone).args(["config", "create", "fake", "local", "--config"]).arg(&config).output().await.unwrap();
        assert!(output.status.success());
        let spec = format!("fake:{}", dir.join("data").display());
        assert_eq!(test(rclone, &config, &spec).await, Ok(()));
        assert_eq!(list_dirs(rclone, &config, &spec).await.unwrap(), vec!["a".to_string()]);
        make_dir(rclone, &config, &format!("{spec}/b")).await.unwrap();
        assert!(dir.join("data/b").is_dir());
        assert_eq!(count(rclone, &config, &spec, &[]).await.unwrap(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

