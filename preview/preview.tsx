// Dev-only harness: renders a window with a mocked Rust side, one scene at a time.
// Open /preview.html?window=popover&scene=running in the Vite dev server.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { MotionGlobalConfig } from "motion/react";
import "./preview.css";
import { scenes, type SceneName } from "./scenes";

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
