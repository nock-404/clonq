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

/// Creates the remote; for browser providers this waits until the sign-in is done.
pub async fn create_remote(rclone: &str, config_file: &Path, remote: &str, provider: &str, fields: &HashMap<String, String>) -> Result<()> {
    let mut command = Command::new(rclone);
    command
        .arg("config")
        .arg("create")
        .arg(remote)
        .arg(provider)
        .args(create_args(provider, fields)?)
        .arg("--obscure")
        .arg("--config")
        .arg(config_file)
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(300), command.output())
        .await
        .map_err(|_| Error::Job("the sign-in did not finish within five minutes".into()))??;
    if !output.status.success() {
        return Err(Error::Job(last_error(&String::from_utf8_lossy(&output.stderr))));
    }
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
pub async fn count(rclone: &str, config_file: &Path, spec: &str) -> Result<i64> {
    let output = Command::new(rclone)
        .args(["size", "--json", spec, "--exclude", &format!("/{ARCHIVE_DIR}/**"), "--config"])
        .arg(config_file)
        .output()
        .await?;
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
        assert_eq!(count(rclone, &config, &spec).await.unwrap(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
