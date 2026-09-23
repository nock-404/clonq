import { Clock, LayoutGrid, Plus, Settings2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { clearError, useClonq, useNow } from "../hooks/useClonq";
import { api } from "../lib/api";
import { isRunning } from "../lib/jobs";
import { closeSheet, navigate, openSheet, useNav } from "../lib/nav";
import { reachLabel } from "../lib/labels";
import { UiIconButton, UiNavItem, UiNotice, UiReel } from "../ui";
import { UiLogo } from "../ui/UiLogo";
import { UiLocationGlyph } from "../ui/UiLocationGlyph";
import { ringOf } from "../ui/rings";
import { toneText } from "../ui/tone";
import { HistoryView } from "./HistoryView";
import { JobDetail } from "./JobDetail";
import { JobWizard } from "./jobs/JobWizard";
import { AddLocationSheet } from "./locations/AddLocationSheet";
import { LocationDetail } from "./locations/LocationDetail";
import { Onboarding } from "./Onboarding";
import { OverviewView } from "./OverviewView";
import { RunSheet } from "./RunSheet";
import { SettingsView } from "./SettingsView";
import { overallSummary } from "./summary";

export function MainWindow() {
  const state = useClonq();
  const now = useNow();
  const { section, sheet } = useNav();
  const jobs = state.config?.jobs ?? [];
  const locations = state.config?.locations ?? [];
  const summary = overallSummary(state);

  useEffect(() => {
    const unlisten = api.onShowJob((jobId) => navigate({ kind: "job", jobId }));
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const jobIndex = section.kind === "job" ? jobs.findIndex((job) => job.id === section.jobId) : -1;
  const job = jobIndex >= 0 ? jobs[jobIndex] : undefined;
  const location = section.kind === "location" ? locations.find((item) => item.id === section.locationId) : undefined;
  const key = section.kind === "job" ? `job-${section.jobId}` : section.kind === "location" ? `location-${section.locationId}` : section.kind;
  const editing = sheet?.kind === "jobWizard" && sheet.jobId ? jobs.find((item) => item.id === sheet.jobId) : undefined;
  const nothingYet = jobs.length === 0;

  return (
    <div className="relative flex h-full bg-canvas text-ink">
      <aside className="hairline-r flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto bg-well px-2.5 pt-3.5 pb-3" data-tauri-drag-region>
        {/* Level with the traffic lights, on the right; the whole strip stays a drag area. */}
        <div className="mb-2.5 flex h-8 shrink-0 justify-end pr-1.5" data-tauri-drag-region>
          <UiLogo variant="wordmark" size="md" label="clonq" />
        </div>
        <UiNavItem icon={LayoutGrid} label="Übersicht" active={section.kind === "overview"} onPress={() => navigate({ kind: "overview" })} />

        <SidebarHeading label="Jobs" onAdd={locations.length > 0 ? () => openSheet({ kind: "jobWizard" }) : undefined} addLabel="Job anlegen" />
        {jobs.map((item, index) => (
          <UiNavItem
            key={item.id}
            leading={<UiReel size="xs" ring={ringOf(item.ring, index)} spinning={isRunning(state.live[item.id])} />}
            label={item.name}
            active={section.kind === "job" && section.jobId === item.id}
            onPress={() => navigate({ kind: "job", jobId: item.id })}
          />
        ))}
        {jobs.length === 0 ? <span className="px-2 py-1 text-[0.6875rem] text-ink-faint">noch keine</span> : null}

        <SidebarHeading label="Orte" onAdd={() => openSheet({ kind: "addLocation" })} addLabel="Ort hinzufügen" />
        {locations.map((item) => {
          const reach = state.locations[item.id]?.reach;
          return (
            <UiNavItem
              key={item.id}
              leading={<UiLocationGlyph kind={item.kind.type} size="xs" connected={reach?.state === "connected"} />}
              label={item.name}
              active={section.kind === "location" && section.locationId === item.id}
              onPress={() => navigate({ kind: "location", locationId: item.id })}
              trailing={<span className={`size-1.5 rounded-full bg-current ${toneText[reachLabel(reach).tone]}`} />}
            />
          );
        })}
        {locations.length === 0 ? <span className="px-2 py-1 text-[0.6875rem] text-ink-faint">noch keine</span> : null}

        <div className="pt-4" />
        <UiNavItem icon={Clock} label="Verlauf" active={section.kind === "history"} onPress={() => navigate({ kind: "history" })} count={state.recent.length} />
        <UiNavItem icon={Settings2} label="Einstellungen" active={section.kind === "settings"} onPress={() => navigate({ kind: "settings" })} />
        <div className="mt-auto flex items-center gap-2 px-2 pt-3 text-xs text-ink-soft">
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
                nothingYet ? (
                  <Onboarding state={state} />
                ) : (
                  <OverviewView state={state} now={now} onOpenJob={(jobId) => navigate({ kind: "job", jobId })} />
                )
              ) : null}
              {section.kind === "job" && job ? <JobDetail state={state} job={job} index={jobIndex} now={now} /> : null}
              {section.kind === "location" && location ? <LocationDetail state={state} location={location} now={now} /> : null}
              {section.kind === "history" ? <HistoryView state={state} /> : null}
              {section.kind === "settings" ? <SettingsView state={state} /> : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AddLocationSheet
        open={sheet?.kind === "addLocation"}
        preset={sheet?.kind === "addLocation" ? sheet.preset : undefined}
        onClose={closeSheet}
        onAdded={(added) => {
          closeSheet();
          navigate({ kind: "location", locationId: added.id });
        }}
      />
      <RunSheet open={sheet?.kind === "run"} runId={sheet?.kind === "run" ? sheet.runId : null} state={state} onClose={closeSheet} />
      <JobWizard
        open={sheet?.kind === "jobWizard"}
        state={state}
        job={editing}
        onClose={closeSheet}
        onSaved={(saved) => {
          closeSheet();
          navigate({ kind: "job", jobId: saved.id });
        }}
      />
    </div>
  );
}

function SidebarHeading({ label, onAdd, addLabel }: { label: string; onAdd?: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between px-2 pt-4 pb-1">
      <span className="text-[0.6875rem] font-medium text-ink-faint">{label}</span>
      {onAdd ? <UiIconButton icon={Plus} label={addLabel} onPress={onAdd} /> : null}
    </div>
  );
}
