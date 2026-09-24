import { CircleAlert, FileMinus, FilePen, FilePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClonqState } from "../hooks/useClonq";
import { api } from "../lib/api";
import { formatBytes, formatCount, formatDateTime, formatDuration } from "../lib/format";
import { messageLabel, statusLabel, statusTone } from "../lib/labels";
import { durationSeconds } from "../lib/runs";
import type { EntryKind, RunEntry } from "../lib/types";
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

const kindIcon: Record<EntryKind, LucideIcon> = { new: FilePlus, changed: FilePen, deleted: FileMinus, error: CircleAlert };
const kindTone: Record<EntryKind, Tone> = { new: "ok", changed: "accent", deleted: "danger", error: "danger" };

const triggerLabel: Record<string, string> = {
  manual: "per Knopf",
  schedule: "nach Zeitplan",
  daily: "täglich",
  mount: "beim Anstecken",
  change: "nach einer Änderung",
  chain: "nach einem anderen Job",
};

/** Everything one run did, file by file; for a dry run, everything it would do. */
export function RunSheet({ open, runId, state, onClose }: RunSheetProps) {
  const run = state.recent.find((item) => item.id === runId);
  const job = state.config?.jobs.find((item) => item.id === run?.jobId);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<RunEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
  }, [open, runId, filter, query]);

  const loadMore = () => {
    if (!runId) return;
    api
      .runEntries(runId, filter === "all" ? null : filter, query, entries.length, PAGE)
      .then((page) => setEntries((before) => [...before, ...page.entries]))
      .catch((reason) => setError(String(reason)));
  };

  const would = run?.dryRun ?? false;
  const filters: UiSegment<Filter>[] = [
    { value: "all", label: "Alle" },
    { value: "new", label: would ? "Würde neu" : "Neu" },
    { value: "changed", label: would ? "Würde ändern" : "Geändert" },
    { value: "deleted", label: would ? "Würde löschen" : "Gelöscht" },
    { value: "error", label: "Fehler" },
  ];
  const seconds = run ? durationSeconds(run) : null;

  return (
    <UiSheet
      open={open}
      title={`${job?.name ?? "Lauf"}${would ? " · Probelauf" : ""}`}
      subtitle={run ? `${formatDateTime(run.startedAt)} · ${triggerLabel[run.trigger] ?? run.trigger}${seconds !== null ? ` · ${formatDuration(seconds)}` : ""}` : undefined}
      onClose={onClose}
    >
      {run ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <UiBadge tone={statusTone[run.status]}>{statusLabel(run.status)}</UiBadge>
            {would ? <UiBadge tone="accent">Nichts wurde verändert</UiBadge> : null}
          </div>
          {run.message ? <UiNotice tone={run.status === "failed" ? "danger" : "warn"}>{messageLabel(run.message)}</UiNotice> : null}
          <div className="grid grid-cols-4 gap-4">
            <UiStat size="md" label={would ? "Würde neu" : "Neu"} value={formatCount(run.filesNew)} tone={run.filesNew > 0 ? "ok" : "ink"} />
            <UiStat size="md" label={would ? "Würde ändern" : "Geändert"} value={formatCount(run.filesChanged)} tone={run.filesChanged > 0 ? "accent" : "ink"} />
            <UiStat size="md" label={would ? "Würde löschen" : "Gelöscht"} value={formatCount(run.filesDeleted)} tone={run.filesDeleted > 0 ? "danger" : "ink"} />
            <UiStat size="md" label="Menge" value={formatBytes(run.bytesNew + run.bytesChanged)} />
          </div>
          <div className="flex items-center gap-3">
            <UiSegmented label="Filter" segments={filters} value={filter} onChange={setFilter} />
            <div className="flex-1">
              <UiInput value={query} onChange={setQuery} placeholder="Pfad suchen …" />
            </div>
          </div>
          {error ? <UiNotice tone="danger">{messageLabel(error)}</UiNotice> : null}
          <ul className="hairline flex flex-col overflow-hidden rounded-[var(--radius-panel)] bg-well">
            {entries.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-ink-faint">{query || filter !== "all" ? "Nichts passt zum Filter." : "Dieser Lauf hat keine Dateien bewegt."}</li>
            ) : (
              entries.map((entry, index) => {
                const Icon = kindIcon[entry.kind];
                return (
                  <li key={`${index}-${entry.path}`} className="hairline-b flex items-center gap-2.5 px-3 py-1.5 last:border-b-0">
                    <Icon className={`size-3.5 shrink-0 ${toneText[kindTone[entry.kind]]}`} strokeWidth={2.1} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ink" title={entry.path}>
                      {entry.path}
                    </span>
                    {entry.size !== null ? <span className="shrink-0 text-[0.6875rem] text-ink-faint tabular">{formatBytes(entry.size)}</span> : null}
                  </li>
                );
              })
            )}
          </ul>
          <div className="flex items-center justify-between">
            <span className="text-[0.6875rem] text-ink-faint tabular">
              {formatCount(entries.length)} von {formatCount(total)} Einträgen
            </span>
            {entries.length < total ? (
              <UiButton variant="ghost" onPress={loadMore}>
                Weitere laden
              </UiButton>
            ) : null}
          </div>
        </div>
      ) : (
        <span className="text-xs text-ink-faint">Dieser Lauf ist nicht mehr im Verlauf.</span>
      )}
    </UiSheet>
  );
}
