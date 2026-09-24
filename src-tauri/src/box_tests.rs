//! The same cases as matrix_tests, against a real Hetzner Storage Box over SSH (rsync on the
//! box, rclone's SFTP backend for two-way). They never run with a plain `cargo test`:
//!
//!     CLONQ_BOX_DIR="$HOME/Library/Application Support/io.github.nock404.clonq" \
//!     CLONQ_BOX_LOCATION=storage-box-510ccd \
//!     cargo test box_ -- --ignored --test-threads=1
//!
//! The box location comes from the app's own config (host, user, key, pinned host keys).
//! Every test writes only generated files, and only below `clonq-test/<random id>/` on the
//! box; `Remote::new` refuses any other place, and the folder is removed afterwards.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use crate::config::{Archive, Config, ConflictLoser, ConflictPrefer, Conflicts, Job, Location, LocationKind, Mode, Place, Safety, Triggers, ARCHIVE_DIR};
use crate::engine::{Emit, Engine, RunOptions};
use crate::history::{History, Run, RunStatus};

/// The only folder on the box these tests may write to.
const PLAYGROUND: &str = "clonq-test";

type Tree = BTreeMap<String, String>;

fn tool(name: &str) -> String {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("{name}-aarch64-apple-darwin")).to_string_lossy().into_owned()
}

struct Remote {
    root: PathBuf,
    engine: Engine,
    history: Arc<History>,
    config: Config,
    /// `clonq-test/<id>`, relative to the box's login folder.
    base: String,
    ssh: Vec<String>,
    login: String,
    clock: std::cell::Cell<u64>,
}

impl Remote {
    fn new(mode: Mode, archive: bool) -> Self {
        // The box refuses new SSH connections for a while when too many come in quickly;
        // every run opens several, so the cases keep their distance.
        std::thread::sleep(Duration::from_secs(20));
        let dir = PathBuf::from(std::env::var("CLONQ_BOX_DIR").expect("CLONQ_BOX_DIR: the app's data folder"));
        let location_id = std::env::var("CLONQ_BOX_LOCATION").expect("CLONQ_BOX_LOCATION: the box's location id");
        crate::ssh::set_known_hosts(dir.join("known_hosts"));
        let app: Config = serde_json::from_str(&fs::read_to_string(dir.join("config.json")).unwrap()).unwrap();
        let mut boxed = app.location(&location_id).expect("box location").clone();
        let base = format!("{PLAYGROUND}/{}", uuid::Uuid::new_v4());
        let LocationKind::Ssh { host, port, user, identity_file, base_path } = &mut boxed.kind else { panic!("not a server") };
        *base_path = base.clone();
        let ssh = crate::locations::ssh_command(*port, identity_file);
        let login = format!("{user}@{host}");
        // The guard: nothing below may ever point outside the playground.
        assert!(base.starts_with(&format!("{PLAYGROUND}/")) && base.len() > PLAYGROUND.len() + 30, "{base}");

        let root = std::env::temp_dir().join(format!("clonq-box-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        let history = Arc::new(History::open(&root.join("history.sqlite")).unwrap());
        let emit: Emit = Arc::new(|_, _| {});
        let engine = Engine::new(emit, history.clone(), root.join("logs"), root.join("rclone.conf"));
        let mut config: Config = serde_json::from_str(&format!(r#"{{"version":2,"rsyncPath":"{}","rclonePath":"{}"}}"#, tool("rsync"), tool("rclone"))).unwrap();
        config.locations.push(Location { id: "local".into(), name: "Local".into(), kind: LocationKind::Folder { path: root.to_string_lossy().into_owned() } });
        boxed.id = "box".into();
        config.locations.push(boxed);
        config.jobs.push(Job {
            id: "job".into(),
            name: "Job".into(),
            enabled: false,
            source: Place { location: "local".into(), path: "src".into() },
            target: Place { location: "box".into(), path: "dst".into() },
            mode,
            excludes: vec![],
            safety: Safety::default(),
            ring: None,
            triggers: Triggers::default(),
            archive: Archive { enabled: archive, keep_days: 30 },
            conflicts: Conflicts { prefer: ConflictPrefer::Newer, loser: ConflictLoser::Keep },
        });
        let remote = Self { root, engine, history, config, base, ssh, login, clock: std::cell::Cell::new(0) };
        remote.box_run(&["mkdir", &remote.base]);
        remote
    }

    /// One command on the box, inside the playground only.
    fn box_run(&self, args: &[&str]) -> String {
        let output = std::process::Command::new(&self.ssh[0]).args(&self.ssh[1..]).arg(&self.login).args(args).output().unwrap();
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn put(&self, relative: &str, content: &str) {
        let path = self.root.join("src").join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        self.clock.set(self.clock.get() + 10);
        let at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + self.clock.get());
        fs::File::options().write(true).open(&path).unwrap().set_modified(at).unwrap();
    }

    async fn run(&self, trigger: &str, options: RunOptions) -> Run {
        let run_id = self.engine.start(&self.config, "job", trigger, options).unwrap();
        for _ in 0..6000 {
            if self.engine.live_runs().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let run = self.history.recent(100).unwrap().into_iter().find(|run| run.id == run_id).unwrap();
        if !run.status.completed() {
            eprintln!("--- log of the {trigger} run ({:?}):\n{}", run.status, fs::read_to_string(&run.log_path).unwrap_or_default());
        }
        run
    }

    /// Copies a folder of the playground back to this Mac and reads it: path → content.
    fn pull(&self, relative: &str) -> Tree {
        let into = self.root.join(format!("pull-{}", uuid::Uuid::new_v4()));
        let status = std::process::Command::new(tool("rsync"))
            .args(["-a", "--mkpath"])
            .arg(format!("--rsh={}", crate::engine::shell_join(&self.ssh)))
            .arg(format!("{}:{}/{relative}/", self.login, self.base))
            .arg(format!("{}/", into.display()))
            .status()
            .unwrap();
        assert!(status.success(), "pull {relative}");
        let mut tree = Tree::new();
        read_tree(&into, &into, &mut tree);
        tree
    }

    /// Replaces a file on the box with other content of the same size and modification time.
    fn corrupt(&self, relative: &str) {
        let original = self.pull(relative.rsplit_once('/').map_or(".", |(dir, _)| dir));
        let name = relative.rsplit('/').next().unwrap();
        let content = original.get(name).unwrap_or_else(|| panic!("{relative} not on the box: {original:?}"));
        let mut bytes = content.clone().into_bytes();
        bytes[0] ^= 0x20;
        let local = self.root.join("corrupt").join(name);
        fs::create_dir_all(local.parent().unwrap()).unwrap();
        fs::write(&local, bytes).unwrap();
        // The same time as the box's file, so a quick check sees no difference.
        let stat = self.box_run(&["stat", "-c", "%Y", &format!("{}/{relative}", self.base)]);
        let seconds: u64 = stat.trim().parse().unwrap_or_else(|_| panic!("stat: {stat}"));
        fs::File::options().write(true).open(&local).unwrap().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds)).unwrap();
        let status = std::process::Command::new(tool("rsync"))
            .args(["--times", "--ignore-times", "--inplace"])
            .arg(format!("--rsh={}", crate::engine::shell_join(&self.ssh)))
            .arg(&local)
            .arg(format!("{}:{}/{relative}", self.login, self.base))
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn inode(&self, relative: &str) -> String {
        self.box_run(&["stat", "-c", "%i", &format!("{}/{relative}", self.base)]).trim().to_string()
    }

    fn source(&self) -> Tree {
        let mut tree = Tree::new();
        read_tree(&self.root.join("src"), &self.root.join("src"), &mut tree);
        tree
    }
}

impl Drop for Remote {
    fn drop(&mut self) {
        // Only ever the test's own folder inside the playground.
        if self.base.starts_with(&format!("{PLAYGROUND}/")) && !self.base.contains("..") {
            self.box_run(&["rm", "-r", &self.base]);
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn read_tree(root: &Path, dir: &Path, tree: &mut Tree) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            read_tree(root, &path, tree);
        } else {
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().into_owned();
            tree.insert(relative, fs::read_to_string(&path).unwrap_or_default());
        }
    }
}

fn ok(run: &Run) {
    assert_eq!(run.status, RunStatus::Succeeded, "run ended {:?}: {:?}", run.status, run.message);
}

fn without_archive(tree: &Tree) -> Tree {
    tree.iter().filter(|(path, _)| !path.starts_with(ARCHIVE_DIR)).map(|(k, v)| (k.clone(), v.clone())).collect()
}

fn archived(tree: &Tree) -> Vec<String> {
    tree.iter().filter(|(path, _)| path.starts_with(ARCHIVE_DIR)).map(|(_, v)| v.clone()).collect()
}

const ODD: &str = "Ordner mit Leerzeichen/Übergröße äöü ß & #1 (final).txt";

#[tokio::test]
#[ignore]
async fn box_mirror_copies_archives_and_deletes_only_in_its_folder() {
    let r = Remote::new(Mode::Mirror, true);
    r.put("a.txt", "alpha");
    r.put("dir/b.txt", "bravo");
    r.put(ODD, "odd name");
    r.put("gone.txt", "to be deleted");
    ok(&r.run("manual", RunOptions::default()).await);
    assert_eq!(without_archive(&r.pull("dst")), r.source());

    r.put("a.txt", "alpha, edited");
    fs::remove_file(r.root.join("src/gone.txt")).unwrap();
    let second = r.run("manual", RunOptions::default()).await;
    ok(&second);
    let dst = r.pull("dst");
    assert_eq!(without_archive(&dst), r.source());
    let mut kept = archived(&dst);
    kept.sort();
    assert_eq!(kept, vec!["alpha".to_string(), "to be deleted".to_string()], "overwritten and deleted versions are archived");
}

#[tokio::test]
#[ignore]
async fn box_mirror_refuses_an_empty_source_and_stops_at_the_deletion_limit() {
    let r = Remote::new(Mode::Mirror, false);
    let empty = r.run("manual", RunOptions::default()).await;
    assert_ne!(empty.status, RunStatus::Succeeded, "ran with an empty source");
    for n in 0..40 {
        r.put(&format!("f{n}.txt"), &format!("file {n}"));
    }
    ok(&r.run("manual", RunOptions::default()).await);
    for n in 0..30 {
        fs::remove_file(r.root.join(format!("src/f{n}.txt"))).unwrap();
    }
    let blocked = r.run("manual", RunOptions::default()).await;
    assert_eq!(blocked.status, RunStatus::Blocked, "{:?}", blocked.message);
    assert_eq!(r.pull("dst").len(), 40, "nothing was deleted on the box");
}

#[tokio::test]
#[ignore]
async fn box_backup_never_deletes() {
    let r = Remote::new(Mode::Backup, false);
    r.put("a.txt", "alpha");
    r.put("b.txt", "bravo");
    ok(&r.run("manual", RunOptions::default()).await);
    fs::remove_file(r.root.join("src/b.txt")).unwrap();
    r.put("c.txt", "charlie");
    ok(&r.run("manual", RunOptions::default()).await);
    let dst = r.pull("dst");
    assert_eq!(dst.keys().cloned().collect::<Vec<_>>(), vec!["a.txt", "b.txt", "c.txt"]);
}

#[tokio::test]
#[ignore]
async fn box_versioned_links_unchanged_files_between_snapshots() {
    let r = Remote::new(Mode::Versioned, true);
    r.put("same.txt", "unchanged");
    r.put("edit.txt", "first");
    ok(&r.run("manual", RunOptions::default()).await);
    // Snapshot names carry seconds and milliseconds; the next run gets its own.
    tokio::time::sleep(Duration::from_millis(1100)).await;
    r.put("edit.txt", "second");
    ok(&r.run("manual", RunOptions::default()).await);
    let base = format!("{}:{}/dst/", r.login, r.base);
    let rsh = vec![format!("--rsh={}", crate::engine::shell_join(&r.ssh))];
    let (complete, incomplete) = crate::versions::list_remote(&tool("rsync"), &rsh, &base).await.unwrap();
    assert_eq!((complete.len(), incomplete.len()), (2, 0), "{complete:?} {incomplete:?}");
    let (old, new) = (&complete[0], &complete[1]);
    assert_eq!(r.inode(&format!("dst/{old}/same.txt")), r.inode(&format!("dst/{new}/same.txt")), "the box keeps hard links");
    assert_ne!(r.inode(&format!("dst/{old}/edit.txt")), r.inode(&format!("dst/{new}/edit.txt")));
    assert_eq!(r.pull(&format!("dst/{old}")).get("edit.txt").map(String::as_str), Some("first"));
    assert_eq!(r.pull(&format!("dst/{new}")).get("edit.txt").map(String::as_str), Some("second"));
}

#[tokio::test]
#[ignore]
async fn box_integrity_check_finds_silent_damage_and_repair_keeps_both_versions() {
    let r = Remote::new(Mode::Mirror, false);
    r.put("a.txt", "alpha");
    r.put("dir/b.txt", "bravo");
    ok(&r.run("manual", RunOptions::default()).await);
    let clean = r.run("verify", RunOptions { verify: true, ..Default::default() }).await;
    assert_eq!((clean.status, clean.files_conflicted), (RunStatus::Succeeded, 0), "{:?}", clean.message);

    r.corrupt("dst/dir/b.txt");
    let found = r.run("verify", RunOptions { verify: true, ..Default::default() }).await;
    assert_eq!((found.status, found.files_conflicted), (RunStatus::Partial, 1), "{:?}", found.message);
    assert_eq!(r.pull("dst").get("dir/b.txt").map(String::as_str), Some("Bravo"), "the check changed nothing");

    ok(&r.run("repair", RunOptions { repair: true, ..Default::default() }).await);
    let dst = r.pull("dst");
    assert_eq!(without_archive(&dst), r.source());
    assert_eq!(archived(&dst), vec!["Bravo".to_string()], "the replaced version is archived, archive off or not");
    let again = r.run("verify", RunOptions { verify: true, ..Default::default() }).await;
    assert_eq!((again.status, again.files_conflicted), (RunStatus::Succeeded, 0));
}

#[tokio::test]
#[ignore]
async fn box_two_way_syncs_both_ways_and_repairs_without_loss() {
    let r = Remote::new(Mode::Bidirectional, true);
    r.put("a.txt", "alpha");
    r.put("dir/b.txt", "bravo");
    ok(&r.run("manual", RunOptions::default()).await);
    assert_eq!(r.pull("dst"), r.source());
    // A file that appears on the box reaches the Mac.
    r.box_run(&["mkdir", &format!("{}/dst/new", r.base)]);
    let local = r.root.join("upload.txt");
    fs::write(&local, "from the box").unwrap();
    let status = std::process::Command::new(tool("rsync"))
        .arg(format!("--rsh={}", crate::engine::shell_join(&r.ssh)))
        .arg(&local)
        .arg(format!("{}:{}/dst/new/c.txt", r.login, r.base))
        .status()
        .unwrap();
    assert!(status.success());
    ok(&r.run("manual", RunOptions::default()).await);
    assert_eq!(r.source().get("new/c.txt").map(String::as_str), Some("from the box"));

    r.corrupt("dst/dir/b.txt");
    let found = r.run("verify", RunOptions { verify: true, ..Default::default() }).await;
    assert_eq!((found.status, found.files_conflicted), (RunStatus::Partial, 1), "{:?}", found.message);
    ok(&r.run("repair", RunOptions { repair: true, ..Default::default() }).await);
    ok(&r.run("manual", RunOptions::default()).await);
    let (src, dst) = (r.source(), without_archive(&r.pull("dst")));
    assert_eq!(src, dst);
    let values: Vec<&str> = src.values().map(String::as_str).collect();
    assert!(values.contains(&"bravo") && values.contains(&"Bravo"), "both versions are kept: {src:?}");
}

#[tokio::test]
#[ignore]
async fn box_space_is_measured_over_ssh() {
    let r = Remote::new(Mode::Mirror, false);
    let job = r.config.job("job").unwrap().clone();
    let (total, free) = crate::report::measure(&job, &r.config, &r.root.join("rclone.conf"), &[]).await.expect("df over ssh");
    assert!(total > 1_000_000_000_000 && free > 0 && free < total, "{total} {free}");
}
