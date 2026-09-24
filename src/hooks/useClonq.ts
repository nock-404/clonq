// One store per window: config, live runs, history and stats, kept current by events.

import { useEffect, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import type { Config, JobStats, LiveRun, LocationStatus, MountedVolume, Overview, Run } from "../lib/types";
import { setLanguage } from "../i18n";
import { setReelStyle } from "../ui/reels/style";

export interface ClonqState {
  config: Config | null;
  /** Runs in progress, and finished ones for a short moment, by job id. */
  live: Record<string, LiveRun>;
  /** The newest real run of every job, by job id. */
  latest: Record<string, Run>;
  recent: Run[];
  /** Stats of every job, by job id; refreshed whenever a run ends. */
  stats: Record<string, JobStats>;
  overview: Overview | null;
  /** Reachability of every location, by location id. */
  locations: Record<string, LocationStatus>;
  /** Drives mounted right now. */
  volumes: MountedVolume[];
  /** The last finished dry run of each job, kept until it is dismissed or the next run starts. */
  dryRuns: Record<string, LiveRun>;
  error: string | null;
}

/** How long a finished run stays visible before the job shows its idle state. */
const FINISHED_LINGER_MS = 4000;
const RECENT_LIMIT = 200;

let state: ClonqState = {
  config: null,
  live: {},
  latest: {},
  recent: [],
  stats: {},
  overview: null,
  locations: {},
  volumes: [],
  dryRuns: {},
  error: null,
};
const listeners = new Set<() => void>();
let started = false;

function set(change: Partial<ClonqState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

function byJob<T extends { jobId: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.jobId, item]));
}

function applyConfig(config: Config) {
  document.documentElement.dataset.accent = config.ui.accent;
  setReelStyle(config.ui.reels);
  setLanguage(config.ui.language);
  set({ config });
  void refreshLocations();
}

/** Re-reads where every location is; cheap enough to call on any hint of change. */
export async function refreshLocations() {
  try {
    const [statuses, volumes] = await Promise.all([api.locationStatuses(), api.mountedVolumes()]);
    set({ locations: Object.fromEntries(statuses.map((status) => [status.id, status])), volumes });
  } catch (error) {
    set({ error: String(error) });
  }
}

async function refreshRuns() {
  try {
    const jobs = state.config?.jobs ?? [];
    const [latest, recent, overview, ...stats] = await Promise.all([
      api.latestRuns(),
      api.recentRuns(RECENT_LIMIT),
      api.overview(),
      ...jobs.map((job) => api.jobStats(job.id)),
    ]);
    set({ latest: byJob(latest), recent, overview, stats: byJob(stats) });
  } catch (error) {
    set({ error: String(error) });
  }
}

export function dismissDryRun(jobId: string) {
  const rest = { ...state.dryRuns };
  delete rest[jobId];
  set({ dryRuns: rest });
}

async function start() {
  if (started) return;
  started = true;
  await api.onRunUpdate((run) => {
    set({ live: { ...state.live, [run.jobId]: run } });
    // A dry run's result must outlast the short linger of the live view; a new run replaces it.
    if (run.phase === "finished" && run.dryRun) set({ dryRuns: { ...state.dryRuns, [run.jobId]: run } });
    else if (run.phase !== "finished" && state.dryRuns[run.jobId]) dismissDryRun(run.jobId);
    if (run.phase === "finished") {
      setTimeout(() => {
        const current = state.live[run.jobId];
        if (current?.runId !== run.runId) return;
        const rest = { ...state.live };
        delete rest[run.jobId];
        set({ live: rest });
      }, FINISHED_LINGER_MS);
    }
  });
  await api.onRunsChanged(() => void refreshRuns());
  await api.onConfigChanged((config) => {
    applyConfig(config);
    void refreshRuns();
  });
  await api.onVolumesChanged(() => void refreshLocations());
  await api.onServersChecked(() => void refreshLocations());
  window.addEventListener("focus", () => void refreshLocations());
  try {
    const [config, live] = await Promise.all([api.getConfig(), api.liveRuns()]);
    applyConfig(config);
    set({ live: byJob(live) });
  } catch (error) {
    set({ error: String(error) });
  }
  await refreshRuns();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useClonq(): ClonqState {
  useEffect(() => {
    void start();
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

export function reportError(error: unknown) {
  set({ error: String(error) });
}

export function clearError() {
  set({ error: null });
}

// A shared clock for "3 minutes ago" texts, ticking every 15 seconds.
let now = Date.now();
const clockListeners = new Set<() => void>();
setInterval(() => {
  now = Date.now();
  for (const listener of clockListeners) listener();
}, 15_000);

export function useNow(): number {
  return useSyncExternalStore(
    (listener) => {
      clockListeners.add(listener);
      return () => clockListeners.delete(listener);
    },
    () => now,
  );
}
