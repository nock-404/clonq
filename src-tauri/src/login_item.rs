//! Opening clonq at login, as the app's own login item (SMAppService). System
//! Settings then lists clonq once, with its icon, instead of an anonymous
//! launch agent next to the app.

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoginItem {
    Off,
    On,
    /// Registered, but switched off under Login Items in System Settings.
    NeedsApproval,
}

#[cfg(target_os = "macos")]
pub fn state() -> LoginItem {
    use objc2_service_management::{SMAppService, SMAppServiceStatus};
    // SAFETY: plain calls on the main app's service object.
    let status = unsafe { SMAppService::mainAppService().status() };
    match status {
        SMAppServiceStatus::Enabled => LoginItem::On,
        SMAppServiceStatus::RequiresApproval => LoginItem::NeedsApproval,
        _ => LoginItem::Off,
    }
}

#[cfg(target_os = "macos")]
pub fn set(on: bool) -> Result<LoginItem> {
    use objc2_service_management::SMAppService;
    // SAFETY: plain calls on the main app's service object.
    let service = unsafe { SMAppService::mainAppService() };
    let done = if on { unsafe { service.registerAndReturnError() } } else { unsafe { service.unregisterAndReturnError() } };
    // Unregistering what is not registered is fine; the state below tells the truth either way.
    if let Err(error) = done
        && on
    {
        return Err(Error::Job(format!("could not add the login item: {}", error.localizedDescription())));
    }
    Ok(state())
}

/// Opens Login Items in System Settings, where a login item waiting for approval is switched on.
#[cfg(target_os = "macos")]
pub fn open_settings() {
    // SAFETY: opens System Settings, no arguments.
    unsafe { objc2_service_management::SMAppService::openSystemSettingsLoginItems() };
}

/// Up to 0.4.9 clonq opened at login through a launch agent that started the
/// binary itself. Replaces it with the login item, keeping the user's choice.
pub fn replace_launch_agent() {
    let (Some(home), Ok(exe)) = (std::env::var_os("HOME"), std::env::current_exe()) else { return };
    let agents = Path::new(&home).join("Library/LaunchAgents");
    let Some(agent) = launch_agent_for(&agents, &exe) else { return };
    // The agent's job stays loaded until logout; only the file goes, so this process keeps running.
    if std::fs::remove_file(&agent).is_ok() {
        #[cfg(target_os = "macos")]
        let _ = set(true);
    }
}

/// The launch agent in `agents` that starts `exe`, if there is one.
fn launch_agent_for(agents: &Path, exe: &Path) -> Option<PathBuf> {
    std::fs::read_dir(agents).ok()?.flatten().map(|entry| entry.path()).find(|path| {
        path.extension().is_some_and(|ext| ext == "plist")
            && plist::Value::from_file(path).ok().is_some_and(|value| {
                value
                    .as_dictionary()
                    .and_then(|dict| dict.get("ProgramArguments"))
                    .and_then(|args| args.as_array())
                    .and_then(|args| args.first())
                    .and_then(|first| first.as_string())
                    .is_some_and(|program| Path::new(program) == exe)
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_the_agent_that_starts_this_app() {
        let dir = std::env::temp_dir().join(format!("clonq-agents-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let agent = |name: &str, program: &str| {
            let mut dict = plist::Dictionary::new();
            dict.insert("Label".into(), name.into());
            dict.insert("ProgramArguments".into(), plist::Value::Array(vec![program.into()]));
            plist::Value::Dictionary(dict).to_file_xml(dir.join(format!("{name}.plist"))).unwrap();
        };
        agent("other", "/Applications/Other.app/Contents/MacOS/other");
        agent("clonq", "/Applications/clonq.app/Contents/MacOS/clonq");
        std::fs::write(dir.join("broken.plist"), "not a plist").unwrap();
        assert_eq!(launch_agent_for(&dir, Path::new("/Applications/clonq.app/Contents/MacOS/clonq")), Some(dir.join("clonq.plist")));
        assert_eq!(launch_agent_for(&dir, Path::new("/Applications/Third.app/Contents/MacOS/third")), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
