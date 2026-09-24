// Dev-only harness: renders a window with a mocked Rust side, one scene at a time.
// Open /preview.html?window=popover&scene=running in the Vite dev server.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { MotionGlobalConfig } from "motion/react";
import "./preview.css";
import { cloudProviders, englishData, orteCloudProviders, orteExtraLocations, orteExtraStatuses, orteNewDrives, scenes, type SceneName } from "./scenes";
import type { Job, JobInput, LocationStatus } from "../src/lib/types";

const params = new URLSearchParams(location.search);
const windowLabel = params.get("window") === "main" ? "main" : "popover";
const sceneName = (params.get("scene") ?? "idle") as SceneName;
const scene = scenes[sceneName] ?? scenes.idle;
/** The German word for the German data, the English one for ?lang=en. */
const say = (de: string, en: string) => (englishData ? en : de);

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
      case "overview": {
        // ?files=123456789 tries the counter with a large number.
        const files = params.get("files");
        return files ? { ...scene.overview, totals: { ...scene.overview.totals, files: Number(files) } } : scene.overview;
      }
      // ?update=covered|notCovered: a newer release is out, with or without licence cover.
      case "plugin:updater|check":
        return params.get("update")
          ? { rid: 1, currentVersion: "0.3.6", version: "0.4.0", date: "2027-10-01 10:00:00.0 +00:00:00", body: "", rawJson: {} }
          : null;
      case "licence_covers_update":
        return params.get("update") === "notCovered"
          ? { covered: false, updatesUntil: "2027-09-24", renewUrl: "https://licences.example.org/buy" }
          : { covered: true, updatesUntil: null, renewUrl: null };
      case "licence_pro":
        return params.get("licence") !== "none";
      case "encryption_key":
        return "K7Q2M-X9PLA-4TRWZ-H3NCE-8VDJF";
      case "weekly_report": {
        // ?week=empty shows a first week without space measurements.
        const day = 86_400_000;
        const now = Date.now();
        const jobs = scene.config.jobs.map((job, index) => ({
          jobId: job.id,
          name: job.name,
          runs: [38, 7, 0, 3][index] ?? 1,
          succeeded: [38, 6, 0, 3][index] ?? 1,
          failed: [0, 1, 0, 0][index] ?? 0,
          bytes: [12_400_000_000, 2_100_000_000, 0, 380_000_000][index] ?? 0,
          files: [1_204, 310, 0, 41][index] ?? 0,
          lastSuccessAt: new Date(now - [0.02, 0.4, 9, 1][index]! * day).toISOString(),
          overdueDays: index === 2 ? 9 : null,
        }));
        const targets =
          params.get("week") === "empty"
            ? []
            : [
                { locationId: "box", name: englishData ? "Storage Box" : "Storage Box", total: 1_000_000_000_000, free: 212_000_000_000, measuredAt: new Date(now).toISOString(), daysUntilFull: 41.6 },
                { locationId: "m2mini", name: englishData ? "Photos Drive" : "M2mini", total: 2_000_000_000_000, free: 1_310_000_000_000, measuredAt: new Date(now).toISOString(), daysUntilFull: null },
              ];
        return { from: new Date(now - 7 * day).toISOString(), to: new Date(now).toISOString(), jobs, targets };
      }
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
        return englishData ? [".DS_Store"] : ["node_modules/"];
      case "licence_status":
        // Preview only: ?licence=none shows clonq without Pro.
        return params.get("licence") === "none" ? { state: "none" } : { state: "active", email: "sam@example.com", updatesUntil: "2027-09-24" };
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
      // --- Settings: saving the interface settings, e.g. switching the language ---
      case "set_ui_settings": {
        scene.config = { ...scene.config, ui: (args as { settings: typeof scene.config.ui }).settings };
        void emit("config-changed", scene.config);
        return scene.config;
      }
      // --- end Settings ---
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
    const known = new Set(scene.config.locations.map((item) => item.id));
    scene.config = { ...scene.config, locations: [...scene.config.locations, ...orteExtraLocations.filter((item) => !known.has(item.id))] };
    scene.locations.push(...orteExtraStatuses.filter((status) => !known.has(status.id)).map((status) => ({ ...status })));
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

// --- Modus (two-way sync, conflict rules, archive): scene change before the app starts -------
// A two-way job with its own conflict rules and archive (id fotos-beidseitig) joins the scene
// whenever ?edit=fotos-beidseitig asks for it, or with ?modusJob=1. Preview only.
if (params.get("modusJob") || params.get("edit") === "fotos-beidseitig") {
  const { modusTwoWayJob } = await import("./scenes");
  scene.config = { ...scene.config, jobs: [...scene.config.jobs, modusTwoWayJob] };
  scene.stats[modusTwoWayJob.id] ??= {
    jobId: modusTwoWayJob.id,
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
}
// --- end Modus -------------------------------------------------------------------------------

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

// ?bare=1 shows the window alone on a transparent page (for product shots): no desktop behind
// it, and a margin wide enough that its shadow is not cut off.
const bare = Boolean(params.get("bare"));
if (!bare) document.documentElement.classList.add("preview-desktop");
else document.documentElement.classList.add("preview-bare");
const root = document.getElementById("root");
if (root) {
  root.classList.add("preview-frame");
  root.dataset.frame = windowLabel;
  // ?frameWidth=760 draws the main window at another width, e.g. its minimum.
  const frameWidth = params.get("frameWidth");
  if (frameWidth) root.style.width = `${Number(frameWidth) / 16}rem`;
  const frameHeight = params.get("frameHeight");
  if (frameHeight) root.style.height = `${Number(frameHeight) / 16}rem`;
}

await import("../src/main");

// ?job=<id> opens that job in the main window, as the popover would.
const jobParam = params.get("job");
// ?encryptJob=<id> shows that job as an encrypted cloud copy.
const encryptJob = params.get("encryptJob");
if (encryptJob) for (const job of scene.config.jobs) if (job.id === encryptJob) job.encrypted = true;
// ?cloudJob=<id> points that job at Google Drive (English data), where encryption is offered.
const cloudJob = params.get("cloudJob");
if (cloudJob) for (const job of scene.config.jobs) if (job.id === cloudJob) job.target = { location: "gdrive", path: "Photos" };
if (jobParam) setTimeout(() => void emit("show-job", jobParam), 300);
// ?dryResult=1|none sends a finished dry run for ?job, as the backend does at the end of one.
const dryParam = params.get("dryResult");
if (jobParam && dryParam) {
  const found = dryParam === "none" ? [0, 0, 0] : [1_043, 204, 3];
  setTimeout(
    () =>
      void emit("run-update", {
        runId: "dry-preview", jobId: jobParam, dryRun: true, verify: false, phase: "finished", percent: 100, bytes: 0, bytesPerSecond: 0,
        etaSeconds: null, filesDone: 0, filesTotal: null, filesNew: found[0], filesChanged: found[1], filesDeleted: found[2],
        filesConflicted: 0, filesPerSecond: 0, throughput: [], recentPaths: [], currentPath: null, status: "succeeded", message: null,
      }),
    700,
  );
}

// ?check=ok|damaged sends a finished integrity check for ?job.
const checkParam = params.get("check");
if (jobParam && checkParam) {
  const damaged = checkParam === "damaged";
  setTimeout(
    () =>
      void emit("run-update", {
        runId: "check-preview", jobId: jobParam, dryRun: true, verify: true, phase: "finished", percent: 100, bytes: 0, bytesPerSecond: 0,
        etaSeconds: null, filesDone: 0, filesTotal: null, filesNew: 0, filesChanged: 0, filesDeleted: 0,
        filesConflicted: damaged ? 2 : 0, filesPerSecond: 0, throughput: [], recentPaths: [], currentPath: null,
        status: damaged ? "partial" : "succeeded", message: damaged ? "2 file(s) differ in content although size and date match" : null,
      }),
    700,
  );
}

// ?sheet=addLocation|jobWizard opens a sheet, ?location=<id> shows a location.
const nav = await import("../src/lib/nav");
const sheetParam = params.get("sheet");
if (sheetParam === "addLocation") nav.openSheet({ kind: "addLocation" });
if (sheetParam === "jobWizard") nav.openSheet({ kind: "jobWizard", jobId: params.get("edit") ?? undefined });
const locationParam = params.get("location");
if (locationParam) nav.navigate({ kind: "location", locationId: locationParam });
// ?section=settings|history opens that page of the main window.
const sectionParam = params.get("section");
if (sectionParam === "settings" || sectionParam === "history") nav.navigate({ kind: sectionParam });

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
  ["fill", say("Adresse", "Address"), "u654321.your-storagebox.de"],
  ["fill", say("Ordner auf dem Server", "Folder on the server"), "backups"],
];
const orteServerKey: OrteStep[] = [...orteServer, ["click", say("Weiter", "Continue")], ["wait", 400]];
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
  "art-laufwerk": [["key", "ArrowDown"]],
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

// --- Server host key (ServerSetup fingerprint step) ------------------------------------------
// Preview only. prepare_server reads the server's host keys; the flow shows their fingerprints and
// pins them with trust_server before any password. A Storage Box on port 23 shows the two
// fingerprints Hetzner publishes; any other address gets made-up ones that follow host and port.
// ?orteFail= takes a comma list here: trust (or trust_server) makes pinning fail as when nothing
// was read, trust_io as when known_hosts cannot be written; prepare_server makes every reading
// fail, reread only the second and later ones; nokeys reads no host key at all; hostkey makes the
// first key install fail because the server shows another host key, which later readings return.
// ?orteSlow=prepare_server,trust_server keeps those calls running, to photograph the waiting.
// ?orteKeys=1|3 reads one host key or three (with ECDSA); ?orteCopy=1 presses the first copy button.
// NOTE: this block REPLACES the Orte scenarios server-schluessel, server-getestet, server-ordner
// and server-fertig above (Object.assign below), because every server flow now confirms the
// fingerprints on its way. It adds: server-fingerabdruck, server-lesen-laeuft,
// server-speichern-laeuft, server-echtheit-fehler, server-neu-lesen-fehler,
// server-keine-schluessel, server-adresse-geaendert, server-adresse-gleich,
// server-fingerabdruck-enter, server-fingerabdruck-cmd-enter, server-fingerabdruck-escape,
// server-eigener, server-nicht-wiedererkannt, server-schluessel-geaendert.
{
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const fingerprint = (seed: string) => {
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    let text = "";
    for (let index = 0; index < 43; index += 1) {
      hash = Math.imul(hash ^ (hash >>> 13), 1597334677) + index;
      text += alphabet.charAt((hash >>> 7) & 63);
    }
    return `SHA256:${text}`;
  };
  // Hetzner's documentation, "Storage Box Überblick", section "SSH-Host-Keys".
  const hetzner = [
    { kind: "ED25519", fingerprint: "SHA256:XqONwb1S0zuj5A1CDxpOSuD2hnAArV1A3wKY7Z3sdgM" },
    { kind: "RSA", fingerprint: "SHA256:EMlfI8GsRIfpVkoW1H2u0zYVpFGKkIMKHFZIRkf2ioI" },
  ];
  // ?orteKeys=1 or =3 reads one host key, or three with ECDSA, as ssh-keyscan often returns.
  const keyCount = Number(params.get("orteKeys") ?? 2);
  const ecdsa = "SHA256:oDHZqKXnoMtgvPBjjC57pcuFez28roaEuFcfwyg8O5c";
  const failing = new Set((params.get("orteFail") ?? "").split(","));
  const slow = new Set((params.get("orteSlow") ?? "").split(","));
  const delay = (command: string, ms: number) => (slow.has(command) ? 600_000 : ms);
  // Like the Rust side: pinning uses up the keys the last reading left for that draft.
  let pending: string | null = null;
  let readings = 0;
  // Once the server has shown another host key, every later reading returns the new ones.
  let rotated = false;
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown> } })
    .__TAURI_INTERNALS__;
  const inner = internals.invoke;
  internals.invoke = (command, args, options) => {
    if (command === "prepare_server") {
      const { host, port, locationId } = args as { host: string; port: number; locationId: string | null };
      readings += 1;
      if (failing.has("prepare_server") || (failing.has("reread") && readings > 1)) {
        return orteLater(null, 600).then(() => Promise.reject("no answer from the server (timeout)"));
      }
      const id = locationId ?? "box-a1b2c3";
      pending = id;
      const address = `${host}:${port}`;
      const box = host.endsWith(".your-storagebox.de");
      const known = box && port === 23 && !rotated;
      const read = known
        ? hetzner
        : [
            { kind: "ED25519", fingerprint: fingerprint(`ed25519 ${address} ${rotated}`) },
            { kind: "RSA", fingerprint: fingerprint(`rsa ${address} ${rotated}`) },
          ];
      const third = { kind: "ECDSA", fingerprint: known ? ecdsa : fingerprint(`ecdsa ${address} ${rotated}`) };
      const hostKeys = failing.has("nokeys") ? [] : keyCount === 1 ? read.slice(0, 1) : keyCount === 3 ? [...read, third] : read;
      return orteLater(
        { locationId: id, publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFq0Yl1vDk3n7c0r2Yp0 clonq box-a1b2c3", storageBox: box, hostKeys },
        delay(command, 250),
      );
    }
    if (command === "trust_server") {
      const { locationId } = args as { locationId: string };
      const read = pending === locationId;
      pending = null;
      if (failing.has("trust_io")) return orteLater(null, 400).then(() => Promise.reject("file system: Permission denied (os error 13)"));
      if (!read || failing.has("trust_server") || failing.has("trust")) {
        return orteLater(null, 400).then(() => Promise.reject("the server's key was not read; start again"));
      }
      return orteLater(null, delay(command, 250));
    }
    if (command === "install_server_key" && failing.has("hostkey") && !rotated) {
      rotated = true;
      return orteLater(null, 700).then(() => Promise.reject("the server's host key changed; check it before trusting it again"));
    }
    return inner(command, args, options);
  };

  const confirm: OrteStep = ["click", say("Fingerabdrücke stimmen", "Fingerprints match")];
  const confirmed: OrteStep[] = [...orteServerKey, confirm, ["wait", 500]];
  const tested: OrteStep[] = [...confirmed, ["fill", "Passwort für", "passwort-demo"], ["click", "Schlüssel hinterlegen"], ["wait", 1800]];
  const reopened: OrteStep[] = [...confirmed, ["click", "Adresse ändern"], ["wait", 200]];
  Object.assign(orteScenarios, {
    "server-fingerabdruck": [...orteServerKey, ["wait", 200]],
    // With ?orteSlow=prepare_server and ?orteSlow=trust_server.
    "server-lesen-laeuft": [...orteServer, ["click", "Weiter"], ["wait", 300]],
    "server-speichern-laeuft": [...orteServerKey, confirm, ["wait", 300]],
    // With ?orteFail=trust, ?orteFail=trust_io, ?orteFail=trust,reread and ?orteFail=nokeys.
    "server-echtheit-fehler": [...orteServerKey, confirm, ["wait", 700]],
    "server-neu-lesen-fehler": [...orteServerKey, confirm, ["wait", 700], ["click", "Fingerabdrücke neu lesen"], ["wait", 900]],
    "server-keine-schluessel": [...orteServerKey, ["wait", 200]],
    "server-schluessel": confirmed,
    "server-getestet": tested,
    "server-ordner": [...tested, ["click", "Hinzufügen"], ["wait", 1500]],
    "server-fertig": [...tested, ["click", "Hinzufügen"], ["wait", 1500]],
    "server-adresse-geaendert": [...reopened, ["fill", "Adresse", "u777777.your-storagebox.de"], ["click", "Weiter"], ["wait", 500]],
    "server-adresse-gleich": [...reopened, ["click", "Weiter"], ["wait", 300]],
    // Plain Enter must not confirm a fingerprint, ⌘↵ does; Escape leads back to the address.
    "server-fingerabdruck-enter": [...orteServerKey, ["key", "Enter"], ["wait", 500]],
    "server-fingerabdruck-cmd-enter": [...orteServerKey, ["key", "Enter", true], ["wait", 500]],
    "server-fingerabdruck-escape": [...orteServerKey, ["key", "Escape"], ["wait", 300]],
    // A server that is not a Storage Box gets the sentence about its provider or administrator.
    "server-eigener": [["click", "Server (SSH)"], ["fill", "Adresse", "backup.example.org"], ["fill", "Benutzer", "demo"], ["click", "Weiter"], ["wait", 400]],
    // With ?orteFail=hostkey: the key install meets another host key, and the new reading differs.
    "server-nicht-wiedererkannt": tested,
    "server-schluessel-geaendert": [...tested, ["click", "Fingerabdrücke neu lesen"], ["wait", 500]],
  } satisfies Record<string, OrteStep[]>);
  // ?orteCopy=1 presses the copy button of the first fingerprint once the step shows (it has no text to click by).
  // Headless Chrome never settles a clipboard write, so the preview refuses it: the value is selected instead.
  if (params.get("orteCopy")) {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("preview")) } });
    setTimeout(() => document.querySelector<HTMLButtonElement>("[role=dialog] button[aria-label='ED25519 kopieren']")?.click(), 3500);
  }
}
// --- end Server host key ---------------------------------------------------------------------

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
    encrypted: input.encrypted ?? false,
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
const jobWizardTree: Record<string, Record<string, string[] | "unreadable">> = englishData ? {
  desktop: { "": ["Projects", "Screenshots", "Notes", ".Trash"], Projects: ["website", "garden-planner"] },
  documents: { "": ["Taxes", "Projects", "Home", "Recipes"], Taxes: ["2024", "2025"] },
  m2mini: { "": ["Photos", "Videos", "Desktop Backup", ".Spotlight-V100"], Photos: ["2025", "2026", "Scans"] },
  nas: { "": ["Documents", "Projects", "Media"], Media: ["Music", "Films"] },
  box: { "": ["Photos"], Photos: ["2025", "2026", "Scans"] },
} : {
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

// --- Panels (ArchivePanel in the job detail, FileBrowser in the location detail) -------------
// Answers for the archive and browse commands: a few runs' worth of archived files per job and a
// small file tree per location, with .zfs snapshots on the Storage Box. Preview-only params:
// ?panels=<scenario> clicks through the archive or the file browser after load, for stills.
// ?panelsArchiveOff=<jobId> turns that job's archive off. ?panelsEmpty=<jobId> empties its archive.
// ?panelsNoZfs=1 hides the Storage Box snapshots. ?panelsFail=<command> makes that command fail
// with the English message the Rust side would send. ?panelsDrop=<locationId> lets that location's
// next background check fail 2.5 s after load. ?panelsLog=1 writes every command the page sends
// into <body data-panels-calls>, so a headless --dump-dom can tell whether ↵ started a job.
// The Storage Box snapshot names (2026-09-22T02-00-00) are invented; Hetzner's are not checked.
{
  const later = <T,>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = (minutesAgo: number) => {
    const at = new Date(Date.now() - minutesAgo * 60_000);
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  };
  type Files = [path: string, size: number][];
  const archivesEn: Record<string, { stamp: string; files: Files }[]> = {
    "work-to-m2mini": [
      { stamp: stamp(33), files: [["2026/Iceland/IMG_4790.heic", 3_204_551], ["2026/Iceland/IMG_4791.heic", 2_987_004], ["2026/Garden/IMG_4702.heic", 2_874_210]] },
      { stamp: stamp(26 * 60 + 7), files: [["2026/Lisbon/IMG_4611.heic", 3_012_448], ["Scans/Letters/scan-0042.pdf", 812_330]] },
    ],
    "work-to-storagebox": [
      {
        stamp: stamp(52),
        files: [
          ["Taxes/2025/receipts.pdf", 1_842_331],
          ["Taxes/2025/donations.pdf", 212_804],
          ["Taxes/2025/tax-return-draft.xlsx", 48_112],
          ["Projects/website/index.html", 6_402],
          ["Projects/website/about.html", 4_118],
          ["Projects/website/styles.css", 8_310],
          ["Projects/website/images/header.jpg", 412_330],
          ["Home/Insurance/home-contents-2026.pdf", 388_902],
          ["Home/Utilities/electricity-2026-08.pdf", 102_441],
          ["Recipes/sourdough.md", 3_120],
          ["Recipes/lentil-soup.md", 1_904],
        ],
      },
      { stamp: stamp(3 * 60 + 12), files: [["Projects/website/index.html", 6_388], ["Recipes/sourdough.md", 3_044]] },
      { stamp: stamp(26 * 60 + 40), files: [["Taxes/2025/receipts.pdf", 1_790_220], ["Home/Car/service-2026-09.pdf", 244_118], ["Projects/garden-planner/beds.svg", 18_402]] },
      { stamp: stamp(4 * 1440 + 95), files: [["Home/Insurance/home-contents-2025.pdf", 380_114]] },
      { stamp: stamp(12 * 1440 + 300), files: [["Taxes/2024/receipts.pdf", 1_612_004], ["Taxes/2024/tax-return.pdf", 902_331]] },
    ],
    "m2mini-to-storagebox": [{ stamp: stamp(15 * 60), files: [["Notes/shopping.md", 1_204], ["Screenshots/Screenshot 2026-09-22 at 10.14.03.png", 1_204_880]] }],
  };
  const archives: Record<string, { stamp: string; files: Files }[]> = englishData ? archivesEn : {
    "work-to-m2mini": [
      {
        stamp: stamp(33),
        files: [
          ["GM8/clonq/src/views/ArchivePanel.tsx", 6_812],
          ["GM8/clonq/src/views/FileBrowser.tsx", 9_904],
          ["GM8/clonq/src/views/JobDetail.tsx", 11_230],
          ["GM8/clonq/src/ui/UiReel.tsx", 1_102],
          ["GM8/clonq/src/ui/reels/licht/ReelShape.tsx", 7_455],
          ["GM8/clonq/src/styles/app.css", 8_310],
          ["GM8/clonq/docs/HANDOFF.md", 3_120],
          ["GM8/clonq/preview/scenes.ts", 14_880],
          ["GM8/matthiasg.rocks/public/images/halftone-portrait@2x.png", 1_824_331],
          ["GM8/matthiasg.rocks/src/pages/index.astro", 5_402],
          ["GM8/plxr/CHANGELOG.md", 21_730],
          ["Projekte/wetterstation/docs/logbuch/2026-09-18.md", 2_915],
          ["Projekte/wetterstation/docs/logbuch/2026-09-19.md", 3_402],
          ["Projekte/wetterstation/docs/migration-status.md", 12_044],
        ],
      },
      {
        stamp: stamp(190),
        files: [
          ["GM8/clonq/docs/PLAN.md", 4_388],
          ["GM8/clonq/src-tauri/src/browse.rs", 11_402],
          ["GM8/clonq/src/views/locations/LocationDetail.tsx", 18_220],
          ["GM8/clonq/src/views/locations/kinds.ts", 4_310],
        ],
      },
      {
        stamp: stamp(26 * 60 + 7),
        files: [
          ["GM8/conn-ui/package.json", 1_433],
          ["GM8/conn-ui/src/components/Elbow.tsx", 3_990],
          ["GM8/conn-ui/src/components/Frame.tsx", 5_112],
          ["GM8/plxr/site/assets/crt-glow.png", 412_330],
          ["Projekte/wetterstation/docs/api/endpoints.md", 9_871],
        ],
      },
      { stamp: stamp(4 * 1440 + 95), files: [["GM8/matthiasg.rocks/astro.config.mjs", 1_204], ["GM8/matthiasg.rocks/public/og.png", 188_220]] },
      {
        stamp: stamp(12 * 1440 + 300),
        files: [
          ["GM8/clonq/src-tauri/Cargo.lock", 98_442],
          ["GM8/clonq/src-tauri/src/engine.rs", 61_870],
          ["Projekte/wetterstation/docs/migration-plan.md", 7_730],
        ],
      },
      { stamp: stamp(28 * 1440 + 600), files: [["GM8/plxr/docs/notizen-alt.md", 2_044]] },
    ],
    "work-to-storagebox": [
      { stamp: stamp(52), files: [["GM8/clonq/src/views/JobDetail.tsx", 11_230], ["GM8/clonq/src/styles/app.css", 8_310], ["Projekte/wetterstation/docs/migration-status.md", 12_044]] },
      { stamp: stamp(2 * 1440 + 40), files: [["GM8/plxr/CHANGELOG.md", 21_402], ["GM8/matthiasg.rocks/public/og.png", 188_220]] },
    ],
    // The two-way job of the Modus block (?modusJob=1); its target side only, as the backend lists it.
    "fotos-beidseitig": [
      { stamp: stamp(3 * 60 + 12), files: [["2026/2026-09-14 Karwendel/IMG_4820.HEIC", 2_990_114], ["2026/2026-09-14 Karwendel/IMG_4823.HEIC", 3_120_877]] },
    ],
  };
  // Snapshot names of a versioned job end in milliseconds, newest first.
  const versionStamps = [12, 75, 9 * 60, 26 * 60, 2 * 1440 + 40, 4 * 1440 + 300, 8 * 1440 + 90, 15 * 1440 + 600, 27 * 1440 + 200, 41 * 1440, 55 * 1440 + 480].map(
    (minutes) => `${stamp(minutes)}-${String(minutes % 1000).padStart(3, "0")}`,
  );
  const emptied = params.get("panelsEmpty");
  if (emptied) archives[emptied] = [];
  const archiveOff = params.get("panelsArchiveOff");
  if (archiveOff) {
    scene.config = { ...scene.config, jobs: scene.config.jobs.map((job) => (job.id === archiveOff ? { ...job, archive: { ...job.archive, enabled: false } } : job)) };
    // After ?job= has opened the job (at 300 ms), so the announcement does not race the navigation.
    setTimeout(() => void emit("config-changed", scene.config), 600);
  }

  // [name, size or -1 for a folder, minutes since the last change]
  type Entry = [name: string, size: number, minutesAgo: number];
  const treesEn: Record<string, Record<string, Entry[]>> = {
    m2mini: {
      "": [["Photos", -1, 33], ["Videos", -1, 9 * 1440], ["Desktop Backup", -1, 15 * 60], [".Spotlight-V100", -1, 3 * 1440], [".DS_Store", 10_244, 2 * 1440]],
      Photos: [["2025", -1, 200 * 1440], ["2026", -1, 33], ["Scans", -1, 26 * 60]],
      "Photos/2026": [["Garden", -1, 190], ["Iceland", -1, 33], ["Lisbon", -1, 26 * 60]],
    },
    desktop: { "": [["Projects", -1, 60], ["Screenshots", -1, 15 * 60], ["Notes", -1, 300], ["Screenshot 2026-09-22 at 10.14.03.png", 1_204_880, 1440]] },
    documents: { "": [["Taxes", -1, 52], ["Projects", -1, 52], ["Home", -1, 3 * 1440], ["Recipes", -1, 190]] },
    box: {
      "": [["Photos", -1, 31]],
      Photos: [["2025", -1, 200 * 1440], ["2026", -1, 31], ["Scans", -1, 26 * 60]],
      "Photos/2026": [["Garden", -1, 190], ["Iceland", -1, 31], ["Lisbon", -1, 26 * 60]],
      "Photos/2026/Iceland": [
        ["IMG_4788.heic", 3_012_448, 31],
        ["IMG_4789.heic", 2_874_210, 31],
        ["IMG_4790.heic", 3_204_551, 31],
        ["IMG_4791.heic", 2_987_004, 31],
        ["IMG_4817.mov", 88_402_117, 31],
        ["IMG_4821.heic", 3_118_902, 31],
      ],
    },
    nas: { "": [["Documents", -1, 52], ["Projects", -1, 5 * 1440], ["Media", -1, 30 * 1440]], Documents: [["Taxes", -1, 52], ["Projects", -1, 52], ["Home", -1, 3 * 1440], ["Recipes", -1, 190]] },
    gdrive: { "": [["Backups", -1, 3 * 1440], ["Trip planning.md", 4_120, 2 * 1440], ["Household budget.xlsx", 38_912, 1440]] },
  };
  const trees: Record<string, Record<string, Entry[]>> = englishData ? treesEn : {
    m2mini: {
      "": [["WORK", -1, 33], ["Archiv", -1, 90 * 1440], ["Fotos", -1, 9 * 1440], [".Spotlight-V100", -1, 3 * 1440], [".fseventsd", -1, 40], [".DS_Store", 10_244, 2 * 1440]],
      WORK: [["GM8", -1, 33], ["Projekte", -1, 60], ["Musik", -1, 20 * 1440], [".clonq-archiv", -1, 33], [".DS_Store", 8_196, 5 * 1440]],
      "WORK/GM8": [["clonq", -1, 33], ["conn-ui", -1, 26 * 60], ["matthiasg.rocks", -1, 4 * 1440], ["plxr", -1, 33]],
      "WORK/GM8/clonq": [
        ["docs", -1, 190],
        ["preview", -1, 33],
        ["src", -1, 33],
        ["src-tauri", -1, 190],
        [".gitignore", 312, 30 * 1440],
        ["index.html", 402, 30 * 1440],
        ["package.json", 1_288, 6 * 1440],
        ["preview.html", 286, 12 * 1440],
        ["README.md", 2_904, 12 * 1440],
        ["tsconfig.json", 611, 30 * 1440],
        ["vite.config.ts", 540, 30 * 1440],
      ],
      "WORK/GM8/clonq/docs": [["HANDOFF.md", 3_188, 33], ["PLAN.md", 4_402, 190]],
      "WORK/GM8/clonq/src": [["hooks", -1, 2 * 1440], ["lib", -1, 190], ["styles", -1, 33], ["ui", -1, 33], ["views", -1, 33], ["main.tsx", 612, 20 * 1440]],
      "WORK/Projekte": [["wetterstation", -1, 60]],
      "WORK/Projekte/wetterstation": [["docs", -1, 60]],
      "WORK/Projekte/wetterstation/docs": [["api", -1, 26 * 60], ["logbuch", -1, 60], ["migration-plan.md", 7_812, 12 * 1440], ["migration-status.md", 12_310, 60]],
      Fotos: [["2025", -1, 200 * 1440], ["2026", -1, 9 * 1440]],
      "Fotos/2026": [["2026-08-02 Gardasee", -1, 50 * 1440], ["2026-09-14 Karwendel", -1, 9 * 1440]],
      "Fotos/2026/2026-09-14 Karwendel": [
        ["IMG_4818.HEIC", 3_012_448, 9 * 1440],
        ["IMG_4819.HEIC", 2_874_210, 9 * 1440],
        ["IMG_4821.HEIC", 3_204_551, 9 * 1440],
        ["IMG_4822.HEIC", 2_987_004, 9 * 1440],
        ["IMG_4825.JPG", 4_118_902, 9 * 1440],
        ["IMG_4826.MOV", 88_402_117, 9 * 1440],
      ],
    },
    desktop: {
      "": [["WORK", -1, 33], ["Bildschirmfoto 2026-09-22 um 10.14.03.png", 1_204_880, 1440], ["notizen.md", 1_402, 300]],
    },
    box: {
      "": [["M2mini", -1, 52], ["WORK", -1, 52]],
      M2mini: [["WORK", -1, 52], ["Archiv", -1, 90 * 1440], ["Fotos", -1, 9 * 1440]],
      WORK: [["GM8", -1, 52], ["Projekte", -1, 60], ["Musik", -1, 20 * 1440], [".clonq-archiv", -1, 52]],
      "WORK/GM8": [["clonq", -1, 52], ["conn-ui", -1, 26 * 60], ["matthiasg.rocks", -1, 4 * 1440], ["plxr", -1, 52]],
    },
    // The share and the Google Drive of the Orte block (?orteExtra=1).
    nas: {
      "": [["2025", -1, 200 * 1440], ["2026", -1, 9 * 1440], [".DS_Store", 6_148, 9 * 1440]],
      "2026": [["2026-08-02 Gardasee", -1, 50 * 1440], ["2026-09-14 Karwendel", -1, 9 * 1440], ["Bestellung Fotobuch.pdf", 2_410_221, 12 * 1440]],
    },
    gdrive: {
      "": [["Projekte", -1, 3 * 1440], ["Belege 2025", -1, 40 * 1440], ["Reiseplanung.md", 4_120, 2 * 1440], ["Haushaltsbuch.xlsx", 38_912, 1440]],
    },
  };
  // The Storage Box keeps its snapshots under .zfs/snapshot; each one holds the whole box as it was.
  const zfs: Entry[] = [0, 1, 2, 3, 4, 5, 6].map((day) => {
    const at = new Date(Date.now() - day * 86_400_000);
    return [`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T02-00-00`, -1, day * 1440 + 120];
  });

  const listing = (location: string, path: string): Entry[] | null => {
    // Inside a snapshot of the versioned job: its top level, the same in every snapshot.
    if (/^(Document Versions|Projekte-Versionen)\/\d{4}-/.test(path)) {
      return englishData
        ? [["Taxes", -1, 52], ["Projects", -1, 52], ["Home", -1, 3 * 1440], ["Recipes", -1, 190], ["Budget 2026.numbers", 412_880, 75], ["Lease.pdf", 1_204_331, 40 * 1440]]
        : [["clonq", -1, 12], ["plxr", -1, 75], ["wetterstation", -1, 3 * 1440], ["Notizen.md", 8_412, 75], [".DS_Store", 10_244, 1440]];
    }
    const tree = trees[location];
    if (!tree) return null;
    if (location === "box" && !params.get("panelsNoZfs")) {
      if (path === ".zfs/snapshot") return zfs;
      const inside = path.match(/^\.zfs\/snapshot\/[^/]+\/?(.*)$/);
      if (inside) return tree[inside[1] ?? ""] ?? [];
    }
    return tree[path] ?? (tree[path.split("/").slice(0, -1).join("/")]?.some(([name, size]) => name === path.split("/").at(-1) && size < 0) ? [] : null);
  };
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  const svg = (body: string) =>
    btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${body}</svg>`);
  const photo = svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d8fb8"/><stop offset="1" stop-color="#e9c9a1"/></linearGradient></defs>` +
      `<rect width="400" height="300" fill="url(#s)"/><circle cx="300" cy="80" r="26" fill="#fbe7c2"/>` +
      `<path d="M0 220 L70 130 L120 180 L190 90 L260 170 L310 120 L400 200 L400 300 L0 300 Z" fill="#4c5a6e"/>` +
      `<path d="M190 90 L210 115 L200 118 L185 108 L170 118 Z" fill="#f4f1ea"/>` +
      `<path d="M0 250 L90 200 L160 240 L240 205 L330 245 L400 225 L400 300 L0 300 Z" fill="#2f3b2e"/>`,
  );
  const texts: Record<string, string> = {
    "PLAN.md": [
      "# clonq – Bauplan",
      "",
      "clonq ist eine Mac-App für Sync und Backup. Vorbild ist ChronoSync, gebaut mit",
      "Tauri 2, React und rsync. Sie sitzt in der Menüleiste und hat ein Hauptfenster",
      "für Jobs, Verlauf und Dateibrowser.",
      "",
      "## Ziele",
      "",
      "- Mac-WORK (`~/Desktop/WORK`) → M.2-WORK (`/Volumes/M2mini/WORK`)",
      "- Mac-WORK → Hetzner Storage Box",
      "- M.2 → Storage Box (ohne WORK, das kommt vom Mac)",
      "- Status live, Verlauf, Start per Knopf, automatische Auslöser",
      "",
      "## Sicherheitsregeln",
      "",
      "- Fehlt die Quelle oder ist sie leer, bricht der Lauf ab.",
      "- Vor jedem Spiegel läuft ein Probelauf.",
    ].join("\n"),
    "notizen.md": "- Storage Box: Zugangsdaten kommen noch\n- Erstkopie M.2 → Schreibtisch erst nach Okay\n",
  };

  const failures: Record<string, string> = {
    archive_snapshots: "volume /Volumes/M2mini is not connected",
    archive_files: "2026-09-23_14-05-09 is not an archive folder",
    restore_archive: "restoring from the archive failed",
    version_snapshots: "volume /Volumes/M2mini is not connected",
    browse_list: "/Volumes/M2mini/WORK/Gesperrt cannot be read",
    browse_preview: "the file is too large for a preview",
    browse_download: "the copy failed",
    browse_delete: "moving to the Trash failed: the volume does not support the Trash",
  };
  const failing = params.get("panelsFail");

  const answer = (command: string, args: Record<string, unknown>): Promise<unknown> | undefined => {
    const job = String(args.jobId ?? "");
    const location = String(args.location ?? "");
    const path = String(args.path ?? "").replace(/^\/+|\/+$/g, "");
    const name = path.split("/").at(-1) ?? path;
    switch (command) {
      // The versioned job: every snapshot of the last day, one per day for a month, one per week before.
      case "version_snapshots":
        return later(job === "documents-versions" && emptied !== job ? versionStamps : [], 250);
      case "archive_snapshots":
        return later(
          // ?keptArchive=1 marks the oldest archive folder as kept by a repair.
          (archives[job] ?? []).map((item, index, all) => ({
            stamp: item.stamp,
            files: item.files.length,
            bytes: item.files.reduce((sum, [, size]) => sum + size, 0),
            kept: Boolean(params.get("keptArchive")) && index === all.length - 1,
          })),
          250,
        );
      case "archive_files": {
        const found = (archives[job] ?? []).find((item) => item.stamp === String(args.stamp));
        return later((found?.files ?? []).map(([file, size]) => ({ path: file, size })), 200);
      }
      case "restore_archive": {
        const jobName = scene.config.jobs.find((item) => item.id === job)?.name ?? job;
        return later(`/Users/matthias/Downloads/clonq-wiederhergestellt/${jobName}/${String(args.stamp)}`, 900);
      }
      case "browse_list": {
        const entries = listing(location, path);
        if (!entries) return later(null, 200).then(() => Promise.reject(`folder ${path} does not exist`));
        return later(
          entries.map(([entry, size, age]) => ({ name: entry, dir: size < 0, size: Math.max(0, size), modified: minutesAgo(age) })),
          location === "box" ? 450 : 150,
        );
      }
      case "browse_preview": {
        if (/\.(png|jpe?g|heic|gif|webp)$/i.test(name)) return later({ mime: "image/svg+xml", text: null, base64: photo }, 300);
        if (/\.mov$/i.test(name)) return later(null, 200).then(() => Promise.reject("there is no preview for this kind of file"));
        return later({ mime: "text/plain", text: texts[name] ?? `// ${path}\n\nexport {};\n`, base64: null }, 200);
      }
      case "browse_download": {
        const where = scene.config.locations.find((item) => item.id === location)?.name ?? location;
        return later(`/Users/matthias/Downloads/clonq-dateien/${where}/${name}`, 800);
      }
      case "browse_rename": {
        const parent = path.split("/").slice(0, -1).join("/");
        const siblings = trees[location]?.[parent];
        const wanted = String(args.newName ?? "");
        if (siblings?.some(([entry]) => entry === wanted)) return later(null, 300).then(() => Promise.reject(`${wanted} already exists`));
        const entry = siblings?.find(([entry]) => entry === name);
        if (entry) entry[0] = wanted;
        return later(null, 300);
      }
      case "browse_delete": {
        const parent = path.split("/").slice(0, -1).join("/");
        const tree = trees[location];
        if (tree?.[parent]) tree[parent] = tree[parent].filter(([entry]) => entry !== name);
        return later(null, 600);
      }
      default:
        return undefined;
    }
  };

  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown> } })
    .__TAURI_INTERNALS__;
  const inner = internals.invoke;
  const logging = params.get("panelsLog");
  internals.invoke = (command, args, options) => {
    if (logging && !command.startsWith("plugin:")) document.body.dataset.panelsCalls = `${document.body.dataset.panelsCalls ?? ""} ${command}`.trim();
    if (command === failing && failures[command]) return later(null, 500).then(() => Promise.reject(failures[command]));
    return answer(command, (args ?? {}) as Record<string, unknown>) ?? inner(command, args, options);
  };

  // ?panelsDrop=<locationId>: the next background round cannot reach that location.
  const dropped = params.get("panelsDrop");
  if (dropped) {
    setTimeout(() => {
      const index = scene.locations.findIndex((status) => status.id === dropped);
      const status = scene.locations[index];
      if (status) scene.locations[index] = { ...status, reach: { state: "failed", message: "no answer from the server (timeout)" } };
      void emit("servers-checked", null);
    }, 2500);
  }

  // ?panels=<scenario>: steps name headings, rows, buttons and fields by their visible text.
  // "focus" puts the keyboard on a button or a list (by its label), so "key" can press ↵ or ← there.
  type Step = ["scroll", string] | ["pick", string] | ["open", string] | ["click", string] | ["focus", string] | ["fill", string, string] | ["key", string, boolean?] | ["wait", number];
  const archive: Step[] = [["wait", 700], ["scroll", say("Archiv", "Archive")]];
  const files: Step[] = [["wait", 500], ["scroll", say("Dateien", "Files")]];
  const intoClonq: Step[] = [...files, ["open", "WORK"], ["wait", 250], ["open", "GM8"], ["wait", 250], ["open", "clonq"], ["wait", 250]];
  const photos: Step[] = [...files, ["open", "Fotos"], ["wait", 250], ["open", "2026"], ["wait", 250], ["open", "2026-09-14 Karwendel"], ["wait", 250]];
  const scenarios: Record<string, Step[]> = {
    archiv: archive,
    "archiv-datei": [...archive, ["pick", "38,3 KB"], ["wait", 400], ["pick", "LocationDetail.tsx"]],
    "archiv-suche": [...archive, ["fill", "Datei suchen", "clonq/src"]],
    "archiv-wiederhergestellt": [...archive, ["click", "Alle "], ["wait", 1200]],
    "archiv-datei-wiederhergestellt": [...archive, ["pick", "halftone-portrait@2x.png"], ["click", "Datei wiederherstellen"], ["wait", 1200]],
    "archiv-wird-wiederhergestellt": [...archive, ["click", "Alle "], ["wait", 300]],
    dateien: files,
    "dateien-ordner": [...intoClonq, ["pick", "package.json"]],
    "dateien-vorschau": [...intoClonq, ["open", "docs"], ["wait", 250], ["open", "PLAN.md"], ["wait", 400]],
    "dateien-bild": [...photos, ["open", "IMG_4821.HEIC"], ["wait", 500]],
    "dateien-loeschen": [...photos, ["pick", "IMG_4819.HEIC"], ["click", "Löschen"], ["wait", 200]],
    "dateien-geloescht": [...photos, ["pick", "IMG_4819.HEIC"], ["click", "Löschen"], ["wait", 200], ["click", "In den Papierkorb"], ["wait", 900]],
    "dateien-umbenennen": [...intoClonq, ["pick", "README.md"], ["click", "Umbenennen"], ["wait", 100], ["fill", "Neuer Name", "package.json"], ["key", "Enter"], ["wait", 200]],
    "dateien-kopiert": [...photos, ["pick", "IMG_4825.JPG"], ["click", "In Downloads kopieren"], ["wait", 1100]],
    "dateien-box-loeschen": [...files, ["open", "WORK"], ["wait", 600], ["pick", "Musik"], ["click", "Löschen"], ["wait", 200]],
    "dateien-snapshots": [...files, ["wait", 600], ["click", "Snapshots"], ["wait", 700]],
    "dateien-snapshot-innen": [...files, ["wait", 600], ["click", "Snapshots"], ["wait", 700], ["open", zfs[1]?.[0] ?? ""], ["wait", 600], ["open", "M2mini"], ["wait", 600], ["pick", "Fotos"]],
    "dateien-snapshot-zurueck": [...files, ["wait", 600], ["click", "Snapshots"], ["wait", 700], ["focus", "Inhalt von"], ["key", "ArrowLeft"], ["wait", 800]],
    "dateien-umbenennen-schreibweise": [...intoClonq, ["pick", "README.md"], ["click", "Umbenennen"], ["wait", 100], ["fill", "Neuer Name", "readme.md"], ["key", "Enter"], ["wait", 200]],
    "dateien-umbenennen-abbrechen": [...intoClonq, ["pick", "README.md"], ["click", "Umbenennen"], ["wait", 100], ["key", "Escape"], ["wait", 150], ["key", "Enter"], ["wait", 400]],
    "dateien-loeschen-abbrechen": [...photos, ["pick", "IMG_4819.HEIC"], ["click", "Löschen"], ["wait", 200], ["click", "Behalten"], ["wait", 150], ["key", "Enter"], ["wait", 400]],
    "dateien-netz-loeschen": [...files, ["open", "2026"], ["wait", 300], ["pick", "Bestellung Fotobuch.pdf"], ["click", "Löschen"], ["wait", 200]],
    "dateien-cloud-loeschen": [...files, ["wait", 300], ["pick", "Haushaltsbuch.xlsx"], ["click", "Löschen"], ["wait", 200]],
    "dateien-verbindung-weg": [...files, ["open", "WORK"], ["wait", 700], ["pick", "GM8"], ["wait", 2200]],
    "archiv-aendern-enter": [...archive, ["focus", "Ändern"], ["key", "Enter"], ["wait", 400]],
    // The controls for the checks above: ↵ with nothing focused still starts the job or checks the location.
    "archiv-enter-ohne-fokus": [...archive, ["key", "Enter"], ["wait", 400]],
    "dateien-enter-ohne-fokus": [...files, ["key", "Enter"], ["wait", 400]],
    "archiv-fehler-enter": [...archive, ["wait", 600], ["focus", "Erneut versuchen"], ["key", "Enter"], ["wait", 400]],
    "archiv-ziel-pruefen": [...archive, ["click", "Verbindung prüfen"], ["wait", 1800]],
    // The versioned job (?job=documents-versions).
    versionen: [["wait", 700], ["scroll", "Snapshots"]],
    "versionen-eintrag": [["wait", 700], ["scroll", "Snapshots"], ["pick", say("gestern", "yesterday")], ["wait", 400], ["pick", say("clonq", "Projects")], ["click", say("Eintrag wiederherstellen", "Restore item")], ["wait", 1200]],
    "versionen-wiederhergestellt": [["wait", 700], ["scroll", "Snapshots"], ["click", say("Snapshot wiederherstellen", "Restore snapshot")], ["wait", 1200]],
  };

  const visibleText = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
  const run = async (name: string) => {
    const steps = scenarios[name];
    if (!steps) return;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // Rows are looked for in the section scrolled to last, so the sidebar's rows never match.
    let scope: ParentNode = document;
    let heading: string | null = null;
    // A row whose name starts with the text comes first: dates in other columns contain years too.
    const row = (text: string) => {
      const rows = [...scope.querySelectorAll<HTMLElement>("[role=option]")];
      return rows.find((element) => visibleText(element).startsWith(text)) ?? rows.find((element) => visibleText(element).includes(text));
    };
    // Only the content column scrolls; scrollIntoView would move the preview desktop too.
    const align = (title: string) => {
      const section = [...document.querySelectorAll("h3")].find((element) => visibleText(element) === title)?.closest("section");
      const column = section?.closest<HTMLElement>(".overflow-y-auto");
      if (section && column) column.scrollTop += section.getBoundingClientRect().top - column.getBoundingClientRect().top - 16;
      if (section) scope = section;
    };
    // Once the steps are done the section is aligned again, since opening folders changes its height.
    setTimeout(() => heading && align(heading), 4600);
    for (const step of steps) {
      if (step[0] === "wait") await sleep(step[1]);
      if (step[0] === "scroll") {
        heading = step[1];
        align(step[1]);
      }
      if (step[0] === "pick") row(step[1])?.click();
      if (step[0] === "open") {
        // A double click is two clicks first, so the row is selected as well.
        const target = row(step[1]);
        target?.click();
        target?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      }
      if (step[0] === "click") {
        // Buttons in the section come first: the location header has an "Umbenennen" of its own.
        const inScope = [...scope.querySelectorAll<HTMLButtonElement>("button")];
        const buttons = [...inScope, ...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.disabled);
        const words = (button: HTMLButtonElement) => button.getAttribute("aria-label") ?? visibleText(button);
        (buttons.find((button) => words(button) === step[1]) ?? buttons.find((button) => words(button).startsWith(step[1])))?.click();
      }
      if (step[0] === "focus") {
        const targets = [...scope.querySelectorAll<HTMLElement>("button, [role=listbox]")];
        const words = (element: HTMLElement) => element.getAttribute("aria-label") ?? visibleText(element);
        (targets.find((element) => words(element) === step[1]) ?? targets.find((element) => words(element).startsWith(step[1])))?.focus();
      }
      if (step[0] === "fill") {
        const input = document.querySelector<HTMLInputElement>(`input[placeholder^="${step[1]}"]`);
        if (input) {
          input.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, step[2]);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      if (step[0] === "key") {
        const target = document.activeElement ?? document.body;
        // With ?panelsLog=1 the log also says where the key went, e.g. "key:Enter@div[listbox]".
        if (logging) document.body.dataset.panelsCalls = `${document.body.dataset.panelsCalls ?? ""} key:${step[1]}@${target.tagName.toLowerCase()}[${target.getAttribute("role") ?? target.getAttribute("aria-label") ?? ""}]`.trim();
        target.dispatchEvent(new KeyboardEvent("keydown", { key: step[1], metaKey: step[2] ?? false, bubbles: true, cancelable: true }));
      }
      await sleep(120);
    }
  };
  const scenario = params.get("panels");
  if (scenario) void run(scenario);
}
// --- end Panels ------------------------------------------------------------------------------

// --- Modus (two-way sync, conflict rules, archive in the job wizard) -------------------------
// Preview only. ?modus=<scenario> clicks through the job wizard to the "Art" step and beyond, so
// the headless preview can photograph it. A new job gets Schreibtisch/Fotos → M2mini/Fotos; with
// &edit=<jobId> the scenarios start from the stepper instead ("bearbeiten…"). Every step waits
// until what it needs is on screen (at most five seconds), instead of sleeping a fixed time.
// When the scenario is done, the dialog gets data-modus-done, so a driver knows when to shoot.
// Keyboard scenes are driven from outside with real key events, not from here.
{
  type ModusStep =
    | ["radio", string]
    | ["option", string]
    | ["button", string]
    | ["stepper", string]
    | ["select", string, string]
    | ["fill", string, string]
    | ["scroll", string]
    | ["scrollEnd"]
    | ["step", string];

  // The words come from the catalog of the language the wizard shows (?lang=), read once the dialog is open.
  const { texts } = await import("../src/i18n");
  /** The "step" that is reached once the job is created. */
  const CREATED = "created";
  const scenariosFor = (t: ReturnType<typeof texts>): Record<string, ModusStep[]> => {
    const w = t.wizard;
    // English: Desktop/Projects ⇄ Home NAS/Projects, which no job of the English data uses yet.
    const toArt: ModusStep[] = [
      ["radio", say("Schreibtisch", "Desktop")],
      ["option", say("Fotos", "Projects")],
      ["button", w.footer.next],
      ["step", w.steps.target],
      ["radio", say("M2mini", "Home NAS")],
      ["option", say("Fotos", "Projects")],
      ["button", w.footer.next],
      ["step", w.steps.mode],
    ];
    const twoWay: ModusStep[] = [...toArt, ["radio", t.common.mode.bidirectional]];
    const toName: ModusStep[] = [["button", w.footer.next], ["step", w.steps.triggers], ["button", w.footer.next], ["step", w.steps.name]];
    const CONFLICT_ROW = w.mode.conflictTitle;
    const ARCHIVE_ROW = w.mode.archiveTitle;
    const mirror = t.common.mode.mirror;
    const backup = t.common.mode.backup;
    const toModeStep: ModusStep[] = [["stepper", w.steps.mode], ["step", w.steps.mode]];
    return {
      art: toArt,
      spiegel: [...toArt, ["radio", mirror]],
      backup: [...toArt, ["radio", backup]],
      beidseitig: twoWay,
      versionen: [...toArt, ["radio", t.common.mode.versioned]],
      "versionen-name": [...toArt, ["radio", t.common.mode.versioned], ...toName],
      // Conflict rules and archive are folded rows; the first click on their title opens them.
      "beidseitig-offen": [...twoWay, ["button", CONFLICT_ROW], ["button", ARCHIVE_ROW]],
      "beide-behalten": [...twoWay, ["button", CONFLICT_ROW], ["select", w.mode.preferLabel, "none"]],
      "verlierer-loeschen": [...twoWay, ["button", CONFLICT_ROW], ["radio", w.mode.deleteLoser]],
      // The second click finds the switch inside, whose label is exactly the row's title.
      "archiv-aus": [...twoWay, ["button", ARCHIVE_ROW], ["button", ARCHIVE_ROW], ["scrollEnd"]],
      "archiv-tage": [...toArt, ["radio", mirror], ["button", ARCHIVE_ROW], ["fill", "30", "7"]],
      "archiv-ungueltig": [...toArt, ["radio", backup], ["button", ARCHIVE_ROW], ["fill", "30", "400"]],
      zusammenfassung: [...twoWay, ...toName],
      angelegt: [...twoWay, ...toName, ["button", w.footer.create], ["step", CREATED]],
      bearbeiten: toModeStep,
      "bearbeiten-unten": [...toModeStep, ["scrollEnd"]],
      "bearbeiten-beidseitig": [...toModeStep, ["radio", t.common.mode.bidirectional]],
      "bearbeiten-ausloeser": [...toModeStep, ["stepper", w.steps.triggers], ["step", w.steps.triggers]],
      "bearbeiten-ausloeser-unten": [...toModeStep, ["stepper", w.steps.triggers], ["step", w.steps.triggers], ["scrollEnd"]],
      "bearbeiten-beidseitig-name": [...toModeStep, ["radio", t.common.mode.bidirectional], ["stepper", w.steps.name], ["step", w.steps.name]],
    };
  };

  const scope = (): ParentNode => document.querySelector("[role=dialog]") ?? document;
  const words = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
  const enabled = (element: Element) => !(element as HTMLButtonElement).disabled;
  const scroller = () => scope().querySelector<HTMLElement>(".h-full.overflow-y-auto");
  const labelOf = (element: Element) => element.getAttribute("aria-label") ?? words(element);

  // What a step works on, or null while it is not there yet.
  const targetOf = (step: ModusStep): (() => boolean) | null => {
    switch (step[0]) {
      case "radio": {
        const radio = [...scope().querySelectorAll<HTMLElement>("[role=radio]")].find((item) => enabled(item) && words(item).includes(step[1]));
        return radio ? () => (radio.click(), true) : null;
      }
      case "option": {
        const option = [...scope().querySelectorAll<HTMLElement>("[role=option]")].find((item) => words(item) === step[1]);
        return option ? () => (option.click(), true) : null;
      }
      case "button": {
        const buttons = [...scope().querySelectorAll<HTMLButtonElement>("button, [role=switch]")].filter(enabled);
        const button = buttons.find((item) => labelOf(item) === step[1]) ?? buttons.find((item) => labelOf(item).startsWith(step[1]));
        return button ? () => (button.click(), true) : null;
      }
      case "stepper": {
        const button = [...scope().querySelectorAll<HTMLButtonElement>("nav button")].find((item) => enabled(item) && words(item).endsWith(step[1]));
        return button ? () => (button.click(), true) : null;
      }
      case "select": {
        const select = scope().querySelector<HTMLSelectElement>(`select[aria-label="${step[1]}"]`);
        if (!select) return null;
        return () => {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, step[2]);
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        };
      }
      case "fill": {
        const input = [...scope().querySelectorAll<HTMLInputElement>("input")].find((field) => field.value === step[1] && !field.disabled);
        if (!input) return null;
        return () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, step[2]);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        };
      }
      case "scroll": {
        const box = scroller();
        const heading = [...scope().querySelectorAll("span, h3")].find((element) => words(element) === step[1]);
        return box && heading ? () => ((box.scrollTop += heading.getBoundingClientRect().top - box.getBoundingClientRect().top - 8), true) : null;
      }
      case "scrollEnd": {
        const box = scroller();
        return box ? () => ((box.scrollTop = box.scrollHeight), true) : null;
      }
      case "step": {
        // The current step of the stepper, or the title of the sheet once the job is created.
        const current = scope().querySelector("nav [aria-current=step]");
        const reached = (current && words(current).endsWith(step[1])) || (step[1] === CREATED && (scope().textContent ?? "").includes(texts().wizard.title.done));
        return reached ? () => true : null;
      }
    }
  };

  const name = params.get("modus");
  if (name) {
    void (async () => {
      const frame = () => new Promise((resolve) => setTimeout(resolve, 50));
      // The language is known once the config has arrived, which is before the wizard opens.
      const opened = performance.now() + 5000;
      while (!document.querySelector("[role=dialog]") && performance.now() < opened) await frame();
      const steps = scenariosFor(texts())[name] ?? [];
      for (const step of steps) {
        const until = performance.now() + 5000;
        let run = targetOf(step);
        while (!run && performance.now() < until) {
          await frame();
          run = targetOf(step);
        }
        if (!run) {
          console.warn(`modus: step not reached`, step);
          break;
        }
        run();
        await frame();
      }
      (document.querySelector("[role=dialog]") ?? document.body).setAttribute("data-modus-done", name ?? "");
    })();
  }
}
// --- end Modus -------------------------------------------------------------------------------

// ?click=<text> presses the first button whose text contains <text>, once it is there.
const clickParam = params.get("click");
if (clickParam) {
  void (async () => {
    const until = performance.now() + 6000;
    while (performance.now() < until) {
      const button = [...document.querySelectorAll("button")].find((item) => (item.textContent ?? "").includes(clickParam));
      if (button) {
        button.click();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
}
