//! Reads what rsync 3.x prints with `--info=progress2,stats2 --out-format='%i %l %n%L'`.

use regex::Regex;
use std::sync::LazyLock;

/// One line of rsync output, classified.
#[derive(Debug, PartialEq)]
pub enum Line<'a> {
    Progress(Progress),
    Deleted(&'a str),
    /// An itemized change: the 11-character code, the file size, then the path.
    Changed { code: &'a str, size: i64, path: &'a str },
    Stat(Stat),
    Other(&'a str),
}

/// What an itemized change means for the numbers the app shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// A regular file that did not exist on the target.
    NewFile,
    /// A regular file whose content or time differed, so it was sent.
    ChangedFile,
    /// A new directory, link or device.
    NewOther,
    /// Only attributes changed, or a directory was touched; nothing was sent.
    Metadata,
}

impl Change {
    /// Reads the `%i` code: update type, file type, then attribute flags.
    pub fn of(code: &str) -> Self {
        let bytes = code.as_bytes();
        let (Some(&update), Some(&kind)) = (bytes.first(), bytes.get(1)) else {
            return Self::Metadata;
        };
        let created = bytes.get(2) == Some(&b'+');
        match (update, kind, created) {
            (b'<' | b'>' | b'c', b'f', true) => Self::NewFile,
            (b'<' | b'>', b'f', false) => Self::ChangedFile,
            // A hard link costs no data, whatever it points at.
            (b'h', _, _) => Self::NewOther,
            (b'c', _, true) => Self::NewOther,
            _ => Self::Metadata,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Progress {
    pub bytes: i64,
    pub percent: f64,
    pub eta_seconds: i64,
    pub transferred_files: Option<i64>,
    pub remaining_files: Option<i64>,
    pub total_files: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Stat {
    Files(i64),
    Created(i64),
    Deleted(i64),
    RegularTransferred(i64),
    TotalSize(i64),
    TransferredSize(i64),
    Literal(i64),
    Matched(i64),
    Sent(i64),
    Received(i64),
}

/// Totals collected from the stats block at the end of a run.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Stats {
    pub files: i64,
    pub created: i64,
    pub deleted: i64,
    pub regular_transferred: i64,
    /// Size of everything the source holds after excludes.
    pub total_size: i64,
    /// Size of the files that were sent, counted whole.
    pub transferred_size: i64,
    /// Bytes that really crossed as new data.
    pub literal: i64,
    /// Bytes the receiver rebuilt from blocks it already had.
    pub matched: i64,
    pub sent: i64,
    pub received: i64,
}

impl Stats {
    pub fn apply(&mut self, stat: Stat) {
        match stat {
            Stat::Files(n) => self.files = n,
            Stat::Created(n) => self.created = n,
            Stat::Deleted(n) => self.deleted = n,
            Stat::RegularTransferred(n) => self.regular_transferred = n,
            Stat::TotalSize(n) => self.total_size = n,
            Stat::TransferredSize(n) => self.transferred_size = n,
            Stat::Literal(n) => self.literal = n,
            Stat::Matched(n) => self.matched = n,
            Stat::Sent(n) => self.sent = n,
            Stat::Received(n) => self.received = n,
        }
    }

    /// Entries on the target before the run: what the source has, minus what
    /// the run has to create, plus what it has to delete.
    pub fn target_entries_before(&self) -> i64 {
        (self.files - self.created + self.deleted).max(0)
    }

    /// Share of the current target that the run deletes, in percent.
    pub fn delete_percent(&self) -> f64 {
        let before = self.target_entries_before();
        if before == 0 {
            return 0.0;
        }
        self.deleted as f64 * 100.0 / before as f64
    }
}

static PROGRESS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^\s*([\d,]+)\s+(\d+)%\s+\S+\s+(\d+):(\d{2}):(\d{2})(?:\s+\(xfr#(\d+),\s+(?:ir|to)-chk=(\d+)/(\d+)\))?",
    )
    .expect("progress pattern")
});

static STAT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(Number of files|Number of created files|Number of deleted files|Number of regular files transferred|Total file size|Total transferred file size|Literal data|Matched data|Total bytes sent|Total bytes received): ([\d,]+)",
    )
    .expect("stat pattern")
});

pub fn parse(line: &str) -> Line<'_> {
    if let Some(rest) = line.strip_prefix("*deleting") {
        // `%l` is printed for deletions too (always 0), then the path.
        let rest = rest.trim_start();
        let path = rest.split_once(' ').map_or(rest, |(_, path)| path);
        return Line::Deleted(path);
    }
    if let Some(caps) = PROGRESS.captures(line) {
        let number = |i: usize| caps.get(i).map(|m| to_i64(m.as_str()));
        let hours = number(3).unwrap_or(0);
        let minutes = number(4).unwrap_or(0);
        let seconds = number(5).unwrap_or(0);
        let remaining = number(7);
        let total = number(8);
        return Line::Progress(Progress {
            bytes: number(1).unwrap_or(0),
            percent: caps[2].parse().unwrap_or(0.0),
            eta_seconds: hours * 3600 + minutes * 60 + seconds,
            transferred_files: number(6),
            remaining_files: remaining,
            total_files: total,
        });
    }
    if let Some(caps) = STAT.captures(line) {
        let value = to_i64(&caps[2]);
        let stat = match &caps[1] {
            "Number of files" => Stat::Files(value),
            "Number of created files" => Stat::Created(value),
            "Number of deleted files" => Stat::Deleted(value),
            "Number of regular files transferred" => Stat::RegularTransferred(value),
            "Total file size" => Stat::TotalSize(value),
            "Total transferred file size" => Stat::TransferredSize(value),
            "Literal data" => Stat::Literal(value),
            "Matched data" => Stat::Matched(value),
            "Total bytes sent" => Stat::Sent(value),
            _ => Stat::Received(value),
        };
        return Line::Stat(stat);
    }
    if is_itemized(line) {
        let (code, rest) = line.split_at(11);
        let rest = rest.trim_start();
        if let Some((size, path)) = rest.split_once(' ')
            && let Ok(size) = size.parse()
        {
            return Line::Changed { code, size, path };
        }
    }
    Line::Other(line)
}

/// `%i` is 11 characters: update type, file type, then nine attribute flags.
fn is_itemized(line: &str) -> bool {
    let bytes = line.as_bytes();
    bytes.len() > 12
        && matches!(bytes[0], b'<' | b'>' | b'c' | b'h' | b'.')
        && matches!(bytes[1], b'f' | b'd' | b'L' | b'D' | b'S')
        && bytes[11] == b' '
}

fn to_i64(digits: &str) -> i64 {
    digits.replace(',', "").parse().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines copied from a real rsync 3.5.1 run on macOS 27.

    #[test]
    fn progress_with_counters() {
        let line = "        960,000  96%   89.65MB/s    0:00:00 (xfr#48, to-chk=2/52)";
        assert_eq!(
            parse(line),
            Line::Progress(Progress {
                bytes: 960_000,
                percent: 96.0,
                eta_seconds: 0,
                transferred_files: Some(48),
                remaining_files: Some(2),
                total_files: Some(52),
            })
        );
    }

    #[test]
    fn progress_without_counters() {
        let line = "         20,000   2%    0.00kB/s    0:01:05  ";
        let Line::Progress(progress) = parse(line) else { panic!("not progress") };
        assert_eq!(progress.bytes, 20_000);
        assert_eq!(progress.eta_seconds, 65);
        assert_eq!(progress.total_files, None);
    }

    #[test]
    fn deletion() {
        assert_eq!(parse("*deleting   0 a/gone.txt"), Line::Deleted("a/gone.txt"));
        assert_eq!(parse("*deleting   0 name with spaces.txt"), Line::Deleted("name with spaces.txt"));
    }

    #[test]
    fn itemized_file_dir_and_link() {
        assert_eq!(
            parse(">f+++++++++ 5000 a/new.bin"),
            Line::Changed { code: ">f+++++++++", size: 5000, path: "a/new.bin" }
        );
        assert_eq!(parse("cd+++++++++ 96 a/"), Line::Changed { code: "cd+++++++++", size: 96, path: "a/" });
        assert_eq!(
            parse("cL+++++++++ 7 a/link -> new.bin"),
            Line::Changed { code: "cL+++++++++", size: 7, path: "a/link -> new.bin" }
        );
    }

    #[test]
    fn change_kinds() {
        assert_eq!(Change::of(">f+++++++++"), Change::NewFile);
        assert_eq!(Change::of(">f..t......"), Change::ChangedFile);
        assert_eq!(Change::of(">fcst......"), Change::ChangedFile);
        assert_eq!(Change::of("cd+++++++++"), Change::NewOther);
        assert_eq!(Change::of("cL+++++++++"), Change::NewOther);
        assert_eq!(Change::of(".d..t......"), Change::Metadata);
        assert_eq!(Change::of(".f...p....."), Change::Metadata);
        assert_eq!(Change::of("hf+++++++++"), Change::NewOther);
    }

    #[test]
    fn stats_block() {
        let block = "Number of files: 52 (reg: 50, dir: 2)\n\
                     Number of created files: 51 (reg: 50, dir: 1)\n\
                     Number of deleted files: 5 (reg: 5)\n\
                     Number of regular files transferred: 50\n\
                     Total file size: 2,012,012 bytes\n\
                     Total transferred file size: 2,000,005 bytes\n\
                     Literal data: 2,816 bytes\n\
                     Matched data: 1,997,189 bytes\n\
                     Total bytes sent: 8,821\n\
                     Total bytes received: 8,592";
        let mut stats = Stats::default();
        for line in block.lines() {
            if let Line::Stat(stat) = parse(line) {
                stats.apply(stat);
            }
        }
        assert_eq!(
            stats,
            Stats {
                files: 52,
                created: 51,
                deleted: 5,
                regular_transferred: 50,
                total_size: 2_012_012,
                transferred_size: 2_000_005,
                literal: 2_816,
                matched: 1_997_189,
                sent: 8_821,
                received: 8_592,
            }
        );
    }

    #[test]
    fn empty_source_deletes_almost_everything() {
        // Dry run of an empty folder over a target with 22 entries.
        let stats = Stats { files: 1, created: 0, deleted: 22, ..Stats::default() };
        assert_eq!(stats.target_entries_before(), 23);
        assert!(stats.delete_percent() > 95.0);
    }

    #[test]
    fn plain_text_stays_other() {
        assert_eq!(parse("sent 1,003,407 bytes  received 1,073 bytes"), Line::Other("sent 1,003,407 bytes  received 1,073 bytes"));
    }
}
