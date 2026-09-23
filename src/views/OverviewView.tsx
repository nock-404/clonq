import type { ClonqState } from "../hooks/useClonq";
import { formatBytes, formatCount, formatReels, formatRelative } from "../lib/format";
import { isRunning } from "../lib/jobs";
import { UiCounter, UiListRow, UiPanel, UiReel, UiStat, freshnessTone } from "../ui";
import { ringOf } from "../ui/rings";
import { toneText } from "../ui/tone";

interface OverviewViewProps {
  state: ClonqState;
  now: number;
  onOpenJob: (jobId: string) => void;
}

export function OverviewView({ state, now, onOpenJob }: OverviewViewProps) {
  const overview = state.overview;
  const jobs = state.config?.jobs ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Übersicht</h1>
      <div className="grid grid-cols-3 gap-4">
        <UiPanel title="Heute bewegt">
          <UiStat label="Daten" value={formatBytes(overview?.todayBytes ?? 0)} detail={`≈ ${formatReels(overview?.todayBytes ?? 0)} · ${formatCount(overview?.todayRuns ?? 0)} Läufe`} />
        </UiPanel>
        <UiPanel title="Seit Beginn, Dateien">
          <UiCounter value={overview?.totals.files ?? 0} digits={7} />
        </UiPanel>
        <UiPanel title="Seit Beginn, Daten">
          <UiStat label="Neu und geändert" value={formatBytes(overview?.totals.bytes ?? 0)} detail={`≈ ${formatReels(overview?.totals.bytes ?? 0)} Magnetband`} />
        </UiPanel>
      </div>
      <UiPanel title="Stand pro Job">
        <div className="flex flex-col" role="listbox" aria-label="Jobs">
          {jobs.map((job, index) => {
            const stats = state.stats[job.id];
            const live = state.live[job.id];
            const at = stats?.lastSuccessAt ?? null;
            return (
              <UiListRow
                key={job.id}
                selected={false}
                onPress={() => onOpenJob(job.id)}
                leading={<UiReel ring={ringOf(job.ring, index)} spinning={isRunning(live)} />}
                title={job.name}
                subtitle={stats ? `Serie ${stats.streak} · ${formatBytes(stats.totals.bytes)} bewegt` : undefined}
                accessory={<span className={toneText[freshnessTone(at, now)]}>{at ? formatRelative(at, now) : "noch nie"}</span>}
              />
            );
          })}
        </div>
      </UiPanel>
    </div>
  );
}
