// The job wizard's working copy of a job, and everything derived from it.

import type { ClonqState } from "../../hooks/useClonq";
import { locationOf, messageLabel, placeLabel } from "../../lib/labels";
import type { Config, Job, JobInput, Location, LocationStatus, Mode, Place, Ring, Triggers } from "../../lib/types";
import { RINGS, ringOf } from "../../ui/rings";

export const STEPS = ["Quelle", "Ziel", "Art", "Auslöser", "Name"] as const;
export type Step = 0 | 1 | 2 | 3 | 4;
export const LAST_STEP: Step = 4;
export const ALL_STEPS: Step[] = [0, 1, 2, 3, 4];

/** Triggers as the form holds them: each one can be off and still keep its value. */
export interface TriggerDraft {
  onMount: boolean;
  onChange: boolean;
  changeSeconds: string;
  every: boolean;
  everyMinutes: string;
  daily: boolean;
  dailyAt: string;
  after: boolean;
  afterJob: string | null;
}

export interface Draft {
  source: Place | null;
  target: Place | null;
  /** Null until chosen: a new job does not start as a mirror by accident. */
  mode: Mode | null;
  excludes: string[];
  maxDeletePercent: string;
  triggers: TriggerDraft;
  /** Whether the triggers act; without triggers it does not matter. */
  enabled: boolean;
  name: string;
  /** False while the name follows the suggestion. */
  nameEdited: boolean;
  ring: Ring;
}

const DEFAULT_DELETE_PERCENT = 10;

export const ringName: Record<Ring, string> = {
  blue: "Blau",
  green: "Grün",
  red: "Rot",
  yellow: "Gelb",
  white: "Weiß",
};

function triggerDraft(triggers: Triggers | null): TriggerDraft {
  return {
    onMount: triggers?.onMount ?? false,
    onChange: triggers?.onChangeAfterSeconds != null,
    changeSeconds: String(triggers?.onChangeAfterSeconds ?? 60),
    every: triggers?.everyMinutes != null,
    everyMinutes: String(triggers?.everyMinutes ?? 60),
    daily: triggers?.dailyAt != null,
    dailyAt: triggers?.dailyAt ?? "02:00",
    after: triggers?.afterJob != null,
    afterJob: triggers?.afterJob ?? null,
  };
}

/** A ring no other job wears yet, or the next one in turn. */
function freeRing(config: Config | null): Ring {
  const jobs = config?.jobs ?? [];
  const used = new Set(jobs.map((job, index) => ringOf(job.ring, index)));
  return RINGS.find((ring) => !used.has(ring)) ?? ringOf(null, jobs.length);
}

export function draftFrom(job: Job | undefined, config: Config | null): Draft {
  if (job) {
    return {
      source: { ...job.source },
      target: { ...job.target },
      mode: job.mode,
      excludes: sortExcludes(job.excludes),
      maxDeletePercent: String(job.safety.maxDeletePercent),
      triggers: triggerDraft(job.triggers),
      enabled: job.enabled,
      name: job.name,
      nameEdited: true,
      ring: job.ring ?? ringOf(null, config?.jobs.findIndex((item) => item.id === job.id) ?? 0),
    };
  }
  return {
    source: null,
    target: null,
    mode: null,
    excludes: [],
    maxDeletePercent: String(DEFAULT_DELETE_PERCENT),
    triggers: triggerDraft(null),
    enabled: true,
    name: "",
    nameEdited: false,
    ring: freeRing(config),
  };
}

/** True once the draft holds something that closing the wizard would throw away. */
export function isDirty(draft: Draft, initial: Draft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(initial);
}

/** node_modules first, the rest in the order they were added. */
export function sortExcludes(excludes: string[]): string[] {
  const isNodeModules = (pattern: string) => pattern.replace(/^\/+|\/+$/g, "") === "node_modules";
  return [...excludes.filter(isNodeModules), ...excludes.filter((pattern) => !isNodeModules(pattern))];
}

// ── Places ──────────────────────────────────────────────────────────────────

export function trimPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

export function joinPath(...parts: string[]): string {
  return parts.map(trimPath).filter(Boolean).join("/");
}

export function samePlace(a: Place | null, b: Place | null): boolean {
  return a !== null && b !== null && a.location === b.location && trimPath(a.path) === trimPath(b.path);
}

/** "WORK" for Schreibtisch/WORK, the location's own name for the whole location. */
function placeName(place: Place, config: Config | null): string {
  const path = trimPath(place.path);
  if (path) return path.split("/").at(-1) ?? path;
  return locationOf(place, config)?.name ?? "";
}

export function nameTaken(name: string, config: Config | null, jobId: string | null): boolean {
  const wanted = name.trim().toLowerCase();
  return (config?.jobs ?? []).some((job) => job.id !== jobId && job.name.trim().toLowerCase() === wanted);
}

/**
 * "WORK → M2mini": the folder that is copied, and the location it goes to. When another job
 * already has that name, the target's path is added, and after that a number.
 */
export function suggestName(draft: Draft, config: Config | null, jobId: string | null): string {
  if (!draft.source || !draft.target) return "";
  const taken = (name: string) => nameTaken(name, config, jobId);
  const from = placeName(draft.source, config);
  const short = `${from} → ${locationOf(draft.target, config)?.name ?? ""}`;
  if (!taken(short)) return short;
  const long = `${from} → ${placeLabel(draft.target, config)}`;
  if (!taken(long)) return long;
  let number = 2;
  while (taken(`${long} (${number})`)) number += 1;
  return `${long} (${number})`;
}

/** Why a location cannot serve as this end of a job right now, as a sentence, or null. */
export function reachProblem(location: Location, role: "source" | "target", state: ClonqState): string | null {
  if (role === "source" && location.kind.type === "ssh") return "Ein Server kann noch nicht als Quelle dienen.";
  const reach = state.locations[location.id]?.reach;
  switch (reach?.state) {
    case "connected":
      return null;
    case "disconnected":
      return `${location.name} ist nicht angeschlossen.`;
    case "missing":
      return `Den Ordner von ${location.name} gibt es nicht mehr.`;
    case "untested":
      return `Die Verbindung zu ${location.name} wird noch geprüft.`;
    case "failed":
      return `${location.name} ist gerade nicht erreichbar.`;
    default:
      return `Der Zustand von ${location.name} ist unbekannt.`;
  }
}

/** Where a place is on this Mac, when that can be known without asking the Rust side. */
function localPath(place: Place, location: Location | undefined, status: LocationStatus | undefined): string | null {
  if (!location) return null;
  let base: string | null = null;
  if (location.kind.type === "folder") base = location.kind.path;
  if (location.kind.type === "volume") {
    base = status?.reach.state === "connected" && status.reach.path ? status.reach.path : `/Volumes/${location.kind.volumeName}`;
  }
  if (base === null) return null;
  return `/${joinPath(base, place.path)}`;
}

function inside(outer: string, inner: string): boolean {
  return outer === "/" || inner.startsWith(`${outer.replace(/\/+$/, "")}/`);
}

export type Overlap = "same" | "targetInSource" | "sourceInTarget";

/** How two places overlap, as far as can be seen from here, or null when they do not. */
export function overlapOf(source: Place, target: Place, state: ClonqState): Overlap | null {
  let a: string | null;
  let b: string | null;
  if (source.location === target.location) {
    a = `/${trimPath(source.path)}`;
    b = `/${trimPath(target.path)}`;
  } else {
    a = localPath(source, locationOf(source, state.config), state.locations[source.location]);
    b = localPath(target, locationOf(target, state.config), state.locations[target.location]);
  }
  if (a === null || b === null) return null;
  if (a === b) return "same";
  if (inside(a, b)) return "targetInSource";
  if (inside(b, a)) return "sourceInTarget";
  return null;
}

/** The overlap in words, seen from the end that is being chosen, with what to do instead. */
export function overlapText(overlap: Overlap, role: "source" | "target", other: string): string {
  if (overlap === "same") {
    return `Quelle und Ziel sind derselbe Ordner. Wähle als ${role === "source" ? "Quelle" : "Ziel"} einen anderen Ordner.`;
  }
  if (overlap === "targetInSource") {
    return role === "target"
      ? `Dieses Ziel liegt innerhalb der Quelle ${other}. Jeder Lauf würde das Ziel in sich selbst kopieren. Wähle ein Ziel außerhalb der Quelle.`
      : `Das Ziel ${other} liegt innerhalb dieser Quelle. Jeder Lauf würde das Ziel in sich selbst kopieren. Wähle eine Quelle, die das Ziel nicht enthält.`;
  }
  return role === "target"
    ? `Die Quelle ${other} liegt innerhalb dieses Ziels. Ein Spiegel würde hier alles außer der Quelle löschen. Wähle ein Ziel, das die Quelle nicht enthält.`
    : `Diese Quelle liegt innerhalb des Ziels ${other}. Ein Spiegel würde im Ziel alles außer der Quelle löschen. Wähle eine Quelle außerhalb des Ziels.`;
}

/** The overlap between the end being chosen and the other end, or null. */
export function clashOf(place: Place, role: "source" | "target", other: Place | null, state: ClonqState): Overlap | null {
  if (!other) return null;
  return role === "target" ? overlapOf(other, place, state) : overlapOf(place, other, state);
}

export interface PlaceUse {
  job: Job;
  index: number;
  role: "source" | "target";
}

/** Jobs that already copy from or into exactly this place. */
export function jobsAt(place: Place, config: Config | null, jobId: string | null): PlaceUse[] {
  const found: PlaceUse[] = [];
  (config?.jobs ?? []).forEach((job, index) => {
    if (job.id === jobId) return;
    if (samePlace(job.source, place)) found.push({ job, index, role: "source" });
    else if (samePlace(job.target, place)) found.push({ job, index, role: "target" });
  });
  return found;
}

// ── Triggers ────────────────────────────────────────────────────────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function wholeNumber(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 1 ? value : null;
}

/** The problem with the trigger settings, as a sentence, or null. */
export function triggerProblem(triggers: TriggerDraft): string | null {
  if (triggers.onChange && wholeNumber(triggers.changeSeconds) === null) return "Die Ruhezeit muss eine ganze Zahl von mindestens einer Sekunde sein.";
  if (triggers.every && wholeNumber(triggers.everyMinutes) === null) return "Der Abstand muss eine ganze Zahl von mindestens einer Minute sein.";
  if (triggers.daily && !TIME.test(triggers.dailyAt.trim())) return "Die Uhrzeit ist ungültig.";
  if (triggers.after && !triggers.afterJob) return "Es ist noch kein Job gewählt, nach dem dieser laufen soll.";
  return null;
}

/**
 * Jobs this one may follow: all others except those that, through their own chain, already run
 * after this one. Following one of them would make the jobs start each other without end.
 */
export function followableJobs(config: Config | null, jobId: string | null): { jobs: Job[]; excluded: number } {
  const all = (config?.jobs ?? []).filter((job) => job.id !== jobId);
  if (!jobId) return { jobs: all, excluded: 0 };
  const byId = new Map(all.map((job) => [job.id, job]));
  const runsAfterThis = (job: Job): boolean => {
    const seen = new Set<string>();
    let current: Job | undefined = job;
    while (current?.triggers.afterJob && !seen.has(current.id)) {
      if (current.triggers.afterJob === jobId) return true;
      seen.add(current.id);
      current = byId.get(current.triggers.afterJob);
    }
    return false;
  };
  const jobs = all.filter((job) => !runsAfterThis(job));
  return { jobs, excluded: all.length - jobs.length };
}

function toTriggers(triggers: TriggerDraft): Triggers {
  return {
    onMount: triggers.onMount,
    onChangeAfterSeconds: triggers.onChange ? wholeNumber(triggers.changeSeconds) : null,
    everyMinutes: triggers.every ? wholeNumber(triggers.everyMinutes) : null,
    dailyAt: triggers.daily ? triggers.dailyAt.trim() : null,
    afterJob: triggers.after ? triggers.afterJob : null,
  };
}

export function hasAutomatic(triggers: Triggers): boolean {
  return (
    triggers.onMount ||
    triggers.onChangeAfterSeconds !== null ||
    triggers.everyMinutes !== null ||
    triggers.dailyAt !== null ||
    triggers.afterJob !== null
  );
}

/** Words for each active trigger, e.g. "beim Anstecken", "täglich um 02:00 Uhr". */
export function triggerWords(triggers: Triggers, config: Config | null): string[] {
  const words: string[] = [];
  if (triggers.onMount) words.push("beim Anstecken");
  if (triggers.onChangeAfterSeconds !== null) words.push(`bei Änderungen nach ${seconds(triggers.onChangeAfterSeconds)} Ruhe`);
  if (triggers.everyMinutes !== null) words.push(everyWords(triggers.everyMinutes));
  if (triggers.dailyAt !== null) words.push(`täglich um ${triggers.dailyAt} Uhr`);
  if (triggers.afterJob !== null) {
    const name = config?.jobs.find((job) => job.id === triggers.afterJob)?.name ?? "einem anderen Job";
    words.push(`nach „${name}“`);
  }
  return words;
}

/** A few words for the triggers, for the label on the tape, e.g. "täglich 02:00 +1". */
export function triggerTag(triggers: Triggers): string {
  const words: string[] = [];
  if (triggers.onMount) words.push("Anstecken");
  if (triggers.onChangeAfterSeconds !== null) words.push("Änderungen");
  if (triggers.everyMinutes !== null) words.push(everyWords(triggers.everyMinutes));
  if (triggers.dailyAt !== null) words.push(`täglich ${triggers.dailyAt}`);
  if (triggers.afterJob !== null) words.push("nach Job");
  const [first] = words;
  if (!first) return "von Hand";
  return words.length > 1 ? `${first} +${words.length - 1}` : first;
}

function seconds(value: number): string {
  return value === 1 ? "einer Sekunde" : `${value} Sekunden`;
}

function everyWords(minutes: number): string {
  if (minutes === 1) return "jede Minute";
  if (minutes % 60 === 0) return minutes === 60 ? "stündlich" : `alle ${minutes / 60} Stunden`;
  return `alle ${minutes} Minuten`;
}

// ── Saving ──────────────────────────────────────────────────────────────────

export function percentOf(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  if (text.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export function toInput(draft: Draft, job: Job | undefined, name: string, config: Config | null): JobInput | null {
  // Only a mirror deletes; for the other modes a stray value falls back to the default.
  const percent = percentOf(draft.maxDeletePercent) ?? (draft.mode === "mirror" ? null : DEFAULT_DELETE_PERCENT);
  if (!draft.source || !draft.target || !draft.mode || percent === null) return null;
  return {
    id: job?.id ?? null,
    name: name.trim(),
    source: { location: draft.source.location, path: trimPath(draft.source.path) },
    target: { location: draft.target.location, path: trimPath(draft.target.path) },
    mode: draft.mode,
    excludes: draft.excludes,
    maxDeletePercent: percent,
    ring: draft.ring,
    // "When plugged in" only means something while a side of the job is a drive.
    triggers: { ...toTriggers(draft.triggers), onMount: draft.triggers.onMount && drivesOf(draft, config).length > 0 },
    enabled: draft.enabled,
    // The wizard does not show the archive and the conflict rules yet; an edited job keeps its own,
    // a new one gets the defaults of the Rust side.
    archive: job?.archive,
    conflicts: job?.conflicts,
  };
}

/** The job as the Rust side would take it back, e.g. to undo a deletion. */
export function inputOf(job: Job): JobInput {
  return {
    id: job.id,
    name: job.name,
    source: job.source,
    target: job.target,
    mode: job.mode,
    excludes: job.excludes,
    maxDeletePercent: job.safety.maxDeletePercent,
    ring: job.ring,
    triggers: job.triggers,
    enabled: job.enabled,
    archive: job.archive,
    conflicts: job.conflicts,
  };
}

/** Drives on either side of the job, which is what "when plugged in" needs. */
export function drivesOf(draft: Draft, config: Config | null): Location[] {
  return [draft.source, draft.target]
    .map((place) => (place ? locationOf(place, config) : undefined))
    .filter((location): location is Location => location?.kind.type === "volume");
}

export interface SaveFailure {
  /** The message, in German where the words are known. */
  text: string;
  /** The step where the cause can be fixed, or null. */
  step: Step | null;
  /** What to do about it, when that can be said. */
  advice: string | null;
}

/** Sorts an error of save_job to the step it belongs to. */
export function saveFailure(message: string, input: JobInput, config: Config | null): SaveFailure {
  const sourceName = locationOf(input.source, config)?.name;
  const targetName = locationOf(input.target, config)?.name;
  const sideOf = (name: string | undefined): Step | null => (name === undefined ? null : name === sourceName ? 0 : name === targetName ? 1 : null);

  const disconnected = message.match(/^(?:volume )?(.+) is not connected$/);
  if (disconnected) {
    return { text: `${messageLabel(message)}.`, step: sideOf(disconnected[1]), advice: "Schließe das Laufwerk an, um den Job zu speichern." };
  }
  const untested = message.match(/^(.+) has not been tested yet$/);
  if (untested) return { text: `${messageLabel(message)}.`, step: sideOf(untested[1]), advice: "Dort lässt sich die Verbindung prüfen." };
  const gone = message.match(/^(.+) no longer exists$/);
  if (gone) return { text: `${messageLabel(message)}.`, step: sideOf(gone[1]), advice: "Wähle dort einen anderen Ort." };
  // "<location>: <reason>" when a server or a cloud could not be reached.
  const failed = message.match(/^(.+?): (.+)$/);
  if (failed && sideOf(failed[1]) !== null) {
    return { text: `${failed[1]}: ${messageLabel(failed[2] ?? "")}.`, step: sideOf(failed[1]), advice: "Dort lässt sich die Verbindung prüfen." };
  }
  if (/^source /.test(message)) return { text: `${messageLabel(message)}.`, step: 0, advice: "Wähle eine andere Quelle." };
  if (/^target /.test(message)) return { text: `${messageLabel(message)}.`, step: 1, advice: "Wähle ein anderes Ziel." };
  if (/same folder|lies inside/.test(message)) return { text: `${messageLabel(message)}.`, step: 1, advice: "Wähle ein anderes Ziel." };
  if (/deletion limit/.test(message)) return { text: messageLabel(message), step: 2, advice: null };
  if (/is not a time like/.test(message)) return { text: messageLabel(message), step: 3, advice: null };
  if (/^job .+ does not exist$/.test(message) && input.triggers.afterJob) {
    return { text: messageLabel(message), step: 3, advice: "Wähle einen anderen Job, nach dem dieser laufen soll." };
  }
  if (/name is required/.test(message)) return { text: `${messageLabel(message)}.`, step: 4, advice: null };
  return { text: messageLabel(message), step: null, advice: null };
}
