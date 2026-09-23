import type { Run, Sample } from "./types";

/** Newest dry run per job, from a list sorted newest first. */
export function lastDryRunByJob(runs: Run[]): Record<string, Run> {
  const result: Record<string, Run> = {};
  for (const run of runs) {
    if (run.dryRun && !result[run.jobId]) result[run.jobId] = run;
  }
  return result;
}

/** Bytes per second between consecutive samples. */
export function ratesOf(samples: Sample[]): number[] {
  const rates: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const [t0, b0] = samples[i - 1] ?? [0, 0];
    const [t1, b1] = samples[i] ?? [0, 0];
    const seconds = (t1 - t0) / 1000;
    rates.push(seconds > 0 ? Math.max(0, (b1 - b0) / seconds) : 0);
  }
  return rates;
}

/** Share of the source that did not have to cross, in percent. */
export function savedPercent(run: Run): number | null {
  if (run.sourceBytes <= 0) return null;
  const crossed = Math.min(run.sourceBytes, run.literalBytes > 0 ? run.literalBytes : run.bytesTransferred);
  return (1 - crossed / run.sourceBytes) * 100;
}

export function durationSeconds(run: Run): number | null {
  if (!run.finishedAt) return null;
  return (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000;
}
