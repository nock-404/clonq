import { Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { refreshLocations, type ClonqState } from "../../hooks/useClonq";
import { texts, useT } from "../../i18n";
import { api } from "../../lib/api";
import { formatBytes, formatRelative } from "../../lib/format";
import { isRunning } from "../../lib/jobs";
import { messageLabel, modeLabel, placeLabel, statusLabel, statusTone, type Tone } from "../../lib/labels";
import { navigate, openSheet } from "../../lib/nav";
import type { Location, MountedVolume, Reach } from "../../lib/types";
import { UiBadge, UiButton, UiListRow, UiNotice, UiPanel, UiReel, UiText } from "../../ui";
import { UiDriveFront, type UiDriveLamp } from "../../ui/UiDriveFront";
import { UiInlineEdit } from "../../ui/UiInlineEdit";
import { UiLamp } from "../../ui/UiLamp";
import type { GlyphLamp } from "../../ui/UiLocationGlyph";
import { UiSegmentMeter } from "../../ui/UiSegmentMeter";
import { ringOf } from "../../ui/rings";
import { FileBrowser } from "../FileBrowser";
import { checkedInBackground, markChecked, recordOwnCheck, useCheck } from "./checks";
import { errorText, fileSystemLabel, glyphOf, kindTitle, providerLabel, tidyPath } from "./kinds";
import { LocationRepair } from "./LocationRepair";
import { useTask } from "./setup";

/** How long the drive front shows the location being unloaded before it is removed. */
const UNLOAD_MS = 700;

interface LocationDetailProps {
  state: ClonqState;
  location: Location;
  now: number;
}

/**
 * One location: its drive front and live state, what it is, which jobs use it;
 * check, rename, repair and remove. ↵ checks, ⌘E renames.
 */
export function LocationDetail({ state, location, now }: LocationDetailProps) {
  const t = useT();
  const td = t.locations.detail;
  const status = state.locations[location.id];
  const { at: checkedAt, reach } = useCheck(location, status?.reach);
  const kind = location.kind;
  const volume = kind.type === "volume" ? state.volumes.find((item) => item.uuid === kind.volumeUuid) : undefined;
  const jobs = (state.config?.jobs ?? [])
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => job.source.location === location.id || job.target.location === location.id);
  const inUse = jobs.length > 0;
  const running = jobs.some(({ job }) => isRunning(state.live[job.id]));
  const check = useTask();
  const remove = useTask();
  const [pulse, setPulse] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Removing first lets the drive front unload the location: the tape comes out, the lamps go dark.
  const [unloading, setUnloading] = useState(false);
  // Whether the files of this location have been on screen in this view.
  const [browsed, setBrowsed] = useState(false);
  const confirmBox = useRef<HTMLDivElement>(null);

  // Folders, drives and shares are looked at live: opening the view looks again, and every
  // new answer counts as a check. Servers and clouds keep the time of their last test.
  useEffect(() => {
    void refreshLocations();
  }, [location.id]);
  useEffect(() => {
    if (status && !checkedInBackground(location)) markChecked(location.id);
  }, [status?.reach]);

  const connect = kind.type === "smb" && reach?.state === "disconnected";
  const runCheck = async () => {
    const result = await check.run(async (): Promise<Reach | undefined> => {
      if (connect) return (await api.connectLocation(location.id)).reach;
      if (kind.type === "cloud") {
        // test_location only reports the last background round for a cloud; listing its top level is a real test.
        try {
          await api.listFolders(location.id, "");
          const fresh: Reach = { state: "connected", path: null, freeBytes: null, totalBytes: null };
          recordOwnCheck(location.id, fresh);
          return fresh;
        } catch (problem) {
          const fresh: Reach = { state: "failed", message: errorText(problem) };
          recordOwnCheck(location.id, fresh);
          return fresh;
        }
      }
      return (await api.testLocation(location.id)).reach;
    });
    markChecked(location.id);
    await refreshLocations();
    if (result?.state === "connected") setPulse((count) => count + 1);
  };

  const rename = async (name: string): Promise<string | null> => {
    try {
      await api.renameLocation(location.id, name);
      return null;
    } catch (problem) {
      return messageLabel(errorText(problem));
    }
  };

  const runRemove = async () => {
    if (unloading) return;
    setUnloading(true);
    await new Promise((resolve) => setTimeout(resolve, UNLOAD_MS));
    const removed = await remove.run(async () => {
      await api.removeLocation(location.id);
      return true;
    });
    if (removed) navigate({ kind: "overview" });
    else setUnloading(false);
  };

  // ↵ checks, ⌘E renames; while the removal question stands, ↵ removes and Escape keeps.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (confirming) {
      if (unloading) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirming(false);
      } else if (event.key === "Enter" && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        void runRemove();
      }
      return;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement || renaming) return;
    if (event.key === "Enter" && !event.metaKey && !check.busy) {
      event.preventDefault();
      void runCheck();
    } else if (event.key === "e" && event.metaKey) {
      event.preventDefault();
      setRenaming(true);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // The question takes the focus, on "Remove", so ↵ answers it.
  useEffect(() => {
    if (confirming) confirmBox.current?.querySelector<HTMLButtonElement>("button:last-of-type")?.focus();
  }, [confirming]);

  const words = stateWords(location, reach, check.busy, connect);
  const connected = reach?.state === "connected" && !unloading;
  useEffect(() => {
    if (connected) setBrowsed(true);
  }, [connected]);
  const faulty = reach?.state === "failed" || reach?.state === "missing";
  const lamp: GlyphLamp = check.busy ? "busy" : unloading ? "off" : connected ? "on" : faulty ? "fault" : "off";
  const lamps: UiDriveLamp[] = [
    { key: "ready", label: td.lamps.ready, state: connected ? "done" : "off" },
    { key: "check", label: td.lamps.check, state: check.busy ? "busy" : "off" },
    { key: "run", label: td.lamps.run, state: running ? "busy" : "off" },
    { key: "fault", label: td.lamps.fault, state: faulty && !check.busy ? "failed" : "off" },
  ];
  const facts = factsOf(location, volume);
  const subtitle = subtitleOf(location, volume);
  const local = kind.type === "folder" || kind.type === "volume";
  const capacity = capacityOf(location, reach);
  // Servers and clouds are tested every ten minutes. One failed round keeps the file browser, with
  // its folder, selection and preview, and says so above it; a drive or share that is gone does not.
  const showFiles = connected || (browsed && (kind.type === "ssh" || kind.type === "cloud") && !unloading && reach?.state !== "missing");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[15rem_minmax(0,1fr)] items-start gap-5">
        <UiDriveFront
          kind={glyphOf(location)}
          label={location.name}
          lamp={lamp}
          threaded={connected}
          dimmed={(reach?.state === "disconnected" || reach?.state === "missing") && !check.busy}
          spinning={running}
          pulse={unloading ? "unload" : pulse}
          lamps={lamps}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <header className="flex flex-col gap-1">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <UiInlineEdit value={location.name} onSave={rename} label={td.rename} keys={["⌘", "E"]} editing={renaming} onEditingChange={setRenaming}>
                  <h1 className="min-w-0">
                    <UiText variant="title" truncate>
                      {location.name}
                    </UiText>
                  </h1>
                </UiInlineEdit>
              </div>
              {renaming ? null : (
                <UiButton icon={check.busy ? undefined : connect ? Plug : RefreshCw} keys={check.busy ? undefined : ["↵"]} disabled={check.busy} onPress={() => void runCheck()}>
                  {check.busy ? (connect ? td.connecting : td.checking) : connect ? td.connect : local ? td.checkAgain : td.checkConnection}
                </UiButton>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <UiBadge>{kindTitle(location)}</UiBadge>
              {subtitle ? (
                <UiText variant={subtitle.mono ? "mono" : "caption"} tone="neutral" truncate>
                  {subtitle.text}
                </UiText>
              ) : null}
            </div>
          </header>

          <UiPanel title={td.state} aside={checkedAt ? td.lastChecked(formatRelative(new Date(checkedAt).toISOString(), now)) : undefined}>
            <UiText variant="heading" tone={words.tone}>
              {words.headline}
            </UiText>
            {words.sentence ? <UiText tone={words.sentenceTone}>{words.sentence}</UiText> : null}
            {capacity ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <UiSegmentMeter value={capacity.share} segments={56} label={capacity.caption} />
                <UiText variant="caption" tone="neutral">
                  {capacity.text}
                </UiText>
              </div>
            ) : null}
            {check.error ? (
              <UiNotice tone="danger" onDismiss={check.clear}>
                {check.error}
              </UiNotice>
            ) : null}
            <LocationRepair state={state} location={location} reach={reach} onRepaired={() => setPulse((count) => count + 1)} />
          </UiPanel>

          {facts.length > 0 ? (
            <UiPanel title={td.facts}>
              <dl className="flex flex-col">
                {facts.map((fact, index) => (
                  <div key={fact.label} className={`grid grid-cols-[9rem_minmax(0,1fr)] items-baseline pb-1.5 ${index > 0 ? "hairline-t pt-1.5" : ""}`}>
                    <dt>
                      <UiText variant="caption" tone="neutral">
                        {fact.label}
                      </UiText>
                    </dt>
                    <dd className="min-w-0 select-text">
                      <UiText variant={fact.mono ? "mono" : "caption"} truncate title={fact.value}>
                        {fact.value}
                      </UiText>
                    </dd>
                  </div>
                ))}
              </dl>
            </UiPanel>
          ) : null}
        </div>
      </div>

      <UiPanel title={td.jobs} aside={inUse ? String(jobs.length) : undefined}>
        {inUse ? (
          <div className="-mx-2 flex flex-col gap-0.5">
            {jobs.map(({ job, index }) => {
              const latest = state.latest[job.id];
              const source = job.source.location === location.id;
              return (
                <UiListRow
                  key={job.id}
                  leading={<UiReel ring={ringOf(job.ring, index)} size="sm" spinning={isRunning(state.live[job.id])} />}
                  title={job.name}
                  subtitle={`${placeLabel(job.source, state.config)} → ${placeLabel(job.target, state.config)}`}
                  accessory={
                    <>
                      <UiBadge tone={source ? "accent" : "neutral"}>{source ? td.source : td.target}</UiBadge>
                      <span className="w-16">
                        <UiText variant="caption" tone="neutral">
                          {modeLabel(job.mode)}
                        </UiText>
                      </span>
                      <span className="w-28 text-right">
                        <UiText variant="caption" tone={latest ? statusTone[latest.status] : "neutral"} title={latest ? statusLabel(latest.status) : undefined}>
                          {latest ? formatRelative(latest.startedAt, now) : td.neverRun}
                        </UiText>
                      </span>
                    </>
                  }
                  selected={false}
                  onPress={() => navigate({ kind: "job", jobId: job.id })}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <UiText tone="neutral">{td.noJobs}</UiText>
            <UiButton icon={Plus} onPress={() => openSheet({ kind: "jobWizard" })}>
              {td.createJob}
            </UiButton>
          </div>
        )}
      </UiPanel>

      <UiPanel title={td.files}>
        {showFiles ? (
          <>
            {connected ? null : (
              <UiNotice tone="neutral">
                {td.staleFiles(location.name)}
              </UiNotice>
            )}
            <FileBrowser key={location.id} location={location} now={now} connected={connected} />
          </>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {check.busy ? <UiLamp tone="accent" busy /> : null}
              <UiText tone="neutral">{filesUnavailable(location, reach, unloading)}</UiText>
            </div>
            {unloading || renaming ? null : (
              <UiButton icon={check.busy ? undefined : connect ? Plug : RefreshCw} disabled={check.busy} onPress={() => void runCheck()}>
                {check.busy ? (connect ? td.connecting : td.checking) : connect ? td.connect : local ? td.checkAgain : td.checkConnection}
              </UiButton>
            )}
          </div>
        )}
      </UiPanel>

      <UiPanel title={td.removeTitle}>
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {inUse ? (
              <UiText tone="neutral">{td.removeInUse}</UiText>
            ) : (
              <UiText tone={confirming ? "ink" : "neutral"}>
                {confirming ? td.removeConfirm(location.name) : ""}
                {td.dataStays}
                {removalExtra(location)}
              </UiText>
            )}
            {remove.error ? (
              <UiText variant="caption" tone="danger">
                {remove.error}
              </UiText>
            ) : null}
          </div>
          {confirming && !inUse ? (
            <div ref={confirmBox} className="flex shrink-0 items-center gap-2">
              <UiButton variant="ghost" keys={["esc"]} onPress={() => setConfirming(false)}>
                {td.keep}
              </UiButton>
              <UiButton variant="danger" icon={unloading ? undefined : Trash2} keys={unloading ? undefined : ["↵"]} disabled={unloading} onPress={() => void runRemove()}>
                {unloading ? td.removing : td.remove}
              </UiButton>
            </div>
          ) : (
            <UiButton variant="ghost" icon={Trash2} disabled={inUse} onPress={() => setConfirming(true)}>
              {td.removeAsk}
            </UiButton>
          )}
        </div>
      </UiPanel>
    </div>
  );
}

/** Why the files cannot be shown right now, in one sentence. */
function filesUnavailable(location: Location, reach: Reach | undefined, unloading: boolean): string {
  const t = texts().locations.detail;
  const kind = location.kind.type;
  if (unloading) return t.filesRemoving;
  switch (reach?.state) {
    case "disconnected":
      return kind === "volume" ? t.filesDrive : kind === "smb" ? t.filesShare : t.filesReachable;
    case "missing":
      return t.filesMissing;
    case "failed":
      return t.filesFailed;
    case "untested":
      return t.filesUntested;
    default:
      return t.filesUnknown;
  }
}

/** What else goes when the location is removed. */
function removalExtra(location: Location): string {
  const t = texts().locations.detail;
  switch (location.kind.type) {
    case "ssh":
      return t.removeSsh;
    case "smb":
      return t.removeSmb;
    case "cloud":
      return t.removeCloud;
    default:
      return "";
  }
}

/** The line under the name: where the location is, once. An unplugged drive has no place to show. */
function subtitleOf(location: Location, volume: MountedVolume | undefined): { text: string; mono: boolean } | null {
  const kind = location.kind;
  switch (kind.type) {
    case "folder":
      return { text: tidyPath(kind.path), mono: true };
    case "volume":
      return volume ? { text: volume.mountPoint, mono: true } : null;
    case "ssh":
      return { text: texts().locations.detail.sshLine(`${kind.user}@${kind.host}`, kind.port), mono: true };
    case "smb":
      return { text: kind.url, mono: true };
    case "cloud":
      return kind.provider === "webdav" ? null : { text: providerLabel[kind.provider], mono: false };
  }
}

interface Words {
  headline: string;
  tone: Tone;
  sentence: string | null;
  sentenceTone: Tone | "ink";
}

/** The state in words, for this kind of location. */
function stateWords(location: Location, reach: Reach | undefined, checking: boolean, connecting: boolean): Words {
  const t = texts().locations.detail;
  const kind = location.kind.type;
  const remote = kind === "ssh" || kind === "cloud";
  if (checking) {
    const sentence = connecting ? t.checkingShare : kind === "ssh" ? t.checkingServer : kind === "cloud" ? t.checkingCloud : null;
    return { headline: connecting ? t.connecting : t.checking, tone: "accent", sentence, sentenceTone: "neutral" };
  }
  switch (reach?.state) {
    case "connected": {
      const headline = kind === "folder" ? t.present : kind === "volume" ? t.pluggedIn : t.connected;
      const sentence = kind === "ssh" ? t.serverOk : kind === "cloud" ? t.cloudOk : kind === "smb" && reach.path ? t.mountedAt(reach.path) : null;
      return { headline, tone: "ok", sentence, sentenceTone: "neutral" };
    }
    case "disconnected":
      if (kind === "volume") {
        return { headline: t.notPluggedIn, tone: "neutral", sentence: t.driveWaits, sentenceTone: "neutral" };
      }
      if (kind === "smb") {
        return { headline: t.notConnected, tone: "neutral", sentence: t.shareOff, sentenceTone: "neutral" };
      }
      return { headline: t.unreachable, tone: "neutral", sentence: t.jobsWait, sentenceTone: "neutral" };
    case "missing":
      return { headline: t.folderMissing, tone: "danger", sentence: t.folderMissingText, sentenceTone: "neutral" };
    case "untested":
      return { headline: t.untested, tone: "neutral", sentence: remote ? t.firstCheck : t.stateUnknown, sentenceTone: "neutral" };
    case "failed":
      return { headline: t.noConnection, tone: "danger", sentence: messageLabel(reach.message), sentenceTone: "danger" };
    default:
      return { headline: t.unknown, tone: "neutral", sentence: t.stateUnknown, sentenceTone: "neutral" };
  }
}

/** Free space where the location reports it; for a folder that is the space of the whole internal SSD. */
function capacityOf(location: Location, reach: Reach | undefined): { share: number; text: string; caption: string } | null {
  if (reach?.state !== "connected" || reach.totalBytes === null || reach.freeBytes === null || reach.totalBytes <= 0) return null;
  const t = texts().locations.detail;
  const where = location.kind.type === "folder" ? t.onSsd : location.kind.type === "volume" ? t.onDrive : t.onShare;
  const used = Math.max(0, reach.totalBytes - reach.freeBytes);
  return {
    share: used / reach.totalBytes,
    text: t.capacity(formatBytes(reach.freeBytes), formatBytes(reach.totalBytes), where),
    caption: t.usedSpace(where),
  };
}

interface Fact {
  label: string;
  value: string;
  mono: boolean;
}

/** What the location is beyond the line under its name, like the type plate on a device. */
function factsOf(location: Location, volume: MountedVolume | undefined): Fact[] {
  const all = texts().locations;
  const t = all.detail;
  const kind = location.kind;
  switch (kind.type) {
    case "folder":
      return [];
    case "volume":
      return [
        ...(volume ? [{ label: t.fileSystem, value: fileSystemLabel(volume.fileSystem), mono: false }] : []),
        ...(kind.volumeName !== location.name ? [{ label: t.driveName, value: kind.volumeName, mono: false }] : []),
        { label: t.identifier, value: kind.volumeUuid, mono: true },
      ];
    case "ssh":
      return [
        { label: all.server.baseFolder, value: kind.basePath || all.server.loginFolder, mono: kind.basePath !== "" },
        { label: t.keyFile, value: tidyPath(kind.identityFile), mono: true },
      ];
    case "smb":
      return [
        { label: all.flow.user, value: kind.user, mono: true },
        { label: all.flow.password, value: t.inKeychain, mono: false },
      ];
    case "cloud": {
      const bucket = kind.provider === "s3" || kind.provider === "b2";
      return kind.provider === "webdav"
        ? [
            { label: t.folder, value: kind.root || t.topLevel, mono: kind.root !== "" },
            { label: t.access, value: t.userAndPassword, mono: false },
          ]
        : [
            { label: bucket ? all.fields.bucket : t.folder, value: kind.root || t.topLevel, mono: kind.root !== "" },
            { label: t.access, value: bucket ? t.withAccessKey : all.cloud.browserLogin, mono: false },
          ];
    }
  }
}
