import { Pencil, Trash } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { reportError } from "../../hooks/useClonq";
import { api } from "../../lib/api";
import { messageLabel, modeLabel, placeLabel } from "../../lib/labels";
import { navigate, openSheet } from "../../lib/nav";
import type { Config, Job } from "../../lib/types";
import { UiBadge, UiButton, UiIconButton } from "../../ui";
import { UiConfirmBar } from "../../ui/UiConfirmBar";
import { UiDivider } from "../../ui/UiDivider";
import { UiToggle } from "../../ui/UiToggle";
import { hasAutomatic, inputOf, triggerWords } from "./draft";
import { showJobToast } from "./jobToast";

const fail = (error: unknown) => reportError(messageLabel(String(error)));

/** The job's triggers in words, with the switch that turns them on and off. */
function JobAutomation({ job, config }: { job: Job; config: Config | null }) {
  if (!hasAutomatic(job.triggers)) {
    return <span className="text-xs text-ink-faint">Startet nur von Hand</span>;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
      <UiToggle label="Automatik" checked={job.enabled} onChange={(enabled) => void api.setJobEnabled(job.id, enabled).catch(fail)} />
      <span className={`text-xs ${job.enabled ? "text-ink-faint" : "text-ink-faint/60"}`}>{triggerWords(job.triggers, config).join(", ")}</span>
    </div>
  );
}

interface JobHeaderProps {
  job: Job;
  config: Config | null;
  running: boolean;
  /** The run buttons, on the right. */
  children: ReactNode;
}

/** Name, places and triggers of a job, with edit, delete and the run buttons. Deleting asks once, in place. */
export function JobHeader({ job, config, running, children }: JobHeaderProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteJob(job.id);
      navigate({ kind: "overview" });
      showJobToast({
        text: `„${job.name}“ ist gelöscht.`,
        duration: 8000,
        action: {
          label: "Rückgängig",
          onPress: () =>
            void api
              .saveJob(inputOf(job))
              .then((saved) => navigate({ kind: "job", jobId: saved.id }))
              .catch(fail),
        },
      });
    } catch (error) {
      fail(error);
      setBusy(false);
      setConfirming(false);
    }
  };

  // Enter on a focused control in the header belongs to that control, not to the run it starts elsewhere in this view.
  const keepEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && event.target instanceof Element && event.target.closest("button, [role=switch]")) event.stopPropagation();
  };

  return (
    <header className="flex flex-col gap-3" onKeyDown={keepEnter}>
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="line-clamp-2 min-w-0 text-xl font-semibold tracking-tight break-words">{job.name}</h1>
            <UiBadge>{modeLabel(job.mode)}</UiBadge>
          </div>
          <span className="text-xs break-words text-ink-faint">
            {placeLabel(job.source, config)} → {placeLabel(job.target, config)}
          </span>
          <JobAutomation job={job} config={config} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <UiButton variant="ghost" icon={Pencil} onPress={() => openSheet({ kind: "jobWizard", jobId: job.id })}>
            Bearbeiten
          </UiButton>
          <UiIconButton
            icon={Trash}
            label={running ? "Während eines Laufs lässt sich der Job nicht löschen" : "Job löschen"}
            disabled={running}
            onPress={() => setConfirming(true)}
          />
          <UiDivider />
          <div className="flex items-center gap-2">{children}</div>
        </div>
      </div>
      {confirming ? (
        <UiConfirmBar
          title={`„${job.name}“ löschen?`}
          cancelLabel="Behalten"
          confirmLabel="Job löschen"
          confirmIcon={Trash}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
        >
          Die Dateien in Quelle und Ziel bleiben unberührt, die bisherigen Läufe bleiben im Verlauf. Gelöscht werden nur die Einstellungen des Jobs.
        </UiConfirmBar>
      ) : null}
    </header>
  );
}
