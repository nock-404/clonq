// Mirrors the Rust types that cross the bridge (serde, camelCase).

export type Mode = "mirror" | "backup" | "blind" | "bidirectional";

export type Accent = "ring" | "amber" | "blue";

export type Ring = "red" | "yellow" | "blue" | "green" | "white";

/** How the tape reels and the drive are drawn. */
export type Reels = "licht" | "vakuum" | "praezision";

export interface UiSettings {
  accent: Accent;
  lamps: boolean;
  /** Also announce automatic runs that went well, not only problems. */
  notifySuccess: boolean;
  reels: Reels;
}

export interface Place {
  location: string;
  /** Path inside the location; "" is the location itself. */
  path: string;
}

export type CloudProvider = "s3" | "b2" | "drive" | "onedrive" | "dropbox" | "webdav";

export type LocationKind =
  | { type: "folder"; path: string }
  | { type: "volume"; volumeUuid: string; volumeName: string }
  | { type: "ssh"; host: string; port: number; user: string; identityFile: string; basePath: string }
  /** A network share; the password lives in the macOS keychain. */
  | { type: "smb"; url: string; user: string }
  /** Cloud storage through rclone; the remote lives in clonq's own rclone config. */
  | { type: "cloud"; provider: CloudProvider; remote: string; root: string };

/** One input a cloud provider needs, e.g. an access key. */
export interface CloudField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder: string;
  hint: string | null;
}

export interface CloudProviderInfo {
  id: CloudProvider;
  label: string;
  /** True when the account is connected by signing in through the browser. */
  browserLogin: boolean;
  fields: CloudField[];
}

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
}

export interface Triggers {
  onMount: boolean;
  onChangeAfterSeconds: number | null;
  everyMinutes: number | null;
  /** Local time "HH:MM". */
  dailyAt: string | null;
  afterJob: string | null;
}

/** Deleted and overwritten files are kept in `.clonq-archiv/<time>/` on the target. */
export interface Archive {
  enabled: boolean;
  keepDays: number;
}

export type ConflictPrefer = "newer" | "older" | "larger" | "smaller" | "source" | "target" | "none";

/** Two-way jobs only: what happens when a file changed on both sides. */
export interface Conflicts {
  prefer: ConflictPrefer;
  /** "keep" renames the loser to name.conflict1, "delete" removes it (into the archive). */
  loser: "keep" | "delete";
}

export interface Safety {
  maxDeletePercent: number;
  alwaysAllowedDeletions: number;
}

export interface Job {
  id: string;
  name: string;
  enabled: boolean;
  source: Place;
  target: Place;
  mode: Mode;
  excludes: string[];
  safety: Safety;
  ring: Ring | null;
  triggers: Triggers;
  archive: Archive;
  conflicts: Conflicts;
}

export interface Config {
  version: number;
  rsyncPath: string;
  rclonePath: string;
  ui: UiSettings;
  locations: Location[];
  jobs: Job[];
}

export type Reach =
  | { state: "connected"; path: string | null; freeBytes: number | null; totalBytes: number | null }
  | { state: "disconnected" }
  | { state: "missing" }
  | { state: "untested" }
  | { state: "failed"; message: string };

export interface LocationStatus {
  id: string;
  reach: Reach;
  usedBy: string[];
}

export interface MountedVolume {
  uuid: string;
  name: string;
  mountPoint: string;
  totalBytes: number;
  freeBytes: number;
  fileSystem: string;
  internal: boolean;
}

export interface HostKey {
  /** Key type as ssh names it, e.g. "ED25519". */
  kind: string;
  /** "SHA256:…", the form `ssh-keygen -l` and most hosters print. */
  fingerprint: string;
}

export interface ServerDraft {
  locationId: string;
  publicKey: string;
  storageBox: boolean;
  /** The server's host keys; the user compares one fingerprint before any password is sent. */
  hostKeys: HostKey[];
}

export interface ServerInput {
  locationId: string;
  name: string;
  host: string;
  port: number;
  user: string;
  basePath: string;
}

export interface FolderEntry {
  name: string;
  hidden: boolean;
}

export interface JobInput {
  id: string | null;
  name: string;
  source: Place;
  target: Place;
  mode: Mode;
  excludes: string[];
  maxDeletePercent: number;
  ring: Ring | null;
  triggers: Triggers;
  enabled: boolean;
  /** Defaults to on, 30 days, when left out. */
  archive?: Archive;
  /** Defaults to newer wins, loser kept. */
  conflicts?: Conflicts;
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
  filesConflicted: number;
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
  filesConflicted: number;
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

export type EntryKind = "new" | "changed" | "deleted" | "error";

export interface RunEntry {
  kind: EntryKind;
  size: number | null;
  path: string;
}

export interface RunEntryPage {
  entries: RunEntry[];
  total: number;
}

export interface Snapshot {
  /** Folder name, e.g. "2026-09-23_14-05-09". */
  stamp: string;
  files: number;
  bytes: number;
}

export interface ArchivedFile {
  path: string;
  size: number;
}

export interface BrowseEntry {
  name: string;
  dir: boolean;
  size: number;
  modified: string | null;
}

export interface FilePreview {
  mime: string;
  text: string | null;
  base64: string | null;
}
