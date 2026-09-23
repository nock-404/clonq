// The only place that talks to the Rust side.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Config, JobStats, LiveRun, Overview, Run, UiSettings } from "./types";

export interface RunOptions {
  dryRun?: boolean;
  force?: boolean;
}

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  liveRuns: () => invoke<LiveRun[]>("live_runs"),
  latestRuns: () => invoke<Run[]>("latest_runs"),
  recentRuns: (limit: number) => invoke<Run[]>("recent_runs", { limit }),
  jobStats: (jobId: string) => invoke<JobStats>("job_stats", { jobId }),
  overview: () => invoke<Overview>("overview"),
  setUiSettings: (settings: UiSettings) => invoke<Config>("set_ui_settings", { settings }),
  runJob: (jobId: string, options: RunOptions = {}) =>
    invoke<string>("run_job", { jobId, dryRun: options.dryRun ?? false, force: options.force ?? false }),
  cancelJob: (jobId: string) => invoke<void>("cancel_job", { jobId }),
  openMainWindow: (jobId?: string) => invoke<void>("open_main_window", { jobId: jobId ?? null }),
  quit: () => invoke<void>("quit"),

  onRunUpdate: (handler: (run: LiveRun) => void): Promise<UnlistenFn> =>
    listen<LiveRun>("run-update", (event) => handler(event.payload)),
  onRunsChanged: (handler: () => void): Promise<UnlistenFn> => listen("runs-changed", handler),
  onShowJob: (handler: (jobId: string) => void): Promise<UnlistenFn> =>
    listen<string>("show-job", (event) => handler(event.payload)),
  onConfigChanged: (handler: (config: Config) => void): Promise<UnlistenFn> =>
    listen<Config>("config-changed", (event) => handler(event.payload)),
};
