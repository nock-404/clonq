import type { Config, LiveRun, Run } from "../src/lib/types";

export type SceneName = "idle" | "running" | "blocked" | "failed" | "fresh";

interface Scene {
  config: Config;
  live: LiveRun[];
  latest: Run[];
  recent: Run[];
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const config: Config = {
  version: 1,
  rsyncPath: "/opt/homebrew/bin/rsync",
  hosts: [],
  jobs: [
    {
      id: "work-to-m2mini",
      name: "WORK → M2mini",
      enabled: false,
      source: { kind: "local", path: "/Users/matthias/Desktop/WORK" },
      target: { kind: "local", path: "/Volumes/M2mini/WORK" },
      mode: "mirror",
      excludes: ["node_modules/"],
      safety: { maxDeletePercent: 10, alwaysAllowedDeletions: 10 },
    },
    {
      id: "work-to-storagebox",
      name: "WORK → Storage Box",
      enabled: false,
      source: { kind: "local", path: "/Users/matthias/Desktop/WORK" },
      target: { kind: "remote", host: "storagebox", path: "M2mini/WORK" },
      mode: "mirror",
      excludes: ["node_modules/"],
      safety: { maxDeletePercent: 10, alwaysAllowedDeletions: 10 },
    },
    {
      id: "m2mini-to-storagebox",
      name: "M2mini → Storage Box",
      enabled: false,
      source: { kind: "local", path: "/Volumes/M2mini" },
      target: { kind: "remote", host: "storagebox", path: "M2mini" },
      mode: "mirror",
      excludes: ["node_modules/", "/WORK/"],
      safety: { maxDeletePercent: 10, alwaysAllowedDeletions: 10 },
    },
  ],
};

function run(partial: Partial<Run> & Pick<Run, "id" | "jobId" | "status">): Run {
  return {
    trigger: "manual",
    dryRun: false,
    startedAt: minutesAgo(3),
    finishedAt: minutesAgo(2),
    filesTotal: 18_420,
    filesTransferred: 14,
    filesDeleted: 2,
    bytesTransferred: 48_300_000,
    targetEntries: 18_420,
    exitCode: 0,
    message: null,
    logPath: "",
    ...partial,
  };
}

const succeeded = run({ id: "r1", jobId: "work-to-m2mini", status: "succeeded" });
const dry = run({
  id: "r0",
  jobId: "work-to-m2mini",
  status: "succeeded",
  dryRun: true,
  startedAt: minutesAgo(1),
  finishedAt: minutesAgo(1),
  filesTransferred: 3,
  filesDeleted: 0,
  bytesTransferred: 1_200_000,
});
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
  filesTransferred: 0,
  filesDeleted: 0,
  bytesTransferred: 0,
  message: "source /Users/matthias/Desktop/WORK does not exist",
});

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
  currentPath: "GM8/matthiasg.rocks/public/images/halftone-portrait@2x.png",
  status: "running",
  message: null,
};

export const scenes: Record<SceneName, Scene> = {
  fresh: { config, live: [], latest: [], recent: [] },
  idle: { config, live: [], latest: [succeeded], recent: [dry, succeeded, failed] },
  running: { config, live: [running], latest: [succeeded], recent: [succeeded] },
  blocked: { config, live: [], latest: [blocked], recent: [blocked, succeeded] },
  failed: { config, live: [], latest: [failed], recent: [failed, blocked, succeeded, dry] },
};
