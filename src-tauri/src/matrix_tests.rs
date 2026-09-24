//! Every case of what a job does with files, run through the real engine with the rsync
//! and rclone that ship inside the app (src-tauri/binaries, see scripts/fetch-tools.sh).
//!
//! Each case builds a source and a target folder, runs the job, and compares every file on
//! both sides and in the archive with what the case expects. On top of that, every case with
//! the archive on checks the rule that matters most: no version of any file that existed
//! before the run is gone afterwards; it is on a side, in the archive, or a conflict copy.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use crate::config::{Archive, ConflictLoser, ConflictPrefer, Conflicts, Config, Job, Location, LocationKind, Mode, Place, Safety, Triggers, ARCHIVE_DIR};
use crate::engine::{Emit, Engine, RunOptions};
use crate::history::{History, Run, RunStatus};

const TRIPLE: &str = "aarch64-apple-darwin";

fn tool(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("{name}-{TRIPLE}"));
    assert!(path.is_file(), "{} is missing: run scripts/fetch-tools.sh", path.display());
    path.to_string_lossy().into_owned()
}

/// Relative path → content, for the files of one side (archive left out).
type Tree = BTreeMap<String, String>;

struct Bench {
    root: PathBuf,
    engine: Engine,
    history: Arc<History>,
    /// Seconds added to every written file's modification time, so "newer" is exact.
    clock: std::cell::Cell<u64>,
}

impl Bench {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("clonq-matrix-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("dst")).unwrap();
        let history = Arc::new(History::open(&root.join("history.sqlite")).unwrap());
        let emit: Emit = Arc::new(|_, _| {});
        let engine = Engine::new(emit, history.clone(), root.join("logs"), root.join("rclone.conf"));
        Self { root, engine, history, clock: std::cell::Cell::new(0) }
    }

    fn side(&self, side: &str) -> PathBuf {
        self.root.join(side)
    }

    /// Writes a file with a modification time later than every file written before.
    fn put(&self, side: &str, relative: &str, content: &str) {
        let path = self.side(side).join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        self.clock.set(self.clock.get() + 10);
        let at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + self.clock.get());
        fs::File::options().write(true).open(&path).unwrap().set_modified(at).unwrap();
    }

    fn remove(&self, side: &str, relative: &str) {
        let path = self.side(side).join(relative);
        if path.is_dir() { fs::remove_dir_all(path).unwrap() } else { fs::remove_file(path).unwrap() }
    }

    /// Changes a file's content but keeps its size and modification time: silent damage.
    fn corrupt(&self, side: &str, relative: &str) {
        let path = self.side(side).join(relative);
        let at = fs::metadata(&path).unwrap().modified().unwrap();
        let mut bytes = fs::read(&path).unwrap();
        bytes[0] ^= 0x20;
        fs::write(&path, bytes).unwrap();
        fs::File::options().write(true).open(&path).unwrap().set_modified(at).unwrap();
    }

    fn rename(&self, side: &str, from: &str, to: &str) {
        let to = self.side(side).join(to);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::rename(self.side(side).join(from), to).unwrap();
    }

    fn config(&self, mode: Mode, archive: bool, conflicts: Conflicts) -> Config {
        let mut config: Config = serde_json::from_str(&format!(r#"{{"version":2,"rsyncPath":"{}","rclonePath":"{}"}}"#, tool("rsync"), tool("rclone"))).unwrap();
        config.locations.push(Location {
            id: "root".into(),
            name: "Root".into(),
            kind: LocationKind::Folder { path: self.root.to_string_lossy().into_owned() },
        });
        config.jobs.push(Job {
            id: "job".into(),
            name: "Job".into(),
            enabled: false,
            source: Place { location: "root".into(), path: "src".into() },
            target: Place { location: "root".into(), path: "dst".into() },
            mode,
            excludes: vec!["node_modules/".into()],
            safety: Safety::default(),
            ring: None,
            triggers: Triggers::default(),
            archive: Archive { enabled: archive, keep_days: 30 },
            conflicts,
        });
        config
    }

    async fn run(&self, config: &Config) -> Run {
        self.run_with(config, RunOptions::default()).await
    }

    async fn run_with(&self, config: &Config, options: RunOptions) -> Run {
        let run_id = self.engine.start(config, "job", "manual", options).unwrap();
        for _ in 0..3000 {
            if self.engine.live_runs().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        self.history.recent(100).unwrap().into_iter().find(|run| run.id == run_id).unwrap()
    }

    fn tree(&self, side: &str) -> Tree {
        let mut tree = Tree::new();
        collect(&self.side(side), &self.side(side), &mut tree, false);
        tree
    }

    /// Every content found in either archive.
    fn archived(&self) -> BTreeSet<String> {
        let mut found = Tree::new();
        for side in ["src", "dst"] {
            let archive = self.side(side).join(ARCHIVE_DIR);
            if archive.is_dir() {
                collect(&archive, &archive, &mut found, true);
            }
        }
        found.into_values().collect()
    }

    /// Every content anywhere: both sides, both archives.
    fn everything(&self) -> BTreeSet<String> {
        let mut all: BTreeSet<String> = self.tree("src").into_values().collect();
        all.extend(self.tree("dst").into_values());
        all.extend(self.archived());
        all
    }
}

impl Drop for Bench {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn collect(root: &Path, dir: &Path, tree: &mut Tree, inside_archive: bool) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !inside_archive && path.parent() == Some(root) && name == ARCHIVE_DIR {
            continue;
        }
        if path.is_dir() {
            collect(root, &path, tree, inside_archive);
        } else if name != ".DS_Store" {
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().into_owned();
            tree.insert(relative, fs::read_to_string(&path).unwrap_or_else(|_| "<binary>".into()));
        }
    }
}

fn newer_wins() -> Conflicts {
    Conflicts { prefer: ConflictPrefer::Newer, loser: ConflictLoser::Keep }
}

/// A run must end as succeeded; anything else fails the case with its message.
fn ok(run: &Run) {
    assert_eq!(run.status, RunStatus::Succeeded, "run ended {:?}: {:?}", run.status, run.message);
}

/// The names used everywhere: umlauts, spaces, shell characters, a nested folder.
const ODD: &str = "Ordner mit Leerzeichen/Übergröße äöü ß & #1 (final).txt";

/// Both sides filled before the first run: every kind of starting difference at once.
fn fill_both(b: &Bench) {
    b.put("src", "only-src.txt", "only-src");
    b.put("src", "same.txt", "same");
    b.put("dst", "same.txt", "same");
    b.put("dst", "src-newer.txt", "src-newer: old in dst");
    b.put("src", "src-newer.txt", "src-newer: new in src");
    b.put("src", "dst-newer.txt", "dst-newer: old in src");
    b.put("dst", "dst-newer.txt", "dst-newer: new in dst");
    b.put("dst", "only-dst.txt", "only-dst");
    b.put("src", ODD, "odd name");
    b.put("src", "deep/a/b/c.txt", "deep");
    b.put("src", "node_modules/lib.js", "excluded in src");
    b.put("dst", "node_modules/lib.js", "excluded in dst");
}

// ---------------------------------------------------------------- first run, both filled

#[tokio::test]
async fn first_run_mirror_archive_on() {
    let b = Bench::new();
    fill_both(&b);
    let before = b.everything();
    ok(&b.run(&b.config(Mode::Mirror, true, newer_wins())).await);
    let source = b.tree("src");
    // The target is the source, except its own excluded folder, which a mirror never touches.
    let mut expected = source.clone();
    expected.remove("node_modules/lib.js");
    expected.insert("node_modules/lib.js".into(), "excluded in dst".into());
    assert_eq!(b.tree("dst"), expected);
    // Everything the target lost is in its archive.
    for kept in ["only-dst", "src-newer: old in dst", "dst-newer: new in dst"] {
        assert!(b.archived().contains(kept), "{kept} not archived");
    }
    assert!(before.is_subset(&b.everything()), "lost: {:?}", before.difference(&b.everything()).collect::<Vec<_>>());
}

#[tokio::test]
async fn first_run_mirror_archive_off_deletes_and_overwrites_for_good() {
    let b = Bench::new();
    fill_both(&b);
    ok(&b.run(&b.config(Mode::Mirror, false, newer_wins())).await);
    let dst = b.tree("dst");
    assert!(!dst.contains_key("only-dst.txt"));
    assert_eq!(dst["dst-newer.txt"], "dst-newer: old in src", "a mirror overwrites even a newer target file");
    assert!(b.archived().is_empty());
    // Documented loss without archive: these three versions are gone.
    let all = b.everything();
    for gone in ["only-dst", "src-newer: old in dst", "dst-newer: new in dst"] {
        assert!(!all.contains(gone));
    }
}

#[tokio::test]
async fn first_run_backup_archive_on() {
    let b = Bench::new();
    fill_both(&b);
    let before = b.everything();
    ok(&b.run(&b.config(Mode::Backup, true, newer_wins())).await);
    let dst = b.tree("dst");
    assert_eq!(dst["only-dst.txt"], "only-dst", "a backup never deletes");
    assert_eq!(dst["only-src.txt"], "only-src");
    assert_eq!(dst["src-newer.txt"], "src-newer: new in src");
    assert_eq!(dst["dst-newer.txt"], "dst-newer: old in src", "a backup overwrites a differing target file, newer or not");
    assert_eq!(dst[ODD], "odd name");
    assert_eq!(dst["deep/a/b/c.txt"], "deep");
    assert_eq!(dst["node_modules/lib.js"], "excluded in dst");
    assert!(b.archived().contains("dst-newer: new in dst"));
    assert!(b.archived().contains("src-newer: old in dst"));
    assert!(before.is_subset(&b.everything()), "lost: {:?}", before.difference(&b.everything()).collect::<Vec<_>>());
    assert_eq!(b.tree("src").len(), 7, "the source is never changed by a backup");
}

#[tokio::test]
async fn first_run_backup_archive_off() {
    let b = Bench::new();
    fill_both(&b);
    ok(&b.run(&b.config(Mode::Backup, false, newer_wins())).await);
    let dst = b.tree("dst");
    assert_eq!(dst["only-dst.txt"], "only-dst");
    assert_eq!(dst["dst-newer.txt"], "dst-newer: old in src");
    assert!(!b.everything().contains("dst-newer: new in dst"), "documented: without archive the overwritten version is gone");
}

#[tokio::test]
async fn first_run_two_way_merges_and_deletes_nothing() {
    for archive in [true, false] {
        let b = Bench::new();
        fill_both(&b);
        ok(&b.run(&b.config(Mode::Bidirectional, archive, newer_wins())).await);
        let (src, dst) = (b.tree("src"), b.tree("dst"));
        for side in [&src, &dst] {
            assert_eq!(side["only-src.txt"], "only-src");
            assert_eq!(side["only-dst.txt"], "only-dst");
            assert_eq!(side["same.txt"], "same");
            assert_eq!(side["src-newer.txt"], "src-newer: new in src");
            assert_eq!(side["dst-newer.txt"], "dst-newer: new in dst");
            assert_eq!(side[ODD], "odd name");
            assert_eq!(side["deep/a/b/c.txt"], "deep");
        }
        assert_eq!(src["node_modules/lib.js"], "excluded in src");
        assert_eq!(dst["node_modules/lib.js"], "excluded in dst");
        if archive {
            assert!(b.archived().contains("src-newer: old in dst"), "archive: {:?}", b.archived());
            assert!(b.archived().contains("dst-newer: old in src"), "archive: {:?}", b.archived());
        }
    }
}

// ---------------------------------------------------------------- later runs

/// Both sides in step after one run: a.txt … f.txt, a folder and the odd name.
async fn in_step(b: &Bench, config: &Config) {
    for name in ["a", "b", "c", "d", "e", "f", "g"] {
        b.put("src", &format!("{name}.txt"), &format!("{name} v1"));
    }
    b.put("src", "folder/inner.txt", "inner v1");
    b.put("src", ODD, "odd v1");
    ok(&b.run(config).await);
    assert_eq!(b.tree("src"), b.tree("dst"), "not in step after the first run");
}

/// The changes every later case makes, on both sides at once.
fn change_both(b: &Bench) {
    b.put("src", "new-in-src.txt", "new in src");
    b.put("dst", "new-in-dst.txt", "new in dst");
    b.put("src", "a.txt", "a v2 src");
    b.put("dst", "b.txt", "b v2 dst");
    b.remove("src", "c.txt");
    b.remove("dst", "d.txt");
    b.remove("src", "e.txt");
    b.put("dst", "e.txt", "e v2 dst after src deleted it");
    b.put("src", "f.txt", "f v2 src");
    b.remove("dst", "f.txt");
    b.rename("src", "g.txt", "renamed/g-moved.txt");
    b.put("src", ODD, "odd v2");
}

#[tokio::test]
async fn later_mirror() {
    for archive in [true, false] {
        let b = Bench::new();
        let config = b.config(Mode::Mirror, archive, newer_wins());
        in_step(&b, &config).await;
        change_both(&b);
        let before = b.everything();
        ok(&b.run(&config).await);
        let mut expected = b.tree("src");
        expected.retain(|path, _| !path.starts_with("node_modules/"));
        assert_eq!(b.tree("dst"), expected, "archive {archive}: the target must equal the source");
        if archive {
            // What the target had and lost: its own new file, its change, and the rename's old name.
            for kept in ["new in dst", "b v2 dst", "g v1", "e v2 dst after src deleted it"] {
                assert!(b.archived().contains(kept), "{kept} not archived: {:?}", b.archived());
            }
            assert!(before.is_subset(&b.everything()), "lost: {:?}", before.difference(&b.everything()).collect::<Vec<_>>());
        }
    }
}

#[tokio::test]
async fn later_backup() {
    for archive in [true, false] {
        let b = Bench::new();
        let config = b.config(Mode::Backup, archive, newer_wins());
        in_step(&b, &config).await;
        change_both(&b);
        let before = b.everything();
        ok(&b.run(&config).await);
        let dst = b.tree("dst");
        assert_eq!(dst["new-in-src.txt"], "new in src");
        assert_eq!(dst["new-in-dst.txt"], "new in dst", "a backup keeps what only the target has");
        assert_eq!(dst["a.txt"], "a v2 src");
        assert_eq!(dst["b.txt"], "b v1", "archive {archive}: a changed target file is set back to the source");
        assert_eq!(dst["c.txt"], "c v1", "deleted in the source stays in the backup");
        assert_eq!(dst["d.txt"], "d v1", "deleted in the target comes back");
        assert_eq!(dst["f.txt"], "f v2 src");
        assert_eq!(dst["g.txt"], "g v1", "the old name stays in a backup");
        assert_eq!(dst["renamed/g-moved.txt"], "g v1");
        assert_eq!(dst[ODD], "odd v2");
        if archive {
            assert!(b.archived().contains("b v2 dst"), "the target's own change must be archived: {:?}", b.archived());
            assert!(b.archived().contains("e v2 dst after src deleted it") || dst.get("e.txt").map(String::as_str) == Some("e v2 dst after src deleted it"));
            assert!(before.is_subset(&b.everything()), "lost: {:?}", before.difference(&b.everything()).collect::<Vec<_>>());
        }
    }
}

#[tokio::test]
async fn later_two_way() {
    for archive in [true, false] {
        let b = Bench::new();
        let config = b.config(Mode::Bidirectional, archive, newer_wins());
        in_step(&b, &config).await;
        change_both(&b);
        let before = b.everything();
        ok(&b.run(&config).await);
        let (src, dst) = (b.tree("src"), b.tree("dst"));
        assert_eq!(src, dst, "archive {archive}: both sides must match after a two-way run");
        assert_eq!(src["new-in-src.txt"], "new in src");
        assert_eq!(src["new-in-dst.txt"], "new in dst");
        assert_eq!(src["a.txt"], "a v2 src");
        assert_eq!(src["b.txt"], "b v2 dst");
        assert!(!src.contains_key("c.txt"), "deleted in the source is deleted in the target");
        assert!(!src.contains_key("d.txt"), "deleted in the target is deleted in the source");
        assert_eq!(src["e.txt"], "e v2 dst after src deleted it", "a change beats a deletion");
        assert_eq!(src["f.txt"], "f v2 src", "a change beats a deletion");
        assert!(!src.contains_key("g.txt"));
        assert_eq!(src["renamed/g-moved.txt"], "g v1");
        assert_eq!(src[ODD], "odd v2");
        if archive {
            for kept in ["a v1", "b v1", "c v1", "d v1", "odd v1"] {
                assert!(b.archived().contains(kept), "{kept} not archived: {:?}", b.archived());
            }
            assert!(before.is_subset(&b.everything()), "lost: {:?}", before.difference(&b.everything()).collect::<Vec<_>>());
        }
    }
}

// ---------------------------------------------------------------- two-way conflicts

/// One file changed on both sides; `src_later` decides which side changed last.
async fn conflict(prefer: ConflictPrefer, loser: ConflictLoser, archive: bool, src_later: bool) -> (Tree, Tree, BTreeSet<String>, BTreeSet<String>) {
    let b = Bench::new();
    let config = b.config(Mode::Bidirectional, archive, Conflicts { prefer, loser });
    b.put("src", "doc.txt", "base");
    // bisync refuses a run in which every file on one side changed; real folders hold more.
    b.put("src", "untouched.txt", "untouched");
    ok(&b.run(&config).await);
    if src_later {
        b.put("dst", "doc.txt", "dst edit, short");
        b.put("src", "doc.txt", "src edit, this one is longer");
    } else {
        b.put("src", "doc.txt", "src edit, this one is longer");
        b.put("dst", "doc.txt", "dst edit, short");
    }
    let before = b.everything();
    let run = b.run(&config).await;
    ok(&run);
    (b.tree("src"), b.tree("dst"), b.archived(), before)
}

#[tokio::test]
async fn conflicts_every_rule() {
    let rules = [ConflictPrefer::Newer, ConflictPrefer::Older, ConflictPrefer::Larger, ConflictPrefer::Smaller, ConflictPrefer::Source, ConflictPrefer::Target, ConflictPrefer::None];
    for prefer in rules {
        for loser in [ConflictLoser::Keep, ConflictLoser::Delete] {
            for archive in [true, false] {
                for src_later in [true, false] {
                    let (src, dst, archived, before) = conflict(prefer, loser, archive, src_later).await;
                    let label = format!("{prefer:?}/{loser:?}/archive {archive}/src later {src_later}");
                    assert_eq!(src, dst, "{label}: sides differ: {src:?} vs {dst:?}");
                    let winner = match prefer {
                        ConflictPrefer::Newer => Some(if src_later { "src" } else { "dst" }),
                        ConflictPrefer::Older => Some(if src_later { "dst" } else { "src" }),
                        ConflictPrefer::Larger | ConflictPrefer::Source => Some("src"),
                        ConflictPrefer::Smaller | ConflictPrefer::Target => Some("dst"),
                        ConflictPrefer::None => None,
                    };
                    let versions: BTreeSet<&str> = src.values().map(String::as_str).collect();
                    let src_edit = "src edit, this one is longer";
                    let dst_edit = "dst edit, short";
                    match winner {
                        Some(side) => {
                            let (won, lost) = if side == "src" { (src_edit, dst_edit) } else { (dst_edit, src_edit) };
                            assert_eq!(src.get("doc.txt").map(String::as_str), Some(won), "{label}: wrong winner: {src:?}");
                            let loser_kept = versions.contains(lost);
                            match loser {
                                ConflictLoser::Keep => assert!(loser_kept, "{label}: losing copy must stay next to the winner: {src:?}"),
                                ConflictLoser::Delete => {
                                    assert!(!loser_kept, "{label}: losing copy should be gone from the sides");
                                    if archive {
                                        assert!(archived.contains(lost), "{label}: deleted loser must be in the archive: {archived:?}");
                                    }
                                }
                            }
                        }
                        None => {
                            assert!(versions.contains(src_edit) && versions.contains(dst_edit), "{label}: both versions must stay: {src:?}");
                        }
                    }
                    // Whatever the rule, with the archive on or with the loser kept, no version is lost.
                    if archive || loser == ConflictLoser::Keep {
                        let mut after: BTreeSet<String> = src.into_values().collect();
                        after.extend(dst.into_values());
                        after.extend(archived);
                        assert!(before.is_subset(&after), "{label}: lost {:?}", before.difference(&after).collect::<Vec<_>>());
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- safety

#[tokio::test]
async fn empty_source_is_refused_in_every_mode() {
    for mode in [Mode::Mirror, Mode::Backup, Mode::Bidirectional] {
        let b = Bench::new();
        b.put("dst", "keep.txt", "keep");
        let run = b.run(&b.config(mode, false, newer_wins())).await;
        assert_ne!(run.status, RunStatus::Succeeded, "{mode:?} ran with an empty source");
        assert_eq!(b.tree("dst")["keep.txt"], "keep", "{mode:?} touched the target");
    }
}

#[tokio::test]
async fn missing_source_is_refused_in_every_mode() {
    for mode in [Mode::Mirror, Mode::Backup, Mode::Bidirectional] {
        let b = Bench::new();
        b.put("dst", "keep.txt", "keep");
        fs::remove_dir_all(b.side("src")).unwrap();
        let run = b.run(&b.config(mode, false, newer_wins())).await;
        assert_ne!(run.status, RunStatus::Succeeded, "{mode:?} ran without a source");
        assert_eq!(b.tree("dst")["keep.txt"], "keep", "{mode:?} touched the target");
    }
}

#[tokio::test]
async fn emptied_source_after_a_sync_is_stopped_by_the_deletion_limit() {
    for mode in [Mode::Mirror, Mode::Bidirectional] {
        let b = Bench::new();
        let config = b.config(mode, false, newer_wins());
        for index in 0..40 {
            b.put("src", &format!("file-{index}.txt"), &format!("content {index}"));
        }
        ok(&b.run(&config).await);
        // Everything but one file disappears from the source, as if a folder had been wiped.
        for index in 1..40 {
            b.remove("src", &format!("file-{index}.txt"));
        }
        let run = b.run(&config).await;
        assert_eq!(run.status, RunStatus::Blocked, "{mode:?}: mass deletion was not stopped: {:?}", run.message);
        assert_eq!(b.tree("dst").len(), 40, "{mode:?}: the target lost files although the run was stopped");
    }
}

#[tokio::test]
async fn two_runs_in_one_second_keep_both_archived_versions() {
    let b = Bench::new();
    let config = b.config(Mode::Mirror, true, newer_wins());
    b.put("src", "doc.txt", "v1");
    ok(&b.run(&config).await);
    b.put("src", "doc.txt", "v2");
    ok(&b.run(&config).await);
    b.put("src", "doc.txt", "v3");
    ok(&b.run(&config).await);
    let archived = b.archived();
    assert!(archived.contains("v1") && archived.contains("v2"), "an archived version was overwritten: {archived:?}");
}

#[tokio::test]
async fn metadata_hard_links_and_creation_dates_survive_a_mirror() {
    let b = Bench::new();
    b.put("src", "meta.txt", "meta");
    let source = b.side("src").join("meta.txt");
    std::fs::hard_link(&source, b.side("src").join("meta-link.txt")).unwrap();
    assert!(std::process::Command::new("xattr").args(["-w", "com.clonq.test", "value"]).arg(&source).status().unwrap().success());
    ok(&b.run(&b.config(Mode::Mirror, true, newer_wins())).await);
    let copy = b.side("dst").join("meta.txt");
    let attr = std::process::Command::new("xattr").args(["-p", "com.clonq.test"]).arg(&copy).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&attr.stdout).trim(), "value", "extended attribute lost");
    use std::os::unix::fs::MetadataExt;
    assert_eq!(fs::metadata(&copy).unwrap().nlink(), 2, "hard link turned into a copy");
    assert_eq!(fs::metadata(&copy).unwrap().modified().unwrap(), fs::metadata(&source).unwrap().modified().unwrap(), "modification time changed");
}

#[tokio::test]
async fn two_way_archive_is_readable_and_restorable_on_both_ends() {
    use crate::archive::{files, restore, snapshots, Side};
    let b = Bench::new();
    let config = b.config(Mode::Bidirectional, true, newer_wins());
    b.put("src", "doc.txt", "v1");
    b.put("src", "other.txt", "other");
    ok(&b.run(&config).await);
    // Changed in the target: the source's old version is replaced and must land in the source's archive.
    b.put("dst", "doc.txt", "v2 from target");
    ok(&b.run(&config).await);
    let job = &config.jobs[0];
    let rclone = b.root.join("rclone.conf");
    let source = snapshots(job, &config, &rclone, Side::Source).await.unwrap();
    assert_eq!(source.len(), 1, "the source's archive must be listed: {source:?}");
    let listed = files(job, &config, &rclone, Side::Source, &source[0].stamp).await.unwrap();
    assert!(listed.iter().any(|file| file.path == "doc.txt"), "{listed:?}");
    let downloads = b.root.join("downloads");
    let folder = restore(job, &config, &rclone, Side::Source, &downloads, &source[0].stamp, None).await.unwrap();
    assert_eq!(fs::read_to_string(folder.join("doc.txt")).unwrap(), "v1");
    // A one-way job has no archive on its source.
    let mirror = b.config(Mode::Mirror, true, newer_wins());
    assert!(snapshots(&mirror.jobs[0], &mirror, &rclone, Side::Source).await.is_err());
}

#[tokio::test]
async fn old_archive_folders_are_pruned_in_both_name_formats() {
    let b = Bench::new();
    let mut config = b.config(Mode::Mirror, true, newer_wins());
    config.jobs[0].archive.keep_days = 1;
    b.put("src", "doc.txt", "v1");
    let archive = b.side("dst").join(ARCHIVE_DIR);
    // One folder from before 0.3.2 without milliseconds, one after with them, both long expired.
    for old in ["2020-01-01_10-00-00", "2020-01-02_10-00-00-123"] {
        fs::create_dir_all(archive.join(old)).unwrap();
        fs::write(archive.join(old).join("x.txt"), "old").unwrap();
    }
    ok(&b.run(&config).await);
    for old in ["2020-01-01_10-00-00", "2020-01-02_10-00-00-123"] {
        assert!(!archive.join(old).exists(), "{old} was not pruned");
    }
}

// ---------------------------------------------------------------- versioned backups

/// Complete snapshot folders in the target, oldest first.
fn snapshots_in(b: &Bench) -> Vec<String> {
    crate::versions::list_local(&b.side("dst")).0
}

fn snapshot_tree(b: &Bench, stamp: &str) -> Tree {
    let mut tree = Tree::new();
    let root = b.side("dst").join(stamp);
    collect(&root, &root, &mut tree, false);
    tree.remove(crate::versions::MARKER);
    tree
}

fn inode(path: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).unwrap().ino()
}

#[tokio::test]
async fn versioned_first_run_is_a_full_snapshot() {
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    b.put("src", "a.txt", "a v1");
    b.put("src", ODD, "odd v1");
    b.put("src", "deep/x/y.txt", "deep v1");
    b.put("src", "node_modules/lib.js", "excluded");
    let source_before = b.tree("src");
    ok(&b.run(&config).await);
    let list = snapshots_in(&b);
    assert_eq!(list.len(), 1, "{list:?}");
    let mut expected = source_before.clone();
    expected.remove("node_modules/lib.js");
    assert_eq!(snapshot_tree(&b, &list[0]), expected);
    assert_eq!(b.tree("src"), source_before, "the source is never changed");
    assert!(!b.side("dst").join(ARCHIVE_DIR).exists(), "snapshots need no archive");
}

#[tokio::test]
async fn versioned_later_run_links_unchanged_files_and_keeps_every_old_version() {
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    b.put("src", "same.txt", "same");
    b.put("src", "change.txt", "change v1");
    b.put("src", "gone.txt", "gone v1");
    ok(&b.run(&config).await);
    let first = snapshots_in(&b)[0].clone();
    b.put("src", "change.txt", "change v2");
    b.remove("src", "gone.txt");
    b.put("src", "new.txt", "new");
    ok(&b.run(&config).await);
    let list = snapshots_in(&b);
    assert_eq!(list.len(), 2, "{list:?}");
    let second = &list[1];
    assert_eq!(snapshot_tree(&b, &first), tree_of(&[("same.txt", "same"), ("change.txt", "change v1"), ("gone.txt", "gone v1")]), "the old snapshot stays exactly as it was");
    assert_eq!(snapshot_tree(&b, second), tree_of(&[("same.txt", "same"), ("change.txt", "change v2"), ("new.txt", "new")]), "the new snapshot equals the source");
    let dst = b.side("dst");
    assert_eq!(inode(&dst.join(&first).join("same.txt")), inode(&dst.join(second).join("same.txt")), "an unchanged file must be a hard link, not a copy");
    assert_ne!(inode(&dst.join(&first).join("change.txt")), inode(&dst.join(second).join("change.txt")));
}

fn tree_of(entries: &[(&str, &str)]) -> Tree {
    entries.iter().map(|(path, content)| (path.to_string(), content.to_string())).collect()
}

#[tokio::test]
async fn versioned_unfinished_snapshots_are_removed_and_never_linked() {
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    b.put("src", "a.txt", "a v1");
    ok(&b.run(&config).await);
    // A run that died halfway: a newer folder without the marker, holding a wrong file.
    let broken = b.side("dst").join("2099-01-01_00-00-00-000");
    fs::create_dir_all(&broken).unwrap();
    fs::write(broken.join("a.txt"), "half written").unwrap();
    b.put("src", "a.txt", "a v2");
    ok(&b.run(&config).await);
    assert!(!broken.exists(), "the unfinished snapshot must be removed");
    let list = snapshots_in(&b);
    assert_eq!(list.len(), 2);
    assert_eq!(snapshot_tree(&b, &list[1])["a.txt"], "a v2");
}

#[tokio::test]
async fn versioned_thinning_removes_only_old_snapshots_and_nothing_else() {
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    b.put("src", "a.txt", "a");
    // Files of the user that happen to lie in the target must never be touched.
    b.put("dst", "Photos/keep.jpg", "user file");
    // Old complete snapshots: two in the same week long ago, and one a week later.
    for old in ["2026-01-05_10-00-00-000", "2026-01-07_10-00-00-000", "2026-01-13_10-00-00-000"] {
        let folder = b.side("dst").join(old);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("a.txt"), "a").unwrap();
        fs::write(folder.join(crate::versions::MARKER), old).unwrap();
    }
    ok(&b.run(&config).await);
    let list = snapshots_in(&b);
    assert!(!list.contains(&"2026-01-05_10-00-00-000".to_string()), "older one of the same week must go: {list:?}");
    assert!(list.contains(&"2026-01-07_10-00-00-000".to_string()), "newest of its week stays: {list:?}");
    assert!(list.contains(&"2026-01-13_10-00-00-000".to_string()), "the next week stays: {list:?}");
    assert_eq!(list.len(), 3, "{list:?}");
    assert_eq!(fs::read_to_string(b.side("dst").join("Photos/keep.jpg")).unwrap(), "user file");
}

#[tokio::test]
async fn versioned_dry_run_creates_nothing() {
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    b.put("src", "a.txt", "a");
    let run_id = b.engine.start(&config, "job", "manual", RunOptions { dry_run: true, ..Default::default() }).unwrap();
    for _ in 0..500 {
        if b.engine.live_runs().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let run = b.history.recent(10).unwrap().into_iter().find(|run| run.id == run_id).unwrap();
    ok(&run);
    assert!(snapshots_in(&b).is_empty());
    assert!(fs::read_dir(b.side("dst")).unwrap().next().is_none(), "a dry run must leave the target empty");
}

#[tokio::test]
async fn versioned_refuses_an_empty_source() {
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    let run = b.run(&config).await;
    assert_ne!(run.status, RunStatus::Succeeded);
    assert!(snapshots_in(&b).is_empty());
}

#[tokio::test]
async fn versioned_snapshots_are_listed_and_restored_without_the_marker() {
    use crate::archive::{restore, version_list, Side};
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    b.put("src", "doc.txt", "v1");
    ok(&b.run(&config).await);
    b.put("src", "doc.txt", "v2");
    ok(&b.run(&config).await);
    let job = &config.jobs[0];
    let list = version_list(job, &config).await.unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[0] > list[1], "newest first");
    let downloads = b.root.join("downloads");
    let rclone = b.root.join("rclone.conf");
    let folder = restore(job, &config, &rclone, Side::Snapshots, &downloads, &list[1], None).await.unwrap();
    assert_eq!(fs::read_to_string(folder.join("doc.txt")).unwrap(), "v1", "the older snapshot restores the older version");
    assert!(!folder.join(crate::versions::MARKER).exists(), "the marker is clonq's own and must not be restored");
}

#[tokio::test]
async fn versioned_remote_listing_reads_complete_and_unfinished_snapshots() {
    // The server listing runs rsync --list-only; against a local path it prints the same lines.
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    b.put("src", "doc.txt", "v1");
    ok(&b.run(&config).await);
    let unfinished = b.side("dst").join("2099-01-01_00-00-00-000");
    fs::create_dir_all(&unfinished).unwrap();
    fs::write(unfinished.join("doc.txt"), "half").unwrap();
    fs::create_dir_all(b.side("dst").join("Photos")).unwrap();
    let base = format!("{}/", b.side("dst").display());
    let (complete, incomplete) = crate::versions::list_remote(&tool("rsync"), &[], &base).await.unwrap();
    assert_eq!(complete, crate::versions::list_local(&b.side("dst")).0);
    assert_eq!(incomplete, vec!["2099-01-01_00-00-00-000".to_string()]);
    // A target folder that does not exist yet has no snapshots, and that is not an error.
    let missing = format!("{}/", b.root.join("nothing-here").display());
    assert_eq!(crate::versions::list_remote(&tool("rsync"), &[], &missing).await.unwrap(), (vec![], vec![]));
}

// Integrity check

fn verify() -> RunOptions {
    RunOptions { verify: true, ..Default::default() }
}

fn log_of(b: &Bench, run: &Run) -> String {
    fs::read_to_string(b.root.join("logs").join(format!("{}.log", run.id))).unwrap_or_default()
}

#[tokio::test]
async fn verify_passes_when_both_sides_hold_the_same_content() {
    for mode in [Mode::Mirror, Mode::Backup, Mode::Bidirectional] {
        let b = Bench::new();
        let config = b.config(mode, true, newer_wins());
        b.put("src", "a.txt", "alpha");
        b.put("src", "dir/b.txt", "bravo");
        ok(&b.run(&config).await);
        let run = b.run_with(&config, verify()).await;
        assert_eq!(run.status, RunStatus::Succeeded, "{mode:?}: {:?}", run.message);
        assert_eq!(run.files_conflicted, 0, "{mode:?}");
        assert!(run.dry_run, "{mode:?}: a check is recorded as a dry run");
    }
}

#[tokio::test]
async fn verify_finds_silent_damage_and_changes_nothing() {
    for mode in [Mode::Mirror, Mode::Backup, Mode::Bidirectional] {
        let b = Bench::new();
        let config = b.config(mode, true, newer_wins());
        b.put("src", "a.txt", "alpha");
        b.put("src", "dir/b.txt", "bravo");
        ok(&b.run(&config).await);
        b.corrupt("dst", "dir/b.txt");
        let (src, dst) = (b.tree("src"), b.tree("dst"));
        let run = b.run_with(&config, verify()).await;
        assert_eq!(run.status, RunStatus::Partial, "{mode:?}: {:?}", run.message);
        assert_eq!(run.files_conflicted, 1, "{mode:?}");
        assert!(log_of(&b, &run).contains("! content differs: dir/b.txt"), "{mode:?}: {}", log_of(&b, &run));
        assert_eq!((b.tree("src"), b.tree("dst")), (src, dst), "{mode:?}: the check touched a file");
        assert!(b.archived().is_empty(), "{mode:?}: the check archived something");
    }
}

#[tokio::test]
async fn verify_does_not_count_pending_changes_as_damage() {
    let b = Bench::new();
    let config = b.config(Mode::Backup, true, newer_wins());
    b.put("src", "a.txt", "alpha");
    b.put("src", "gone.txt", "gone");
    ok(&b.run(&config).await);
    b.put("src", "new.txt", "new");
    b.put("src", "a.txt", "alpha, edited");
    b.remove("src", "gone.txt");
    let run = b.run_with(&config, verify()).await;
    assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.message);
    assert_eq!((run.files_conflicted, run.files_new, run.files_changed), (0, 1, 1));
    assert!(!b.side("dst").join("new.txt").exists());
}

#[tokio::test]
async fn verify_checks_the_newest_snapshot_of_a_versioned_job() {
    let b = Bench::new();
    let config = b.config(Mode::Versioned, true, newer_wins());
    let run = b.run_with(&config, verify()).await;
    assert_eq!(run.status, RunStatus::Failed, "no snapshot yet");
    b.put("src", "a.txt", "alpha");
    b.put("src", "b.txt", "bravo");
    ok(&b.run(&config).await);
    let run = b.run_with(&config, verify()).await;
    assert_eq!(run.status, RunStatus::Succeeded, "{:?}", run.message);
    let newest = snapshots_in(&b).last().unwrap().clone();
    b.corrupt("dst", &format!("{newest}/b.txt"));
    let run = b.run_with(&config, verify()).await;
    assert_eq!(run.status, RunStatus::Partial, "{:?}", run.message);
    assert_eq!(run.files_conflicted, 1);
    assert_eq!(snapshots_in(&b), vec![newest], "the check made a snapshot");
}
