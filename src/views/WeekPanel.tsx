import { useT } from "../i18n";
import { usePro } from "../hooks/usePro";
import { formatBytes, formatCount } from "../lib/format";
import type { WeeklyReport } from "../lib/types";
import { UiPanel } from "../ui";
import { toneText } from "../ui/tone";

interface WeekPanelProps {
  week: WeeklyReport | null;
  onOpenJob: (jobId: string) => void;
}

/** clonq Pro's weekly report: the last seven days per job, and how long each target's space lasts. */
export function WeekPanel({ week, onOpenJob }: WeekPanelProps) {
  const o = useT().shell.overview.week;
  const pro = usePro();
  if (pro === null) return null;
  if (!pro) {
    return (
      <UiPanel title={o.title}>
        <span className="text-xs text-ink-soft">{o.pro}</span>
      </UiPanel>
    );
  }
  if (!week) return null;
  const bytes = week.jobs.reduce((sum, job) => sum + job.bytes, 0);
  const runs = week.jobs.reduce((sum, job) => sum + job.runs, 0);
  return (
    <UiPanel title={o.title} aside={<span className="text-xs text-ink-faint">{o.summary(formatBytes(bytes), runs, formatCount(runs))}</span>}>
      <div className="flex flex-col">
        {week.jobs.map((job) => {
          const verdict =
            job.overdueDays !== null
              ? { text: o.overdue(job.overdueDays), tone: "danger" as const }
              : job.failed > 0 && job.succeeded === 0
                ? { text: o.failing, tone: "danger" as const }
                : job.failed > 0
                  ? { text: o.someFailed(job.failed), tone: "warn" as const }
                  : job.runs === 0
                    ? { text: o.noRuns, tone: "neutral" as const }
                    : { text: o.fine, tone: "ok" as const };
          return (
            <button
              key={job.jobId}
              type="button"
              onClick={() => onOpenJob(job.jobId)}
              className="flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-2 text-left not-last:hairline-b hover:bg-track"
            >
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">{job.name}</span>
              <span className="shrink-0 text-xs text-ink-faint tabular-nums">{o.jobLine(job.runs, formatCount(job.runs), formatBytes(job.bytes))}</span>
              <span className={`w-48 shrink-0 text-right text-xs ${toneText[verdict.tone]}`}>{verdict.text}</span>
            </button>
          );
        })}
      </div>
      {week.targets.length > 0 ? (
        <div className="flex flex-col">
          <span className="px-2 pb-1 text-[0.6875rem] font-medium tracking-wide text-ink-faint uppercase">{o.space}</span>
          {week.targets.map((target) => {
            const days = target.daysUntilFull;
            const soon = days !== null && days < 60;
            return (
              <div key={target.locationId} className="flex min-h-10 items-center gap-3 px-2 not-last:hairline-b">
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">{target.name}</span>
                <span className="shrink-0 text-xs text-ink-faint tabular-nums">{o.free(formatBytes(target.free), formatBytes(target.total))}</span>
                <span className={`w-48 shrink-0 text-right text-xs ${toneText[soon ? "warn" : "neutral"]}`}>
                  {days === null || days >= 365 ? o.lasts : o.fullIn(Math.max(1, Math.round(days)))}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <span className="px-2 text-xs text-ink-faint">{o.noSpace}</span>
      )}
    </UiPanel>
  );
}
