import { FlaskConical, Play, ShieldAlert, Square } from "lucide-react";
import type { ClonqState } from "../hooks/useClonq";
import { useHotkeys } from "../hooks/useHotkeys";
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
import { locationOf, messageLabel, modeLabel, placeLabel, reachLabel, statusLabel } from "../lib/labels";
import { durationSeconds, ratesOf, savedPercent } from "../lib/runs";
import type { Job } from "../lib/types";
import {
  UiBadge,
  UiBars,
  UiButton,
  UiCounter,
  UiFreshness,
  UiLamps,
  UiNotice,
  UiPanel,
  UiProgressBar,
  UiReelPair,
  UiSparkline,
  UiStat,
} from "../ui";
import { ringOf } from "../ui/rings";

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

  useHotkeys({
    Enter: () => !running && !remote && void jobActions.run(job.id),
    "mod+Enter": () => !running && !remote && void jobActions.dryRun(job.id),
    "mod+.": () => running && void jobActions.cancel(job.id),
  });

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
      <header className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{job.name}</h1>
            <UiBadge>{modeLabel[job.mode]}</UiBadge>
          </div>
          <span className="truncate text-xs text-ink-faint">
            {placeLabel(job.source, state.config)} → {placeLabel(job.target, state.config)}
          </span>
        </div>
        {running ? (
          <UiButton variant="danger" icon={Square} keys={["⌘", "."]} onPress={() => void jobActions.cancel(job.id)}>
            Abbrechen
          </UiButton>
        ) : (
          <>
            <UiButton variant="ghost" icon={FlaskConical} keys={["⌘", "↵"]} disabled={remote} onPress={() => void jobActions.dryRun(job.id)}>
              Probelauf
            </UiButton>
            <UiButton variant="primary" icon={Play} keys={["↵"]} disabled={remote} onPress={() => void jobActions.run(job.id)}>
              Jetzt syncen
            </UiButton>
          </>
        )}
      </header>

      {remote ? (
        <UiNotice tone="neutral">
          {blockerName ?? "Ein Ort"} ist gerade {blockerReach}. Sobald er erreichbar ist, kann dieser Job laufen.
        </UiNotice>
      ) : null}
      {!running && latest?.message && latest.status !== "succeeded" ? (
        <UiNotice
          tone={latest.status === "failed" ? "danger" : "warn"}
          actions={
            blocked ? (
              <>
                <UiButton variant="danger" icon={ShieldAlert} onPress={() => void jobActions.force(job.id)}>
                  Trotzdem ausführen
                </UiButton>
                <UiButton variant="ghost" icon={FlaskConical} onPress={() => void jobActions.dryRun(job.id)}>
                  Probelauf ansehen
                </UiButton>
              </>
            ) : undefined
          }
        >
          {messageLabel(latest.message)}
        </UiNotice>
      ) : null}

      <div className="grid grid-cols-[auto_1fr] gap-4">
        <section className="hairline flex flex-col items-center gap-3 rounded-[var(--radius-panel)] bg-well px-5 pt-4 pb-3">
          <div className="h-64">
            <UiReelPair ring={ring} progress={running ? live.percent : latest ? 100 : 0} running={running} label={running ? "Band läuft" : "Band steht"} />
          </div>
          {state.config?.ui.lamps ? <UiLamps active={running && live.phase === "transferring"} /> : null}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <UiPanel title={running ? (live.dryRun ? "Probelauf läuft" : "Läuft gerade") : "Stand der Kopie"} aside={running ? progressLine(live) : undefined}>
            {running ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-4">
                  <span className="text-4xl font-semibold tracking-tight tabular">
                    {live.phase === "checking" ? "prüft" : formatPercent(live.percent)}
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

          <UiPanel title={running ? "Durchsatz, letzte Minute" : "Durchsatz im letzten Lauf"} aside={peak > 0 ? `Spitze ${formatRate(peak)}` : undefined}>
            <div className="h-16">
              {curve.length > 1 ? (
                <UiSparkline values={curve} slots={running ? 60 : undefined} label="Durchsatz" />
              ) : (
                <span className="text-xs text-ink-faint">Noch keine Messwerte. Die Kurve entsteht beim nächsten Lauf.</span>
              )}
            </div>
          </UiPanel>

          <div className="grid grid-cols-4 gap-4">
            <UiStat label="Neu" value={formatCount(counts.created)} tone={counts.created > 0 ? "ok" : "ink"} />
            <UiStat label="Geändert" value={formatCount(counts.changed)} tone={counts.changed > 0 ? "accent" : "ink"} />
            <UiStat label="Gelöscht" value={formatCount(counts.deleted)} tone={counts.deleted > 0 ? "danger" : "ink"} />
            <UiStat
              label={running ? "Dateien/s" : "Gespart"}
              value={running ? formatCount(Math.round(live.filesPerSecond)) : saved === null ? "–" : formatPercent(saved, saved > 99 ? 2 : 0)}
              detail={!running && last ? `von ${formatBytes(last.sourceBytes)} nicht übertragen` : undefined}
            />
          </div>
        </div>
      </div>

      {running && live.recentPaths.length > 0 ? (
        <UiPanel title="Zuletzt übertragen">
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
        <UiPanel title="Änderungen, letzte 30 Tage" aside={formatBytes(lastThirty)}>
          <div className="h-20">
            <UiBars
              label="Geänderte Daten pro Tag"
              bars={(stats?.daily ?? []).map((day) => ({
                key: day.day,
                value: day.bytes,
                highlight: day.day === todayKey && day.bytes > 0,
                title: `${formatDay(day.day)}: ${formatBytes(day.bytes)}, ${formatCount(day.files)} Dateien, ${day.runs} Läufe`,
              }))}
            />
          </div>
        </UiPanel>

        <UiPanel title="Ändert sich am meisten" aside="7 Tage">
          {stats && stats.topFolders.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {stats.topFolders.map((folder) => (
                <li key={folder.folder} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate font-mono text-ink">{folder.folder === "." ? "(oberste Ebene)" : folder.folder}</span>
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
            <span className="text-xs text-ink-faint">Noch keine Änderungen aufgezeichnet.</span>
          )}
        </UiPanel>

        <UiPanel title="Gesamt bewegt" aside={stats ? `${formatCount(stats.totals.runs)} Läufe` : undefined}>
          <div className="flex items-end justify-between gap-4">
            <UiCounter value={stats?.totals.files ?? 0} digits={6} />
            <div className="flex flex-col items-end">
              <span className="text-lg font-semibold tabular">{formatBytes(stats?.totals.bytes ?? 0)}</span>
              <span className="text-[0.6875rem] text-ink-faint">≈ {formatReels(stats?.totals.bytes ?? 0)} Magnetband</span>
            </div>
          </div>
        </UiPanel>

        <UiPanel title="Zuverlässigkeit">
          <div className="grid grid-cols-3 gap-4">
            <UiStat label="Serie" value={formatCount(stats?.streak ?? 0)} detail="ohne Fehler" size="md" />
            <UiStat
              label="Erfolgreich"
              value={stats && stats.runsTotal > 0 ? `${stats.runsCompleted}/${stats.runsTotal}` : "–"}
              size="md"
            />
            <UiStat label="Ø Dauer" value={stats?.averageSeconds ? formatDuration(stats.averageSeconds) : "–"} detail="30 Tage" size="md" />
          </div>
        </UiPanel>
      </div>

      {latest ? (
        <span className="text-[0.6875rem] text-ink-faint">
          Letzter Lauf: {statusLabel[latest.status]} · {formatRelative(latest.startedAt, now)}
          {durationSeconds(latest) !== null ? ` · ${formatDuration(durationSeconds(latest) ?? 0)}` : ""}
        </span>
      ) : null}
    </div>
  );
}
