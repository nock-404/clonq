// Dev-only: made-up data that exercises every state of the UI. The app itself only shows real numbers.

import type { CloudProviderInfo, Config, DayChange, JobStats, LiveRun, LocationStatus, MountedVolume, Overview, Run, RunDetail, Sample } from "../src/lib/types";

export type SceneName = "idle" | "running" | "blocked" | "failed" | "fresh" | "empty";

interface Scene {
  config: Config;
  live: LiveRun[];
  latest: Run[];
  recent: Run[];
  stats: Record<string, JobStats>;
  overview: Overview;
  locations: LocationStatus[];
  volumes: MountedVolume[];
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const triggers = { onMount: false, onChangeAfterSeconds: null, everyMinutes: null, dailyAt: null, afterJob: null };
const safety = { maxDeletePercent: 10, alwaysAllowedDeletions: 10 };

const config: Config = {
  version: 2,
  rsyncPath: "/opt/homebrew/bin/rsync",
  ui: { accent: "amber", lamps: true },
  locations: [
    { id: "desktop", name: "Schreibtisch", kind: { type: "folder", path: "/Users/matthias/Desktop" } },
    { id: "m2mini", name: "M2mini", kind: { type: "volume", volumeUuid: "53955C00-5DD6-4953-8E31-335F53043B30", volumeName: "M2mini" } },
    {
      id: "box",
      name: "Storage Box",
      kind: { type: "ssh", host: "u123456.your-storagebox.de", port: 23, user: "u123456", identityFile: "/k", basePath: "" },
    },
  ],
  jobs: [
    {
      id: "work-to-m2mini",
      name: "WORK → M2mini",
      enabled: true,
      source: { location: "desktop", path: "WORK" },
      target: { location: "m2mini", path: "WORK" },
      mode: "mirror",
      excludes: ["node_modules/"],
      safety,
      ring: "blue",
      triggers: { ...triggers, onMount: true, onChangeAfterSeconds: 60 },
    },
    {
      id: "work-to-storagebox",
      name: "WORK → Storage Box",
      enabled: true,
      source: { location: "desktop", path: "WORK" },
      target: { location: "box", path: "M2mini/WORK" },
      mode: "mirror",
      excludes: ["node_modules/"],
      safety,
      ring: "green",
      triggers: { ...triggers, everyMinutes: 60 },
    },
    {
      id: "m2mini-to-storagebox",
      name: "M2mini → Storage Box",
      enabled: false,
      source: { location: "m2mini", path: "" },
      target: { location: "box", path: "M2mini" },
      mode: "mirror",
      excludes: ["node_modules/", "/WORK/"],
      safety,
      ring: "red",
      triggers: { ...triggers, dailyAt: "02:00" },
    },
  ],
};

const connected = (id: string, path: string | null, free: number | null, total: number | null, usedBy: string[]): LocationStatus => ({
  id,
  reach: { state: "connected", path, freeBytes: free, totalBytes: total },
  usedBy,
});

const locationStatuses: LocationStatus[] = [
  connected("desktop", "/Users/matthias/Desktop", 812_000_000_000, 994_000_000_000, ["WORK → M2mini", "WORK → Storage Box"]),
  connected("m2mini", "/Volumes/M2mini", 228_900_000_000, 1_000_200_000_000, ["WORK → M2mini", "M2mini → Storage Box"]),
  { id: "box", reach: { state: "untested" }, usedBy: ["WORK → Storage Box", "M2mini → Storage Box"] },
];

const volumes: MountedVolume[] = [
  {
    uuid: "53955C00-5DD6-4953-8E31-335F53043B30",
    name: "M2mini",
    mountPoint: "/Volumes/M2mini",
    totalBytes: 1_000_200_000_000,
    freeBytes: 228_900_000_000,
    fileSystem: "apfs",
    internal: false,
  },
];

function run(partial: Partial<Run> & Pick<Run, "id" | "jobId" | "status">): Run {
  return {
    trigger: "manual",
    dryRun: false,
    startedAt: minutesAgo(33),
    finishedAt: minutesAgo(31),
    filesTotal: 184_420,
    filesTransferred: 1_214,
    filesNew: 902,
    filesChanged: 312,
    filesDeleted: 41,
    bytesTransferred: 1_480_000_000,
    bytesNew: 1_120_000_000,
    bytesChanged: 360_000_000,
    sourceBytes: 96_400_000_000,
    literalBytes: 1_480_000_000,
    matchedBytes: 0,
    wireBytes: 1_492_000_000,
    targetEntries: 184_420,
    exitCode: 0,
    message: null,
    logPath: "",
    ...partial,
  };
}

const samples: Sample[] = Array.from({ length: 90 }, (_, i) => [
  i * 1000,
  Math.round(i * 16_000_000 + Math.sin(i / 5) * 9_000_000 + i * i * 20_000),
  i * 13,
]);

const succeeded = run({ id: "r1", jobId: "work-to-m2mini", status: "succeeded" });
const blocked = run({
  id: "r2",
  jobId: "work-to-m2mini",
  status: "blocked",
  exitCode: null,
  filesDeleted: 18_300,
  message: "would delete 18300 of 18420 entries on the target (99.3 %), limit is 10 %",
});
const failed = run({
  id: "r3",
  jobId: "work-to-m2mini",
  status: "failed",
  exitCode: null,
  filesNew: 0,
  filesChanged: 0,
  filesDeleted: 0,
  bytesNew: 0,
  bytesChanged: 0,
  message: "source /Users/matthias/Desktop/WORK does not exist",
});

const detail: RunDetail = {
  ...succeeded,
  samples,
  folders: [
    { folder: "GM8/clonq", files: 412, bytes: 612_000_000 },
    { folder: "Projekte/wetterstation", files: 380, bytes: 402_000_000 },
    { folder: "GM8/matthiasg.rocks", files: 96, bytes: 210_000_000 },
    { folder: "Musik/kunde-x", files: 41, bytes: 98_000_000 },
  ],
};

const daily: DayChange[] = Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.now() - (29 - i) * 86_400_000);
  const bytes = i % 7 === 5 || i % 7 === 6 ? 0 : Math.round(200_000_000 + Math.abs(Math.sin(i * 1.7)) * 2_400_000_000);
  return { day: date.toISOString().slice(0, 10), bytes, files: Math.round(bytes / 900_000), runs: bytes > 0 ? 2 : 0 };
});

function statsFor(jobId: string, withRuns: boolean): JobStats {
  return {
    jobId,
    lastSuccessAt: withRuns ? minutesAgo(31) : null,
    streak: withRuns ? 41 : 0,
    runsTotal: withRuns ? 44 : 0,
    runsCompleted: withRuns ? 43 : 0,
    averageSeconds: withRuns ? 142 : null,
    last: withRuns ? { ...detail, jobId } : null,
    daily: withRuns ? daily : daily.map((day) => ({ ...day, bytes: 0, files: 0, runs: 0 })),
    topFolders: withRuns ? detail.folders : [],
    totals: withRuns
      ? { runs: 43, files: 2_104_380, bytes: 1_412_000_000_000, wireBytes: 1_398_000_000_000, deleted: 12_031 }
      : { runs: 0, files: 0, bytes: 0, wireBytes: 0, deleted: 0 },
  };
}

const running: LiveRun = {
  runId: "live1",
  jobId: "work-to-m2mini",
  dryRun: false,
  phase: "transferring",
  percent: 62,
  bytes: 1_240_000_000,
  bytesPerSecond: 184_000_000,
  etaSeconds: 83,
  filesDone: 11_420,
  filesTotal: 18_420,
  filesDeleted: 3,
  filesNew: 812,
  filesChanged: 204,
  filesPerSecond: 2_340,
  throughput: Array.from({ length: 42 }, (_, i) => 120_000_000 + Math.sin(i / 3) * 60_000_000 + i * 900_000),
  recentPaths: [
    "GM8/matthiasg.rocks/public/images/halftone-portrait@2x.png",
    "GM8/clonq/src/ui/ReelShape.tsx",
    "Projekte/wetterstation/docs/migration-status.md",
  ],
  currentPath: "GM8/matthiasg.rocks/public/images/halftone-portrait@2x.png",
  status: "running",
  message: null,
};

const allStats = (withRuns: boolean) =>
  Object.fromEntries(config.jobs.map((job) => [job.id, statsFor(job.id, withRuns && job.id === "work-to-m2mini")]));

const overview = (withRuns: boolean): Overview =>
  withRuns
    ? { totals: statsFor("x", true).totals, todayBytes: 3_420_000_000, todayFiles: 4_210, todayRuns: 3 }
    : { totals: { runs: 0, files: 0, bytes: 0, wireBytes: 0, deleted: 0 }, todayBytes: 0, todayFiles: 0, todayRuns: 0 };

const base = { locations: locationStatuses, volumes };
const emptyConfig: Config = { ...config, locations: [], jobs: [] };

export const scenes: Record<SceneName, Scene> = {
  empty: { config: emptyConfig, live: [], latest: [], recent: [], stats: {}, overview: overview(false), locations: [], volumes },
  fresh: { ...base, config, live: [], latest: [], recent: [], stats: allStats(false), overview: overview(false) },
  idle: { ...base, config, live: [], latest: [succeeded], recent: [succeeded, failed], stats: allStats(true), overview: overview(true) },
  running: { ...base, config, live: [running], latest: [succeeded], recent: [succeeded], stats: allStats(true), overview: overview(true) },
  blocked: { ...base, config, live: [], latest: [blocked], recent: [blocked, succeeded], stats: allStats(true), overview: overview(true) },
  failed: { ...base, config, live: [], latest: [failed], recent: [failed, blocked, succeeded], stats: allStats(true), overview: overview(true) },
};

const key = (label: string) => ({ key: label.toLowerCase().replace(/\W+/g, "_"), label, secret: false, required: true, placeholder: "", hint: null });
export const cloudProviders: CloudProviderInfo[] = [
  { id: "s3", label: "Amazon S3 und kompatible", browserLogin: false, fields: [key("Endpoint"), key("Access Key ID"), { ...key("Secret Access Key"), secret: true }, key("Bucket")] },
  { id: "b2", label: "Backblaze B2", browserLogin: false, fields: [key("Account ID"), { ...key("Application Key"), secret: true }, key("Bucket")] },
  { id: "drive", label: "Google Drive", browserLogin: true, fields: [] },
  { id: "onedrive", label: "Microsoft OneDrive", browserLogin: true, fields: [] },
  { id: "dropbox", label: "Dropbox", browserLogin: true, fields: [] },
  { id: "webdav", label: "WebDAV", browserLogin: false, fields: [key("URL"), key("Benutzer"), { ...key("Passwort"), secret: true }] },
];
