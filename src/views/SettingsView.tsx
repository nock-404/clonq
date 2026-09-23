import type { ClonqState } from "../hooks/useClonq";
import { reportError } from "../hooks/useClonq";
import { api } from "../lib/api";
import type { Accent, UiSettings } from "../lib/types";
import { UiPanel, UiSegmented, UiSwitch, type UiSegment } from "../ui";

interface SettingsViewProps {
  state: ClonqState;
}

const accents: UiSegment<Accent>[] = [
  { value: "ring", label: "Schreibring-Rot", leading: <span className="size-2.5 rounded-full bg-ring-red" /> },
  { value: "amber", label: "Band-Bernstein", leading: <span className="size-2.5 rounded-full bg-tape-amber" /> },
  { value: "blue", label: "IBM-Blau", leading: <span className="size-2.5 rounded-full bg-ring-blue" /> },
];

export function SettingsView({ state }: SettingsViewProps) {
  const ui = state.config?.ui;
  if (!ui || !state.config) return null;
  const save = (change: Partial<UiSettings>) => void api.setUiSettings({ ...ui, ...change }).catch(reportError);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Einstellungen</h1>
      <UiPanel title="Akzentfarbe">
        <UiSegmented label="Akzentfarbe" segments={accents} value={ui.accent} onChange={(accent) => save({ accent })} />
      </UiPanel>
      <UiPanel title="Lämpchen im Job-Detail">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-ink-soft">Blinken, solange Daten fließen.</span>
          <UiSwitch label="Lämpchen" checked={ui.lamps} onChange={(lamps) => save({ lamps })} />
        </div>
      </UiPanel>
      <UiPanel title="rsync">
        <span className="font-mono text-xs text-ink-soft">{state.config.rsyncPath}</span>
      </UiPanel>
    </div>
  );
}
