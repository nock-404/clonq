import type { ClonqState } from "../hooks/useClonq";
import { useT } from "../i18n";
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
  const t = useT();
  const o = t.shell.overview;
  const overview = state.overview;
  const jobs = state.config?.jobs ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">{o.title}</h1>
      <div className="grid grid-cols-3 gap-4">
        <UiPanel title={o.today}>
          <UiStat
            label={o.data}
            value={formatBytes(overview?.todayBytes ?? 0)}
            detail={o.todayDetail(formatReels(overview?.todayBytes ?? 0), overview?.todayRuns ?? 0, formatCount(overview?.todayRuns ?? 0))}
          />
        </UiPanel>
        <UiPanel title={o.totalFiles}>
          <UiCounter value={overview?.totals.files ?? 0} digits={7} />
        </UiPanel>
        <UiPanel title={o.totalData}>
          <UiStat label={o.newAndChanged} value={formatBytes(overview?.totals.bytes ?? 0)} detail={o.tape(formatReels(overview?.totals.bytes ?? 0))} />
        </UiPanel>
      </div>
      <UiPanel title={o.perJob}>
        <div className="flex flex-col" role="listbox" aria-label={t.shell.nav.jobs}>
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
                subtitle={stats ? o.jobLine(stats.streak, formatBytes(stats.totals.bytes)) : undefined}
                accessory={<span className={toneText[freshnessTone(at, now)]}>{at ? formatRelative(at, now) : t.common.never}</span>}
              />
            );
          })}
        </div>
      </UiPanel>
    </div>
  );
}
