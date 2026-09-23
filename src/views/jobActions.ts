import { FlaskConical, PanelRight, Play, ShieldAlert, Square } from "lucide-react";
import { api } from "../lib/api";
import { isRunning, jobActions } from "../lib/jobs";
import type { Job, LiveRun, Run } from "../lib/types";
import type { UiAction } from "../ui";

/** Everything one can do with a job, in the order the ⌘K panel lists it. */
export function actionsFor(job: Job, live: LiveRun | undefined, latest: Run | undefined, ready: boolean, withDetails: boolean): UiAction[] {
  const running = isRunning(live);
  const remote = !ready;
  const blocked = !running && latest?.status === "blocked";
  const actions: UiAction[] = [
    { id: "run", title: "Jetzt syncen", icon: Play, keys: ["↵"], disabled: running || remote, run: () => void jobActions.run(job.id) },
    { id: "dry", title: "Probelauf", icon: FlaskConical, keys: ["⌘", "↵"], disabled: running || remote, run: () => void jobActions.dryRun(job.id) },
    { id: "cancel", title: "Abbrechen", icon: Square, keys: ["⌘", "."], tone: "danger", disabled: !running, run: () => void jobActions.cancel(job.id) },
    {
      id: "force",
      title: "Trotzdem ausführen",
      icon: ShieldAlert,
      tone: "danger",
      disabled: !blocked || remote,
      run: () => void jobActions.force(job.id),
    },
  ];
  if (withDetails) {
    actions.push({ id: "details", title: "Details öffnen", icon: PanelRight, keys: ["⌘", "O"], run: () => void api.openMainWindow(job.id) });
  }
  return actions;
}
