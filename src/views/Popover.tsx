import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { clearError, useClonq, useNow } from "../hooks/useClonq";
import { useHotkeys } from "../hooks/useHotkeys";
import { api } from "../lib/api";
import { formatBytes } from "../lib/format";
import { endpointLabel, messageLabel } from "../lib/labels";
import { isRemote, isRunning, jobActions, jobLine } from "../lib/jobs";
import { UiActionBar, UiActionPanel, UiButton, UiEmpty, UiKbd, UiListRow, UiNotice, UiReel, UiSearchField } from "../ui";
import { ringOf } from "../ui/rings";
import { toneText } from "../ui/tone";
import { actionsFor } from "./jobActions";
import { overallSummary } from "./summary";
import { Disc3, ShieldAlert } from "lucide-react";

export function Popover() {
  const state = useClonq();
  const now = useNow();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const jobs = useMemo(() => {
    const all = (state.config?.jobs ?? []).map((job, index) => ({ job, index }));
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(({ job }) => `${job.name} ${endpointLabel(job.source)} ${endpointLabel(job.target)}`.toLowerCase().includes(needle));
  }, [state.config, query]);

  const current = jobs[Math.min(selected, Math.max(jobs.length - 1, 0))];
  const job = current?.job;
  const live = job ? state.live[job.id] : undefined;
  const latest = job ? state.latest[job.id] : undefined;
  const running = isRunning(live);

  // Every time the popover comes up, it starts clean with the cursor in the search.
  useEffect(() => {
    const window = getCurrentWindow();
    const unlisten = window.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        setActionsOpen(false);
        search.current?.focus();
      } else {
        setQuery("");
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useHotkeys(
    {
      "mod+k": () => setActionsOpen((open) => !open),
      "mod+Enter": () => job && !running && !isRemote(job) && void jobActions.dryRun(job.id),
      "mod+.": () => job && running && void jobActions.cancel(job.id),
      "mod+o": () => job && void api.openMainWindow(job.id),
    },
    !actionsOpen,
  );

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, jobs.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && !event.metaKey) {
      event.preventDefault();
      if (job && !running && !isRemote(job)) void jobActions.run(job.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else void getCurrentWindow().hide();
    }
  };

  const summary = overallSummary(state);
  const today = state.overview?.todayBytes ?? 0;

  return (
    <div className="relative flex h-full flex-col bg-canvas text-ink">
      <UiSearchField ref={search} value={query} onChange={(value) => { setQuery(value); setSelected(0); }} placeholder="Job suchen oder starten …" onKeyDown={onSearchKey} autoFocus />
      <div className="hairline-t" />

      {state.error ? (
        <div className="px-2 pt-2">
          <UiNotice tone="danger" onDismiss={clearError}>
            {state.error}
          </UiNotice>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" role="listbox" aria-label="Jobs">
        <div className="px-2.5 pt-1 pb-1.5 text-[0.6875rem] font-medium text-ink-faint">Jobs</div>
        {jobs.length === 0 ? (
          <UiEmpty icon={Disc3} title={query ? "Kein Job passt" : "Noch keine Jobs"} />
        ) : (
          jobs.map(({ job: rowJob, index }, position) => {
            const rowLive = state.live[rowJob.id];
            const rowRunning = isRunning(rowLive);
            const line = jobLine(rowJob, rowLive, state.latest[rowJob.id], now);
            const isSelected = position === selected;
            return (
              <UiListRow
                key={rowJob.id}
                selected={isSelected}
                onPress={() => setSelected(position)}
                onHover={() => setSelected(position)}
                dimmed={isRemote(rowJob)}
                leading={<UiReel ring={ringOf(rowJob.ring, index)} spinning={rowRunning} fill={rowRunning ? 0.35 + (rowLive.percent / 100) * 0.55 : 0.8} />}
                title={rowJob.name}
                subtitle={`${endpointLabel(rowJob.source)} → ${endpointLabel(rowJob.target)}`}
                progress={rowRunning ? (rowLive.phase === "checking" ? null : rowLive.percent) : undefined}
                accessory={
                  <>
                    <span className={toneText[line.tone]}>{line.text}</span>
                    {isSelected && !rowRunning && !isRemote(rowJob) ? <UiKbd keys={["↵"]} /> : null}
                  </>
                }
              />
            );
          })
        )}
        {job && latest?.message && !running && latest.status !== "succeeded" ? (
          <div className="px-1 pt-2">
            <UiNotice
              tone={latest.status === "failed" ? "danger" : "warn"}
              actions={
                latest.status === "blocked" && !isRemote(job) ? (
                  <UiButton variant="danger" icon={ShieldAlert} onPress={() => void jobActions.force(job.id)}>
                    Trotzdem ausführen
                  </UiButton>
                ) : undefined
              }
            >
              {messageLabel(latest.message)}
            </UiNotice>
          </div>
        ) : null}
      </div>

      <UiActionBar
        status={
          <>
            <span className={`size-1.5 shrink-0 rounded-full bg-current ${toneText[summary.tone]}`} />
            <span className="truncate" title={summary.text}>
              {summary.short}
              {today > 0 ? ` · heute ${formatBytes(today)}` : ""}
            </span>
          </>
        }
        primary={
          job
            ? running
              ? { label: "Abbrechen", keys: ["⌘", "."], onPress: () => void jobActions.cancel(job.id) }
              : { label: "Jetzt syncen", keys: ["↵"], onPress: () => void jobActions.run(job.id), disabled: isRemote(job) }
            : undefined
        }
        secondary={{ label: "Aktionen", keys: ["⌘", "K"], onPress: () => setActionsOpen(true), disabled: !job }}
      />

      {job ? (
        <UiActionPanel
          open={actionsOpen}
          title={job.name}
          actions={actionsFor(job, live, latest, true)}
          onClose={() => {
            setActionsOpen(false);
            search.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
