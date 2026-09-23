import { Archive, ListFilter, ShieldAlert, Zap } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState, type KeyboardEvent, type ReactNode } from "react";
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
  CONFLICT_EXAMPLE,
  PERCENT_PROBLEM,
  PREFER_CHOICES,
  archivePlace,
  archiveProblem,
  deletesIn,
  keepDaysOf,
  percentOf,
  conflictTag,
  sortExcludes,
  type ArchiveDraft,
} from "./draft";

interface ModeStepProps {
  mode: Mode | null;
  onMode: (mode: Mode) => void;
  excludes: string[];
  onExcludes: (excludes: string[]) => void;
  maxDeletePercent: string;
  onMaxDeletePercent: (value: string) => void;
  archive: ArchiveDraft;
  onArchive: (archive: ArchiveDraft) => void;
  conflicts: Conflicts;
  onConflicts: (conflicts: Conflicts) => void;
  /** Enter in the pattern field with nothing to add: go on, like Enter anywhere else. */
  onSubmit: () => void;
  /** False while something covers the step, e.g. the question whether to discard the draft; 1 to 3 then do nothing. */
  shortcuts: boolean;
}

type ShownMode = "mirror" | "backup" | "bidirectional";

// Each description fits two lines of a card, so the three cards keep the height of two.
const options: { mode: ShownMode; key: string; description: string; extra: string }[] = [
  { mode: "mirror", key: "1", description: "Das Ziel wird zur genauen Kopie; Überzähliges wird gelöscht.", extra: "gelöscht" },
  { mode: "backup", key: "2", description: "Neues und Geändertes kommt ins Ziel; gelöscht wird nie.", extra: "bleibt" },
  { mode: "bidirectional", key: "3", description: "Jede Seite übernimmt Neues, Geändertes und Gelöschtes.", extra: "Konflikt" },
];

const loserSegments: UiRadioSegment<Conflicts["loser"]>[] = [
  { value: "keep", label: "Verlierer umbenennen" },
  { value: "delete", label: "Verlierer löschen" },
];

/** What becomes of the losing copy, or why nobody loses. */
function loserReason(conflicts: Conflicts, archive: boolean): ReactNode {
  if (conflicts.prefer === "none") return "Ohne Gewinner gibt es keinen Verlierer; beide Fassungen bleiben unter neuen Namen erhalten.";
  if (conflicts.loser === "keep") {
    return (
      <>
        Er heißt danach zum Beispiel <span className="font-mono">„{CONFLICT_EXAMPLE}“</span>.
      </>
    );
  }
  return archive ? "Er wird ins Archiv verschoben." : "Ohne Archiv lässt er sich nicht wiederherstellen.";
}

/** The conflict rule in a few words, for the folded row. */
function conflictSummary(conflicts: Conflicts): string {
  const winner = conflictTag(conflicts);
  if (conflicts.prefer === "none") return winner;
  return `${winner} · Verlierer ${conflicts.loser === "keep" ? "umbenennen" : "löschen"}`;
}

/** The first patterns and how many more, for the folded row. */
function excludesSummary(excludes: string[]): string {
  if (excludes.length === 0) return "keine";
  const shown = excludes.slice(0, 2).join(", ");
  return excludes.length > 2 ? `${shown} und ${excludes.length - 2} weitere` : shown;
}

/** Step 3: how the two ends follow each other, what a conflict does, how much a run may delete, what it keeps, and what stays out. */
export function ModeStep({
  mode,
  onMode,
  excludes,
  onExcludes,
  maxDeletePercent,
  onMaxDeletePercent,
  archive,
  onArchive,
  conflicts,
  onConflicts,
  onSubmit,
  shortcuts,
}: ModeStepProps) {
  const [pattern, setPattern] = useState("");
  // Conflict rules and archive stay folded until needed, so the step fits without scrolling.
  const [openConflicts, setOpenConflicts] = useState(false);
  const [openArchive, setOpenArchive] = useState(false);
  const [openExcludes, setOpenExcludes] = useState(false);
  const ids = useId();
  const percentBad = percentOf(maxDeletePercent) === null;
  const twoWay = mode === "bidirectional";
  const noWinner = conflicts.prefer === "none";
  const daysProblem = archiveProblem(archive);
  const [beforeFolder, afterFolder] = archivePlace(mode);

  // 1 to 3 pick a mode, as long as no text field or menu has the keys. The arrow keys belong to
  // the focused control: inside the cards they move between the modes, elsewhere they scroll.
  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!shortcuts || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select")) return;
    const option = options.find((item) => item.key === event.key);
    if (option) onMode(option.mode);
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
      <UiRadioGroup label="Art der Kopie" columns={3}>
        {options.map((option) => (
          <UiOptionCard
            key={option.mode}
            layout="tall"
            art={<UiModeDiagram mode={option.mode} active={mode === option.mode} extraLabel={option.extra} />}
            title={modeLabel[option.mode]}
            shortcut={option.key}
            description={option.description}
            selected={mode === option.mode}
            onPress={() => onMode(option.mode)}
          />
        ))}
      </UiRadioGroup>

      <div className="hairline flex flex-col rounded-[var(--radius-panel)] bg-well">
        {twoWay ? (
          <UiDisclosureRow
            icon={Zap}
            title="Wenn eine Datei auf beiden Seiten geändert wurde"
            summary={conflictSummary(conflicts)}
            open={openConflicts}
            onToggle={() => setOpenConflicts((value) => !value)}
          >
            <span className="flex w-64">
              <UiSelect
                label="Welche Fassung bei einem Konflikt gewinnt"
                value={conflicts.prefer}
                options={PREFER_CHOICES}
                onChange={(prefer) => onConflicts({ ...conflicts, prefer })}
              />
            </span>
            <div className="flex items-center gap-3">
              <UiRadioSegments
                label="Was mit dem Verlierer geschieht"
                segments={loserSegments}
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
            title="Schutzschwelle"
            description={
              percentBad
                ? PERCENT_PROBLEM
                : twoWay
                  ? "Löscht ein Lauf auf einer Seite mehr als diesen Anteil der Dateien, hält clonq vorher an und fragt nach."
                  : "Löscht ein Lauf mehr als diesen Anteil der Einträge im Ziel, hält clonq vorher an und fragt nach."
            }
            descriptionId={`${ids}-percent`}
            invalid={percentBad}
            control={
              <UiNumberField
                label="Schutzschwelle in Prozent"
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

        <UiDisclosureRow
          icon={Archive}
          title="Gelöschtes und Überschriebenes aufheben"
          summary={daysProblem ?? (archive.enabled ? `An · ${archive.keepDays} ${keepDaysOf(archive.keepDays) === 1 ? "Tag" : "Tage"}` : "Aus")}
          invalid={daysProblem !== null}
          // An invalid number must stay in sight until it is fixed.
          open={openArchive || daysProblem !== null}
          onToggle={() => setOpenArchive((value) => !value)}
        >
          <div className="flex items-center gap-3">
            <UiSwitch checked={archive.enabled} onChange={(enabled) => onArchive({ ...archive, enabled })} label="Gelöschtes und Überschriebenes aufheben" />
            <div className={`flex items-center gap-1.5 text-xs transition-opacity ${archive.enabled ? "text-ink-soft" : "text-ink-faint opacity-60"}`}>
              <UiNumberField
                label="Aufbewahrungsdauer in Tagen"
                before="für"
                after={keepDaysOf(archive.keepDays) === 1 ? "Tag" : "Tage"}
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
                "Was ein Lauf löscht oder überschreibt, lässt sich danach nicht wiederherstellen."
              ))}
          </span>
        </UiDisclosureRow>

        <UiDisclosureRow
          icon={ListFilter}
          title="Ausschlüsse"
          summary={excludesSummary(excludes)}
          open={openExcludes}
          onToggle={() => setOpenExcludes((value) => !value)}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {excludes.map((item) => (
              <UiChip key={item} mono onRemove={() => onExcludes(excludes.filter((other) => other !== item))} removeLabel={`${item} entfernen`}>
                {item}
              </UiChip>
            ))}
            <span className="min-w-[10rem] flex-1" data-own-enter>
              <UiInput value={pattern} onChange={setPattern} onKeyDown={onPatternKey} placeholder="Muster, zum Beispiel .DS_Store" mono />
            </span>
          </div>
          <span className="text-[0.6875rem] leading-snug text-ink-faint">
            Endet ein Muster auf /, gilt es nur für Ordner; beginnt es mit /, nur für die oberste Ebene.
          </span>
        </UiDisclosureRow>
      </div>
    </div>
  );
}
