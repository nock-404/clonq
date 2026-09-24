import { FileText, Play, X } from "lucide-react";
import { dismissDryRun } from "../hooks/useClonq";
import { useT } from "../i18n";
import { formatCount } from "../lib/format";
import { messageLabel } from "../lib/labels";
import { openSheet } from "../lib/nav";
import type { LiveRun } from "../lib/types";
import { UiButton, UiIconButton, UiStat } from "../ui";
import { jobActions } from "../lib/jobs";

interface DryRunResultProps {
  run: LiveRun;
  /** False while the job cannot run, e.g. because a location is not reachable. */
  canRun: boolean;
}

/** What the last dry run found, kept on screen until it is dismissed or the next run starts. */
export function DryRunResult({ run, canRun }: DryRunResultProps) {
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
