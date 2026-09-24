import { Archive, History, ListFilter, Lock, ShieldAlert, Zap } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { texts, useT } from "../../i18n";
import { modeLabel } from "../../lib/labels";
import type { Conflicts, Mode } from "../../lib/types";
import { UiInput } from "../../ui";
import { UiChip } from "../../ui/UiChip";
import { UiDisclosureRow } from "../../ui/UiDisclosureRow";
import { UiModeDiagram } from "../../ui/UiModeDiagram";
import { UiNumberField } from "../../ui/UiNumberField";
import { UiOptionCard } from "../../ui/UiOptionCard";
import { UiRadioGroup } from "../../ui/UiRadioGroup";
import { UiRadioSegments, type UiRadioSegment } from "../../ui/UiRadioSegments";
import { UiSelect } from "../../ui/UiSelect";
import { UiSettingRow } from "../../ui/UiSettingRow";
import { UiSwitch } from "../../ui/UiSwitch";
import {
  ARCHIVE_FOLDER,
  archivePlace,
  archiveProblem,
  deletesIn,
  keepDaysOf,
  percentOf,
  preferChoices,
  conflictTag,
  sortExcludes,
  type ArchiveDraft,
} from "./draft";

interface ModeStepProps {
  mode: Mode | null;
  onMode: (mode: Mode) => void;
  /** Why the chosen places can't hold a versioned job, or null; the card is then disabled with this reason. */
  versionedBlocked: string | null;
  excludes: string[];
  onExcludes: (excludes: string[]) => void;
  maxDeletePercent: string;
  onMaxDeletePercent: (value: string) => void;
  archive: ArchiveDraft;
  onArchive: (archive: ArchiveDraft) => void;
  conflicts: Conflicts;
  onConflicts: (conflicts: Conflicts) => void;
  /** Shown only with a cloud as the target. */
  encryption: { cloud: boolean; pro: boolean; on: boolean; onChange: (on: boolean) => void };
  /** Enter in the pattern field with nothing to add: go on, like Enter anywhere else. */
  onSubmit: () => void;
  /** False while something covers the step, e.g. the question whether to discard the draft; 1 to 3 then do nothing. */
  shortcuts: boolean;
}

type ShownMode = "mirror" | "backup" | "bidirectional" | "versioned";

const SHORTCUTS: { mode: ShownMode; key: string }[] = [
  { mode: "mirror", key: "1" },
  { mode: "backup", key: "2" },
  { mode: "bidirectional", key: "3" },
  { mode: "versioned", key: "4" },
];

/**
 * The four cards, side by side in one row. A card is too narrow for a sentence, so each shows its
 * picture, title and caption, and the chosen mode's description runs under the row: the step
 * keeps the height it had with three cards.
 */
function modeOptions(): { mode: ShownMode; key: string; description: string; extra: string }[] {
  const t = texts().wizard.mode;
  const words: Record<ShownMode, [string, string]> = {
    mirror: [t.mirror, t.mirrorCaption],
    backup: [t.backup, t.backupCaption],
    bidirectional: [t.bidirectional, t.bidirectionalCaption],
    versioned: [t.versioned, t.versionedCaption],
  };
  return SHORTCUTS.map((option) => ({ ...option, description: words[option.mode][0], extra: words[option.mode][1] }));
}

function loserSegments(): UiRadioSegment<Conflicts["loser"]>[] {
  const t = texts().wizard.mode;
  return [
    { value: "keep", label: t.renameLoser },
    { value: "delete", label: t.deleteLoser },
  ];
}

/** What becomes of the losing copy, or why nobody loses. */
function loserReason(conflicts: Conflicts, archive: boolean): ReactNode {
  const { mode: t, conflict, quote } = texts().wizard;
  if (conflicts.prefer === "none") return t.noLoser;
  if (conflicts.loser === "keep") {
    return (
      <>
        {t.renamedBefore}
        <span className="font-mono">{quote(conflict.example)}</span>
        {t.renamedAfter}
      </>
    );
  }
  return archive ? t.loserArchived : t.loserLost;
}

/** The conflict rule in a few words, for the folded row. */
function conflictSummary(conflicts: Conflicts): string {
  const t = texts().wizard.mode;
  const winner = conflictTag(conflicts);
  if (conflicts.prefer === "none") return winner;
  return `${winner} · ${conflicts.loser === "keep" ? t.renameLoser : t.deleteLoser}`;
}

/** The first patterns and how many more, for the folded row. */
function excludesSummary(excludes: string[]): string {
  const t = texts().wizard.mode;
  if (excludes.length === 0) return t.excludesNone;
  const shown = excludes.slice(0, 2).join(", ");
  return excludes.length > 2 ? t.excludesMore(shown, excludes.length - 2) : shown;
}

/** Step 3: how the two ends follow each other, what a conflict does, how much a run may delete, what it keeps, and what stays out. */
export function ModeStep({
  mode,
  onMode,
  versionedBlocked,
  excludes,
  onExcludes,
  maxDeletePercent,
  onMaxDeletePercent,
  archive,
  onArchive,
  conflicts,
  onConflicts,
  encryption,
  onSubmit,
  shortcuts,
}: ModeStepProps) {
  const t = useT();
  const m = t.wizard.mode;
  const options = modeOptions();
  const [pattern, setPattern] = useState("");
  // Conflict rules and archive stay folded until needed, so the step fits without scrolling.
  const [openConflicts, setOpenConflicts] = useState(false);
  const [openArchive, setOpenArchive] = useState(false);
  const [openExcludes, setOpenExcludes] = useState(false);
  const ids = useId();
  const percentBad = percentOf(maxDeletePercent) === null;
  const twoWay = mode === "bidirectional";
  const versioned = mode === "versioned";
  const noWinner = conflicts.prefer === "none";
  const daysProblem = archiveProblem(archive);
  const [beforeFolder, afterFolder] = archivePlace(mode);

  // 1 to 4 pick a mode, as long as no text field or menu has the keys. The arrow keys belong to
  // the focused control: inside the cards they move between the modes, elsewhere they scroll.
  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!shortcuts || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select")) return;
    const option = SHORTCUTS.find((item) => item.key === event.key);
    if (option && !(option.mode === "versioned" && versionedBlocked)) onMode(option.mode);
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const add = () => {
    const next = pattern.trim();
    if (!next) return;
    if (!excludes.includes(next)) onExcludes(sortExcludes([...excludes, next]));
    setPattern("");
  };

  // Enter adds the pattern while there is one; with an empty field it moves on as everywhere else.
  const onPatternKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (pattern.trim()) add();
    else onSubmit();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {/* Two by two: each card keeps its picture and its own description. */}
        <UiRadioGroup label={m.groupLabel} columns={2}>
          {options.map((option) => {
            // A versioned job the places can't hold stays visible, dimmed, with the reason on the card.
            const blocked = option.mode === "versioned" && versionedBlocked !== null;
            return (
              <UiOptionCard
                key={option.mode}
                layout="row"
                art={
                  <UiModeDiagram mode={option.mode} active={mode === option.mode} extraLabel={blocked ? m.versionedUnavailable : option.extra} />
                }
                title={modeLabel(option.mode)}
                description={blocked ? versionedBlocked : option.description}
                shortcut={option.key}
                selected={mode === option.mode}
                disabled={blocked && mode !== option.mode}
                onPress={() => onMode(option.mode)}
              />
            );
          })}
        </UiRadioGroup>
      </div>

      <div className="hairline flex flex-col rounded-[var(--radius-panel)] bg-well">
        {twoWay ? (
          <UiDisclosureRow
            icon={Zap}
            title={m.conflictTitle}
            summary={conflictSummary(conflicts)}
            open={openConflicts}
            onToggle={() => setOpenConflicts((value) => !value)}
          >
            <span className="flex w-64">
              <UiSelect
                label={m.preferLabel}
                value={conflicts.prefer}
                options={preferChoices()}
                onChange={(prefer) => onConflicts({ ...conflicts, prefer })}
              />
            </span>
            <div className="flex items-center gap-3">
              <UiRadioSegments
                label={m.loserLabel}
                segments={loserSegments()}
                value={conflicts.loser}
                onChange={(loser) => onConflicts({ ...conflicts, loser })}
                disabled={noWinner}
                describedBy={`${ids}-loser`}
              />
              <span id={`${ids}-loser`} className="min-w-0 text-[0.6875rem] leading-snug text-ink-faint">
                {loserReason(conflicts, archive.enabled)}
              </span>
            </div>
          </UiDisclosureRow>
        ) : null}

        {deletesIn(mode) ? (
          <UiSettingRow
            icon={ShieldAlert}
            title={m.limitTitle}
            description={percentBad ? t.wizard.problem.percent : twoWay ? m.limitTwoWay : m.limitOneWay}
            descriptionId={`${ids}-percent`}
            invalid={percentBad}
            control={
              <UiNumberField
                label={m.limitLabel}
                value={maxDeletePercent}
                onChange={onMaxDeletePercent}
                after="%"
                invalid={percentBad}
                min={0}
                max={100}
                describedBy={`${ids}-percent`}
              />
            }
          />
        ) : null}

        {versioned ? (
          // Snapshots are the history of a versioned job; they thin out by a fixed rule.
          <UiSettingRow icon={History} title={m.keepTitle} description={m.keepRule} />
        ) : (
          <UiDisclosureRow
            icon={Archive}
            title={m.archiveTitle}
            summary={daysProblem ?? (archive.enabled ? m.archiveOn(archive.keepDays, keepDaysOf(archive.keepDays)) : m.archiveOff)}
            invalid={daysProblem !== null}
            // An invalid number must stay in sight until it is fixed.
            open={openArchive || daysProblem !== null}
            onToggle={() => setOpenArchive((value) => !value)}
          >
            <div className="flex items-center gap-3">
              <UiSwitch checked={archive.enabled} onChange={(enabled) => onArchive({ ...archive, enabled })} label={m.archiveTitle} />
              <div className={`flex items-center gap-1.5 text-xs transition-opacity ${archive.enabled ? "text-ink-soft" : "text-ink-faint opacity-60"}`}>
                <UiNumberField
                  label={m.keepLabel}
                  before={m.keepBefore}
                  after={m.dayUnit(keepDaysOf(archive.keepDays))}
                  value={archive.keepDays}
                  onChange={(keepDays) => onArchive({ ...archive, keepDays })}
                  disabled={!archive.enabled}
                  invalid={daysProblem !== null}
                  min={1}
                  max={365}
                  describedBy={`${ids}-days`}
                />
              </div>
            </div>
            <span id={`${ids}-days`} className={`text-[0.6875rem] leading-snug ${daysProblem ? "text-danger" : "text-ink-faint"}`}>
              {daysProblem ??
                (archive.enabled ? (
                  <>
                    {beforeFolder} <span className="font-mono">{ARCHIVE_FOLDER}</span> {afterFolder}
                  </>
                ) : (
                  m.archiveNone
                ))}
            </span>
          </UiDisclosureRow>
        )}

        {encryption.cloud ? (
          <UiSettingRow
            icon={Lock}
            title={m.encryptTitle}
            description={!encryption.pro && !encryption.on ? m.encryptPro : encryption.on ? m.encryptOn : m.encryptOff}
            control={
              <UiSwitch checked={encryption.on} onChange={encryption.onChange} label={m.encryptTitle} disabled={!encryption.pro && !encryption.on} />
            }
          />
        ) : null}

        <UiDisclosureRow
          icon={ListFilter}
          title={m.excludesTitle}
          summary={excludesSummary(excludes)}
          open={openExcludes}
          onToggle={() => setOpenExcludes((value) => !value)}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {excludes.map((item) => (
              <UiChip key={item} mono onRemove={() => onExcludes(excludes.filter((other) => other !== item))} removeLabel={m.removeExclude(item)}>
                {item}
              </UiChip>
            ))}
            <span className="min-w-[10rem] flex-1" data-own-enter>
              <UiInput value={pattern} onChange={setPattern} onKeyDown={onPatternKey} placeholder={m.patternPlaceholder} mono />
            </span>
          </div>
          <span className="text-[0.6875rem] leading-snug text-ink-faint">
            {m.patternHint}
          </span>
        </UiDisclosureRow>
      </div>
    </div>
  );
}
