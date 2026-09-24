// The job wizard's working copy of a job, and everything derived from it.

import type { ClonqState } from "../../hooks/useClonq";
import { texts } from "../../i18n";
import { locationOf, messageLabel, placeLabel } from "../../lib/labels";
import type { Config, ConflictPrefer, Conflicts, Job, JobInput, Location, LocationStatus, Mode, Place, Ring, Triggers } from "../../lib/types";
import { RINGS, ringOf } from "../../ui/rings";

export type Step = 0 | 1 | 2 | 3 | 4;
const STEP_KEYS = ["source", "target", "mode", "triggers", "name"] as const;

/** The name of a step, as the stepper shows it. */
export function stepLabel(step: Step): string {
  return texts().wizard.steps[STEP_KEYS[step]];
}

/** The words of the link that jumps to a step. */
export function jumpLabel(step: Step): string {
  return texts().wizard.jump[STEP_KEYS[step]];
}
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

/** The archive as the form holds it: the days as typed, kept while the archive is off. */
export interface ArchiveDraft {
  enabled: boolean;
  keepDays: string;
}

export interface Draft {
  source: Place | null;
  target: Place | null;
  /** Null until chosen: a new job does not start as a mirror by accident. */
  mode: Mode | null;
  excludes: string[];
  maxDeletePercent: string;
  archive: ArchiveDraft;
  /** Only used by a two-way job, but kept while another mode is tried. */
  conflicts: Conflicts;
  triggers: TriggerDraft;
  /** Whether the triggers act; without triggers it does not matter. */
  enabled: boolean;
  name: string;
  /** False while the name follows the suggestion. */
  nameEdited: boolean;
  ring: Ring;
}

const DEFAULT_DELETE_PERCENT = 10;
/** The defaults of the Rust side, see Archive and Conflicts in src-tauri/src/config.rs. */
const DEFAULT_KEEP_DAYS = 30;
const DEFAULT_CONFLICTS: Conflicts = { prefer: "newer", loser: "keep" };

function triggerDraft(triggers: Triggers | null): TriggerDraft {
  return {
    onMount: triggers?.onMount ?? false,
    onChange: triggers?.onChangeAfterSeconds != null,
    changeSeconds: String(triggers?.onChangeAfterSeconds ?? 10),
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
      archive: { enabled: job.archive.enabled, keepDays: String(job.archive.keepDays) },
      conflicts: { ...job.conflicts },
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
    archive: { enabled: true, keepDays: String(DEFAULT_KEEP_DAYS) },
    conflicts: { ...DEFAULT_CONFLICTS },
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
  // Two-way jobs get ⇄, the others the one-way →.
  const arrow = draft.mode === "bidirectional" ? "⇄" : "→";
  const short = `${from} ${arrow} ${locationOf(draft.target, config)?.name ?? ""}`;
  if (!taken(short)) return short;
  const long = `${from} ${arrow} ${placeLabel(draft.target, config)}`;
  if (!taken(long)) return long;
  let number = 2;
  while (taken(`${long} (${number})`)) number += 1;
  return `${long} (${number})`;
}

/** Why a location cannot serve as this end of a job right now, as a sentence, or null. */
export function reachProblem(location: Location, state: ClonqState): string | null {
  const reach = state.locations[location.id]?.reach;
  const t = texts().wizard.reach;
  switch (reach?.state) {
    case "connected":
      return null;
    case "disconnected":
      return t.disconnected(location.name);
    case "missing":
      return t.missing(location.name);
    case "untested":
      return t.untested(location.name);
    case "failed":
      return t.failed(location.name);
    default:
      return t.unknown(location.name);
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
  const t = texts().wizard.overlap;
  if (overlap === "same") return t.same(role);
  if (overlap === "targetInSource") return role === "target" ? t.targetInSourceForTarget(other) : t.targetInSourceForSource(other);
  return role === "target" ? t.sourceInTargetForTarget(other) : t.sourceInTargetForSource(other);
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
  const t = texts().wizard.problem;
  if (triggers.onChange && wholeNumber(triggers.changeSeconds) === null) return t.quietTime;
  if (triggers.every && wholeNumber(triggers.everyMinutes) === null) return t.interval;
  if (triggers.daily && !TIME.test(triggers.dailyAt.trim())) return t.time;
  if (triggers.after && !triggers.afterJob) return t.noAfterJob;
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

/** Words for each active trigger, e.g. "when plugged in", "daily at 02:00". */
export function triggerWords(triggers: Triggers, config: Config | null): string[] {
  const t = texts().wizard.words;
  const words: string[] = [];
  if (triggers.onMount) words.push(t.onMount);
  if (triggers.onChangeAfterSeconds !== null) words.push(t.onChange(triggers.onChangeAfterSeconds));
  if (triggers.everyMinutes !== null) words.push(t.every(triggers.everyMinutes));
  if (triggers.dailyAt !== null) words.push(t.daily(triggers.dailyAt));
  if (triggers.afterJob !== null) words.push(t.after(config?.jobs.find((job) => job.id === triggers.afterJob)?.name ?? null));
  return words;
}

/** A few words for the triggers, for the label on the tape, e.g. "daily 02:00 +1". */
export function triggerTag(triggers: Triggers): string {
  const { tag, words: every, standalone } = texts().wizard;
  const words: string[] = [];
  if (triggers.onMount) words.push(tag.onMount);
  if (triggers.onChangeAfterSeconds !== null) words.push(tag.onChange);
  if (triggers.everyMinutes !== null) words.push(every.every(triggers.everyMinutes));
  if (triggers.dailyAt !== null) words.push(tag.daily(triggers.dailyAt));
  if (triggers.afterJob !== null) words.push(tag.after);
  const [first] = words;
  if (!first) return standalone(tag.manual);
  return standalone(words.length > 1 ? `${first} +${words.length - 1}` : first);
}

// ── Two-way sync and archive ────────────────────────────────────────────────

/** Whether a run of this mode deletes, so that the deletion limit applies. */
export function deletesIn(mode: Mode | null): boolean {
  return mode === "mirror" || mode === "bidirectional";
}

/** Days to keep archived files: a whole number from 1 to 365, or null. */
export function keepDaysOf(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 1 && value <= 365 ? value : null;
}

export function archiveProblem(archive: ArchiveDraft): string | null {
  return archive.enabled && keepDaysOf(archive.keepDays) === null ? texts().wizard.problem.keepDays : null;
}

/** The problem with the mode step, as a sentence, or null. */
export function modeProblem(draft: Draft): string | null {
  if (!draft.mode) return texts().wizard.problem.noMode;
  if (deletesIn(draft.mode) && percentOf(draft.maxDeletePercent) === null) return texts().wizard.problem.percent;
  return archiveProblem(draft.archive);
}

/** The order in which the menu shows the winners of a conflict. */
const PREFER_ORDER: ConflictPrefer[] = ["newer", "older", "larger", "smaller", "source", "target", "none"];

/** The choices for the winner of a conflict, in the order the menu shows them. */
export function preferChoices(): { value: ConflictPrefer; label: string; tag: string }[] {
  const prefer = texts().wizard.conflict.prefer;
  return PREFER_ORDER.map((value) => ({ value, ...prefer[value] }));
}

/** The conflict rule in a few words, for the label on the tape, e.g. "Newer wins". */
export function conflictTag(conflicts: Conflicts): string {
  return texts().wizard.conflict.prefer[conflicts.prefer].tag;
}

/** The winner of a conflict, e.g. "Newer version wins". */
export function preferLabel(prefer: ConflictPrefer): string {
  return texts().wizard.conflict.prefer[prefer].label;
}

// With "none" the loser setting does not apply. The draft still keeps and sends it, so that it is
// back when another winner is chosen. Checked with rclone 1.75.1: bisync with --conflict-resolve
// none and --conflict-loser delete renames both copies (.conflict1, .conflict2) and deletes neither.

/** What happens to the losing copy, as a sentence; it depends on the archive. */
export function loserSentence(conflicts: Conflicts, archive: boolean): string {
  const t = texts().wizard.conflict;
  if (conflicts.prefer === "none") return t.bothKept;
  if (conflicts.loser === "keep") return t.renamed(t.example);
  return archive ? t.archived : t.deleted;
}

/** The whole conflict rule in a few words, for the summary, e.g. "Newer wins, losing copy renamed". */
export function conflictSummary(conflicts: Conflicts, archive: boolean): string {
  const t = texts().wizard.conflict;
  const tag = conflictTag(conflicts);
  if (conflicts.prefer === "none") return tag;
  if (conflicts.loser === "keep") return t.summaryRenamed(tag);
  return archive ? t.summaryArchived(tag) : t.summaryDeleted(tag);
}

/** The folder at the top of every target (on both sides of a two-way job) that holds the archive. */
export const ARCHIVE_FOLDER = ".clonq-archiv";

/**
 * Where archived files are kept, in words that go around the folder name: before it and after it.
 * "That long" refers to the days beside the sentence.
 */
export function archivePlace(mode: Mode | null): [string, string] {
  const t = texts().wizard.mode;
  const words = mode === "bidirectional" ? t.archiveTwoWay : t.archiveOneWay;
  return [words.before, words.after];
}

/**
 * What the first run of a two-way job does. It merges both sides (bisync --resync) and deletes
 * nothing, but where a file differs on both sides it keeps one version and overwrites the other;
 * "none" only applies from the second run on.
 */
export function firstRunSentences(conflicts: Conflicts, archive: boolean): string[] {
  // The winner of the first run is the one resync_args in engine.rs picks.
  const t = texts().wizard.conflict;
  const winner = t.firstRunWinner[conflicts.prefer];
  return [t.firstRun, archive ? t.firstRunArchived(winner) : t.firstRunOverwritten(winner), ...(conflicts.prefer === "none" ? [t.firstRunNone] : [])];
}

// ── Saving ──────────────────────────────────────────────────────────────────

export function percentOf(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  if (text.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export function toInput(draft: Draft, job: Job | undefined, name: string, config: Config | null): JobInput | null {
  // Only a mirror and a two-way job delete; for the other modes a stray value falls back to the
  // job's own limit, and for a new job to the default.
  const percent = percentOf(draft.maxDeletePercent) ?? (deletesIn(draft.mode) ? null : (job?.safety.maxDeletePercent ?? DEFAULT_DELETE_PERCENT));
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
    // While the archive is off its days cannot be typed, so a stray value falls back to the last good one.
    archive: { enabled: draft.archive.enabled, keepDays: keepDaysOf(draft.archive.keepDays) ?? job?.archive.keepDays ?? DEFAULT_KEEP_DAYS },
    conflicts: { ...draft.conflicts },
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
  /** The message, in the interface language where the words are known. */
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
  const advice = texts().wizard.advice;
  const sideOf = (name: string | undefined): Step | null => (name === undefined ? null : name === sourceName ? 0 : name === targetName ? 1 : null);

  const disconnected = message.match(/^(?:volume )?(.+) is not connected$/);
  if (disconnected) {
    return { text: `${messageLabel(message)}.`, step: sideOf(disconnected[1]), advice: advice.connectDrive };
  }
  const untested = message.match(/^(.+) has not been tested yet$/);
  if (untested) return { text: `${messageLabel(message)}.`, step: sideOf(untested[1]), advice: advice.checkThere };
  const gone = message.match(/^(.+) no longer exists$/);
  if (gone) return { text: `${messageLabel(message)}.`, step: sideOf(gone[1]), advice: advice.otherLocation };
  // "<location>: <reason>" when a server or a cloud could not be reached.
  const failed = message.match(/^(.+?): (.+)$/);
  if (failed && sideOf(failed[1]) !== null) {
    return { text: `${failed[1]}: ${messageLabel(failed[2] ?? "")}.`, step: sideOf(failed[1]), advice: advice.checkThere };
  }
  if (/^source /.test(message)) return { text: `${messageLabel(message)}.`, step: 0, advice: advice.otherSource };
  if (/^target /.test(message)) return { text: `${messageLabel(message)}.`, step: 1, advice: advice.otherTarget };
  if (/same folder|lies inside/.test(message)) return { text: `${messageLabel(message)}.`, step: 1, advice: advice.otherTarget };
  if (/deletion limit/.test(message)) return { text: messageLabel(message), step: 2, advice: null };
  if (/is not a time like/.test(message)) return { text: messageLabel(message), step: 3, advice: null };
  if (/^job .+ does not exist$/.test(message) && input.triggers.afterJob) {
    return { text: messageLabel(message), step: 3, advice: advice.otherAfterJob };
  }
  if (/name is required/.test(message)) return { text: `${messageLabel(message)}.`, step: 4, advice: null };
  return { text: messageLabel(message), step: null, advice: null };
}
