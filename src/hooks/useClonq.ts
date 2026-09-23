// One store per window: config, live runs and history, kept current by events.

import { useEffect, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import type { Config, LiveRun, Run } from "../lib/types";

export interface ClonqState {
  config: Config | null;
  /** Runs in progress, and finished ones for a short moment, by job id. */
  live: Record<string, LiveRun>;
  /** The newest real run of every job, by job id. */
  latest: Record<string, Run>;
  recent: Run[];
  error: string | null;
}

/** How long a finished run stays visible before the job shows its idle state. */
const FINISHED_LINGER_MS = 4000;
const RECENT_LIMIT = 200;

let state: ClonqState = { config: null, live: {}, latest: {}, recent: [], error: null };
const listeners = new Set<() => void>();
let started = false;

function set(change: Partial<ClonqState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

function byJob<T extends { jobId: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.jobId, item]));
}

async function refreshRuns() {
  try {
    const [latest, recent] = await Promise.all([api.latestRuns(), api.recentRuns(RECENT_LIMIT)]);
    set({ latest: byJob(latest), recent });
  } catch (error) {
    set({ error: String(error) });
  }
}

async function start() {
  if (started) return;
  started = true;
  await api.onRunUpdate((run) => {
    set({ live: { ...state.live, [run.jobId]: run } });
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
  try {
    const [config, live] = await Promise.all([api.getConfig(), api.liveRuns()]);
    set({ config, live: byJob(live) });
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
