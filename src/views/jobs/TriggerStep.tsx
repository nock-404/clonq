import { CalendarClock, FileClock, Link2, Timer, Usb } from "lucide-react";
import { locale, useT } from "../../i18n";
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
  const r = useT().wizard.trigger;
  const withMount = drives.length > 0;
  const set = (change: Partial<TriggerDraft>) => onTriggers({ ...triggers, ...change });
  const { jobs: followable, excluded } = followableJobs(config, jobId);
  const driveNames = new Intl.ListFormat(locale(), { type: "disjunction" }).format(drives.map((drive) => drive.name));
  const automatic = anyOn(triggers, withMount);

  return (
    <div className="flex flex-col gap-3">
      <div className="hairline flex flex-col rounded-[var(--radius-panel)] bg-well">
        {withMount ? (
          <UiSwitchRow
            icon={Usb}
            title={r.onMount}
            description={triggers.onMount ? r.onMountDescription(driveNames) : undefined}
            checked={triggers.onMount}
            onChange={(onMount) => set({ onMount })}
          />
        ) : null}
        <UiSwitchRow
          icon={FileClock}
          title={r.onChange}
          description={triggers.onChange ? r.onChangeDescription : undefined}
          checked={triggers.onChange}
          onChange={(onChange) => set({ onChange })}
          inline={
            <>
              {r.onChangeBefore}
              <span className="w-16">
                <UiInput type="number" value={triggers.changeSeconds} disabled={!triggers.onChange} onChange={(changeSeconds) => set({ changeSeconds })} />
              </span>
              {r.onChangeAfter}
            </>
          }
        />
        <UiSwitchRow
          icon={Timer}
          title={r.every}
          description={triggers.every ? r.everyDescription : undefined}
          checked={triggers.every}
          onChange={(every) => set({ every })}
          inline={
            <>
              {r.everyBefore}
              <span className="w-16">
                <UiInput type="number" value={triggers.everyMinutes} disabled={!triggers.every} onChange={(everyMinutes) => set({ everyMinutes })} />
              </span>
              {r.everyAfter}
            </>
          }
        />
        <UiSwitchRow
          icon={CalendarClock}
          title={r.daily}
          description={triggers.daily ? r.dailyDescription : undefined}
          checked={triggers.daily}
          onChange={(daily) => set({ daily })}
          inline={
            <>
              {r.dailyBefore}
              <UiTimeField label={r.timeLabel} value={triggers.dailyAt} disabled={!triggers.daily} onChange={(dailyAt) => set({ dailyAt })} />
              {r.dailyAfter}
            </>
          }
        />
        {followable.length > 0 || triggers.after ? (
          <UiSwitchRow
            icon={Link2}
            title={r.after}
            description={triggers.after ? (excluded > 0 ? r.afterExcluded : r.afterDescription) : undefined}
            checked={triggers.after}
            onChange={(after) => set({ after, afterJob: after ? (triggers.afterJob ?? followable[0]?.id ?? null) : triggers.afterJob })}
            inline={
              <span className="w-[11.5rem]">
                <UiSelect
                  label={r.afterLabel}
                  value={triggers.afterJob}
                  options={followable.map((job) => ({ value: job.id, label: job.name }))}
                  onChange={(afterJob) => set({ afterJob })}
                  placeholder={r.afterPlaceholder}
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
            title={r.automation}
            description={enabled ? r.automationOn : r.automationOff}
            checked={enabled}
            onChange={onEnabled}
          />
        ) : (
          <p className="flex min-h-11 flex-wrap items-center gap-1 px-3 text-xs text-ink-soft">
            {r.manualBefore} <UiKbd keys={["↵"]} /> {r.manualAfter}
          </p>
        )}
      </div>
    </div>
  );
}
