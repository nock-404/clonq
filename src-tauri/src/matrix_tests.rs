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
        let run_id = self.engine.start(config, "job", "manual", RunOptions::default()).unwrap();
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
