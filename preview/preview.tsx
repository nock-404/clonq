// Dev-only harness: renders a window with a mocked Rust side, one scene at a time.
// Open /preview.html?window=popover&scene=running in the Vite dev server.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { MotionGlobalConfig } from "motion/react";
import "./preview.css";
import { cloudProviders, scenes, type SceneName } from "./scenes";

const params = new URLSearchParams(location.search);
const windowLabel = params.get("window") === "main" ? "main" : "popover";
const sceneName = (params.get("scene") ?? "idle") as SceneName;
const scene = scenes[sceneName] ?? scenes.idle;

// Headless Chrome has no display link, so animation frames never come: ?instant=1 skips them.
if (params.get("instant")) MotionGlobalConfig.instantAnimations = true;

mockWindows(windowLabel);
mockIPC(
  (command, args) => {
    switch (command) {
      case "get_config":
        return scene.config;
      case "live_runs":
        return scene.live;
      case "latest_runs":
        return scene.latest;
      case "recent_runs":
        return scene.recent;
      case "job_stats":
        return scene.stats[String((args as { jobId?: string } | undefined)?.jobId)];
      case "overview":
        return scene.overview;
      case "location_statuses":
        return scene.locations;
      case "mounted_volumes":
        return scene.volumes;
      case "list_folders":
        return [
          { name: "WORK", hidden: false },
          { name: "Fotos", hidden: false },
          { name: "Projekte", hidden: false },
          { name: ".Trash", hidden: true },
        ];
      case "job_defaults":
        return ["node_modules/"];
      case "prepare_server":
        return {
          locationId: "box-a1b2c3",
          publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFq0Yl1vDk3n7c0r2Yp0 clonq box-a1b2c3",
          storageBox: true,
        };
      case "test_server":
        return "/home";
      case "cloud_providers":
        return cloudProviders;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

// A running scene keeps moving, so the progress animation can be seen.
if (scene.live.length > 0) {
  let percent = scene.live[0]?.percent ?? 0;
  setInterval(() => {
    percent = percent >= 100 ? 0 : percent + 1.5;
    for (const live of scene.live) {
      void emit("run-update", {
        ...live,
        percent,
        filesDone: Math.round((percent / 100) * (live.filesTotal ?? 0)),
        filesNew: live.filesNew + Math.round(percent * 3),
      });
    }
  }, 400);
}

document.documentElement.classList.add("preview-desktop");
const root = document.getElementById("root");
if (root) {
  root.classList.add("preview-frame");
  root.dataset.frame = windowLabel;
}

await import("../src/main");

// ?job=<id> opens that job in the main window, as the popover would.
const jobParam = params.get("job");
if (jobParam) setTimeout(() => void emit("show-job", jobParam), 300);

// ?sheet=addLocation|jobWizard opens a sheet, ?location=<id> shows a location.
const nav = await import("../src/lib/nav");
const sheetParam = params.get("sheet");
if (sheetParam === "addLocation") nav.openSheet({ kind: "addLocation" });
if (sheetParam === "jobWizard") nav.openSheet({ kind: "jobWizard", jobId: params.get("edit") ?? undefined });
const locationParam = params.get("location");
if (locationParam) nav.navigate({ kind: "location", locationId: locationParam });
