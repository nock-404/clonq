//! Numbers about a job over time, computed from the run history.

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use serde::Serialize;
use std::collections::BTreeMap;

use crate::error::Result;
use crate::history::{FolderChange, History, Run, RunDetail, RunStatus, Totals};

const DAYS: i64 = 30;
const FOLDER_DAYS: i64 = 7;
const FOLDER_LIMIT: i64 = 6;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStats {
    pub job_id: String,
    /// When the target was last brought fully up to date.
    pub last_success_at: Option<DateTime<Utc>>,
    /// Completed runs in a row, newest first; cancelled runs neither count nor break it.
    pub streak: i64,
    pub runs_total: i64,
    pub runs_completed: i64,
    pub average_seconds: Option<f64>,
    pub last: Option<RunDetail>,
    /// One entry per local calendar day, oldest first, today last.
    pub daily: Vec<DayChange>,
    /// Folders with the most changed bytes in the last week.
    pub top_folders: Vec<FolderChange>,
    pub totals: Totals,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayChange {
    /// Local date, `YYYY-MM-DD`.
    pub day: String,
    pub bytes: i64,
    pub files: i64,
    pub runs: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub totals: Totals,
    /// New and changed bytes of all jobs today.
    pub today_bytes: i64,
    pub today_files: i64,
    pub today_runs: i64,
}

pub fn job_stats(history: &History, job_id: &str, now: DateTime<Utc>) -> Result<JobStats> {
    let statuses = history.job_statuses(job_id)?;
    let since = now - Duration::days(DAYS);
    let runs = history.job_runs_since(job_id, since)?;
    let last = history.last_completed(job_id)?;
    Ok(JobStats {
        job_id: job_id.to_string(),
        last_success_at: last.as_ref().and_then(|detail| detail.run.finished_at),
        streak: streak(&statuses),
        runs_total: statuses.len() as i64,
        runs_completed: statuses.iter().filter(|status| status.completed()).count() as i64,
        average_seconds: average_seconds(&runs),
        daily: daily(&runs, now.with_timezone(&Local).date_naive(), DAYS),
        top_folders: history.folders_since(job_id, now - Duration::days(FOLDER_DAYS), FOLDER_LIMIT)?,
        totals: history.totals(Some(job_id))?,
        last,
    })
}

pub fn overview(history: &History, job_ids: &[String], now: DateTime<Utc>) -> Result<Overview> {
    let today = now.with_timezone(&Local).date_naive();
    let (mut today_bytes, mut today_files, mut today_runs) = (0, 0, 0);
    for job_id in job_ids {
        for run in history.job_runs_since(job_id, now - Duration::days(1))? {
            if run.status.completed() && local_day(&run) == today {
                today_bytes += run.bytes_new + run.bytes_changed;
                today_files += run.files_new + run.files_changed;
                today_runs += 1;
            }
        }
    }
    Ok(Overview { totals: history.totals(None)?, today_bytes, today_files, today_runs })
}

fn streak(statuses: &[RunStatus]) -> i64 {
    let mut count = 0;
    for status in statuses {
        match status {
            RunStatus::Cancelled => continue,
            status if status.completed() => count += 1,
            _ => break,
        }
    }
    count
}

fn average_seconds(runs: &[Run]) -> Option<f64> {
    let durations: Vec<f64> = runs
        .iter()
        .filter(|run| run.status.completed())
        .filter_map(|run| run.finished_at.map(|end| (end - run.started_at).num_milliseconds() as f64 / 1000.0))
        .collect();
    if durations.is_empty() {
        return None;
    }
    Some(durations.iter().sum::<f64>() / durations.len() as f64)
}

fn local_day(run: &Run) -> NaiveDate {
    run.started_at.with_timezone(&Local).date_naive()
}

fn daily(runs: &[Run], today: NaiveDate, days: i64) -> Vec<DayChange> {
    let mut by_day: BTreeMap<NaiveDate, DayChange> = BTreeMap::new();
    for offset in (0..days).rev() {
        let day = today - Duration::days(offset);
        by_day.insert(day, DayChange { day: day.to_string(), bytes: 0, files: 0, runs: 0 });
    }
    for run in runs.iter().filter(|run| run.status.completed()) {
        if let Some(entry) = by_day.get_mut(&local_day(run)) {
            entry.bytes += run.bytes_new + run.bytes_changed;
            entry.files += run.files_new + run.files_changed;
            entry.runs += 1;
        }
    }
    by_day.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streak_counts_completed_runs_until_a_failure() {
        use RunStatus::*;
        assert_eq!(streak(&[Succeeded, Partial, Cancelled, Succeeded, Failed, Succeeded]), 3);
        assert_eq!(streak(&[Failed, Succeeded]), 0);
        assert_eq!(streak(&[]), 0);
    }

    #[test]
    fn daily_has_one_entry_per_day_with_today_last() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 23).unwrap();
        let days = daily(&[], today, 30);
        assert_eq!(days.len(), 30);
        assert_eq!(days.last().unwrap().day, "2026-09-23");
        assert_eq!(days.first().unwrap().day, "2026-08-25");
    }
}
