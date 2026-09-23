import { Clock, LayoutGrid, Settings2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { clearError, useClonq, useNow } from "../hooks/useClonq";
import { api } from "../lib/api";
import { isRunning } from "../lib/jobs";
import { UiNavItem, UiNotice, UiReel } from "../ui";
import { ringOf } from "../ui/rings";
import { toneText } from "../ui/tone";
import { HistoryView } from "./HistoryView";
import { JobDetail } from "./JobDetail";
import { OverviewView } from "./OverviewView";
import { SettingsView } from "./SettingsView";
import { overallSummary } from "./summary";

type Section = { kind: "overview" } | { kind: "job"; jobId: string } | { kind: "history" } | { kind: "settings" };

export function MainWindow() {
  const state = useClonq();
  const now = useNow();
  const [section, setSection] = useState<Section>({ kind: "overview" });
  const jobs = state.config?.jobs ?? [];
  const summary = overallSummary(state);

  useEffect(() => {
    const unlisten = api.onShowJob((jobId) => setSection({ kind: "job", jobId }));
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const jobIndex = section.kind === "job" ? jobs.findIndex((job) => job.id === section.jobId) : -1;
  const job = jobIndex >= 0 ? jobs[jobIndex] : undefined;
  const key = section.kind === "job" ? `job-${section.jobId}` : section.kind;

  return (
    <div className="flex h-full bg-canvas text-ink">
      <aside className="hairline-r flex w-60 shrink-0 flex-col gap-0.5 bg-well px-2.5 pt-12 pb-3" data-tauri-drag-region>
        <UiNavItem icon={LayoutGrid} label="Übersicht" active={section.kind === "overview"} onPress={() => setSection({ kind: "overview" })} />
        <div className="px-2 pt-4 pb-1.5 text-[0.6875rem] font-medium text-ink-faint">Jobs</div>
        {jobs.map((item, index) => (
          <UiNavItem
            key={item.id}
            leading={<UiReel size="xs" ring={ringOf(item.ring, index)} spinning={isRunning(state.live[item.id])} />}
            label={item.name}
            active={section.kind === "job" && section.jobId === item.id}
            onPress={() => setSection({ kind: "job", jobId: item.id })}
          />
        ))}
        <div className="pt-4" />
        <UiNavItem icon={Clock} label="Verlauf" active={section.kind === "history"} onPress={() => setSection({ kind: "history" })} count={state.recent.length} />
        <UiNavItem icon={Settings2} label="Einstellungen" active={section.kind === "settings"} onPress={() => setSection({ kind: "settings" })} />
        <div className="mt-auto flex items-center gap-2 px-2 text-xs text-ink-soft">
          <span className={`size-1.5 rounded-full bg-current ${toneText[summary.tone]}`} />
          {summary.text}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="h-10 shrink-0" data-tauri-drag-region />
        {state.error ? (
          <div className="px-8 pb-2">
            <UiNotice tone="danger" onDismiss={clearError}>
              {state.error}
            </UiNotice>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="mx-auto max-w-5xl"
            >
              {section.kind === "overview" ? (
                <OverviewView state={state} now={now} onOpenJob={(jobId) => setSection({ kind: "job", jobId })} />
              ) : null}
              {section.kind === "job" && job ? <JobDetail state={state} job={job} index={jobIndex} now={now} /> : null}
              {section.kind === "history" ? <HistoryView state={state} /> : null}
              {section.kind === "settings" ? <SettingsView state={state} /> : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
