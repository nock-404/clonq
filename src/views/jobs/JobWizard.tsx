import type { ClonqState } from "../../hooks/useClonq";
import type { Job } from "../../lib/types";
import { UiSheet } from "../../ui";

// Placeholder; the full wizard replaces this file.

interface JobWizardProps {
  open: boolean;
  state: ClonqState;
  /** Set when an existing job is edited. */
  job?: Job;
  onClose: () => void;
  onSaved: (job: Job) => void;
}

export function JobWizard({ open, job, onClose }: JobWizardProps) {
  return (
    <UiSheet open={open} title={job ? "Job bearbeiten" : "Job anlegen"} onClose={onClose}>
      <span className="text-xs text-ink-faint">…</span>
    </UiSheet>
  );
}
