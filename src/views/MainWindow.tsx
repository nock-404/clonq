import { Clock, LayoutList } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { clearError, useClonq } from "../hooks/useClonq";
import { UiNavItem, UiNotice, UiText } from "../ui";
import { HistoryView } from "./HistoryView";
import { JobList } from "./JobList";
import { overallSummary } from "./summary";

type Section = "jobs" | "history";

const titles: Record<Section, string> = {
  jobs: "Jobs",
  history: "Verlauf",
};

export function MainWindow() {
  const state = useClonq();
  const [section, setSection] = useState<Section>("jobs");
  const summary = overallSummary(state);

  return (
    <div className="flex h-full">
      <aside className="hairline-r flex w-56 shrink-0 flex-col gap-1 bg-surface px-3 pt-14 pb-4" data-tauri-drag-region>
        <UiNavItem icon={LayoutList} label="Jobs" active={section === "jobs"} onPress={() => setSection("jobs")} count={state.config?.jobs.length} />
        <UiNavItem icon={Clock} label="Verlauf" active={section === "history"} onPress={() => setSection("history")} count={state.recent.length} />
        <div className="mt-auto px-2.5">
          <UiText variant="label" tone={summary.tone}>
            {summary.text}
          </UiText>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-end px-6 pb-2" data-tauri-drag-region>
          <UiText variant="title">{titles[section]}</UiText>
        </div>
        {state.error ? (
          <div className="px-6 pb-2">
            <UiNotice tone="danger" onDismiss={clearError}>
              {state.error}
            </UiNotice>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="mx-auto max-w-4xl"
            >
              {section === "jobs" ? <JobList state={state} /> : <HistoryView state={state} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
