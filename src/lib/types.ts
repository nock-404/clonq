// Mirrors the Rust types that cross the bridge (serde, camelCase).

export type Mode = "mirror" | "backup" | "blind" | "bidirectional";

export type Accent = "ring" | "amber" | "blue";

export type Ring = "red" | "yellow" | "blue" | "green" | "white";

export interface UiSettings {
  accent: Accent;
  lamps: boolean;
}

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
  ring: Ring | null;
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
  ui: UiSettings;
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
  filesNew: number;
  filesChanged: number;
  filesPerSecond: number;
  /** Bytes per second, one value per second, oldest first. */
  throughput: number[];
  /** Newest first. */
  recentPaths: string[];
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
  filesNew: number;
  filesChanged: number;
  filesDeleted: number;
  bytesTransferred: number;
  bytesNew: number;
  bytesChanged: number;
  sourceBytes: number;
  literalBytes: number;
  matchedBytes: number;
  wireBytes: number;
  targetEntries: number;
  exitCode: number | null;
  message: string | null;
  logPath: string;
}

/** Milliseconds since start, bytes so far, files so far. */
export type Sample = [number, number, number];

export interface FolderChange {
  folder: string;
  files: number;
  bytes: number;
}

export interface RunDetail extends Run {
  samples: Sample[];
  folders: FolderChange[];
}

export interface Totals {
  runs: number;
  files: number;
  bytes: number;
  wireBytes: number;
  deleted: number;
}

export interface DayChange {
  day: string;
  bytes: number;
  files: number;
  runs: number;
}

export interface JobStats {
  jobId: string;
  lastSuccessAt: string | null;
  streak: number;
  runsTotal: number;
  runsCompleted: number;
  averageSeconds: number | null;
  last: RunDetail | null;
  daily: DayChange[];
  topFolders: FolderChange[];
  totals: Totals;
}

export interface Overview {
  totals: Totals;
  todayBytes: number;
  todayFiles: number;
  todayRuns: number;
}
