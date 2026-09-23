import { api } from "./api";
import { formatBytes, formatDuration, formatRate, formatRelative } from "./format";
import { statusLabel, statusTone, type Tone } from "./labels";
import type { Job, LiveRun, LocationStatus, Run } from "./types";
import { reportError } from "../hooks/useClonq";

/** Whether both places of a job can be reached now, and if not, which one blocks it. */
export function jobReady(job: Job, locations: Record<string, LocationStatus>): { ready: boolean; blocker: string | null } {
  for (const place of [job.source, job.target]) {
    const reach = locations[place.location]?.reach;
    if (reach?.state !== "connected") {
      return { ready: false, blocker: place.location };
    }
  }
  return { ready: true, blocker: null };
}

export function isRunning(live: LiveRun | undefined): live is LiveRun {
  return live !== undefined && live.phase !== "finished";
}

export interface JobLine {
  text: string;
  tone: Tone;
}

/** The short status a job shows next to its name. */
export function jobLine(
  job: Job,
  live: LiveRun | undefined,
  latest: Run | undefined,
  now: number,
  locations: Record<string, LocationStatus>,
): JobLine {
  if (isRunning(live)) {
    if (live.phase === "checking") return { text: "prüft …", tone: "accent" };
    const parts = [`${Math.round(live.percent)} %`];
    if (live.bytesPerSecond > 0) parts.push(formatRate(live.bytesPerSecond));
    return { text: parts.join(" · "), tone: "accent" };
  }
  if (!jobReady(job, locations).ready) return { text: "Ort nicht erreichbar", tone: "neutral" };
  if (!latest) return { text: "noch nie", tone: "neutral" };
  if (latest.status === "succeeded") return { text: formatRelative(latest.finishedAt ?? latest.startedAt, now), tone: "neutral" };
  return { text: statusLabel[latest.status], tone: statusTone[latest.status] };
}

export function progressLine(live: LiveRun): string {
  const parts: string[] = [];
  if (live.filesTotal !== null) parts.push(`${live.filesDone.toLocaleString("de-DE")} / ${live.filesTotal.toLocaleString("de-DE")} Einträge`);
  if (live.bytes > 0) parts.push(formatBytes(live.bytes));
  if (live.etaSeconds !== null && live.etaSeconds > 0) parts.push(`noch ${formatDuration(live.etaSeconds)}`);
  return parts.join(" · ");
}

export const jobActions = {
  run: (jobId: string) => api.runJob(jobId).catch(reportError),
  dryRun: (jobId: string) => api.runJob(jobId, { dryRun: true }).catch(reportError),
  force: (jobId: string) => api.runJob(jobId, { force: true }).catch(reportError),
  cancel: (jobId: string) => api.cancelJob(jobId).catch(reportError),
};
