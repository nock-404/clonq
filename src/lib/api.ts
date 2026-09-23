// The only place that talks to the Rust side.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Config, LiveRun, Run } from "./types";

export interface RunOptions {
  dryRun?: boolean;
  force?: boolean;
}

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  liveRuns: () => invoke<LiveRun[]>("live_runs"),
  latestRuns: () => invoke<Run[]>("latest_runs"),
  recentRuns: (limit: number) => invoke<Run[]>("recent_runs", { limit }),
  runJob: (jobId: string, options: RunOptions = {}) =>
    invoke<string>("run_job", { jobId, dryRun: options.dryRun ?? false, force: options.force ?? false }),
  cancelJob: (jobId: string) => invoke<void>("cancel_job", { jobId }),
  openMainWindow: () => invoke<void>("open_main_window"),
  quit: () => invoke<void>("quit"),

  onRunUpdate: (handler: (run: LiveRun) => void): Promise<UnlistenFn> =>
    listen<LiveRun>("run-update", (event) => handler(event.payload)),
  onRunsChanged: (handler: () => void): Promise<UnlistenFn> => listen("runs-changed", handler),
};
