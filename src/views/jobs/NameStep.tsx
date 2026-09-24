import { modeLabel, placeLabel } from "../../lib/labels";
import type { Config, JobInput, Ring } from "../../lib/types";
import { UiField, UiInput } from "../../ui";
import { UiLamp } from "../../ui/UiLamp";
import { UiFormGroup } from "../../ui/UiFormGroup";
import { UiRingPicker } from "../../ui/UiRingPicker";
import { UiSummaryRow } from "../../ui/UiSummaryRow";
import { ringBg } from "../../ui/rings";
import { conflictSummary, daysWords, deletesIn, hasAutomatic, ringName, triggerWords, type Step } from "./draft";

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
  const automatic = input ? hasAutomatic(input.triggers) : false;
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-[21.75rem_minmax(0,1fr)] gap-3">
        <div className="flex flex-col gap-4">
          <UiField
            label="Name"
            error={name.trim() ? null : "Der Job braucht einen Namen."}
            hint={
              taken ? (
                <span className="text-warn">Ein anderer Job trägt bereits diesen Namen. Mit einem eigenen Namen lassen sich beide leichter unterscheiden.</span>
              ) : suggested ? (
                "Vorgeschlagen aus Quelle und Ziel."
              ) : undefined
            }
          >
            <UiInput value={name} onChange={onName} placeholder={suggestion} autoFocus />
          </UiField>
          <UiFormGroup title="Farbe des Schreibrings">
            <UiRingPicker value={ring} onChange={onRing} label="Farbe des Schreibrings" names={ringName} size="lg" />
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
          <section aria-label="Zusammenfassung" className="hairline relative flex self-start overflow-hidden rounded-[var(--radius-panel)] bg-well">
            <span aria-hidden className={`w-1 shrink-0 ${ringBg[ring]}`} />
            <div className="flex min-w-0 flex-1 flex-col">
              <UiSummaryRow label="Quelle" onPress={() => onJump(0)} pressLabel="Quelle ändern">
                <span className="font-mono text-[0.6875rem]">{placeLabel(input.source, config)}</span>
              </UiSummaryRow>
              <UiSummaryRow label="Ziel" onPress={() => onJump(1)} pressLabel="Ziel ändern">
                <span className="font-mono text-[0.6875rem]">{placeLabel(input.target, config)}</span>
              </UiSummaryRow>
              <UiSummaryRow
                label="Art"
                onPress={() => onJump(2)}
                pressLabel="Art und Ausschlüsse ändern"
                detail={input.excludes.length > 0 ? <span className="font-mono">ohne {input.excludes.join("  ")}</span> : "Keine Ausschlüsse"}
              >
                {modeLabel(input.mode)}
                {deletesIn(input.mode) ? `, Schutzschwelle ${input.maxDeletePercent} %` : ""}
              </UiSummaryRow>
              {input.mode === "bidirectional" && input.conflicts ? (
                <UiSummaryRow label="Konflikte" onPress={() => onJump(2)} pressLabel="Konfliktregel ändern">
                  {conflictSummary(input.conflicts, input.archive?.enabled ?? true)}
                </UiSummaryRow>
              ) : null}
              {input.archive ? (
                <UiSummaryRow label="Archiv" onPress={() => onJump(2)} pressLabel="Archiv ändern">
                  {input.archive.enabled
                    ? `${daysWords(input.archive.keepDays)}, ${input.mode === "bidirectional" ? "auf beiden Seiten" : "im Ziel"}`
                    : "Aus"}
                </UiSummaryRow>
              ) : null}
              <UiSummaryRow
                label="Auslöser"
                onPress={() => onJump(3)}
                pressLabel="Auslöser ändern"
                detail={automatic && !input.enabled ? "Die Automatik ist aus; der Job startet vorerst nur von Hand." : undefined}
              >
                {automatic ? triggerWords(input.triggers, config).join(", ") : "Nur von Hand"}
              </UiSummaryRow>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
