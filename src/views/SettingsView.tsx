import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import type { ClonqState } from "../hooks/useClonq";
import { reportError } from "../hooks/useClonq";
import { api } from "../lib/api";
import { LANGUAGES, useT } from "../i18n";
import type { Accent, Language, Reels, UiSettings } from "../lib/types";
import { UiPanel, UiSegmented, UiSwitch, type UiSegment } from "../ui";
import { UiLogo } from "../ui/UiLogo";
import { UpdateCheck } from "./UpdateBand";
import { UiReel as LichtReel } from "../ui/reels/licht/UiReel";
import { UiReel as PraezisionReel } from "../ui/reels/praezision/UiReel";
import { UiReel as VakuumReel } from "../ui/reels/vakuum/UiReel";

interface SettingsViewProps {
  state: ClonqState;
}

export function SettingsView({ state }: SettingsViewProps) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => setAutostart(null));
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);
  const t = useT();
  const s = t.shell.settings;
  const languages: UiSegment<Language>[] = [
    { value: "system", label: s.languageSystem },
    ...LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name })),
  ];
  const accents: UiSegment<Accent>[] = [
    { value: "ring", label: s.accentRing, leading: <span className="size-2.5 rounded-full bg-ring-red" /> },
    { value: "amber", label: s.accentAmber, leading: <span className="size-2.5 rounded-full bg-tape-amber" /> },
    { value: "blue", label: s.accentBlue, leading: <span className="size-2.5 rounded-full bg-ring-blue" /> },
  ];
  // Each choice shows its own reel, whatever style is active right now.
  const reelStyles: UiSegment<Reels>[] = [
    { value: "licht", label: s.reelLight, leading: <LichtReel ring="blue" size="xs" /> },
    { value: "vakuum", label: s.reelVacuum, leading: <VakuumReel ring="blue" size="xs" /> },
    { value: "praezision", label: s.reelPrecision, leading: <PraezisionReel ring="blue" size="xs" /> },
  ];
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
      <h1 className="text-xl font-semibold tracking-tight">{s.title}</h1>
      <UiPanel title={s.language}>
        <UiSegmented label={s.language} segments={languages} value={ui.language} onChange={(language) => save({ language })} />
      </UiPanel>
      <UiPanel title={s.accent}>
        <UiSegmented label={s.accent} segments={accents} value={ui.accent} onChange={(accent) => save({ accent })} />
      </UiPanel>
      <UiPanel title={s.reels}>
        <UiSegmented label={s.reels} segments={reelStyles} value={ui.reels} onChange={(reels) => save({ reels })} />
      </UiPanel>
      <UiPanel title={s.lamps}>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-ink-soft">{s.lampsDetail}</span>
          <UiSwitch label={s.lampsSwitch} checked={ui.lamps} onChange={(lamps) => save({ lamps })} />
        </div>
      </UiPanel>
      <UiPanel title={s.autostart}>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-ink-soft">{s.autostartDetail}</span>
          <UiSwitch label={s.autostart} checked={autostart ?? false} onChange={toggleAutostart} />
        </div>
      </UiPanel>
      <UiPanel title={s.notifications}>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-ink-soft">{s.notificationsDetail}</span>
          <UiSwitch label={s.notifySuccess} checked={ui.notifySuccess} onChange={(notifySuccess) => save({ notifySuccess })} />
        </div>
      </UiPanel>
      <UiPanel title={s.about}>
        <div className="flex items-center gap-4">
          <UiLogo variant="icon" size="md" />
          <div className="flex flex-col gap-1">
            <UiLogo variant="wordmark" size="sm" label="clonq" />
            {version ? <span className="font-mono text-xs text-ink-faint">{s.version(version)}</span> : null}
          </div>
        </div>
        <div className="pt-4">
          <UpdateCheck />
        </div>
      </UiPanel>
      <UiPanel title={s.tools}>
        <div className="flex flex-col gap-1 font-mono text-xs text-ink-soft">
          <span>{state.config.rsyncPath}</span>
          <span>{state.config.rclonePath}</span>
        </div>
      </UiPanel>
    </div>
  );
}
