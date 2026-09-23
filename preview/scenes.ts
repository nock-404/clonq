// Dev-only: made-up data that exercises every state of the UI. The app itself only shows real numbers.

import type { CloudProviderInfo, Config, DayChange, JobStats, LiveRun, LocationStatus, MountedVolume, Overview, Reels, Run, RunDetail, Sample } from "../src/lib/types";

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
const archive = { enabled: true, keepDays: 30 };
const conflicts = { prefer: "newer" as const, loser: "keep" as const };

// ?reels=vakuum|praezision shows the other reel styles; licht is the default.
const reelParam = new URLSearchParams(location.search).get("reels");
const reels: Reels = reelParam === "vakuum" || reelParam === "praezision" ? reelParam : "licht";

const config: Config = {
  version: 2,
  rsyncPath: "/opt/homebrew/bin/rsync",
  rclonePath: "/opt/homebrew/bin/rclone",
  ui: { accent: "amber", lamps: true, notifySuccess: false, reels },
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
      archive,
      conflicts,
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
      archive,
      conflicts,
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
      archive,
      conflicts,
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
    filesConflicted: 0,
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
  filesConflicted: 0,
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

// --- Orte (AddLocationSheet, LocationDetail) -------------------------------------------------
// Data for the Orte previews. preview.tsx adds it to a scene only when asked (?orteExtra=1,
// ?orteDrives=1|2), so the other previews keep their sidebar as it is.

import type { Location } from "../src/lib/types";

const orteField = (key: string, label: string, secret: boolean, required: boolean, placeholder: string) => ({
  key,
  label,
  secret,
  required,
  placeholder,
  hint: null as string | null,
});

/** The providers exactly as src-tauri/src/cloud.rs describes them, English labels included. */
export const orteCloudProviders: CloudProviderInfo[] = [
  {
    id: "s3",
    label: "Amazon S3 und kompatible",
    browserLogin: false,
    fields: [
      { ...orteField("endpoint", "Endpoint", false, false, "https://…"), hint: "Leer lassen für Amazon S3; sonst die Adresse des Anbieters, z. B. fsn1.your-objectstorage.com" },
      orteField("region", "Region", false, false, "eu-central-1"),
      orteField("access_key_id", "Access Key ID", false, true, ""),
      orteField("secret_access_key", "Secret Access Key", true, true, ""),
    ],
  },
  { id: "b2", label: "Backblaze B2", browserLogin: false, fields: [orteField("account", "Key ID", false, true, ""), orteField("key", "Application Key", true, true, "")] },
  { id: "drive", label: "Google Drive", browserLogin: true, fields: [] },
  { id: "onedrive", label: "Microsoft OneDrive", browserLogin: true, fields: [] },
  { id: "dropbox", label: "Dropbox", browserLogin: true, fields: [] },
  {
    id: "webdav",
    label: "WebDAV",
    browserLogin: false,
    fields: [
      orteField("url", "Adresse", false, true, "https://…"),
      orteField("user", "Benutzer", false, true, ""),
      orteField("pass", "Passwort", true, true, ""),
    ],
  },
];

/** One location of every kind the base scene lacks, none of them used by a job. */
export const orteExtraLocations: Location[] = [
  { id: "fotoarchiv", name: "Fotoarchiv", kind: { type: "folder", path: "/Users/demo/Pictures/Fotoarchiv" } },
  { id: "nas", name: "NAS Fotos", kind: { type: "smb", url: "smb://nas.local/Fotos", user: "demo" } },
  { id: "gdrive", name: "Google Drive", kind: { type: "cloud", provider: "drive", remote: "clonq-google-drive-7a1e", root: "Backups/clonq" } },
  { id: "nextcloud", name: "Nextcloud", kind: { type: "cloud", provider: "webdav", remote: "clonq-nextcloud-3c9d", root: "clonq" } },
];

export const orteExtraStatuses: LocationStatus[] = [
  { id: "fotoarchiv", reach: { state: "connected", path: "/Users/demo/Pictures/Fotoarchiv", freeBytes: 812_000_000_000, totalBytes: 994_000_000_000 }, usedBy: [] },
  { id: "nas", reach: { state: "disconnected" }, usedBy: [] },
  { id: "gdrive", reach: { state: "connected", path: null, freeBytes: null, totalBytes: null }, usedBy: [] },
  { id: "nextcloud", reach: { state: "untested" }, usedBy: [] },
];

/** Drives that are plugged in but not yet a location. */
export const orteNewDrives: MountedVolume[] = [
  {
    uuid: "7C1D2E3F-0A4B-4C5D-8E6F-9A0B1C2D3E4F",
    name: "Samsung T7",
    mountPoint: "/Volumes/Samsung T7",
    totalBytes: 2_000_000_000_000,
    freeBytes: 1_310_000_000_000,
    fileSystem: "apfs",
    internal: false,
  },
  {
    uuid: "0F1E2D3C-4B5A-4968-8776-A5B4C3D2E1F0",
    name: "Archiv 2019",
    mountPoint: "/Volumes/Archiv 2019",
    totalBytes: 4_000_000_000_000,
    freeBytes: 380_000_000_000,
    fileSystem: "exfat",
    internal: false,
  },
];
// --- end Orte --------------------------------------------------------------------------------

// --- Modus (two-way sync, conflict rules, archive in the job wizard) --------------------------
// A two-way job with rules other than the defaults, so that editing it shows its saved rules.
// preview.tsx adds it to a scene only when asked (?modusJob=1).

import type { Job } from "../src/lib/types";

export const modusTwoWayJob: Job = {
  id: "fotos-beidseitig",
  name: "Fotos → M2mini",
  enabled: true,
  source: { location: "desktop", path: "Fotos" },
  target: { location: "m2mini", path: "Fotos" },
  mode: "bidirectional",
  excludes: ["node_modules/", ".DS_Store"],
  safety: { maxDeletePercent: 25, alwaysAllowedDeletions: 10 },
  archive: { enabled: true, keepDays: 14 },
  conflicts: { prefer: "source", loser: "delete" },
  ring: "yellow",
  triggers: { onMount: true, onChangeAfterSeconds: null, everyMinutes: null, dailyAt: null, afterJob: null },
};
// --- end Modus -------------------------------------------------------------------------------
