import { locale, useT } from "../../i18n";
import { modeLabel, placeLabel } from "../../lib/labels";
import type { Config, JobInput, Ring } from "../../lib/types";
import { UiField, UiInput } from "../../ui";
import { UiLamp } from "../../ui/UiLamp";
import { UiFormGroup } from "../../ui/UiFormGroup";
import { UiRingPicker } from "../../ui/UiRingPicker";
import { UiSummaryRow } from "../../ui/UiSummaryRow";
import { ringBg } from "../../ui/rings";
import { conflictSummary, deletesIn, hasAutomatic, stepLabel, triggerWords, type Step } from "./draft";

interface NameStepProps {
  /** The name as it stands, the suggestion until it is edited. */
  name: string;
  suggestion: string;
  /** True while the name still follows the suggestion. */
  suggested: boolean;
  /** True when another job already has this name. */
  taken: boolean;
  onName: (name: string) => void;
  ring: Ring;
  onRing: (ring: Ring) => void;
  /** The job as it would be saved. */
  input: JobInput | null;
  config: Config | null;
  onJump: (step: Step) => void;
  /** Things to know before saving, e.g. that a mirror would delete in the target. */
  notices: string[];
}

/** Step 5: what the job is called, the colour of its ring, and the whole job on one label. */
export function NameStep({ name, suggestion, suggested, taken, onName, ring, onRing, input, config, onJump, notices }: NameStepProps) {
  const t = useT();
  const n = t.wizard.name;
  const automatic = input ? hasAutomatic(input.triggers) : false;
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-[21.75rem_minmax(0,1fr)] gap-3">
        <div className="flex flex-col gap-4">
          <UiField
            label={n.label}
            error={name.trim() ? null : t.wizard.problem.noName}
            hint={
              taken ? (
                <span className="text-warn">{n.taken}</span>
              ) : suggested ? (
                n.suggested
              ) : undefined
            }
          >
            <UiInput value={name} onChange={onName} placeholder={suggestion} autoFocus />
          </UiField>
          <UiFormGroup title={n.ringTitle}>
            <UiRingPicker value={ring} onChange={onRing} label={n.ringTitle} names={n.rings} size="lg" />
          </UiFormGroup>
          {/* Notices sit under the ring, beside the summary, so a long summary does not push them out of view. */}
          {notices.map((notice) => (
            <span key={notice} className="flex items-start gap-2 text-[0.6875rem] leading-snug text-warn">
              <span className="pt-1">
                <UiLamp tone="warn" lit />
              </span>
              {notice}
            </span>
          ))}
        </div>

        {input ? (
          <section aria-label={n.summary} className="hairline relative flex self-start overflow-hidden rounded-[var(--radius-panel)] bg-well">
            <span aria-hidden className={`w-1 shrink-0 ${ringBg[ring]}`} />
            <div className="flex min-w-0 flex-1 flex-col">
              <UiSummaryRow label={stepLabel(0)} onPress={() => onJump(0)} pressLabel={n.changeSource}>
                <span className="font-mono text-[0.6875rem]">{placeLabel(input.source, config)}</span>
              </UiSummaryRow>
              <UiSummaryRow label={stepLabel(1)} onPress={() => onJump(1)} pressLabel={n.changeTarget}>
                <span className="font-mono text-[0.6875rem]">{placeLabel(input.target, config)}</span>
              </UiSummaryRow>
              <UiSummaryRow
                label={stepLabel(2)}
                onPress={() => onJump(2)}
                pressLabel={n.changeMode}
                detail={input.excludes.length > 0 ? <span className="font-mono">{n.excluding(input.excludes.join("  "))}</span> : n.noExcludes}
              >
                {modeLabel(input.mode)}
                {deletesIn(input.mode) ? n.withLimit(t.common.percent(input.maxDeletePercent.toLocaleString(locale()))) : ""}
              </UiSummaryRow>
              {input.mode === "bidirectional" && input.conflicts ? (
                <UiSummaryRow label={n.conflicts} onPress={() => onJump(2)} pressLabel={n.changeConflicts}>
                  {conflictSummary(input.conflicts, input.archive?.enabled ?? true)}
                </UiSummaryRow>
              ) : null}
              {input.archive ? (
                <UiSummaryRow label={n.archive} onPress={() => onJump(2)} pressLabel={n.changeArchive}>
                  {input.archive.enabled
                    ? (input.mode === "bidirectional" ? n.archiveBothSides : n.archiveInTarget)(t.wizard.days(input.archive.keepDays))
                    : n.archiveOff}
                </UiSummaryRow>
              ) : null}
              <UiSummaryRow
                label={stepLabel(3)}
                onPress={() => onJump(3)}
                pressLabel={n.changeTriggers}
                detail={automatic && !input.enabled ? n.automationOff : undefined}
              >
                {automatic ? t.wizard.standalone(triggerWords(input.triggers, config).join(", ")) : n.manualOnly}
              </UiSummaryRow>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
