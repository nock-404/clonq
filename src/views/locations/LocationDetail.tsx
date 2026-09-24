import { Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { refreshLocations, type ClonqState } from "../../hooks/useClonq";
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

  // The question takes the focus, on "Entfernen", so ↵ answers it.
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
    { key: "ready", label: "Bereit", state: connected ? "done" : "off" },
    { key: "check", label: "Prüft", state: check.busy ? "busy" : "off" },
    { key: "run", label: "Läuft", state: running ? "busy" : "off" },
    { key: "fault", label: "Störung", state: faulty && !check.busy ? "failed" : "off" },
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
                <UiInlineEdit value={location.name} onSave={rename} label="Umbenennen" keys={["⌘", "E"]} editing={renaming} onEditingChange={setRenaming}>
                  <h1 className="min-w-0">
                    <UiText variant="title" truncate>
                      {location.name}
                    </UiText>
                  </h1>
                </UiInlineEdit>
              </div>
              {renaming ? null : (
                <UiButton icon={check.busy ? undefined : connect ? Plug : RefreshCw} keys={check.busy ? undefined : ["↵"]} disabled={check.busy} onPress={() => void runCheck()}>
                  {check.busy ? (connect ? "Wird verbunden …" : "Wird geprüft …") : connect ? "Verbinden" : local ? "Erneut prüfen" : "Verbindung prüfen"}
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

          <UiPanel title="Zustand" aside={checkedAt ? `Zuletzt geprüft ${formatRelative(new Date(checkedAt).toISOString(), now)}` : undefined}>
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
            <UiPanel title="Angaben">
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

      <UiPanel title="Jobs mit diesem Ort" aside={inUse ? String(jobs.length) : undefined}>
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
                      <UiBadge tone={source ? "accent" : "neutral"}>{source ? "Quelle" : "Ziel"}</UiBadge>
                      <span className="w-16">
                        <UiText variant="caption" tone="neutral">
                          {modeLabel(job.mode)}
                        </UiText>
                      </span>
                      <span className="w-28 text-right">
                        <UiText variant="caption" tone={latest ? statusTone[latest.status] : "neutral"} title={latest ? statusLabel(latest.status) : undefined}>
                          {latest ? formatRelative(latest.startedAt, now) : "noch nie gelaufen"}
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
            <UiText tone="neutral">Noch kein Job benutzt diesen Ort.</UiText>
            <UiButton icon={Plus} onPress={() => openSheet({ kind: "jobWizard" })}>
              Job anlegen
            </UiButton>
          </div>
        )}
      </UiPanel>

      <UiPanel title="Dateien">
        {showFiles ? (
          <>
            {connected ? null : (
              <UiNotice tone="neutral">
                Die letzte Prüfung hat {location.name} nicht erreicht. Die Liste zeigt den Stand von vorher; Aktionen können scheitern, bis die Verbindung wieder steht.
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
                {check.busy ? (connect ? "Wird verbunden …" : "Wird geprüft …") : connect ? "Verbinden" : local ? "Erneut prüfen" : "Verbindung prüfen"}
              </UiButton>
            )}
          </div>
        )}
      </UiPanel>

      <UiPanel title="Ort entfernen">
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {inUse ? (
              <UiText tone="neutral">Dieser Ort lässt sich erst entfernen, wenn kein Job ihn mehr benutzt.</UiText>
            ) : (
              <UiText tone={confirming ? "ink" : "neutral"}>
                {confirming ? `„${location.name}“ wird aus clonq entfernt. ` : ""}
                Die Daten am Ort selbst bleiben, wie sie sind.{removalExtra(location)}
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
                Behalten
              </UiButton>
              <UiButton variant="danger" icon={unloading ? undefined : Trash2} keys={unloading ? undefined : ["↵"]} disabled={unloading} onPress={() => void runRemove()}>
                {unloading ? "Wird entfernt …" : "Entfernen"}
              </UiButton>
            </div>
          ) : (
            <UiButton variant="ghost" icon={Trash2} disabled={inUse} onPress={() => setConfirming(true)}>
              Entfernen …
            </UiButton>
          )}
        </div>
      </UiPanel>
    </div>
  );
}

/** Why the files cannot be shown right now, in one sentence. */
function filesUnavailable(location: Location, reach: Reach | undefined, unloading: boolean): string {
  const kind = location.kind.type;
  if (unloading) return "Der Ort wird entfernt.";
  switch (reach?.state) {
    case "disconnected":
      return kind === "volume"
        ? "Die Dateien sind hier zu sehen, sobald das Laufwerk angeschlossen ist."
        : kind === "smb"
          ? "Die Dateien sind hier zu sehen, sobald die Freigabe verbunden ist."
          : "Die Dateien sind hier zu sehen, sobald der Ort wieder erreichbar ist.";
    case "missing":
      return "Den Ordner gibt es an dieser Stelle nicht mehr, darum lassen sich keine Dateien zeigen.";
    case "failed":
      return "Ohne Verbindung lassen sich die Dateien nicht zeigen.";
    case "untested":
      return "Die Dateien sind hier zu sehen, sobald die erste Prüfung gelungen ist.";
    default:
      return "Die Dateien sind hier zu sehen, sobald der Zustand des Orts bekannt ist.";
  }
}

/** What else goes when the location is removed. */
function removalExtra(location: Location): string {
  switch (location.kind.type) {
    case "ssh":
      return " Den Schlüssel, den clonq für diesen Server erzeugt hat, löscht clonq dabei.";
    case "smb":
      return " Das Passwort wird aus dem Schlüsselbund gelöscht.";
    case "cloud":
      return " Die Verbindung zum Anbieter wird aus clonq gelöscht.";
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
      return { text: `${kind.user}@${kind.host}, Port ${kind.port}`, mono: true };
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
  const kind = location.kind.type;
  const remote = kind === "ssh" || kind === "cloud";
  if (checking) {
    const sentence = connecting
      ? "clonq hängt die Freigabe mit dem Passwort aus dem Schlüsselbund ein."
      : kind === "ssh"
        ? "clonq meldet sich mit dem Schlüssel an."
        : kind === "cloud"
          ? "clonq fragt den Speicher an."
          : null;
    return { headline: connecting ? "Wird verbunden …" : "Wird geprüft …", tone: "accent", sentence, sentenceTone: "neutral" };
  }
  switch (reach?.state) {
    case "connected": {
      const headline = kind === "folder" ? "Vorhanden" : kind === "volume" ? "Angeschlossen" : "Verbunden";
      const sentence =
        kind === "ssh"
          ? "Die Anmeldung mit dem Schlüssel funktioniert. clonq prüft sie alle zehn Minuten."
          : kind === "cloud"
            ? "Der Speicher antwortet. clonq prüft ihn alle zehn Minuten."
            : kind === "smb" && reach.path
              ? `Eingehängt unter ${reach.path}.`
              : null;
      return { headline, tone: "ok", sentence, sentenceTone: "neutral" };
    }
    case "disconnected":
      if (kind === "volume") {
        return {
          headline: "Nicht angeschlossen",
          tone: "neutral",
          sentence: "Jobs mit diesem Ort warten, bis das Laufwerk wieder angeschlossen ist. clonq bemerkt das sofort.",
          sentenceTone: "neutral",
        };
      }
      if (kind === "smb") {
        return {
          headline: "Nicht verbunden",
          tone: "neutral",
          sentence: "Die Freigabe ist gerade nicht eingehängt. „Verbinden“ hängt sie mit dem Passwort aus dem Schlüsselbund ein.",
          sentenceTone: "neutral",
        };
      }
      return { headline: "Nicht erreichbar", tone: "neutral", sentence: "Jobs mit diesem Ort warten, bis er wieder erreichbar ist.", sentenceTone: "neutral" };
    case "missing":
      return {
        headline: "Ordner fehlt",
        tone: "danger",
        sentence: "An dieser Stelle gibt es den Ordner nicht mehr. Wurde er verschoben oder umbenannt, wähle ihn unten neu aus.",
        sentenceTone: "neutral",
      };
    case "untested":
      return {
        headline: "Noch nicht geprüft",
        tone: "neutral",
        sentence: remote ? "Die erste Prüfung nach dem Start von clonq läuft noch." : "Der Zustand ist noch nicht bekannt.",
        sentenceTone: "neutral",
      };
    case "failed":
      return { headline: "Keine Verbindung", tone: "danger", sentence: messageLabel(reach.message), sentenceTone: "danger" };
    default:
      return { headline: "Unbekannt", tone: "neutral", sentence: "Der Zustand ist noch nicht bekannt.", sentenceTone: "neutral" };
  }
}

/** Free space where the location reports it; for a folder that is the space of the whole internal SSD. */
function capacityOf(location: Location, reach: Reach | undefined): { share: number; text: string; caption: string } | null {
  if (reach?.state !== "connected" || reach.totalBytes === null || reach.freeBytes === null || reach.totalBytes <= 0) return null;
  const where = location.kind.type === "folder" ? "auf der eingebauten SSD" : location.kind.type === "volume" ? "auf dem Laufwerk" : "auf der Freigabe";
  const used = Math.max(0, reach.totalBytes - reach.freeBytes);
  return {
    share: used / reach.totalBytes,
    text: `${formatBytes(reach.freeBytes)} frei von ${formatBytes(reach.totalBytes)} ${where}`,
    caption: `Belegter Platz ${where}`,
  };
}

interface Fact {
  label: string;
  value: string;
  mono: boolean;
}

/** What the location is beyond the line under its name, like the type plate on a device. */
function factsOf(location: Location, volume: MountedVolume | undefined): Fact[] {
  const kind = location.kind;
  switch (kind.type) {
    case "folder":
      return [];
    case "volume":
      return [
        ...(volume ? [{ label: "Dateisystem", value: fileSystemLabel(volume.fileSystem), mono: false }] : []),
        ...(kind.volumeName !== location.name ? [{ label: "Name des Laufwerks", value: kind.volumeName, mono: false }] : []),
        { label: "Kennung", value: kind.volumeUuid, mono: true },
      ];
    case "ssh":
      return [
        { label: "Ordner auf dem Server", value: kind.basePath || "Anmeldeordner", mono: kind.basePath !== "" },
        { label: "Schlüsseldatei", value: tidyPath(kind.identityFile), mono: true },
      ];
    case "smb":
      return [
        { label: "Benutzer", value: kind.user, mono: true },
        { label: "Passwort", value: "im Schlüsselbund von macOS", mono: false },
      ];
    case "cloud":
      return kind.provider === "webdav"
        ? [
            { label: "Ordner", value: kind.root || "oberste Ebene", mono: kind.root !== "" },
            { label: "Zugang", value: "Benutzer und Passwort", mono: false },
          ]
        : [
            { label: kind.provider === "s3" || kind.provider === "b2" ? "Bucket und Ordner" : "Ordner", value: kind.root || "oberste Ebene", mono: kind.root !== "" },
            { label: "Zugang", value: kind.provider === "s3" || kind.provider === "b2" ? "mit Zugangsschlüssel" : "Anmeldung im Browser", mono: false },
          ];
  }
}
