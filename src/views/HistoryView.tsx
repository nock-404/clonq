import { Clock } from "lucide-react";
import type { ClonqState } from "../hooks/useClonq";
import { formatBytes, formatCount, formatDateTime, formatDuration } from "../lib/format";
import { messageLabel, statusLabel, statusTone } from "../lib/labels";
import { durationSeconds } from "../lib/runs";
import type { Run } from "../lib/types";
import { openSheet } from "../lib/nav";
import { UiBadge, UiEmpty, UiTable, type UiColumn } from "../ui";
import { ringBg, ringOf } from "../ui/rings";

interface HistoryViewProps {
  state: ClonqState;
}

const triggerLabel: Record<string, string> = {
  manual: "Per Knopf",
  schedule: "Zeitplan",
  daily: "Täglich",
  mount: "Angesteckt",
  change: "Änderung",
  chain: "Nach Job",
};

export function HistoryView({ state }: HistoryViewProps) {
  const jobs = state.config?.jobs ?? [];
  const jobOf = (jobId: string) => {
    const index = jobs.findIndex((job) => job.id === jobId);
    return { job: jobs[index], index };
  };

  const columns: UiColumn<Run>[] = [
    {
      key: "when",
      header: "Start",
      width: "w-36",
      render: (run) => <span className="text-xs text-ink-soft tabular">{formatDateTime(run.startedAt)}</span>,
    },
    {
      key: "job",
      header: "Job",
      render: (run) => {
        const { job, index } = jobOf(run.jobId);
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${ringBg[ringOf(job?.ring ?? null, Math.max(index, 0))]}`} />
              <span className="truncate text-xs font-medium">{job?.name ?? run.jobId}</span>
              {run.dryRun ? <UiBadge tone="accent">Probelauf</UiBadge> : null}
            </div>
            {run.message ? (
              <span className="truncate text-[0.6875rem] text-ink-faint" title={messageLabel(run.message)}>
                {messageLabel(run.message)}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "w-32",
      render: (run) => <UiBadge tone={statusTone[run.status]}>{statusLabel[run.status]}</UiBadge>,
    },
    {
      key: "trigger",
      header: "Auslöser",
      width: "w-24",
      render: (run) => <span className="text-xs text-ink-faint">{triggerLabel[run.trigger] ?? run.trigger}</span>,
    },
    {
      key: "files",
      header: "Neu / geändert / gelöscht",
      width: "w-44",
      align: "end",
      render: (run) => (
        <span className="text-xs tabular">
          <span className="text-ok">{formatCount(run.filesNew)}</span>
          <span className="text-ink-faint"> / </span>
          <span className="text-accent">{formatCount(run.filesChanged)}</span>
          <span className="text-ink-faint"> / </span>
          <span className="text-danger">{formatCount(run.filesDeleted)}</span>
        </span>
      ),
    },
    {
      key: "bytes",
      header: "Menge",
      width: "w-24",
      align: "end",
      render: (run) => <span className="text-xs tabular">{formatBytes(run.bytesNew + run.bytesChanged)}</span>,
    },
    {
      key: "duration",
      header: "Dauer",
      width: "w-20",
      align: "end",
      render: (run) => {
        const seconds = durationSeconds(run);
        return <span className="text-xs text-ink-faint tabular">{seconds === null ? "läuft" : formatDuration(seconds)}</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Verlauf</h1>
      <UiTable
        columns={columns}
        rows={state.recent}
        rowKey={(run) => run.id}
        onRowPress={(run) => openSheet({ kind: "run", runId: run.id })}
        empty={<UiEmpty icon={Clock} title="Noch keine Läufe" detail="Jeder Lauf erscheint hier, auch Probeläufe." />}
      />
    </div>
  );
}
