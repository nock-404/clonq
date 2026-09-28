import { CircleAlert, FileMinus, FilePen, FilePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClonqState } from "../hooks/useClonq";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { formatBytes, formatCount, formatDateTime, formatDuration } from "../lib/format";
import { locationOf, messageLabel, statusLabel, statusTone } from "../lib/labels";
import { durationSeconds } from "../lib/runs";
import type { EntryKind, PlannedDeletion, RunEntry } from "../lib/types";
import { UiBadge, UiButton, UiInput, UiNotice, UiSegmented, UiSheet, UiStat, type UiSegment } from "../ui";
import { toneText } from "../ui/tone";
import type { Tone } from "../lib/labels";

interface RunSheetProps {
  open: boolean;
  runId: string | null;
  state: ClonqState;
  onClose: () => void;
}

type Filter = "all" | EntryKind;

const PAGE = 300;
/** How often the sheet rereads the log of a run that is still going. */
const FOLLOW_MS = 2000;

const kindIcon: Record<EntryKind, LucideIcon> = { new: FilePlus, changed: FilePen, deleted: FileMinus, planned: FileMinus, error: CircleAlert };
const kindTone: Record<EntryKind, Tone> = { new: "ok", changed: "accent", deleted: "danger", planned: "warn", error: "danger" };

/** Everything one run did, file by file; for a dry run, everything it would do. */
export function RunSheet({ open, runId, state, onClose }: RunSheetProps) {
  const run = state.recent.find((item) => item.id === runId);
  const job = state.config?.jobs.find((item) => item.id === run?.jobId);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<RunEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<PlannedDeletion[]>([]);
  const [tick, setTick] = useState(0);
  const t = useT();
  const r = t.detail.run;
  const c = t.detail.counts;
  const triggers: Record<string, string> = r.triggers;
  const running = run?.status === "running";
  const blocked = run?.status === "blocked";

  // A running run writes its log as it goes; the sheet follows it.
  useEffect(() => {
    if (!open || !running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), FOLLOW_MS);
    return () => window.clearInterval(timer);
  }, [open, running]);

  // A run the safety rule stopped deleted nothing; what it would have deleted is kept per folder.
  useEffect(() => {
    if (!open || !runId || !blocked) {
      setPlanned([]);
      return;
    }
    let current = true;
    api.plannedDeletions(runId).then((list) => current && setPlanned(list), () => undefined);
    return () => {
      current = false;
    };
  }, [open, runId, blocked]);

  useEffect(() => {
    if (!open || !runId) return;
    let current = true;
    api
      .runEntries(runId, filter === "all" ? null : filter, query, 0, PAGE)
      .then((page) => {
        if (!current) return;
        setEntries(page.entries);
        setTotal(page.total);
        setError(null);
      })
      .catch((reason) => current && setError(String(reason)));
    return () => {
      current = false;
    };
  }, [open, runId, filter, query, tick]);

  const loadMore = () => {
    if (!runId) return;
    api
      .runEntries(runId, filter === "all" ? null : filter, query, entries.length, PAGE)
      .then((page) => setEntries((before) => [...before, ...page.entries]))
      .catch((reason) => setError(String(reason)));
  };

  const would = run?.dryRun ?? false;
  const filters: UiSegment<Filter>[] = [
    { value: "all", label: r.all },
    { value: "new", label: would ? c.wouldCreate : c.created },
    { value: "changed", label: would ? c.wouldChange : c.changed },
    blocked ? { value: "planned", label: c.wouldDelete } : { value: "deleted", label: would ? c.wouldDelete : c.deleted },
    { value: "error", label: r.errors },
  ];
  const seconds = run ? durationSeconds(run) : null;
  const sideName = (onTarget: boolean) => (job ? (locationOf(onTarget ? job.target : job.source, state.config)?.name ?? "") : "");

  return (
    <UiSheet
      open={open}
      title={`${job?.name ?? r.fallbackTitle}${would ? r.dryRunSuffix : ""}`}
      subtitle={run ? `${formatDateTime(run.startedAt)} · ${triggers[run.trigger] ?? run.trigger}${seconds !== null ? ` · ${formatDuration(seconds)}` : ""}` : undefined}
      onClose={onClose}
    >
      {run ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <UiBadge tone={statusTone[run.status]}>{statusLabel(run.status)}</UiBadge>
            {would ? <UiBadge tone="accent">{r.nothingChanged}</UiBadge> : null}
          </div>
          {run.message ? (
            <UiNotice tone={run.status === "failed" ? "danger" : "warn"}>
              {messageLabel(run.message)}
              {planned.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {planned.map((item) => (
                    <li key={`${item.onTarget}:${item.folder}`} className="text-xs">
                      {t.detail.job.blockedDeletes(item.files, formatCount(item.files), sideName(item.onTarget))}{" "}
                      <span className="font-mono">{item.folder || t.detail.job.blockedTopLevel}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </UiNotice>
          ) : null}
          <div className="grid grid-cols-4 gap-4">
            <UiStat size="md" label={would ? c.wouldCreate : c.created} value={formatCount(run.filesNew)} tone={run.filesNew > 0 ? "ok" : "ink"} />
            <UiStat size="md" label={would ? c.wouldChange : c.changed} value={formatCount(run.filesChanged)} tone={run.filesChanged > 0 ? "accent" : "ink"} />
            <UiStat size="md" label={would || blocked ? c.wouldDelete : c.deleted} value={formatCount(run.filesDeleted)} tone={run.filesDeleted > 0 ? "danger" : "ink"} />
            <UiStat size="md" label={t.detail.data} value={formatBytes(run.bytesNew + run.bytesChanged)} />
          </div>
          <div className="flex items-center gap-3">
            <UiSegmented label={r.filter} segments={filters} value={filter} onChange={setFilter} />
            <div className="flex-1">
              <UiInput value={query} onChange={setQuery} placeholder={r.search} />
            </div>
          </div>
          {error ? <UiNotice tone="danger">{messageLabel(error)}</UiNotice> : null}
          <ul className="hairline flex flex-col overflow-hidden rounded-[var(--radius-panel)] bg-well">
            {entries.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-ink-faint">{query || filter !== "all" ? r.noMatch : running ? r.noFilesYet : r.noFiles}</li>
            ) : (
              entries.map((entry, index) => {
                const Icon = kindIcon[entry.kind];
                return (
                  <li key={`${index}-${entry.path}`} className="hairline-b flex items-center gap-2.5 px-3 py-1.5 last:border-b-0">
                    <Icon className={`size-3.5 shrink-0 ${toneText[kindTone[entry.kind]]}`} strokeWidth={2.1} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ink" title={entry.path}>
                      {entry.path}
                    </span>
                    {entry.kind === "planned" ? <span className="shrink-0 text-[0.6875rem] text-ink-faint">{sideName(!entry.onSource)}</span> : null}
                    {entry.size !== null ? <span className="shrink-0 text-[0.6875rem] text-ink-faint tabular">{formatBytes(entry.size)}</span> : null}
                  </li>
                );
              })
            )}
          </ul>
          <div className="flex items-center justify-between">
            <span className="text-[0.6875rem] text-ink-faint tabular">
              {r.shown(formatCount(entries.length), formatCount(total))}
            </span>
            {entries.length < total ? (
              <UiButton variant="ghost" onPress={loadMore}>
                {r.loadMore}
              </UiButton>
            ) : null}
          </div>
        </div>
      ) : (
        <span className="text-xs text-ink-faint">{r.gone}</span>
      )}
    </UiSheet>
  );
}
