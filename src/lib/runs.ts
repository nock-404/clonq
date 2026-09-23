import type { Run } from "./types";

/** Newest dry run per job, from a list sorted newest first. */
export function lastDryRunByJob(runs: Run[]): Record<string, Run> {
  const result: Record<string, Run> = {};
  for (const run of runs) {
    if (run.dryRun && !result[run.jobId]) result[run.jobId] = run;
  }
  return result;
}
