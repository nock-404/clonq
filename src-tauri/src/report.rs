//! clonq Pro's watchdog and weekly report: how much space the targets have left and when
//! they fill up, which jobs have not succeeded for too long, and a summary of the week.

use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone, Utc, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::config::{Config, Job, LocationKind};
use crate::error::Result;
use crate::history::{History, RunStatus};
use crate::locations::{self, MountedVolume};

/// Space is measured at most this often per location.
const SPACE_EVERY: i64 = 60;
/// The trend that says when a target is full looks this far back.
const TREND_DAYS: i64 = 30;
/// The weekly report goes out on Monday from this local time on.
const REPORT_DAY: Weekday = Weekday::Mon;
const REPORT_AT: (u32, u32) = (9, 0);

/// Total and free bytes of a job's target location, or None when it cannot be measured now.
pub async fn measure(job: &Job, config: &Config, rclone_config: &Path, volumes: &[MountedVolume]) -> Option<(u64, u64)> {
    let location = config.location(&job.target.location)?;
    match &location.kind {
        LocationKind::Folder { .. } | LocationKind::Volume { .. } | LocationKind::Smb { .. } => {
            let crate::locations::Resolved::Local(path) = locations::resolve(&job.target, config, volumes).ok()? else { return None };
            // The target folder may not exist before the first run; its drive does.
            let existing = path.ancestors().find(|dir| dir.is_dir())?;
            match locations::free_space(existing) {
                (Some(free), Some(total)) if total > 0 => Some((total, free)),
                _ => None,
            }
        }
        LocationKind::Ssh { .. } => {
            let crate::locations::Resolved::Remote { destination, ssh, .. } = locations::resolve(&job.target, config, volumes).ok()? else { return None };
            let (host, path) = destination.split_once(':')?;
            let mut command = tokio::process::Command::new(ssh.first()?);
            command.args(&ssh[1..]).arg(host).arg("df").arg("-k").arg(if path.is_empty() { "." } else { path });
            let output = tokio::time::timeout(std::time::Duration::from_secs(30), command.output()).await.ok()?.ok()?;
            parse_df(&String::from_utf8_lossy(&output.stdout))
        }
        LocationKind::Cloud { remote, .. } => {
            let output = tokio::process::Command::new(&config.rclone_path)
                .arg("about")
                .arg(format!("{remote}:"))
                .arg("--json")
                .arg("--config")
                .arg(rclone_config)
                .output();
            let output = tokio::time::timeout(std::time::Duration::from_secs(60), output).await.ok()?.ok()?;
            parse_about(&String::from_utf8_lossy(&output.stdout))
        }
    }
}

/// `df -k`: the second line holds 1K-blocks and available blocks in columns 2 and 4.
fn parse_df(text: &str) -> Option<(u64, u64)> {
    let fields: Vec<&str> = text.lines().nth(1)?.split_whitespace().collect();
    let total = fields.get(1)?.parse::<u64>().ok()? * 1024;
    let free = fields.get(3)?.parse::<u64>().ok()? * 1024;
    (total > 0).then_some((total, free))
}

/// `rclone about --json`: a provider without quotas leaves out total or free.
fn parse_about(text: &str) -> Option<(u64, u64)> {
    #[derive(Deserialize)]
    struct About {
        total: Option<u64>,
        free: Option<u64>,
    }
    let about: About = serde_json::from_str(text).ok()?;
    Some((about.total.filter(|total| *total > 0)?, about.free?))
}

/// Measures the target of a job that just finished, unless it was measured within the hour.
pub async fn record_space(history: &History, job: &Job, config: &Config, rclone_config: &Path, now: DateTime<Utc>) {
    let recent = history.space_since(&job.target.location, now - Duration::minutes(SPACE_EVERY)).unwrap_or_default();
    if !recent.is_empty() {
        return;
    }
    let volumes = locations::mounted_volumes();
    if let Some((total, free)) = measure(job, config, rclone_config, &volumes).await {
        let _ = history.add_space(&job.target.location, now, total, free);
    }
}

/// Days until the location is full, from the growth of the used space over the last month;
/// None while it does not grow or there is too little to go on.
pub fn days_until_full(samples: &[(DateTime<Utc>, u64, u64)]) -> Option<f64> {
    let (first, last) = (samples.first()?, samples.last()?);
    // Less than a day of measurements says nothing about the trend.
    if last.0 - first.0 < Duration::days(1) {
        return None;
    }
    // Least squares over (days since the first sample, used bytes).
    let points: Vec<(f64, f64)> = samples
        .iter()
        .map(|(at, total, free)| ((*at - first.0).num_seconds() as f64 / 86_400.0, total.saturating_sub(*free) as f64))
        .collect();
    let n = points.len() as f64;
    let mean_x = points.iter().map(|p| p.0).sum::<f64>() / n;
    let mean_y = points.iter().map(|p| p.1).sum::<f64>() / n;
    let spread: f64 = points.iter().map(|p| (p.0 - mean_x).powi(2)).sum();
    if spread == 0.0 {
        return None;
    }
    let per_day = points.iter().map(|p| (p.0 - mean_x) * (p.1 - mean_y)).sum::<f64>() / spread;
    (per_day > 0.0).then(|| last.2 as f64 / per_day)
}

/// Whole days since the job last succeeded, when that is more than it allows; None while it is fine,
/// has no watchdog, or never succeeded (a new job is not overdue).
pub fn overdue_days(job: &Job, last_success: Option<DateTime<Utc>>, now: DateTime<Utc>) -> Option<i64> {
    let limit = i64::try_from(job.triggers.watchdog_days.filter(|days| *days > 0)?).ok()?;
    let days = (now - last_success?).num_days();
    (days >= limit).then_some(days)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobWeek {
    pub job_id: String,
    pub name: String,
    pub runs: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub bytes: i64,
    pub files: i64,
    pub last_success_at: Option<DateTime<Utc>>,
    pub overdue_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSpace {
    pub location_id: String,
    pub name: String,
    pub total: u64,
    pub free: u64,
    pub measured_at: DateTime<Utc>,
    pub days_until_full: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReport {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub jobs: Vec<JobWeek>,
    pub targets: Vec<TargetSpace>,
}

impl WeeklyReport {
    pub fn bytes(&self) -> i64 {
        self.jobs.iter().map(|job| job.bytes).sum()
    }

    pub fn runs(&self) -> i64 {
        self.jobs.iter().map(|job| job.runs).sum()
    }

    /// Jobs that failed every run this week or are overdue.
    pub fn attention(&self) -> usize {
        self.jobs.iter().filter(|job| job.overdue_days.is_some() || (job.failed > 0 && job.succeeded == 0)).count()
    }

    /// The target that fills up first, if any within a year.
    pub fn filling_first(&self) -> Option<&TargetSpace> {
        self.targets
            .iter()
            .filter(|target| target.days_until_full.is_some_and(|days| days < 365.0))
            .min_by(|a, b| a.days_until_full.partial_cmp(&b.days_until_full).unwrap_or(std::cmp::Ordering::Equal))
    }
}

/// The last seven days, as the Overview shows them and the Monday notification sums them up.
pub fn weekly(history: &History, config: &Config, now: DateTime<Utc>) -> Result<WeeklyReport> {
    let from = now - Duration::days(7);
    let mut jobs = Vec::new();
    for job in &config.jobs {
        let runs = history.job_runs_since(&job.id, from)?;
        let last_success_at = history.last_completed(&job.id)?.and_then(|detail| detail.run.finished_at);
        jobs.push(JobWeek {
            job_id: job.id.clone(),
            name: job.name.clone(),
            runs: runs.len() as i64,
            succeeded: runs.iter().filter(|run| run.status.completed()).count() as i64,
            failed: runs.iter().filter(|run| matches!(run.status, RunStatus::Failed | RunStatus::Blocked)).count() as i64,
            bytes: runs.iter().map(|run| run.bytes_new + run.bytes_changed).sum(),
            files: runs.iter().map(|run| run.files_new + run.files_changed).sum(),
            last_success_at,
            overdue_days: overdue_days(job, last_success_at, now),
        });
    }
    let mut targets = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for job in &config.jobs {
        if !seen.insert(job.target.location.clone()) {
            continue;
        }
        let samples = history.space_since(&job.target.location, now - Duration::days(TREND_DAYS))?;
        let Some(&(measured_at, total, free)) = samples.last() else { continue };
        targets.push(TargetSpace {
            location_id: job.target.location.clone(),
            name: config.location(&job.target.location).map_or_else(|| job.target.location.clone(), |location| location.name.clone()),
            total,
            free,
            measured_at,
            days_until_full: days_until_full(&samples),
        });
    }
    Ok(WeeklyReport { from, to: now, jobs, targets })
}

/// Whether the weekly report is due: Monday after nine, local time, and not sent since.
pub fn report_due(last_sent: Option<DateTime<Utc>>, now: DateTime<Local>) -> bool {
    let days_back = i64::from(now.weekday().num_days_from_monday()) - i64::from(REPORT_DAY.num_days_from_monday());
    let monday = now.date_naive() - Duration::days(days_back.rem_euclid(7));
    let Some(at) = NaiveTime::from_hms_opt(REPORT_AT.0, REPORT_AT.1, 0) else { return false };
    let Some(due) = Local.from_local_datetime(&monday.and_time(at)).earliest() else { return false };
    now >= due && last_sent.is_none_or(|sent| sent < due.with_timezone(&Utc))
}

/// What the watchdog and the report remember between launches, in `report.json`.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub report_sent: Option<DateTime<Utc>>,
    /// Per job, the last success a watchdog notice was given for: one notice per silence.
    #[serde(default)]
    pub watchdog_told: HashMap<String, Option<DateTime<Utc>>>,
}

impl Memory {
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join("report.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) {
        if let Ok(text) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(dir.join("report.json"), text);
        }
    }
}

/// "12.4 GB" or "12,4 GB": decimal units, as Finder shows them.
pub fn bytes_text(bytes: i64, german: bool) -> String {
    let units = ["bytes", "KB", "MB", "GB", "TB"];
    let mut value = bytes.max(0) as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < units.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    let text = if unit == 0 { format!("{value:.0}") } else { format!("{value:.1}") };
    format!("{} {}", if german { text.replace('.', ",") } else { text }, units[unit])
}

/// The Monday notification: one sentence about the week, one about what needs looking at.
pub fn summary(report: &WeeklyReport, german: bool) -> String {
    let bytes = bytes_text(report.bytes(), german);
    let runs = report.runs();
    let mut parts = vec![if german {
        format!("{bytes} in {runs} {} gesichert.", if runs == 1 { "Lauf" } else { "Läufen" })
    } else {
        format!("{bytes} backed up in {runs} {}.", if runs == 1 { "run" } else { "runs" })
    }];
    match (report.attention(), german) {
        (0, _) => {}
        (1, true) => parts.push("Ein Job braucht Aufmerksamkeit.".into()),
        (n, true) => parts.push(format!("{n} Jobs brauchen Aufmerksamkeit.")),
        (1, false) => parts.push("One job needs attention.".into()),
        (n, false) => parts.push(format!("{n} jobs need attention.")),
    }
    if let Some(target) = report.filling_first() {
        let days = target.days_until_full.unwrap_or_default().round().max(1.0) as i64;
        parts.push(if german {
            format!("{} ist in etwa {days} {} voll.", target.name, if days == 1 { "Tag" } else { "Tagen" })
        } else {
            format!("{} will be full in about {days} {}.", target.name, if days == 1 { "day" } else { "days" })
        });
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(days: f64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap() + Duration::seconds((days * 86_400.0) as i64)
    }

    #[test]
    fn a_target_growing_ten_gigabytes_a_day_with_hundred_free_is_full_in_ten_days() {
        let gb = 1_000_000_000_u64;
        let samples: Vec<_> = (0..=5).map(|day| (at(day as f64), 1000 * gb, (150 - 10 * day) * gb)).collect();
        let days = days_until_full(&samples).unwrap();
        assert!((days - 10.0).abs() < 0.01, "{days}");
    }

    #[test]
    fn no_forecast_for_shrinking_flat_or_too_short_measurements() {
        let gb = 1_000_000_000_u64;
        assert_eq!(days_until_full(&[(at(0.0), 1000 * gb, 100 * gb), (at(3.0), 1000 * gb, 120 * gb)]), None, "shrinking");
        assert_eq!(days_until_full(&[(at(0.0), 1000 * gb, 100 * gb), (at(3.0), 1000 * gb, 100 * gb)]), None, "flat");
        assert_eq!(days_until_full(&[(at(0.0), 1000 * gb, 100 * gb), (at(0.5), 1000 * gb, 90 * gb)]), None, "half a day");
        assert_eq!(days_until_full(&[]), None);
    }

    #[test]
    fn the_summary_names_the_week_the_problems_and_the_first_full_target() {
        let job = |failed: i64, succeeded: i64, overdue: Option<i64>| JobWeek {
            job_id: "j".into(), name: "J".into(), runs: failed + succeeded, succeeded, failed,
            bytes: 6_200_000_000, files: 10, last_success_at: None, overdue_days: overdue,
        };
        let target = |days: Option<f64>| TargetSpace { location_id: "m".into(), name: "M2mini".into(), total: 1, free: 1, measured_at: at(0.0), days_until_full: days };
        let report = WeeklyReport { from: at(0.0), to: at(7.0), jobs: vec![job(0, 12, None), job(2, 0, None), job(0, 3, Some(9))], targets: vec![target(Some(400.0)), target(Some(41.6))] };
        assert_eq!(summary(&report, true), "18,6 GB in 17 Läufen gesichert. 2 Jobs brauchen Aufmerksamkeit. M2mini ist in etwa 42 Tagen voll.");
        assert_eq!(summary(&report, false), "18.6 GB backed up in 17 runs. 2 jobs need attention. M2mini will be full in about 42 days.");
        let quiet = WeeklyReport { jobs: vec![job(0, 1, None)], targets: vec![target(None)], ..report };
        assert_eq!(summary(&quiet, false), "6.2 GB backed up in 1 run.");
    }

    #[test]
    fn df_and_rclone_about_are_read() {
        let df = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 976490576 500000000 476490576 52% /Volumes/M2mini\n";
        assert_eq!(parse_df(df), Some((976_490_576 * 1024, 476_490_576 * 1024)));
        assert_eq!(parse_df("garbage"), None);
        assert_eq!(parse_about(r#"{"total":1000,"used":400,"free":600}"#), Some((1000, 600)));
        assert_eq!(parse_about(r#"{"used":400}"#), None, "no quota, no forecast");
    }

    #[test]
    fn the_watchdog_counts_from_the_last_success_and_ignores_new_jobs() {
        let mut job: Job = serde_json::from_value(serde_json::json!({
            "id": "j", "name": "J", "enabled": true,
            "source": { "location": "a", "path": "" }, "target": { "location": "b", "path": "" },
            "mode": "mirror", "excludes": [], "safety": { "maxDeletePercent": 10.0 },
            "triggers": { "onMount": false, "watchdogDays": 3 }
        }))
        .unwrap();
        let now = at(10.0);
        assert_eq!(overdue_days(&job, Some(at(8.0)), now), None);
        assert_eq!(overdue_days(&job, Some(at(7.0)), now), Some(3));
        assert_eq!(overdue_days(&job, None, now), None, "never ran: not overdue");
        job.triggers.watchdog_days = None;
        assert_eq!(overdue_days(&job, Some(at(0.0)), now), None);
    }

    #[test]
    fn the_report_goes_out_once_on_monday_after_nine_and_catches_up_later_in_the_week() {
        let local = |d: u32, h: u32| Local.with_ymd_and_hms(2026, 9, d, h, 0, 0).unwrap();
        // 21 September 2026 is a Monday.
        assert!(!report_due(None, local(21, 8)));
        assert!(report_due(None, local(21, 9)));
        assert!(!report_due(Some(local(21, 9).with_timezone(&Utc)), local(21, 15)), "already sent");
        assert!(report_due(Some(local(14, 10).with_timezone(&Utc)), local(23, 12)), "Mac was off on Monday");
        assert!(!report_due(Some(local(21, 10).with_timezone(&Utc)), local(27, 23)), "Sunday, sent this week");
    }
}
