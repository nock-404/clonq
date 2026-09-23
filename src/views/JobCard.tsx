import { Ban, CircleCheck, CircleDashed, CircleX, FlaskConical, Play, Square, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { formatBytes, formatCount, formatDuration, formatRate, formatRelative } from "../lib/format";
import { endpointLabel, messageLabel, modeLabel, statusLabel, statusTone, type Tone } from "../lib/labels";
import type { Job, LiveRun, Run, RunStatus } from "../lib/types";
import { reportError } from "../hooks/useClonq";
import { UiBadge, UiButton, UiIconButton, UiNotice, UiPane, UiProgressBar, UiProgressRing, UiText } from "../ui";

interface JobCardProps {
  job: Job;
  live: LiveRun | undefined;
  latest: Run | undefined;
  /** The newest dry run, shown while no real run has happened since. */
  lastDryRun: Run | undefined;
}

const statusIcon: Record<RunStatus, LucideIcon> = {
  running: CircleDashed,
  succeeded: CircleCheck,
  partial: TriangleAlert,
  blocked: TriangleAlert,
  failed: CircleX,
  cancelled: Ban,
};

export function JobCard({ job, live, latest, lastDryRun }: JobCardProps) {
  const running = live !== undefined && live.phase !== "finished";
  const remote = job.source.kind === "remote" || job.target.kind === "remote";
  const status = live?.status ?? latest?.status ?? null;
  const tone: Tone = running ? "accent" : status ? statusTone[status] : "neutral";
  const StatusIcon = status ? statusIcon[status] : CircleDashed;
  const message = live?.message ?? latest?.message ?? null;
  const blocked = !running && status === "blocked";
  const dryRun = lastDryRun && (!latest || lastDryRun.startedAt > latest.startedAt) ? lastDryRun : undefined;

  const run = (options: { dryRun?: boolean; force?: boolean } = {}) =>
    api.runJob(job.id, options).catch(reportError);
  const cancel = () => api.cancelJob(job.id).catch(reportError);

  return (
    <UiPane>
      <div className="flex items-center gap-3">
        <UiProgressRing
          value={running ? (live.phase === "checking" ? null : live.percent) : 100}
          tone={running ? "accent" : tone}
        >
          <StatusIcon className={`size-4 ${running ? "text-accent" : ""}`} strokeWidth={2.2} />
        </UiProgressRing>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <UiText variant="heading" truncate>
              {job.name}
            </UiText>
            <UiBadge>{modeLabel[job.mode]}</UiBadge>
          </div>
          <UiText variant="caption" tone="neutral" truncate title={`${endpointLabel(job.source)} → ${endpointLabel(job.target)}`}>
            {endpointLabel(job.source)} → {endpointLabel(job.target)}
          </UiText>
        </div>

        <div className="flex items-center gap-0.5">
          {running ? (
            <UiIconButton icon={Square} label="Abbrechen" tone="danger" onPress={cancel} filled />
          ) : (
            <>
              <UiIconButton
                icon={FlaskConical}
                label="Probelauf – zeigt, was passieren würde"
                onPress={() => run({ dryRun: true })}
                disabled={remote}
              />
              <UiIconButton
                icon={Play}
                label={remote ? "Storage Box noch nicht verbunden" : "Jetzt starten"}
                tone="accent"
                onPress={() => run()}
                disabled={remote}
                filled
              />
            </>
          )}
        </div>
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        {running ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 flex flex-col gap-1.5 overflow-hidden"
          >
            <UiProgressBar value={live.phase === "checking" ? null : live.percent} />
            <div className="flex items-center justify-between gap-3">
              <UiText variant="caption" tone="neutral">
                {live.phase === "checking" ? "Prüfe, was gelöscht würde …" : progressLine(live)}
              </UiText>
              {live.dryRun ? <UiBadge tone="accent">Probelauf</UiBadge> : null}
            </div>
            {live.currentPath ? (
              <UiText variant="mono" tone="neutral" truncate title={live.currentPath}>
                {live.currentPath}
              </UiText>
            ) : null}
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-2.5 flex flex-col gap-2"
          >
            <UiText variant="caption" tone={status ? statusTone[status] : "neutral"}>
              {idleLine(latest)}
            </UiText>
            {dryRun ? (
              <div className="flex items-center gap-2">
                <UiBadge tone="accent">Probelauf</UiBadge>
                <UiText variant="caption" tone="neutral" truncate>
                  {dryRunLine(dryRun)}
                </UiText>
              </div>
            ) : null}
            {message && status !== "succeeded" ? (
              <UiNotice
                tone={status === "failed" ? "danger" : "warn"}
                actions={
                  blocked ? (
                    <>
                      <UiButton size="sm" variant="danger" onPress={() => run({ force: true })}>
                        Trotzdem ausführen
                      </UiButton>
                      <UiButton size="sm" variant="ghost" icon={FlaskConical} onPress={() => run({ dryRun: true })}>
                        Probelauf ansehen
                      </UiButton>
                    </>
                  ) : undefined
                }
              >
                {messageLabel(message)}
              </UiNotice>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </UiPane>
  );
}

function progressLine(live: LiveRun): string {
  const parts = [`${Math.round(live.percent)} %`];
  if (live.filesTotal !== null) parts.push(`${formatCount(live.filesDone)} / ${formatCount(live.filesTotal)} Dateien`);
  if (live.bytesPerSecond > 0) parts.push(formatRate(live.bytesPerSecond));
  if (live.etaSeconds !== null && live.etaSeconds > 0) parts.push(`noch ${formatDuration(live.etaSeconds)}`);
  return parts.join(" · ");
}

function idleLine(latest: Run | undefined): string {
  if (!latest) return "Noch nie gelaufen";
  const parts = [statusLabel[latest.status], formatRelative(latest.finishedAt ?? latest.startedAt)];
  if (latest.status === "succeeded" || latest.status === "partial") {
    parts.push(`${formatCount(latest.filesTransferred)} übertragen`);
    if (latest.filesDeleted > 0) parts.push(`${formatCount(latest.filesDeleted)} gelöscht`);
    if (latest.bytesTransferred > 0) parts.push(formatBytes(latest.bytesTransferred));
  }
  return parts.join(" · ");
}

function dryRunLine(run: Run): string {
  if (run.status !== "succeeded" && run.status !== "partial") {
    return `${statusLabel[run.status]} · ${formatRelative(run.startedAt)}`;
  }
  const parts = [
    `würde ${formatCount(run.filesTransferred)} übertragen`,
    `${formatCount(run.filesDeleted)} löschen`,
  ];
  if (run.bytesTransferred > 0) parts.push(formatBytes(run.bytesTransferred));
  parts.push(formatRelative(run.startedAt));
  return parts.join(" · ");
}
