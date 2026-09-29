//! Copying is background work: the sync tools run the way Time Machine and
//! Spotlight do, so the Mac stays responsive while a large run lists millions
//! of entries.

use tokio::process::Command;

/// A soft ceiling for rclone's heap. rclone is written in Go; above this its
/// garbage collector works harder instead of letting the process grow into
/// gigabytes while it holds the listings of both sides.
const RCLONE_MEMORY_LIMIT: &str = "2GiB";

/// Starts `command` in macOS's background band: efficiency cores only, and disk
/// access that yields to everything the user does. Children such as the ssh
/// that rsync starts inherit it.
pub fn lower(command: &mut Command) -> &mut Command {
    command.env("GOMEMLIMIT", RCLONE_MEMORY_LIMIT);
    #[cfg(target_os = "macos")]
    // SAFETY: setpriority is async-signal-safe and touches only the child process.
    unsafe {
        command.pre_exec(|| {
            // A failure only means the run is not throttled; it must not stop the run.
            let _ = libc::setpriority(libc::PRIO_DARWIN_PROCESS, 0, libc::PRIO_DARWIN_BG);
            Ok(())
        });
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_started_tool_runs_in_the_background_band() {
        // ps reports a background-band process with a lowered priority.
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "ps -o pri= -p $$; echo $GOMEMLIMIT"]);
        let output = lower(&mut command).output().await.unwrap();
        let text = String::from_utf8(output.stdout).unwrap();
        let mut lines = text.lines();
        let priority: i32 = lines.next().unwrap().trim().parse().unwrap();
        let mut plain = Command::new("/bin/sh");
        let normal: i32 = String::from_utf8(plain.args(["-c", "ps -o pri= -p $$"]).output().await.unwrap().stdout).unwrap().trim().parse().unwrap();
        assert!(priority < normal, "background {priority}, normal {normal}");
        assert_eq!(lines.next(), Some(RCLONE_MEMORY_LIMIT));
    }
}
