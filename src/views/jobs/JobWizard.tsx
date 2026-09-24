import { FlaskConical } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import { refreshLocations, type ClonqState } from "../../hooks/useClonq";
import { texts, useT } from "../../i18n";
import { api } from "../../lib/api";
import { jobActions } from "../../lib/jobs";
import { locationOf, modeLabel, placeLabel } from "../../lib/labels";
import { openSheet, useNav } from "../../lib/nav";
import type { Job, Place } from "../../lib/types";
import { UiButton, UiSheet } from "../../ui";
import { UiConfirmBar } from "../../ui/UiConfirmBar";
import { UiLamp } from "../../ui/UiLamp";
import { UiLinkButton } from "../../ui/UiLinkButton";
import { UiStepper, type UiStepperStep } from "../../ui/UiStepper";
import { UiTapePath, type UiTapeEnd, type UiTapeTag } from "../../ui/UiTapePath";
import { UiToast } from "../../ui/UiToast";
import { DoneStep } from "./DoneStep";
import {
  ALL_STEPS,
  LAST_STEP,
  clashOf,
  conflictTag,
  draftFrom,
  drivesOf,
  hasAutomatic,
  isDirty,
  jumpLabel,
  loserSentence,
  modeProblem,
  versionedProblem,
  nameTaken,
  overlapText,
  preferLabel,
  reachProblem,
  samePlace,
  saveFailure,
  sortExcludes,
  stepLabel,
  suggestName,
  toInput,
  triggerProblem,
  triggerTag,
  triggerWords,
  trimPath,
  type Draft,
  type SaveFailure,
  type Step,
} from "./draft";
import { hideJobToast, showJobToast, useJobToast } from "./jobToast";
import { ModeStep } from "./ModeStep";
import { NameStep } from "./NameStep";
import { PlaceStep } from "./PlaceStep";
import { TriggerStep } from "./TriggerStep";

interface JobWizardProps {
  open: boolean;
  state: ClonqState;
  /** Set when an existing job is edited. */
  job?: Job;
  onClose: () => void;
  onSaved: (job: Job) => void;
}

/** While a new location is being added, the wizard waits with its draft and picks that location afterwards. */
interface Parked {
  role: "source" | "target";
  known: string[];
}

// Enter on these belongs to the control. Radios, switches and list rows are part of the form,
// so there Enter moves on, as it would in a form.
const OWN_ENTER = "button:not([role=radio]):not([role=switch]):not([role=checkbox]), a[href], select, textarea";

/** One reel turn of the spooling animation, see --animate-reel in app.css. */
const TURN_MS = 2400;

/** Creates or edits a job in five steps; a tape path along the top shows the job as it takes shape. */
export function JobWizard({ open, state, job, onClose, onSaved }: JobWizardProps) {
  const config = state.config;
  const t = useT();
  const w = t.wizard;
  // Versions are clonq Pro; without a licence the card says so instead of failing on save.
  const [pro, setPro] = useState(true);
  useEffect(() => {
    if (!open) return;
    api
      .licenceStatus()
      .then((status) => setPro(status.state === "active" || status.state === "unchecked"))
      .catch(() => setPro(false));
  }, [open]);
  const nav = useNav();
  const toast = useJobToast();
  const [session, setSession] = useState("closed");
  const [draft, setDraft] = useState<Draft>(() => draftFrom(job, config));
  const [initial, setInitial] = useState<Draft>(draft);
  const [step, setStep] = useState<Step>(0);
  const [reached, setReached] = useState<Step>(0);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [done, setDone] = useState<Job | null>(null);
  const [closing, setClosing] = useState(false);
  const [spooling, setSpooling] = useState(false);
  const [parked, setParked] = useState<Parked | null>(null);
  const [pendingPick, setPendingPick] = useState<Parked | null>(null);
  const [targetFolders, setTargetFolders] = useState<{ key: string; count: number } | null>(null);
  /** Folders that could not be read when they were opened, by location and path. */
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const timers = useRef<number[]>([]);

  // Every time the sheet opens, or the job to edit arrives, the wizard starts afresh, unless it
  // comes back from adding a location: then the draft is still wanted.
  const opened = open ? `open:${job?.id ?? "new"}` : "closed";
  if (session !== opened) {
    setSession(opened);
    if (open) {
      if (parked) {
        setPendingPick(parked);
        setParked(null);
      } else {
        const fresh = draftFrom(job, config);
        setDraft(fresh);
        setInitial(fresh);
        setStep(job ? LAST_STEP : 0);
        setReached(job ? LAST_STEP : 0);
        setPendingPick(null);
      }
      setSaving(false);
      setFailure(null);
      setConfirmDiscard(false);
      setDone(null);
      setClosing(false);
      setSpooling(false);
    }
  }

  useEffect(() => {
    if (open) return;
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, [open]);
  const later = (run: () => void, ms: number) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  // Back from the sheet for a new location, whether one was added or not.
  useEffect(() => {
    if (parked && nav.sheet === null) openSheet({ kind: "jobWizard", jobId: job?.id });
  }, [parked, nav.sheet, job?.id]);

  // The location that was added in the meantime becomes this end of the job.
  const locationIds = (config?.locations ?? []).map((location) => location.id).join("|");
  useEffect(() => {
    if (!pendingPick) return;
    const added = (config?.locations ?? []).find((location) => !pendingPick.known.includes(location.id));
    if (!added) return;
    setDraft((value) => ({ ...value, [pendingPick.role]: { location: added.id, path: "" } }));
    setPendingPick(null);
  }, [pendingPick, locationIds]);

  // A server, share or cloud at either end of an edited job that has not been tried yet is tried
  // when the wizard opens, so the job can be saved without first visiting its places. For a new
  // job the place step does this as soon as the location is picked.
  const checked = useRef(new Set<string>());
  const endIds = [draft.source?.location, draft.target?.location].filter((id): id is string => Boolean(id)).join("|");
  useEffect(() => {
    if (!open || !job) return;
    for (const id of endIds.split("|").filter(Boolean)) {
      const kind = config?.locations.find((location) => location.id === id)?.kind.type;
      if (kind !== "ssh" && kind !== "smb" && kind !== "cloud") continue;
      if (state.locations[id]?.reach.state !== "untested" || checked.current.has(id)) continue;
      checked.current.add(id);
      void api
        .testLocation(id)
        .then(() => refreshLocations())
        .catch(() => undefined);
    }
  }, [open, job, endIds, config, state.locations]);

  // A new job starts with the default excludes, node_modules first.
  useEffect(() => {
    if (!open || job) return;
    let current = true;
    api
      .jobDefaults()
      .then((defaults) => {
        if (!current) return;
        const excludes = sortExcludes(defaults ?? []);
        setDraft((value) => (value.excludes.length > 0 ? value : { ...value, excludes }));
        setInitial((value) => (value.excludes.length > 0 ? value : { ...value, excludes }));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [open, job]);

  // What is in the target now, to warn before a mirror deletes it.
  const targetLocation = draft.target ? locationOf(draft.target, config) : undefined;
  const targetConnected = draft.target ? state.locations[draft.target.location]?.reach.state === "connected" : false;
  const targetKey = draft.target ? `${draft.target.location}/${trimPath(draft.target.path)}` : null;
  useEffect(() => {
    if (!open || !draft.target || !targetConnected || targetKey === null) return;
    let current = true;
    api
      .listFolders(draft.target.location, trimPath(draft.target.path))
      .then((entries) => current && setTargetFolders({ key: targetKey, count: (entries ?? []).length }))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [open, targetKey, targetConnected]);

  const change = (update: Partial<Draft>) => {
    setDraft((value) => ({ ...value, ...update }));
    setFailure(null);
    setConfirmDiscard(false);
  };

  const jobId = job?.id ?? null;
  const suggestion = suggestName(draft, config, jobId);
  const name = draft.nameEdited ? draft.name : suggestion;
  const input = toInput(draft, job, name, config);
  const drives = drivesOf(draft, config);
  const sourceLocation = draft.source ? locationOf(draft.source, config) : undefined;
  const overlap = draft.source && draft.target ? clashOf(draft.target, "target", draft.source, state) : null;

  const placeKey = (place: Place) => `${place.location}/${trimPath(place.path)}`;
  const readProblem = (place: Place | null) =>
    place && unreadable.includes(placeKey(place)) ? w.problem.unreadable(placeLabel(place, config)) : null;
  const problems: Record<Step, string | null> = {
    0: !draft.source
      ? w.problem.noSource
      : ((sourceLocation ? reachProblem(sourceLocation, state) : null) ?? readProblem(draft.source)),
    1: !draft.target
      ? w.problem.noTarget
      : ((targetLocation ? reachProblem(targetLocation, state) : null) ??
        readProblem(draft.target) ??
        (overlap && draft.source ? overlapText(overlap, "target", placeLabel(draft.source, config)) : null)),
    2: modeProblem(draft, config),
    3: triggerProblem({ ...draft.triggers, onMount: draft.triggers.onMount && drives.length > 0 }),
    4: name.trim() ? null : w.problem.noName,
  };
  const firstProblem = ALL_STEPS.find((index) => problems[index] !== null);
  const canSave = firstProblem === undefined && input !== null && !saving && !done && !closing;
  const dirty = isDirty(draft, initial);

  // A mirror into a place that already holds something deletes what the source lacks. An edited
  // job that keeps its target has filled it itself, so only a new or changed target is worth a word.
  const newTarget = !job || !samePlace(job.target, draft.target);
  const mirrorRisk = (() => {
    if (!draft.target || !newTarget || !targetLocation) return null;
    if (trimPath(draft.target.path) === "") {
      return targetLocation.kind.type === "volume" ? w.warning.wholeDrive(targetLocation.name) : w.warning.wholeLocation(targetLocation.name);
    }
    const count = targetFolders?.key === targetKey ? targetFolders.count : 0;
    if (count === 0) return null;
    return w.warning.targetHolds(placeLabel(draft.target, config), count);
  })();
  const history = job ? (state.stats[job.id]?.runsTotal ?? 0) > 0 : false;
  // A two-way job starts by merging both sides, so whatever only the target holds reaches the
  // source: worth a word for a new job into a place that holds something, and for a job that
  // becomes two-way now.
  const switchedToTwoWay = job !== undefined && job.mode !== "bidirectional";
  const mergeWarning =
    draft.mode !== "bidirectional" ? null : switchedToTwoWay ? w.warning.merge : mirrorRisk ? `${mirrorRisk} ${w.warning.merge}` : null;
  const mirrorWarning = draft.mode === "mirror" && mirrorRisk ? `${mirrorRisk} ${w.warning.mirrorDeletes}` : null;
  const nameNotices = [...(mirrorWarning ? [mirrorWarning] : []), ...(mergeWarning ? [mergeWarning] : []), ...(job && history && newTarget ? [w.warning.newTarget] : [])];

  const goTo = (next: Step) => {
    setStep(next);
    setConfirmDiscard(false);
    setReached((value) => (next > value ? next : value));
  };

  const finish = (saved: Job) => {
    onSaved(saved);
  };

  const save = async () => {
    if (!canSave || !input) return;
    setSaving(true);
    setFailure(null);
    setConfirmDiscard(false);
    try {
      const saved = await api.saveJob(input);
      setSpooling(true);
      if (job) {
        // A short moment of the reels turning, then back to the job, with a word that it worked.
        setClosing(true);
        later(() => {
          finish(saved);
          // Read at this moment: the language may have changed while the reels turned.
          showJobToast({ text: texts().wizard.savedToast(saved.name) });
        }, 1300);
      } else {
        setDone(saved);
        later(() => setSpooling(false), TURN_MS * 2);
      }
    } catch (reason) {
      setFailure(saveFailure(String(reason), input, config));
    } finally {
      setSaving(false);
    }
  };

  const advance = () => {
    if (saving || closing || problems[step] !== null) return;
    if (step < LAST_STEP) goTo((step + 1) as Step);
    else void save();
  };

  const back = () => {
    if (step > 0) goTo((step - 1) as Step);
  };

  const dryRun = (saved: Job) => {
    void jobActions.dryRun(saved.id);
    finish(saved);
  };

  // Escape, the cross and a click beside the sheet all land here; while the question stands,
  // Escape takes it back.
  const requestClose = () => {
    if (done) return finish(done);
    if (saving || closing) return;
    if (confirmDiscard) return setConfirmDiscard(false);
    if (dirty) return setConfirmDiscard(true);
    onClose();
  };

  const addLocation = (role: "source" | "target") => {
    setParked({ role, known: (config?.locations ?? []).map((location) => location.id) });
    openSheet({ kind: "addLocation" });
  };

  // Enter moves on, ⌘← goes back, ⌘↵ saves at once while editing. The wizard listens before
  // everything else in the window, so the job view underneath does not start a run on the same Enter.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.isComposing) {
      // A field that owns Enter (a new folder, an exclude pattern, a highlighted folder) handles it and stops it there.
      if (!event.metaKey && target?.closest("[data-own-enter]")) return;
      // A focused button gets its own click; nothing further along sees the key.
      if (!event.metaKey && target?.closest(OWN_ENTER)) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (confirmDiscard || saving || closing) return;
      if (done) dryRun(done);
      else if (!event.metaKey) advance();
      else if (job || step === LAST_STEP) void save();
      return;
    }
    if (event.key === "ArrowLeft" && event.metaKey) {
      if (target instanceof HTMLInputElement && target.value !== "") return;
      if (done || closing) return;
      event.preventDefault();
      event.stopPropagation();
      back();
    }
  });

  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [open]);

  const endOf = (place: Place | null): UiTapeEnd | null => {
    const location = place ? locationOf(place, config) : undefined;
    if (!place || !location) return null;
    return {
      kind: location.kind.type,
      name: location.name,
      path: trimPath(place.path),
      connected: state.locations[place.location]?.reach.state === "connected",
    };
  };

  const triggers = input?.triggers;
  const automatic = triggers ? hasAutomatic(triggers) : false;
  const sourceTag: UiTapeTag | null = draft.mode ? { text: modeLabel(draft.mode) } : null;
  // A two-way job carries its conflict rule under the tape, with the whole rule as the title.
  const twoWay = draft.mode === "bidirectional";
  const conflictNote: UiTapeTag | null = twoWay
    ? { text: conflictTag(draft.conflicts), title: w.tape.conflicts(preferLabel(draft.conflicts.prefer), loserSentence(draft.conflicts, draft.archive.enabled)) }
    : null;
  const targetTag: UiTapeTag | null =
    reached >= 3 && triggers
      ? automatic && !draft.enabled
        ? { text: w.tape.automationOff, tone: "warn", title: triggerWords(triggers, config).join(", ") }
        : { text: triggerTag(triggers), title: automatic ? triggerWords(triggers, config).join(", ") : w.tape.manualOnly }
      : null;
  const pulse = [step, draft.source?.location, draft.source?.path, draft.target?.location, draft.target?.path, draft.mode, draft.conflicts.prefer].join("|");

  const steps: UiStepperStep[] = ALL_STEPS.map((index) => ({
    label: stepLabel(index),
    state: done
      ? "done"
      : index === step
        ? "current"
        : index > reached
          ? "locked"
          : problems[index] !== null
            ? "problem"
            : "done",
  }));

  // What the footer says: an error of the last save, a problem this step does not show in place,
  // or, on the last step, the first thing still missing elsewhere. The mode step says its problems
  // in place too, but a wrong number may sit below the fold, so the footer repeats them.
  const inPlace = (index: Step) => (index === 0 && draft.source !== null) || (index === 1 && draft.target !== null) || index === 4;
  const pending: { text: string; jump: Step | null; tone: "danger" | "warn" | "neutral" } | null = failure
    ? { text: [failure.text, failure.advice].filter(Boolean).join(" "), jump: failure.step !== step ? failure.step : null, tone: "danger" }
    : (step === LAST_STEP || (job && problems[step] === null)) && firstProblem !== undefined && firstProblem !== step
      ? { text: `${stepLabel(firstProblem)}: ${problems[firstProblem]}`, jump: firstProblem, tone: "neutral" }
      : problems[step] !== null && !inPlace(step)
        ? { text: problems[step] ?? "", jump: null, tone: step === 3 || (step === 2 && draft.mode !== null) ? "danger" : "neutral" }
        : step === 2 && (mirrorWarning ?? mergeWarning)
          ? { text: mirrorWarning ?? mergeWarning ?? "", jump: null, tone: "warn" }
          : null;

  // The two footers are keyed apart, so a button focused before saving does not turn into another one.
  const footer = done ? (
    <Fragment key="done">
      <span className="mr-auto" />
      <UiButton variant="secondary" keys={["esc"]} onPress={() => finish(done)}>
        {w.footer.openJob}
      </UiButton>
      <UiButton variant="primary" icon={FlaskConical} keys={["↵"]} onPress={() => dryRun(done)}>
        {w.footer.dryRun}
      </UiButton>
    </Fragment>
  ) : (
    <Fragment key="form">
      <span className="mr-auto flex min-w-0 items-center gap-2">
        {closing ? (
          <>
            <UiLamp tone="ok" lit />
            <span className="text-xs text-ink-soft">{w.footer.saved}</span>
          </>
        ) : pending ? (
          <>
            <UiLamp tone={pending.tone} lit={pending.tone !== "neutral"} />
            <span
              className={`line-clamp-2 text-[0.6875rem] leading-snug ${pending.tone === "danger" ? "text-danger" : pending.tone === "warn" ? "text-warn" : "text-ink-soft"}`}
              title={pending.text}
            >
              {pending.text}
            </span>
            {pending.jump !== null ? <UiLinkButton onPress={() => goTo(pending.jump ?? step)}>{jumpLabel(pending.jump)}</UiLinkButton> : null}
          </>
        ) : null}
      </span>
      {step > 0 ? (
        <UiButton variant="ghost" keys={["⌘", "←"]} disabled={closing} onPress={back}>
          {w.footer.back}
        </UiButton>
      ) : null}
      {job && step < LAST_STEP ? (
        <UiButton variant="secondary" keys={["⌘", "↵"]} disabled={!canSave} onPress={() => void save()}>
          {t.common.save}
        </UiButton>
      ) : null}
      {step < LAST_STEP ? (
        <UiButton variant="primary" keys={["↵"]} disabled={problems[step] !== null} onPress={advance}>
          {w.footer.next}
        </UiButton>
      ) : (
        <UiButton variant="primary" keys={["↵"]} disabled={!canSave} onPress={() => void save()}>
          {saving ? (job ? t.common.saving : w.footer.creating) : job ? t.common.save : w.footer.create}
        </UiButton>
      )}
    </Fragment>
  );

  return (
    <>
      <UiSheet
        open={open}
        title={done ? w.title.done : job ? w.title.edit : w.title.create}
        onClose={requestClose}
        header={
          <div className="bg-raised-solid">
            <UiStepper steps={steps} label={w.stepsLabel} onJump={(index) => !done && goTo(index as Step)} />
            <UiTapePath
              source={endOf(draft.source)}
              target={endOf(draft.target)}
              ring={draft.ring}
              wound={done ? 1 : step / LAST_STEP}
              active={done ? null : step === 0 ? "source" : step === 1 ? "target" : null}
              sourceTag={sourceTag}
              targetTag={targetTag}
              sourceNote={conflictNote}
              twoWay={twoWay}
              pulse={pulse}
              spooling={spooling}
            />
          </div>
        }
        footer={footer}
      >
        {/* One height for every step, so the sheet does not jump while moving through them. */}
        <div className="relative -mx-5 -my-4 h-[25rem] bg-raised-solid px-5 py-3.5">
          <div className="scroll-fade h-full overflow-y-auto">
            {done ? <DoneStep job={done} config={config} /> : null}
            {!done && (step === 0 || step === 1) ? (
              <PlaceStep
                key={step}
                role={step === 0 ? "source" : "target"}
                state={state}
                place={step === 0 ? draft.source : draft.target}
                other={step === 0 ? draft.target : draft.source}
                jobId={jobId}
                onChange={(place) => change(step === 0 ? { source: place } : { target: place })}
                onAddLocation={() => addLocation(step === 0 ? "source" : "target")}
                onReadable={(place, readable) =>
                  setUnreadable((list) => (readable ? list.filter((key) => key !== placeKey(place)) : [...list.filter((key) => key !== placeKey(place)), placeKey(place)]))
                }
              />
            ) : null}
            {!done && step === 2 ? (
              <ModeStep
                mode={draft.mode}
                onMode={(mode) => change({ mode })}
                versionedBlocked={versionedProblem(draft, config) ?? (pro ? null : t.messages.proNeeded)}
                excludes={draft.excludes}
                onExcludes={(excludes) => change({ excludes })}
                maxDeletePercent={draft.maxDeletePercent}
                onMaxDeletePercent={(maxDeletePercent) => change({ maxDeletePercent })}
                archive={draft.archive}
                onArchive={(archive) => change({ archive })}
                conflicts={draft.conflicts}
                onConflicts={(conflicts) => change({ conflicts })}
                onSubmit={advance}
                shortcuts={!confirmDiscard}
              />
            ) : null}
            {!done && step === 3 ? (
              <TriggerStep
                triggers={draft.triggers}
                onTriggers={(value) => change({ triggers: value })}
                enabled={draft.enabled}
                onEnabled={(enabled) => change({ enabled })}
                drives={drives}
                config={config}
                jobId={jobId}
                pro={pro}
              />
            ) : null}
            {!done && step === 4 ? (
              <NameStep
                name={name}
                suggestion={suggestion}
                suggested={!draft.nameEdited}
                taken={nameTaken(name, config, jobId)}
                onName={(value) => change({ name: value, nameEdited: true })}
                ring={draft.ring}
                onRing={(ring) => change({ ring })}
                input={input}
                config={config}
                onJump={goTo}
                notices={nameNotices}
              />
            ) : null}
          </div>
          {confirmDiscard ? (
            <div className="absolute inset-x-5 bottom-3.5 rounded-[var(--radius-panel)] bg-raised-solid shadow-2xl">
              <UiConfirmBar
                tone="warn"
                title={w.discard.title}
                cancelLabel={w.discard.keepEditing}
                confirmLabel={w.discard.confirm}
                onCancel={() => setConfirmDiscard(false)}
                onConfirm={onClose}
                escapeCancels={false}
              >
                {job ? w.discard.edited : w.discard.created}
              </UiConfirmBar>
            </div>
          ) : null}
        </div>
      </UiSheet>
      <UiToast message={toast} onDismiss={hideJobToast} />
    </>
  );
}
