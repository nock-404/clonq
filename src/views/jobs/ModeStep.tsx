import { useEffect, useState, type KeyboardEvent } from "react";
import { modeLabel } from "../../lib/labels";
import type { Mode } from "../../lib/types";
import { UiInput } from "../../ui";
import { UiChip } from "../../ui/UiChip";
import { UiFormGroup } from "../../ui/UiFormGroup";
import { UiModeDiagram } from "../../ui/UiModeDiagram";
import { UiOptionCard } from "../../ui/UiOptionCard";
import { percentOf, sortExcludes } from "./draft";

interface ModeStepProps {
  mode: Mode | null;
  onMode: (mode: Mode) => void;
  excludes: string[];
  onExcludes: (excludes: string[]) => void;
  maxDeletePercent: string;
  onMaxDeletePercent: (value: string) => void;
  /** Enter in the pattern field with nothing to add: go on, like Enter anywhere else. */
  onSubmit: () => void;
}

const options: { mode: "mirror" | "backup"; key: string; description: string; extra: string }[] = [
  {
    mode: "mirror",
    key: "1",
    description: "Das Ziel wird zu einer genauen Kopie der Quelle; was in der Quelle fehlt, wird im Ziel gelöscht.",
    extra: "wird gelöscht",
  },
  { mode: "backup", key: "2", description: "Neues und Geändertes kommt ins Ziel; dort wird nie etwas gelöscht.", extra: "bleibt" },
];

/** Step 3: how the target follows the source, what stays out, and how much a run may delete. */
export function ModeStep({ mode, onMode, excludes, onExcludes, maxDeletePercent, onMaxDeletePercent, onSubmit }: ModeStepProps) {
  const [pattern, setPattern] = useState("");
  const percentBad = percentOf(maxDeletePercent) === null;

  // 1 and 2 pick a mode, as long as no text field has the keys.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const option = options.find((item) => item.key === event.key);
      if (option) onMode(option.mode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMode]);

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
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Art der Kopie">
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
      </div>

      <div className={`grid gap-4 ${mode === "mirror" ? "grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" : "grid-cols-1"}`}>
        <UiFormGroup title="Ausschlüsse" hint="Endet ein Muster auf /, gilt es nur für Ordner; beginnt es mit /, nur für die oberste Ebene.">
          <div className="hairline flex flex-wrap items-center gap-1.5 rounded-[var(--radius-panel)] bg-well p-1.5">
            {excludes.map((item) => (
              <UiChip key={item} mono onRemove={() => onExcludes(excludes.filter((other) => other !== item))} removeLabel={`${item} entfernen`}>
                {item}
              </UiChip>
            ))}
            <span className="min-w-[10rem] flex-1" data-own-enter>
              <UiInput value={pattern} onChange={setPattern} onKeyDown={onPatternKey} placeholder="Muster, zum Beispiel .DS_Store" mono />
            </span>
          </div>
        </UiFormGroup>

        {mode === "mirror" ? (
          <UiFormGroup
            title="Schutzschwelle"
            error={percentBad ? "Die Schutzschwelle muss eine Zahl zwischen 0 und 100 sein." : null}
            hint="Löscht ein Lauf mehr als diesen Anteil der Einträge im Ziel, hält clonq nach dem Probelauf an und fragt nach."
          >
            <div className="flex w-24 items-center gap-1.5">
              <UiInput value={maxDeletePercent} onChange={onMaxDeletePercent} type="number" />
              <span className="text-xs text-ink-soft">%</span>
            </div>
          </UiFormGroup>
        ) : null}
      </div>
    </div>
  );
}
