import { api } from "./api";
import { texts } from "../i18n";
import { formatBytes, formatCount, formatDuration, formatPercent, formatRate, formatRelative } from "./format";
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
  const t = texts().common;
  if (isRunning(live)) {
    if (live.phase === "checking") return { text: t.job.checking, tone: "accent" };
    const parts = [formatPercent(Math.round(live.percent))];
    if (live.bytesPerSecond > 0) parts.push(formatRate(live.bytesPerSecond));
    return { text: parts.join(" · "), tone: "accent" };
  }
  if (!jobReady(job, locations).ready) return { text: t.job.unreachable, tone: "neutral" };
  if (!latest) return { text: t.never, tone: "neutral" };
  if (latest.status === "succeeded") return { text: formatRelative(latest.finishedAt ?? latest.startedAt, now), tone: "neutral" };
  return { text: statusLabel(latest.status), tone: statusTone[latest.status] };
}

export function progressLine(live: LiveRun): string {
  const t = texts().common.job;
  const parts: string[] = [];
  if (live.filesTotal !== null) parts.push(t.entries(formatCount(live.filesDone), formatCount(live.filesTotal)));
  if (live.bytes > 0) parts.push(formatBytes(live.bytes));
  if (live.etaSeconds !== null && live.etaSeconds > 0) parts.push(t.remaining(formatDuration(live.etaSeconds)));
  return parts.join(" · ");
}

export const jobActions = {
  run: (jobId: string) => api.runJob(jobId).catch(reportError),
  dryRun: (jobId: string) => api.runJob(jobId, { dryRun: true }).catch(reportError),
  force: (jobId: string) => api.runJob(jobId, { force: true }).catch(reportError),
  cancel: (jobId: string) => api.cancelJob(jobId).catch(reportError),
};
