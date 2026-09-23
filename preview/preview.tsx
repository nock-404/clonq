// Dev-only harness: renders a window with a mocked Rust side, one scene at a time.
// Open /preview.html?window=popover&scene=running in the Vite dev server.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import "./preview.css";
import { scenes, type SceneName } from "./scenes";

const params = new URLSearchParams(location.search);
const windowLabel = params.get("window") === "main" ? "main" : "popover";
const sceneName = (params.get("scene") ?? "idle") as SceneName;
const scene = scenes[sceneName] ?? scenes.idle;

mockWindows(windowLabel);
mockIPC(
  (command) => {
    switch (command) {
      case "get_config":
        return scene.config;
      case "live_runs":
        return scene.live;
      case "latest_runs":
        return scene.latest;
      case "recent_runs":
        return scene.recent;
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
      void emit("run-update", { ...live, percent, filesDone: Math.round((percent / 100) * (live.filesTotal ?? 0)) });
    }
  }, 400);
}

document.documentElement.classList.add("preview-desktop");
const root = document.getElementById("root");
if (root && windowLabel === "popover") {
  root.classList.add("preview-glass");
  root.dataset.frame = "popover";
}
if (root && windowLabel === "main") {
  root.classList.add("preview-glass");
  root.dataset.frame = "main";
}

await import("../src/main");
