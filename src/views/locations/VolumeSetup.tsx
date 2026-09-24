import { Check, Plus } from "lucide-react";
import { useState } from "react";
import type { ClonqState } from "../../hooks/useClonq";
import { useT } from "../../i18n";
import { api } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import type { MountedVolume } from "../../lib/types";
import { UiChoiceCard, UiNotice, UiPanel, UiText } from "../../ui";
import { UiLocationGlyph } from "../../ui/UiLocationGlyph";
import { UiSegmentMeter } from "../../ui/UiSegmentMeter";
import { nameTaken } from "./duplicates";
import { fileSystemLabel } from "./kinds";
import { NameField } from "./parts";
import { lampOf, useAdded, useSuggestedName, useTask, type Setup, type SetupContext } from "./setup";

function volumeIds(state: ClonqState): Set<string> {
  return new Set((state.config?.locations ?? []).flatMap((location) => (location.kind.type === "volume" ? [location.kind.volumeUuid] : [])));
}

/** Drives that are mounted right now and not yet a location. */
export function newDrives(state: ClonqState): MountedVolume[] {
  const known = volumeIds(state);
  return state.volumes.filter((volume) => !known.has(volume.uuid));
}

/** An external drive: picked from the drives macOS has mounted, remembered by its volume UUID. */
export function useVolumeSetup(context: SetupContext): Setup {
  const t = useT();
  const tv = t.locations.volume;
  const tw = t.locations.flow;
  const { state } = context;
  const drives = newDrives(state);
  const known = volumeIds(state);
  const alreadyAdded = state.volumes.filter((volume) => known.has(volume.uuid)).map((volume) => volume.name);
  const [picked, setPicked] = useState<string | null>(null);
  const add = useTask();
  const { added, done } = useAdded(context.onAdded);
  // Once added, the drive is no longer new; the form keeps showing it until the sheet closes.
  const [submitted, setSubmitted] = useState<MountedVolume | null>(null);
  const shown = submitted && (add.busy || added) ? [submitted] : drives;
  const drive = shown.find((item) => item.uuid === picked) ?? shown[0];
  const { name, setName, edited } = useSuggestedName(drive?.name ?? "");
  const taken = add.busy || added ? undefined : nameTaken(state.config, name);
  const ready = drive !== undefined && taken === undefined && name.trim() !== "";

  const pick = (uuid: string) => {
    setPicked(uuid);
    setName(null);
    add.clear();
  };

  const move = (step: 1 | -1) => {
    if (drives.length < 2 || add.busy || added) return;
    const index = drives.findIndex((item) => item.uuid === drive?.uuid);
    const next = drives[(index + step + drives.length) % drives.length];
    if (next) pick(next.uuid);
  };

  const submit = async () => {
    if (!drive || !ready) return;
    setSubmitted(drive);
    const location = await add.run(() => api.addVolumeLocation(name.trim(), drive.uuid));
    if (location) done(location);
  };

  const body =
    !drive && !added ? (
      <div className="flex flex-col gap-2 pt-1">
        <UiText variant="heading">{tv.noneTitle}</UiText>
        <UiText tone="neutral">
          {tv.noneText}
        </UiText>
        {alreadyAdded.length > 0 ? (
          <UiText variant="caption" tone="neutral">
            {tv.alreadyAdded(alreadyAdded.join(", "))}
          </UiText>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {shown.length === 1 && drive ? (
          <UiPanel>
            <div className="flex items-center gap-3">
              <UiLocationGlyph kind="volume" size="md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-3">
                  <UiText variant="heading" truncate>
                    {drive.name}
                  </UiText>
                  <UiText variant="caption" tone="neutral">
                    {fileSystemLabel(drive.fileSystem)}
                  </UiText>
                </span>
                <DriveSummary drive={drive} selected={false} />
              </div>
            </div>
          </UiPanel>
        ) : (
          <div role="radiogroup" aria-label={tv.group} className="flex flex-col gap-1.5">
            {shown.map((item) => (
              <UiChoiceCard
                key={item.uuid}
                art={<UiLocationGlyph kind="volume" size="md" />}
                title={item.name}
                description={<DriveSummary drive={item} selected={item.uuid === drive?.uuid} />}
                selected={item.uuid === drive?.uuid}
                onPress={() => pick(item.uuid)}
                aside={fileSystemLabel(item.fileSystem)}
              />
            ))}
          </div>
        )}
        <NameField
          value={name}
          onChange={setName}
          taken={taken}
          hint={tv.nameHint}
          disabled={add.busy || !!added}
        />
        {add.error ? <UiNotice tone="danger">{add.error}</UiNotice> : null}
      </div>
    );

  const plate = {
    name: drive || added ? name : "",
    lamp: added ? ("on" as const) : add.busy ? ("busy" as const) : ("off" as const),
    threaded: added !== null,
    empty: !drive && !added,
    steps: [lampOf({ done: drive !== undefined || !!added, ready: true }), lampOf({ done: !!added, busy: add.busy, failed: !!add.error, ready })],
    status: added
      ? tw.added
      : add.busy
        ? tw.adding
        : add.error
          ? tw.notAdded
          : !drive
            ? tv.noDrive
            : taken
              ? tw.nameTaken
              : name.trim() === ""
                ? tw.nameMissing
                : tw.readyToAdd,
    tone: added ? ("ok" as const) : add.error ? ("danger" as const) : ("neutral" as const),
  };

  const base = { body, plate, dirty: edited || picked !== null, busy: add.busy, onArrow: move };
  if (added) return { ...base, final: true, action: { label: tw.added, icon: Check, run: () => {}, disabled: true } };
  return {
    ...base,
    action: { label: add.busy ? tw.adding : tw.add, icon: add.busy ? undefined : Plus, run: () => void submit(), disabled: add.busy || !ready },
  };
}

/** Used and free space as a block meter, with the numbers under it. */
function DriveSummary({ drive, selected }: { drive: MountedVolume; selected: boolean }) {
  const t = useT().locations.volume;
  const used = Math.max(0, drive.totalBytes - drive.freeBytes);
  return (
    <span className="flex flex-col gap-1.5 pt-1">
      <UiSegmentMeter
        value={drive.totalBytes > 0 ? used / drive.totalBytes : 0}
        size="sm"
        segments={40}
        tone={selected ? "ink" : "oxide"}
        label={t.usedSpace(drive.name)}
      />
      <UiText variant="caption" tone="neutral">
        {t.summary(formatBytes(used), formatBytes(drive.freeBytes), formatBytes(drive.totalBytes))}
      </UiText>
    </span>
  );
}
