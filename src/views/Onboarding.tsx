import { Plus } from "lucide-react";
import type { ClonqState } from "../hooks/useClonq";
import { useT } from "../i18n";
import { formatBytes } from "../lib/format";
import { openSheet } from "../lib/nav";
import { UiButton, UiChoiceCard, UiReelPair } from "../ui";
import { UiLocationGlyph } from "../ui/UiLocationGlyph";
import { UiLogo } from "../ui/UiLogo";

interface OnboardingProps {
  state: ClonqState;
}

/** The first thing a new user sees: nothing set up yet, and what to do about it. */
export function Onboarding({ state }: OnboardingProps) {
  const t = useT().shell.onboarding;
  const known = new Set(
    (state.config?.locations ?? []).flatMap((location) => (location.kind.type === "volume" ? [location.kind.volumeUuid] : [])),
  );
  const drives = state.volumes.filter((volume) => !known.has(volume.uuid));
  const hasLocations = (state.config?.locations.length ?? 0) > 0;
  return (
    <div className="flex items-center gap-10 pt-6">
      <div className="h-72 shrink-0">
        <UiReelPair ring="blue" progress={0} running={false} label={t.emptyTape} />
      </div>
      <div className="flex max-w-md flex-col gap-4">
        {hasLocations ? null : <UiLogo variant="wordmark" size="md" label="clonq" />}
        <h1 className="text-2xl font-semibold tracking-tight">{hasLocations ? t.titleFirstJob : t.titleEmpty}</h1>
        <p className="text-[0.8125rem] leading-relaxed text-ink-soft">
          {hasLocations ? t.introFirstJob : t.introEmpty}
        </p>
        {drives.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-[0.6875rem] font-medium text-ink-faint">{t.found}</span>
            {drives.map((drive) => (
              <UiChoiceCard
                key={drive.uuid}
                art={<UiLocationGlyph kind="volume" size="md" connected />}
                title={drive.name}
                description={t.driveFree(formatBytes(drive.freeBytes), formatBytes(drive.totalBytes))}
                selected={false}
                onPress={() => openSheet({ kind: "addLocation", preset: "volume" })}
                aside={t.add}
              />
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <UiButton variant={hasLocations ? "secondary" : "primary"} icon={Plus} onPress={() => openSheet({ kind: "addLocation" })}>
            {t.addLocation}
          </UiButton>
          <UiButton variant={hasLocations ? "primary" : "ghost"} icon={Plus} disabled={!hasLocations} onPress={() => openSheet({ kind: "jobWizard" })}>
            {t.addJob}
          </UiButton>
        </div>
      </div>
    </div>
  );
}
