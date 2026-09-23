import { CalendarClock, FileClock, Link2, Timer, Usb } from "lucide-react";
import type { Config, Location } from "../../lib/types";
import { UiInput, UiKbd } from "../../ui";
import { UiSelect } from "../../ui/UiSelect";
import { UiSwitchRow } from "../../ui/UiSwitchRow";
import { UiTimeField } from "../../ui/UiTimeField";
import { followableJobs, type TriggerDraft } from "./draft";

interface TriggerStepProps {
  triggers: TriggerDraft;
  onTriggers: (triggers: TriggerDraft) => void;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  /** Drives on either side of the job; "when plugged in" needs one. */
  drives: Location[];
  config: Config | null;
  /** The job being edited, which cannot follow itself. */
  jobId: string | null;
}

function anyOn(triggers: TriggerDraft, withMount: boolean): boolean {
  return (withMount && triggers.onMount) || triggers.onChange || triggers.every || triggers.daily || triggers.after;
}

/** Step 4: when the job starts by itself. Without any trigger it starts only by hand. */
export function TriggerStep({ triggers, onTriggers, enabled, onEnabled, drives, config, jobId }: TriggerStepProps) {
  const withMount = drives.length > 0;
  const set = (change: Partial<TriggerDraft>) => onTriggers({ ...triggers, ...change });
  const { jobs: followable, excluded } = followableJobs(config, jobId);
  const driveNames = new Intl.ListFormat("de", { type: "disjunction" }).format(drives.map((drive) => drive.name));
  const automatic = anyOn(triggers, withMount);

  return (
    <div className="flex flex-col gap-3">
      <div className="hairline flex flex-col rounded-[var(--radius-panel)] bg-well">
        {withMount ? (
          <UiSwitchRow
            icon={Usb}
            title="Beim Anstecken"
            description={triggers.onMount ? `Startet, sobald ${driveNames} angeschlossen wird.` : undefined}
            checked={triggers.onMount}
            onChange={(onMount) => set({ onMount })}
          />
        ) : null}
        <UiSwitchRow
          icon={FileClock}
          title="Bei Änderungen in der Quelle"
          description={triggers.onChange ? "Wartet nach jeder Änderung, bis die Quelle so lange ruht." : undefined}
          checked={triggers.onChange}
          onChange={(onChange) => set({ onChange })}
          inline={
            <>
              nach
              <span className="w-16">
                <UiInput type="number" value={triggers.changeSeconds} disabled={!triggers.onChange} onChange={(changeSeconds) => set({ changeSeconds })} />
              </span>
              Sekunden Ruhe
            </>
          }
        />
        <UiSwitchRow
          icon={Timer}
          title="In festem Abstand"
          description={triggers.every ? "Gezählt ab dem Beginn des letzten Laufs." : undefined}
          checked={triggers.every}
          onChange={(every) => set({ every })}
          inline={
            <>
              alle
              <span className="w-16">
                <UiInput type="number" value={triggers.everyMinutes} disabled={!triggers.every} onChange={(everyMinutes) => set({ everyMinutes })} />
              </span>
              Minuten
            </>
          }
        />
        <UiSwitchRow
          icon={CalendarClock}
          title="Täglich"
          description={triggers.daily ? "Ein verpasster Lauf wird nach dem Ruhezustand nachgeholt." : undefined}
          checked={triggers.daily}
          onChange={(daily) => set({ daily })}
          inline={
            <>
              um
              <UiTimeField label="Uhrzeit" value={triggers.dailyAt} disabled={!triggers.daily} onChange={(dailyAt) => set({ dailyAt })} />
              Uhr
            </>
          }
        />
        {followable.length > 0 || triggers.after ? (
          <UiSwitchRow
            icon={Link2}
            title="Im Anschluss an einen anderen Job"
            description={
              triggers.after
                ? excluded > 0
                  ? "Startet, sobald der gewählte Job einen Lauf beendet hat. Jobs, die selbst nach diesem laufen, stehen nicht zur Wahl."
                  : "Startet, sobald der gewählte Job einen Lauf beendet hat."
                : undefined
            }
            checked={triggers.after}
            onChange={(after) => set({ after, afterJob: after ? (triggers.afterJob ?? followable[0]?.id ?? null) : triggers.afterJob })}
            inline={
              <span className="w-[11.5rem]">
                <UiSelect
                  label="Vorheriger Job"
                  value={triggers.afterJob}
                  options={followable.map((job) => ({ value: job.id, label: job.name }))}
                  onChange={(afterJob) => set({ afterJob })}
                  placeholder="Job wählen"
                  disabled={!triggers.after}
                />
              </span>
            }
          />
        ) : null}
      </div>

      <div className="hairline flex flex-col rounded-[var(--radius-panel)] bg-well">
        {automatic ? (
          <UiSwitchRow
            title="Automatik"
            description={
              enabled
                ? "Die Auslöser greifen nur, solange clonq läuft."
                : "Die Auslöser bleiben gespeichert, greifen aber erst, wenn die Automatik eingeschaltet ist."
            }
            checked={enabled}
            onChange={onEnabled}
          />
        ) : (
          <p className="flex min-h-11 flex-wrap items-center gap-1 px-3 text-xs text-ink-soft">
            Ohne Auslöser startet der Job nur von Hand, mit <UiKbd keys={["↵"]} /> in der Jobansicht oder im Menüleistenfenster.
          </p>
        )}
      </div>
    </div>
  );
}
