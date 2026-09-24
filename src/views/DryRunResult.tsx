import { FileText, Play, Wrench, X } from "lucide-react";
import { dismissDryRun } from "../hooks/useClonq";
import { useT } from "../i18n";
import { formatCount } from "../lib/format";
import { messageLabel } from "../lib/labels";
import { openSheet } from "../lib/nav";
import type { LiveRun, Mode } from "../lib/types";
import { UiButton, UiIconButton, UiStat } from "../ui";
import { jobActions } from "../lib/jobs";

interface DryRunResultProps {
  run: LiveRun;
  /** False while the job cannot run, e.g. because a location is not reachable. */
  canRun: boolean;
  mode: Mode;
}

/** What the last dry run found, kept on screen until it is dismissed or the next run starts. */
export function DryRunResult({ run, canRun, mode }: DryRunResultProps) {
  if (run.verify) return <CheckResult run={run} canRun={canRun} mode={mode} />;
  return <DryRun run={run} canRun={canRun} />;
}

function DryRun({ run, canRun }: Omit<DryRunResultProps, "mode">) {
  const t = useT().detail.dryResult;
  const failed = run.status === "failed" || run.status === "cancelled";
  const nothing = !failed && run.filesNew + run.filesChanged + run.filesDeleted === 0;
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-panel)] bg-accent-soft px-4 py-3 ring-[0.0625rem] ring-inset ring-accent/40">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.8125rem] font-medium text-ink">{t.title}</span>
          <span className="text-xs text-ink-soft">
            {failed ? (run.message ? messageLabel(run.message) : t.failed) : nothing ? t.nothing : t.summary}
          </span>
        </div>
        <UiIconButton icon={X} label={t.dismiss} onPress={() => dismissDryRun(run.jobId)} />
      </div>
      {!failed && !nothing ? (
        <div className="grid grid-cols-3 gap-4">
          <UiStat label={t.added} value={formatCount(run.filesNew)} tone={run.filesNew > 0 ? "ok" : "ink"} />
          <UiStat label={t.changed} value={formatCount(run.filesChanged)} tone={run.filesChanged > 0 ? "accent" : "ink"} />
          <UiStat label={t.deleted} value={formatCount(run.filesDeleted)} tone={run.filesDeleted > 0 ? "danger" : "ink"} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <UiButton variant="secondary" icon={FileText} onPress={() => openSheet({ kind: "run", runId: run.runId })}>
          {t.details}
        </UiButton>
        {!failed && !nothing ? (
          <UiButton variant="primary" icon={Play} disabled={!canRun} onPress={() => void jobActions.run(run.jobId)}>
            {t.run}
          </UiButton>
        ) : null}
      </div>
    </section>
  );
}

/** What the last integrity check found. */
function CheckResult({ run, canRun, mode }: DryRunResultProps) {
  const d = useT().detail;
  const t = d.check;
  const failed = run.status === "failed" || run.status === "cancelled";
  const damaged = !failed && run.filesConflicted > 0;
  const line = failed ? (run.message ? messageLabel(run.message) : t.failed) : damaged && run.message ? messageLabel(run.message) : t.intact;
  return (
    <section
      className={`flex flex-col gap-3 rounded-[var(--radius-panel)] px-4 py-3 ring-[0.0625rem] ring-inset ${damaged ? "bg-danger-soft ring-danger/40" : failed ? "bg-warn-soft ring-warn/40" : "bg-ok-soft ring-ok/40"}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.8125rem] font-medium text-ink">{t.title}</span>
          <span className="text-xs text-ink-soft">{line}</span>
          {damaged ? (
            <span className="text-xs text-ink-soft">
              {t.hint} {mode === "versioned" ? t.repairVersioned : mode === "bidirectional" ? t.repairTwoWay : t.repairOneWay}
            </span>
          ) : null}
        </div>
        <UiIconButton icon={X} label={d.dryResult.dismiss} onPress={() => dismissDryRun(run.jobId)} />
      </div>
      <div className="flex gap-2">
        <UiButton variant="secondary" icon={FileText} onPress={() => openSheet({ kind: "run", runId: run.runId })}>
          {d.dryResult.details}
        </UiButton>
        {damaged ? (
          <UiButton variant="primary" icon={Wrench} disabled={!canRun} onPress={() => void jobActions.repair(run.jobId)}>
            {t.repair}
          </UiButton>
        ) : null}
      </div>
    </section>
  );
}
