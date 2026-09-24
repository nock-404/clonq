import { FlaskConical, PanelRight, Play, ShieldAlert, Square } from "lucide-react";
import { texts } from "../i18n";
import { api } from "../lib/api";
import { isRunning, jobActions } from "../lib/jobs";
import type { Job, LiveRun, Run } from "../lib/types";
import type { UiAction } from "../ui";

/** Everything one can do with a job, in the order the ⌘K panel lists it. */
export function actionsFor(job: Job, live: LiveRun | undefined, latest: Run | undefined, ready: boolean, withDetails: boolean): UiAction[] {
  const running = isRunning(live);
  const remote = !ready;
  const blocked = !running && latest?.status === "blocked";
  const t = texts();
  const actions: UiAction[] = [
    { id: "run", title: t.detail.actions.syncNow, icon: Play, keys: ["↵"], disabled: running || remote, run: () => void jobActions.run(job.id) },
    { id: "dry", title: t.detail.dryRun, icon: FlaskConical, keys: ["⌘", "↵"], disabled: running || remote, run: () => void jobActions.dryRun(job.id) },
    { id: "cancel", title: t.common.cancel, icon: Square, keys: ["⌘", "."], tone: "danger", disabled: !running, run: () => void jobActions.cancel(job.id) },
    {
      id: "force",
      title: t.detail.job.runAnyway,
      icon: ShieldAlert,
      tone: "danger",
      disabled: !blocked || remote,
      run: () => void jobActions.force(job.id),
    },
  ];
  if (withDetails) {
    actions.push({ id: "details", title: t.detail.actions.openDetails, icon: PanelRight, keys: ["⌘", "O"], run: () => void api.openMainWindow(job.id) });
  }
  return actions;
}
