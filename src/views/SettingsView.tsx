import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import type { ClonqState } from "../hooks/useClonq";
import { reportError } from "../hooks/useClonq";
import { api } from "../lib/api";
import type { Accent, Reels, UiSettings } from "../lib/types";
import { UiPanel, UiSegmented, UiSwitch, type UiSegment } from "../ui";
import { UiLogo } from "../ui/UiLogo";
import { UiReel as LichtReel } from "../ui/reels/licht/UiReel";
import { UiReel as PraezisionReel } from "../ui/reels/praezision/UiReel";
import { UiReel as VakuumReel } from "../ui/reels/vakuum/UiReel";

interface SettingsViewProps {
  state: ClonqState;
}

const accents: UiSegment<Accent>[] = [
  { value: "ring", label: "Schreibring-Rot", leading: <span className="size-2.5 rounded-full bg-ring-red" /> },
  { value: "amber", label: "Band-Bernstein", leading: <span className="size-2.5 rounded-full bg-tape-amber" /> },
  { value: "blue", label: "IBM-Blau", leading: <span className="size-2.5 rounded-full bg-ring-blue" /> },
];

// Each choice shows its own reel, whatever style is active right now.
const reelStyles: UiSegment<Reels>[] = [
  { value: "licht", label: "Licht", leading: <LichtReel ring="blue" size="xs" /> },
  { value: "vakuum", label: "Vakuum", leading: <VakuumReel ring="blue" size="xs" /> },
  { value: "praezision", label: "Präzision", leading: <PraezisionReel ring="blue" size="xs" /> },
];

export function SettingsView({ state }: SettingsViewProps) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => setAutostart(null));
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);
  const ui = state.config?.ui;
  if (!ui || !state.config) return null;
  const toggleAutostart = (next: boolean) => {
    (next ? enable() : disable())
      .then(() => setAutostart(next))
      .catch(reportError);
  };
  const save = (change: Partial<UiSettings>) => void api.setUiSettings({ ...ui, ...change }).catch(reportError);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Einstellungen</h1>
      <UiPanel title="Akzentfarbe">
        <UiSegmented label="Akzentfarbe" segments={accents} value={ui.accent} onChange={(accent) => save({ accent })} />
      </UiPanel>
      <UiPanel title="Spulen">
        <UiSegmented label="Spulen" segments={reelStyles} value={ui.reels} onChange={(reels) => save({ reels })} />
      </UiPanel>
      <UiPanel title="Lämpchen im Job-Detail">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-ink-soft">Blinken, solange Daten fließen.</span>
          <UiSwitch label="Lämpchen" checked={ui.lamps} onChange={(lamps) => save({ lamps })} />
        </div>
      </UiPanel>
      <UiPanel title="Beim Anmelden starten">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-ink-soft">Automatische Auslöser laufen nur, solange clonq läuft.</span>
          <UiSwitch label="Beim Anmelden starten" checked={autostart ?? false} onChange={toggleAutostart} />
        </div>
      </UiPanel>
      <UiPanel title="Mitteilungen">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-ink-soft">
            Probleme bei automatischen Läufen meldet clonq immer. Auf Wunsch auch jeden erfolgreichen Lauf.
          </span>
          <UiSwitch label="Erfolgreiche Läufe melden" checked={ui.notifySuccess} onChange={(notifySuccess) => save({ notifySuccess })} />
        </div>
      </UiPanel>
      <UiPanel title="Über clonq">
        <div className="flex items-center gap-4">
          <UiLogo variant="icon" size="md" />
          <div className="flex flex-col gap-1">
            <UiLogo variant="wordmark" size="sm" label="clonq" />
            {version ? <span className="font-mono text-xs text-ink-faint">Version {version}</span> : null}
          </div>
        </div>
      </UiPanel>
      <UiPanel title="Werkzeuge">
        <div className="flex flex-col gap-1 font-mono text-xs text-ink-soft">
          <span>{state.config.rsyncPath}</span>
          <span>{state.config.rclonePath}</span>
        </div>
      </UiPanel>
    </div>
  );
}
