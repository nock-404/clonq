import { Clock } from "lucide-react";
import type { ClonqState } from "../hooks/useClonq";
import { formatBytes, formatCount, formatDateTime, formatDuration, runDurationSeconds } from "../lib/format";
import { messageLabel, statusLabel, statusTone } from "../lib/labels";
import type { Run } from "../lib/types";
import { UiBadge, UiEmpty, UiTable, UiText, type UiColumn } from "../ui";

interface HistoryViewProps {
  state: ClonqState;
}

const triggerLabel: Record<string, string> = {
  manual: "Per Knopf",
};

export function HistoryView({ state }: HistoryViewProps) {
  const jobName = (jobId: string) => state.config?.jobs.find((job) => job.id === jobId)?.name ?? jobId;

  const columns: UiColumn<Run>[] = [
    {
      key: "when",
      header: "Start",
      width: "w-36",
      render: (run) => <UiText variant="caption">{formatDateTime(run.startedAt)}</UiText>,
    },
    {
      key: "job",
      header: "Job",
      render: (run) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <UiText variant="label" truncate>
              {jobName(run.jobId)}
            </UiText>
            {run.dryRun ? <UiBadge tone="accent">Probelauf</UiBadge> : null}
          </div>
          {run.message ? (
            <UiText variant="caption" tone={statusTone[run.status]} truncate title={messageLabel(run.message)}>
              {messageLabel(run.message)}
            </UiText>
          ) : null}
        </div>
      ),
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
      render: (run) => (
        <UiText variant="caption" tone="neutral">
          {triggerLabel[run.trigger] ?? run.trigger}
        </UiText>
      ),
    },
    {
      key: "files",
      header: "Dateien",
      width: "w-28",
      align: "end",
      render: (run) => (
        <UiText variant="caption">
          {formatCount(run.filesTransferred)}
          {run.filesDeleted > 0 ? ` / −${formatCount(run.filesDeleted)}` : ""}
        </UiText>
      ),
    },
    {
      key: "bytes",
      header: "Menge",
      width: "w-24",
      align: "end",
      render: (run) => <UiText variant="caption">{formatBytes(run.bytesTransferred)}</UiText>,
    },
    {
      key: "duration",
      header: "Dauer",
      width: "w-24",
      align: "end",
      render: (run) => {
        const seconds = runDurationSeconds(run.startedAt, run.finishedAt);
        return (
          <UiText variant="caption" tone="neutral">
            {seconds === null ? "läuft" : formatDuration(seconds)}
          </UiText>
        );
      },
    },
  ];

  return (
    <UiTable
      columns={columns}
      rows={state.recent}
      rowKey={(run) => run.id}
      empty={<UiEmpty icon={Clock} title="Noch keine Läufe" detail="Jeder Lauf erscheint hier, auch Probeläufe." />}
    />
  );
}
