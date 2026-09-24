import { FlaskConical, Play, ShieldAlert, ShieldCheck, Square } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { ClonqState } from "../hooks/useClonq";
import { useHotkeys } from "../hooks/useHotkeys";
import { texts, useT } from "../i18n";
import {
  formatBytes,
  formatCount,
  formatDay,
  formatDuration,
  formatPercent,
  formatRate,
  formatReels,
  formatRelative,
} from "../lib/format";
import { isRunning, jobActions, jobReady, progressLine } from "../lib/jobs";
import { locationOf, messageLabel, reachLabel, statusLabel } from "../lib/labels";
import { durationSeconds, ratesOf, savedPercent } from "../lib/runs";
import { openSheet } from "../lib/nav";
import type { ArchiveSide, Job } from "../lib/types";
import {
  UiBadge,
  UiBars,
  UiButton,
  UiCounter,
  UiFreshness,
  UiIconButton,
  UiLamps,
  UiNotice,
  UiPanel,
  UiProgressBar,
  UiReelPair,
  UiSparkline,
  UiStat,
  UiText,
  UiSegmented,
} from "../ui";
import { UiLinkButton } from "../ui/UiLinkButton";
import { ringOf } from "../ui/rings";
import { ArchivePanel } from "./ArchivePanel";
import { SnapshotsPanel } from "./SnapshotsPanel";
import { DryRunResult } from "./DryRunResult";
import { JobHeader } from "./jobs/JobHeader";

interface JobDetailProps {
  state: ClonqState;
  job: Job;
  index: number;
  now: number;
}

export function JobDetail({ state, job, index, now }: JobDetailProps) {
  const live = state.live[job.id];
  const latest = state.latest[job.id];
  const stats = state.stats[job.id];
  const last = stats?.last ?? null;
  const running = isRunning(live);
  const readiness = jobReady(job, state.locations);
  const remote = !readiness.ready;
  const blockerName = readiness.blocker ? locationOf({ location: readiness.blocker, path: "" }, state.config)?.name : undefined;
  const blockerReach = readiness.blocker ? reachLabel(state.locations[readiness.blocker]?.reach).text : "";
  const blocked = !running && latest?.status === "blocked";
  const ring = ringOf(job.ring, index);
  const [archiveSide, setArchiveSide] = useState<ArchiveSide>("target");
  // Only a two-way job has an archive on its source.
  const shownSide: ArchiveSide = job.mode === "bidirectional" ? archiveSide : "target";
  const t = useT();
  const d = t.detail;
  const j = d.job;

  useHotkeys({
    Enter: () => !running && !remote && void jobActions.run(job.id),
    "mod+Enter": () => !running && !remote && void jobActions.dryRun(job.id),
    "mod+.": () => running && void jobActions.cancel(job.id),
  });

  // The watchdog's verdict (Pro): counted from the last success, like the notification.
  const lastSuccess = stats?.lastSuccessAt ? Date.parse(stats.lastSuccessAt) : null;
  const overdueFor = lastSuccess !== null ? Math.floor((now - lastSuccess) / 86_400_000) : 0;
  const overdue = job.triggers.watchdogDays !== null && lastSuccess !== null && overdueFor >= job.triggers.watchdogDays ? overdueFor : null;
  const curve = running ? live.throughput : last ? ratesOf(last.samples) : [];
  const peak = curve.length > 0 ? Math.max(...curve) : 0;
  const saved = last ? savedPercent(last) : null;
  const counts = running
    ? { created: live.filesNew, changed: live.filesChanged, deleted: live.filesDeleted }
    : { created: last?.filesNew ?? 0, changed: last?.filesChanged ?? 0, deleted: last?.filesDeleted ?? 0 };
  const topBytes = Math.max(...(stats?.topFolders ?? []).map((folder) => folder.bytes), 1);
  const lastThirty = (stats?.daily ?? []).reduce((sum, day) => sum + day.bytes, 0);
  const todayKey = stats?.daily.at(-1)?.day;

  return (
    <div className="flex flex-col gap-4">
      <JobHeader job={job} config={state.config} running={running}>
        {running ? (
          <UiButton variant="danger" icon={Square} keys={["⌘", "."]} onPress={() => void jobActions.cancel(job.id)}>
            {t.common.cancel}
          </UiButton>
        ) : (
          <>
            <UiIconButton icon={ShieldCheck} label={d.actions.verify} disabled={remote} onPress={() => void jobActions.verify(job.id)} />
            <UiButton variant="ghost" icon={FlaskConical} keys={["⌘", "↵"]} disabled={remote} onPress={() => void jobActions.dryRun(job.id)}>
              {d.dryRun}
            </UiButton>
            <UiButton variant="primary" icon={Play} keys={["↵"]} disabled={remote} onPress={() => void jobActions.run(job.id)}>
              {j.runNow}
            </UiButton>
          </>
        )}
      </JobHeader>

      {overdue !== null ? <UiNotice tone="danger">{t.shell.overview.week.overdue(overdue)}</UiNotice> : null}
      {remote ? (
        <UiNotice tone="neutral">
          {j.waiting(blockerName, blockerReach)}
        </UiNotice>
      ) : null}
      {!running && latest?.message && latest.status !== "succeeded" && latest.id !== state.dryRuns[job.id]?.runId ? (
        <UiNotice
          tone={latest.status === "failed" ? "danger" : "warn"}
          actions={
            blocked ? (
              <>
                <UiButton variant="danger" icon={ShieldAlert} onPress={() => void jobActions.force(job.id)}>
                  {j.runAnyway}
                </UiButton>
                <UiButton variant="ghost" icon={FlaskConical} onPress={() => void jobActions.dryRun(job.id)}>
                  {j.showDryRun}
                </UiButton>
              </>
            ) : undefined
          }
        >
          {messageLabel(latest.message)}
        </UiNotice>
      ) : null}

      {!running && state.dryRuns[job.id] ? <DryRunResult run={state.dryRuns[job.id]!} canRun={!remote} mode={job.mode} /> : null}

      <div className="grid grid-cols-[auto_1fr] gap-4">
        {/* Fixed width: the three reel styles differ a little in proportion, and switching must not shift the page. */}
        <section className="flex w-44 flex-col items-center gap-3">
          <div className="h-64">
            <UiReelPair ring={ring} progress={running ? live.percent : latest ? 100 : 0} running={running} label={running ? j.tapeRunning : j.tapeStopped} />
          </div>
          {state.config?.ui.lamps ? <UiLamps active={running && live.phase === "transferring"} /> : null}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <UiPanel title={running ? (live.verify ? j.verifying : live.dryRun ? j.dryRunning : j.running) : j.copyState} aside={running ? progressLine(live) : undefined}>
            {running ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-4">
                  <span className="text-4xl font-semibold tracking-tight tabular">
                    {live.phase === "checking" ? j.checking : formatPercent(live.percent)}
                  </span>
                  <span className="text-sm text-ink-soft tabular">{formatRate(live.bytesPerSecond)}</span>
                </div>
                <UiProgressBar value={live.phase === "checking" ? null : live.percent} />
                {live.currentPath ? <span className="truncate font-mono text-[0.6875rem] text-ink-faint">{live.currentPath}</span> : null}
              </div>
            ) : (
              <UiFreshness at={stats?.lastSuccessAt ?? null} now={now} />
            )}
          </UiPanel>

          <UiPanel title={running ? j.throughputLive : j.throughputLast} aside={peak > 0 ? j.peak(formatRate(peak)) : undefined}>
            <div className="h-16">
              {curve.length > 1 ? (
                <UiSparkline values={curve} slots={running ? 60 : undefined} label={j.throughput} />
              ) : (
                <span className="text-xs text-ink-faint">{j.noSamples}</span>
              )}
            </div>
          </UiPanel>

          <div className="grid grid-cols-4 gap-4">
            <UiStat label={d.counts.created} value={formatCount(counts.created)} tone={counts.created > 0 ? "ok" : "ink"} />
            <UiStat label={d.counts.changed} value={formatCount(counts.changed)} tone={counts.changed > 0 ? "accent" : "ink"} />
            <UiStat label={d.counts.deleted} value={formatCount(counts.deleted)} tone={counts.deleted > 0 ? "danger" : "ink"} />
            <UiStat
              label={running ? j.filesPerSecond : j.saved}
              value={running ? formatCount(Math.round(live.filesPerSecond)) : saved === null ? "–" : formatPercent(saved, saved > 99 ? 2 : 0)}
              detail={!running && last ? j.notTransferred(formatBytes(last.sourceBytes)) : undefined}
            />
          </div>
        </div>
      </div>

      {running && live.recentPaths.length > 0 ? (
        <UiPanel title={j.recent}>
          <ul className="flex flex-col gap-1">
            {live.recentPaths.map((path) => (
              <li key={path} className="truncate font-mono text-[0.6875rem] text-ink-soft">
                {path}
              </li>
            ))}
          </ul>
        </UiPanel>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <UiPanel title={j.changes30} aside={formatBytes(lastThirty)}>
          <div className="h-20">
            <UiBars
              label={j.changesPerDay}
              bars={(stats?.daily ?? []).map((day) => ({
                key: day.day,
                value: day.bytes,
                highlight: day.day === todayKey && day.bytes > 0,
                title: j.dayBar(formatDay(day.day), formatBytes(day.bytes), day.files, formatCount(day.files), day.runs),
              }))}
            />
          </div>
        </UiPanel>

        <UiPanel title={j.changesMost} aside={j.sevenDays}>
          {stats && stats.topFolders.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {stats.topFolders.map((folder) => (
                <li key={folder.folder} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate font-mono text-ink">{folder.folder === "." ? j.topLevel : folder.folder}</span>
                    <span className="shrink-0 text-ink-faint tabular">
                      {formatBytes(folder.bytes)} · {formatCount(folder.files)}
                    </span>
                  </div>
                  <svg viewBox="0 0 100 2" preserveAspectRatio="none" className="h-0.5 w-full" aria-hidden>
                    <rect width={(folder.bytes / topBytes) * 100} height="2" rx="1" className="fill-accent/70" />
                  </svg>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-ink-faint">{j.noChanges}</span>
          )}
        </UiPanel>

        <UiPanel title={j.movedTotal} aside={stats ? d.runs(stats.totals.runs, formatCount(stats.totals.runs)) : undefined}>
          <div className="flex items-end justify-between gap-4">
            <UiCounter value={stats?.totals.files ?? 0} digits={6} />
            <div className="flex flex-col items-end">
              <span className="text-lg font-semibold tabular">{formatBytes(stats?.totals.bytes ?? 0)}</span>
              <span className="text-[0.6875rem] text-ink-faint">{j.ofTape(formatReels(stats?.totals.bytes ?? 0))}</span>
            </div>
          </div>
        </UiPanel>

        <UiPanel title={j.reliability}>
          <div className="grid grid-cols-3 gap-4">
            <UiStat label={j.streak} value={formatCount(stats?.streak ?? 0)} detail={j.withoutErrors} size="md" />
            <UiStat
              label={j.succeeded}
              value={stats && stats.runsTotal > 0 ? `${stats.runsCompleted}/${stats.runsTotal}` : "–"}
              size="md"
            />
            <UiStat label={j.averageDuration} value={stats?.averageSeconds ? formatDuration(stats.averageSeconds) : "–"} detail={j.thirtyDays} size="md" />
          </div>
        </UiPanel>
      </div>

      {latest ? (
        <span className="text-[0.6875rem] text-ink-faint">
          {j.lastRun(statusLabel(latest.status))} · {formatRelative(latest.startedAt, now)}
          {durationSeconds(latest) !== null ? ` · ${formatDuration(durationSeconds(latest) ?? 0)}` : ""}
        </span>
      ) : null}

      {/* ↵ on a link, list, field or button in the archive belongs to it; it never starts the job. */}
      {job.mode === "versioned" ? (
        // A versioned job keeps dated snapshots instead of an archive.
        <div onKeyDown={keepEnter}>
          <UiPanel title={d.snapshots.title}>
            <SnapshotsPanel
              job={job}
              revision={`${latest?.id ?? ""}:${latest?.finishedAt ?? ""}`}
              target={locationOf(job.target, state.config)}
              status={state.locations[job.target.location]}
              now={now}
            />
          </UiPanel>
        </div>
      ) : (
        <div onKeyDown={keepEnter}>
          <UiPanel title={j.archive}>
            <div className="flex min-w-0 items-center gap-2">
              <UiBadge>{job.archive.enabled ? j.on : j.off}</UiBadge>
              <UiText tone="neutral" truncate>
                {archiveSentence(job)}
              </UiText>
              <UiLinkButton onPress={() => openSheet({ kind: "jobWizard", jobId: job.id })}>{j.change}</UiLinkButton>
            </div>
            {/* A two-way job keeps an archive on each end; one switch picks which is shown. */}
            {job.mode === "bidirectional" ? (
              <UiSegmented
                label={j.archiveSide}
                value={archiveSide}
                onChange={setArchiveSide}
                segments={(["target", "source"] as const).map((side) => ({
                  value: side,
                  label: locationOf(side === "target" ? job.target : job.source, state.config)?.name ?? (side === "target" ? j.sideTarget : j.sideSource),
                }))}
              />
            ) : null}
            <ArchivePanel
              key={shownSide}
              job={job}
              revision={`${latest?.id ?? ""}:${latest?.finishedAt ?? ""}`}
              side={shownSide}
              target={locationOf(shownSide === "target" ? job.target : job.source, state.config)}
              reach={state.locations[(shownSide === "target" ? job.target : job.source).location]?.reach}
              now={now}
            />
          </UiPanel>
        </div>
      )}
    </div>
  );
}

/** Stops a plain ↵ before it reaches the view's hotkeys, which would start the job and swallow the key. */
function keepEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Enter" && !event.metaKey) event.stopPropagation();
}

/** The archive setting as one sentence. A two-way job keeps an archive on both sides. */
function archiveSentence(job: Job): string {
  const { enabled, keepDays } = job.archive;
  const t = texts().detail.job;
  if (!enabled) return t.archiveOff;
  return t.archiveOn(keepDays, formatCount(keepDays), job.mode === "bidirectional");
}
