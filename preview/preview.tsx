// Dev-only harness: renders a window with a mocked Rust side, one scene at a time.
// Open /preview.html?window=popover&scene=running in the Vite dev server.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { MotionGlobalConfig } from "motion/react";
import "./preview.css";
import { cloudProviders, orteCloudProviders, orteExtraLocations, orteExtraStatuses, orteNewDrives, scenes, type SceneName } from "./scenes";
import type { Job, JobInput, LocationStatus } from "../src/lib/types";

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
      // --- Orte (AddLocationSheet, LocationDetail): mocks for adding, testing, renaming and removing locations ---
      case "plugin:dialog|open":
        return params.get("orteDialog") ?? "/Users/demo/Pictures/Fotoarchiv";
      case "add_folder_location":
      case "add_volume_location":
      case "add_server_location":
      case "add_smb_location":
      case "add_cloud_location":
        return orteAdd(command, (args ?? {}) as Record<string, unknown>);
      case "install_server_key":
        return orteLater(null, 900);
      case "test_location":
        return orteTest(String((args as { id?: string } | undefined)?.id));
      case "connect_location":
        return orteConnect(String((args as { id?: string } | undefined)?.id));
      case "rename_location":
      case "remove_location":
        return orteChange(command, (args ?? {}) as Record<string, unknown>);
      // --- end Orte ---
      // --- Job wizard (JobWizard, JobDetail header): saving, switching and deleting jobs ---
      case "save_job":
        return jobWizardSave((args as { job: JobInput }).job);
      case "set_job_enabled":
      case "delete_job":
        return jobWizardChange(command, (args ?? {}) as { id?: string; enabled?: boolean });
      // --- end Job wizard ---
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

// --- Orte (AddLocationSheet, LocationDetail): scene changes before the app starts ------------
// ?orteExtra=1 adds a folder, a share, a Google Drive and a Nextcloud that no job uses.
// ?orteDrives=1|2 plugs in new drives. ?orteReach=failed|disconnected puts every location into
// that state; ?orteReach=box:failed,nas:connected sets single ones (states: connected,
// disconnected, missing, untested, failed). ?orteHold=1 keeps the sheet on its "added" moment.
{
  if (params.get("orteExtra")) {
    scene.config = { ...scene.config, locations: [...scene.config.locations, ...orteExtraLocations] };
    scene.locations.push(...orteExtraStatuses.map((status) => ({ ...status })));
  }
  const drives = Number(params.get("orteDrives") ?? 0);
  if (drives > 0) scene.volumes = [...scene.volumes, ...orteNewDrives.slice(0, drives)];
  const reachOf = (state: string, id: string): LocationStatus["reach"] => {
    switch (state) {
      case "connected":
        return { state: "connected", path: id === "nas" ? "/Volumes/Fotos" : null, freeBytes: id === "nas" ? 2_100_000_000_000 : null, totalBytes: id === "nas" ? 7_800_000_000_000 : null };
      case "failed":
        return {
          state: "failed",
          message: id === "gdrive" ? "couldn't fetch token: invalid_grant: maybe token expired?" : "login refused: wrong user, password or key",
        };
      case "missing":
        return { state: "missing" };
      case "untested":
        return { state: "untested" };
      default:
        return { state: "disconnected" };
    }
  };
  const orteReach = params.get("orteReach");
  if (orteReach) {
    const single = new Map(orteReach.split(",").flatMap((pair) => (pair.includes(":") ? [pair.split(":") as [string, string]] : [])));
    for (const [index, status] of scene.locations.entries()) {
      const state = orteReach.includes(":") ? single.get(status.id) : orteReach;
      if (state) scene.locations[index] = { ...status, reach: reachOf(state, status.id) };
    }
    if (!orteReach.includes(":") || single.get("m2mini")) scene.volumes = scene.volumes.filter((volume) => volume.name !== "M2mini");
  }
  // The sheet lingers 1.4 s on a new location before it closes; a still of that moment needs it to stay.
  if (params.get("orteHold")) {
    const later = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) =>
      delay === 1400 ? 0 : later(handler, delay, ...rest)) as typeof window.setTimeout;
  }
}
// --- end Orte --------------------------------------------------------------------------------

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

// --- Orte (AddLocationSheet, LocationDetail) -------------------------------------------------
// Mocked answers for the location commands, with a short delay where the real one talks to a
// server or waits for the browser. ?glyphs=1 lays every location glyph out side by side.

function orteLater<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function orteAdd(command: string, args: Record<string, unknown>) {
  const name = String(args.name ?? (args.server as { name?: string } | undefined)?.name ?? "Neuer Ort");
  const id = `${name.toLowerCase().replace(/\W+/g, "-")}-f00d`;
  let location: import("../src/lib/types").Location;
  let delay = 300;
  switch (command) {
    case "add_folder_location":
      location = { id, name, kind: { type: "folder", path: String(args.path) } };
      break;
    case "add_volume_location":
      location = { id, name, kind: { type: "volume", volumeUuid: String(args.volumeUuid), volumeName: name } };
      break;
    case "add_server_location": {
      const server = args.server as { locationId: string; host: string; port: number; user: string; basePath: string };
      location = { id: server.locationId, name, kind: { type: "ssh", host: server.host, port: server.port, user: server.user, basePath: server.basePath, identityFile: "/keys/k" } };
      delay = 700;
      break;
    }
    case "add_smb_location":
      location = { id, name, kind: { type: "smb", url: String(args.url), user: String(args.user) } };
      delay = 900;
      break;
    default: {
      const provider = String(args.provider) as import("../src/lib/types").CloudProvider;
      const browser = cloudProviders.find((item) => item.id === provider)?.browserLogin ?? false;
      location = { id, name, kind: { type: "cloud", provider, remote: id, root: String(args.root ?? "") } };
      delay = browser ? 4000 : 900;
    }
  }
  // Like the Rust side: the new location lands in the config, which is announced.
  scene.config = { ...scene.config, locations: [...scene.config.locations, location] };
  scene.locations.push({ id: location.id, reach: { state: "connected", path: null, freeBytes: null, totalBytes: null }, usedBy: [] });
  setTimeout(() => void emit("config-changed", scene.config), delay - 50);
  return orteLater(location, delay);
}

function orteTest(id: string) {
  const index = scene.locations.findIndex((status) => status.id === id);
  const current = scene.locations[index];
  const kind = scene.config.locations.find((item) => item.id === id)?.kind;
  if (!current) return orteLater(null, 300);
  // Servers and clouds are really tested; folders, drives and shares report what they are.
  const reach: LocationStatus["reach"] =
    params.get("orteFail") === "test_location"
      ? { state: "failed", message: "login refused: wrong user, password or key" }
      : kind?.type === "ssh" || kind?.type === "cloud"
        ? { state: "connected", path: null, freeBytes: null, totalBytes: null }
        : current.reach;
  const tested = { ...current, reach };
  scene.locations.splice(index, 1, tested);
  return orteLater(tested, 1200);
}

function orteConnect(id: string) {
  const index = scene.locations.findIndex((status) => status.id === id);
  const current = scene.locations[index];
  if (!current) return orteLater(null, 300);
  const mounted = { ...current, reach: { state: "connected" as const, path: "/Volumes/Fotos", freeBytes: 2_100_000_000_000, totalBytes: 7_800_000_000_000 } };
  scene.locations.splice(index, 1, mounted);
  return orteLater(mounted, 900);
}

function orteChange(command: string, args: Record<string, unknown>) {
  const id = String(args.id);
  const locations =
    command === "rename_location"
      ? scene.config.locations.map((item) => (item.id === id ? { ...item, name: String(args.name) } : item))
      : scene.config.locations.filter((item) => item.id !== id);
  scene.config = { ...scene.config, locations };
  setTimeout(() => void emit("config-changed", scene.config), 50);
  return scene.config;
}

if (params.get("glyphs")) {
  const [{ createRoot }, { OrteGlyphs }, { createElement }] = await Promise.all([
    import("react-dom/client"),
    import("./orte-glyphs"),
    import("react"),
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(createElement(OrteGlyphs));
}

// ?orte=<scenario> clicks and types through a flow after the page has loaded, so that the
// headless preview can photograph states that need input. The steps name buttons and fields
// by their visible text, as a person would.
type OrteStep = ["click", string] | ["fill", string, string] | ["key", string, boolean?] | ["wait", number];

const orteServer: OrteStep[] = [
  ["click", "Server (SSH)"],
  ["fill", "Adresse", "u654321.your-storagebox.de"],
  ["fill", "Ordner auf dem Server", "backups"],
];
const orteServerKey: OrteStep[] = [...orteServer, ["click", "Weiter"], ["wait", 400]];
const orteServerTested: OrteStep[] = [...orteServerKey, ["fill", "Passwort für", "passwort-demo"], ["click", "Schlüssel hinterlegen"], ["wait", 1800]];
const orteSmb: OrteStep[] = [
  ["click", "Netzlaufwerk"],
  ["fill", "Adresse der Freigabe", "smb://nas.local/Familie"],
  ["fill", "Benutzer", "demo"],
  ["fill", "Passwort", "passwort-demo"],
];
const orteCloud: OrteStep[] = [["click", "Cloud"], ["wait", 300]];

const orteScenarios: Record<string, OrteStep[]> = {
  "art-tastatur": [["key", "ArrowDown"], ["key", "ArrowDown"]],
  "ordner-leer": [["click", "Ordner auf dem Mac"]],
  ordner: [["click", "Ordner auf dem Mac"], ["click", "Ordner wählen"], ["wait", 300]],
  "ordner-fertig": [["click", "Ordner auf dem Mac"], ["click", "Ordner wählen"], ["wait", 300], ["click", "Hinzufügen"], ["wait", 1200]],
  laufwerk: [["click", "Laufwerk"]],
  laufwerke: [["click", "Laufwerk"], ["wait", 100], ["key", "ArrowDown"]],
  "server-adresse": orteServer,
  "server-doppelt": [["click", "Server (SSH)"], ["fill", "Adresse", "u123456.your-storagebox.de"]],
  "server-schluessel": orteServerKey,
  "server-getestet": orteServerTested,
  "server-ordner": [...orteServerTested, ["click", "Hinzufügen"], ["wait", 1500]],
  "server-fertig": [...orteServerTested, ["click", "Hinzufügen"], ["wait", 1500]],
  smb: orteSmb,
  "smb-verbindet": [...orteSmb, ["click", "Verbinden und hinzufügen"], ["wait", 300]],
  "smb-fehler": [...orteSmb, ["click", "Verbinden und hinzufügen"], ["wait", 1200]],
  cloud: [
    ...orteCloud,
    ["fill", "Schlüssel-ID", "AKIA-DEMO"],
    ["fill", "Geheimer Schlüssel", "schluessel-demo"],
    ["fill", "Bucket und Ordner", "fotos-backup/clonq"],
  ],
  "cloud-drive": [...orteCloud, ["click", "Google Drive"]],
  "cloud-browser": [...orteCloud, ["click", "Google Drive"], ["click", "Im Browser anmelden"], ["wait", 1300]],
  "cloud-fehler": orteCloud,
  webdav: [
    ["click", "WebDAV"],
    ["wait", 300],
    ["fill", "Adresse", "https://cloud.example.org/remote.php/webdav"],
    ["fill", "Benutzer", "demo"],
    ["fill", "Passwort", "passwort-demo"],
  ],
  verwerfen: [...orteSmb, ["key", "Escape"], ["wait", 100], ["key", "Escape"]],
  pruefen: [["wait", 300], ["key", "Enter"], ["wait", 1600]],
  "pruefen-laeuft": [["wait", 300], ["key", "Enter"], ["wait", 400]],
  umbenennen: [["wait", 300], ["key", "e", true]],
  entfernen: [["wait", 300], ["click", "Entfernen"]],
  verbinden: [["wait", 300], ["click", "Verbinden"], ["wait", 1300]],
};

function orteScope(): ParentNode {
  return document.querySelector("[role=dialog]") ?? document;
}

function orteButton(text: string): HTMLButtonElement | undefined {
  const buttons = [...orteScope().querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.disabled);
  const words = (button: HTMLButtonElement) => (button.textContent ?? "").replace(/\s+/g, " ").trim();
  return buttons.find((button) => words(button) === text) ?? buttons.find((button) => words(button).startsWith(text));
}

function orteInput(label: string): HTMLInputElement | undefined {
  const labels = [...orteScope().querySelectorAll("label")];
  const caption = (element: Element) => element.firstElementChild?.textContent?.trim() ?? "";
  const found = labels.find((element) => caption(element) === label) ?? labels.find((element) => caption(element).startsWith(label));
  return found?.querySelector("input") ?? undefined;
}

async function orteRun(name: string) {
  const steps = orteScenarios[name];
  if (!steps) return;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(250);
  for (const step of steps) {
    if (step[0] === "wait") await sleep(step[1]);
    if (step[0] === "click") orteButton(step[1])?.click();
    if (step[0] === "fill") {
      const input = orteInput(step[1]);
      if (input) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, step[2]);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (step[0] === "key") {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: step[1], metaKey: step[2] ?? false, bubbles: true, cancelable: true }));
    }
    await sleep(120);
  }
}

const orteScenario = params.get("orte");
if (orteScenario) void orteRun(orteScenario);
// --- end Orte --------------------------------------------------------------------------------

// --- Job wizard (JobWizard, JobDetail header) ------------------------------------------------
// Saving puts the job into the scene's config and announces it, as the Rust side does.
// ?saveError=<message> makes save_job fail with that (English) message instead.

function jobWizardSave(input: JobInput): Promise<Job> {
  const failure = params.get("saveError");
  if (failure) return new Promise((_, reject) => setTimeout(() => reject(failure), 400));
  const id = input.id ?? `${input.name.toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "")}-c0de`;
  const job: Job = {
    id,
    name: input.name,
    enabled: input.enabled,
    source: input.source,
    target: input.target,
    mode: input.mode,
    excludes: input.excludes,
    safety: { maxDeletePercent: input.maxDeletePercent, alwaysAllowedDeletions: 10 },
    ring: input.ring,
    triggers: input.triggers,
    archive: input.archive ?? { enabled: true, keepDays: 30 },
    conflicts: input.conflicts ?? { prefer: "newer", loser: "keep" },
  };
  // The store asks for stats of every job once the config changes.
  scene.stats[id] ??= {
    jobId: id,
    lastSuccessAt: null,
    streak: 0,
    runsTotal: 0,
    runsCompleted: 0,
    averageSeconds: null,
    last: null,
    daily: [],
    topFolders: [],
    totals: { runs: 0, files: 0, bytes: 0, wireBytes: 0, deleted: 0 },
  };
  const known = scene.config.jobs.some((item) => item.id === id);
  const jobs = known ? scene.config.jobs.map((item) => (item.id === id ? job : item)) : [...scene.config.jobs, job];
  scene.config = { ...scene.config, jobs };
  setTimeout(() => void emit("config-changed", scene.config), 50);
  return new Promise((resolve) => setTimeout(() => resolve(job), 400));
}

function jobWizardChange(command: string, args: { id?: string; enabled?: boolean }) {
  const jobs =
    command === "set_job_enabled"
      ? scene.config.jobs.map((item) => (item.id === args.id ? { ...item, enabled: Boolean(args.enabled) } : item))
      : scene.config.jobs.filter((item) => item.id !== args.id);
  scene.config = { ...scene.config, jobs };
  setTimeout(() => void emit("config-changed", scene.config), 50);
  return scene.config;
}

// Folders inside the locations, by path, for the folder browser of the wizard. The shared
// list_folders mock above answers every path alike; this one knows a small tree, with an empty
// folder, one with only hidden folders and one that cannot be read. Only the wizard lists folders.
// ?folderDelay=<ms> slows every listing down, to see the loading state.
const jobWizardTree: Record<string, Record<string, string[] | "unreadable">> = {
  desktop: {
    "": ["WORK", "Fotos", "Projekte", "Nur versteckt", "Gesperrt", ".Trash"],
    WORK: ["GM8", "Projekte", "Musik", "Archiv", ".git"],
    "WORK/GM8": ["clonq", "plxr", "matthiasg.rocks"],
    Fotos: ["2025", "2026"],
    "Nur versteckt": [".cache", ".config"],
    Gesperrt: "unreadable",
  },
  m2mini: {
    "": ["WORK", "Archiv", "Fotos", ".Spotlight-V100", ".fseventsd"],
    WORK: ["GM8", "Projekte", "Musik"],
    Archiv: ["2024", "2025"],
  },
  box: {
    "": ["M2mini", "WORK"],
    M2mini: ["WORK"],
  },
};

function jobWizardFolders(args: { location?: string; path?: string }) {
  const location = String(args.location);
  const path = String(args.path ?? "").replace(/^\/+|\/+$/g, "");
  const listing = jobWizardTree[location]?.[path] ?? [];
  const delay = Number(params.get("folderDelay") ?? 150);
  if (listing === "unreadable") return orteLater(null, delay).then(() => Promise.reject(`/Users/matthias/Desktop/${path} cannot be read`));
  return orteLater(
    listing.map((name) => ({ name, hidden: name.startsWith(".") })),
    delay,
  );
}

function jobWizardCreateFolder(args: { location?: string; path?: string }) {
  const location = String(args.location);
  const path = String(args.path ?? "").replace(/^\/+|\/+$/g, "");
  const parent = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").at(-1) ?? path;
  // A folder called "Schreibgeschützt" cannot be created, to see the error.
  if (name === "Schreibgeschützt") return orteLater(null, 300).then(() => Promise.reject(`/Volumes/M2mini/${path} cannot be created: Permission denied (os error 13)`));
  const tree = (jobWizardTree[location] ??= {});
  const siblings = tree[parent];
  tree[parent] = [...(Array.isArray(siblings) ? siblings : []), name];
  tree[path] = [];
  return orteLater(null, 300);
}

// ?jobOffline=<locationId> unplugs one drive, ?jobFailed=<locationId> makes one server refuse the
// login, to see how the wizard handles a place it cannot open.
const jobOffline = params.get("jobOffline");
const jobFailed = params.get("jobFailed");
for (const [index, status] of scene.locations.entries()) {
  if (status.id === jobOffline) scene.locations[index] = { ...status, reach: { state: "disconnected" } };
  if (status.id === jobFailed) scene.locations[index] = { ...status, reach: { state: "failed", message: "login refused: wrong user, password or key" } };
}
if (jobOffline) scene.volumes = scene.volumes.filter((volume) => volume.name.toLowerCase() !== jobOffline);
if (jobOffline || jobFailed) setTimeout(() => void emit("servers-checked"), 400);

{
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown> } })
    .__TAURI_INTERNALS__;
  const invoke = internals.invoke;
  internals.invoke = (command, args, options) => {
    if (command === "list_folders") return jobWizardFolders((args ?? {}) as { location?: string; path?: string });
    if (command === "create_folder") return jobWizardCreateFolder((args ?? {}) as { location?: string; path?: string });
    return invoke(command, args, options);
  };
}
// --- end Job wizard --------------------------------------------------------------------------

// --- Orte (AddLocationSheet, LocationDetail): answers that wrap every other mock -------------
// Installed last, so it sees commands before the job wizard's wrapper does. cloud_providers
// answers with the list from src-tauri/src/cloud.rs. ?orteFail=<command> makes that command fail
// with the English message the Rust side would send.
{
  const orteFailures: Record<string, string> = {
    add_smb_location: "the share could not be connected: mount_smbfs: server rejected the connection: Authentication error",
    add_cloud_location: "couldn't fetch token: invalid_grant: maybe token expired?",
    test_server: "login refused: wrong user, password or key",
    install_server_key: "login refused: wrong user, password or key",
    list_folders: "cannot list backups on the server",
    cloud_providers: "no answer from the backend",
    connect_location: "the share could not be connected: mount_smbfs: server connection failed: No route to host",
  };
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown> } })
    .__TAURI_INTERNALS__;
  const inner = internals.invoke;
  const failing = params.get("orteFail");
  internals.invoke = (command, args, options) => {
    if (command === failing && orteFailures[command]) return orteLater(null, 700).then(() => Promise.reject(orteFailures[command]));
    if (command === "cloud_providers") return orteLater(orteCloudProviders, 200);
    return inner(command, args, options);
  };
}
// --- end Orte --------------------------------------------------------------------------------
