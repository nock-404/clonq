// Mirrors the Rust types that cross the bridge (serde, camelCase).

export type Mode = "mirror" | "backup" | "blind" | "bidirectional";

export type Endpoint =
  | { kind: "local"; path: string }
  | { kind: "remote"; host: string; path: string };

export interface Safety {
  maxDeletePercent: number;
  alwaysAllowedDeletions: number;
}

export interface Job {
  id: string;
  name: string;
  enabled: boolean;
  source: Endpoint;
  target: Endpoint;
  mode: Mode;
  excludes: string[];
  safety: Safety;
}

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  user: string;
  identityFile: string | null;
}

export interface Config {
  version: number;
  rsyncPath: string;
  hosts: Host[];
  jobs: Job[];
}

export type RunStatus = "running" | "succeeded" | "partial" | "blocked" | "failed" | "cancelled";

export type Phase = "checking" | "transferring" | "finished";

export interface LiveRun {
  runId: string;
  jobId: string;
  dryRun: boolean;
  phase: Phase;
  percent: number;
  bytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  filesDone: number;
  filesTotal: number | null;
  filesDeleted: number;
  currentPath: string | null;
  status: RunStatus | null;
  message: string | null;
}

export interface Run {
  id: string;
  jobId: string;
  trigger: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  filesTotal: number;
  filesTransferred: number;
  filesDeleted: number;
  bytesTransferred: number;
  targetEntries: number;
  exitCode: number | null;
  message: string | null;
  logPath: string;
}
