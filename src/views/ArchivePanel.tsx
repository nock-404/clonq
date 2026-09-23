import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArchiveRestore, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { refreshLocations } from "../hooks/useClonq";
import { api } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import { navigate } from "../lib/nav";
import type { ArchivedFile, Job, Location, Reach, Snapshot } from "../lib/types";
import { UiButton, UiInput, UiNotice, UiText } from "../ui";
import { UiItemList, type UiItemListItem } from "../ui/UiItemList";
import { UiLinkButton } from "../ui/UiLinkButton";
import { UiStatusLine } from "../ui/UiStatusLine";
import { UiWell } from "../ui/UiWell";
import { ARCHIVE_FOLDER } from "./jobs/draft";
import { recordOwnCheck } from "./locations/checks";
import { errorText } from "./locations/kinds";
import { capitalize, failureOf, fileIcon, filesWord, momentWords, splitPath, stampDate, tidyHome, type Failure } from "./files";

const DAY = 86_400_000;
/** From this many files on, the files of one run get a search field. */
const SEARCH_FROM = 10;

interface ArchivePanelProps {
  job: Job;
  /** Changes whenever a run ends, so the list reloads. */
  revision: string;
  /** The job's target, where the archive lives. */
  target: Location | undefined;
  reach: Reach | undefined;
  now: number;
}

type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; failure: Failure };

type Restore = { state: "idle" } | { state: "busy"; name: string | null } | { state: "done"; folder: string } | { state: "failed"; failure: Failure };

type Probe = { state: "idle" } | { state: "busy" } | { state: "done"; reach: Reach };

const connected: Reach = { state: "connected", path: null, freeBytes: null, totalBytes: null };

/**
 * Earlier versions a job moved aside, one group per run, and a way to get them back. Restoring
 * copies into a new folder in Downloads and never overwrites anything. Renders nothing while the
 * archive is off and holds nothing.
 */
export function ArchivePanel({ job, revision, target, reach, now }: ArchivePanelProps) {
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [list, setList] = useState<Load<Snapshot[]>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<Load<ArchivedFile[]>>({ state: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [restore, setRestore] = useState<Restore>({ state: "idle" });
  const fileList = useRef<HTMLDivElement>(null);

  // A check run from here counts until the app reports the location anew.
  useEffect(() => setProbe({ state: "idle" }), [reach?.state]);
  const known = probe.state === "done" ? probe.reach : reach;
  // Servers and clouds are only tested every ten minutes. Until the first test they may be
  // unreachable, and the backend reads an unreachable archive as an empty one.
  const remote = target?.kind.type === "ssh" || target?.kind.type === "cloud";
  const unknown = !known || (known.state === "untested" && remote);
  const unreachable = known?.state === "disconnected" || known?.state === "missing" || known?.state === "failed";
  const readable = target !== undefined && !unknown && !unreachable;

  useEffect(() => {
    if (!readable) return;
    let current = true;
    // A reload after a run keeps the old list on screen until the new one is there.
    setList((before) => (before.state === "ready" ? before : { state: "loading" }));
    api
      .archiveSnapshots(job.id)
      .then((snapshots) => {
        if (!current) return;
        setList({ state: "ready", value: snapshots });
        setOpen((before) => (before && snapshots.some((item) => item.stamp === before) ? before : (snapshots[0]?.stamp ?? null)));
      })
      .catch((reason) => current && setList({ state: "failed", failure: failureOf("Das Archiv ließ sich nicht lesen", reason) }));
    return () => {
      current = false;
    };
  }, [job.id, revision, readable, attempt]);

  useEffect(() => {
    setPicked(null);
    setQuery("");
    // A restore that is still running keeps its line; when it is done, the line names where it landed.
    setRestore((before) => (before.state === "busy" ? before : { state: "idle" }));
    if (!open) return;
    let current = true;
    setFiles({ state: "loading" });
    api
      .archiveFiles(job.id, open)
      .then((value) => current && setFiles({ state: "ready", value }))
      .catch((reason) => current && setFiles({ state: "failed", failure: failureOf("Die Dateien dieses Laufs ließen sich nicht lesen", reason) }));
    return () => {
      current = false;
    };
  }, [job.id, open]);

  const runProbe = async () => {
    if (!target || probe.state === "busy") return;
    setProbe({ state: "busy" });
    let fresh: Reach;
    if (target.kind.type === "cloud") {
      // For a cloud, test_location only repeats the last background round; listing its top level is a real test.
      try {
        await api.listFolders(target.id, "");
        fresh = connected;
      } catch (problem) {
        fresh = { state: "failed", message: errorText(problem) };
      }
      recordOwnCheck(target.id, fresh);
    } else {
      try {
        fresh = (await api.testLocation(target.id)).reach;
      } catch (problem) {
        fresh = { state: "failed", message: errorText(problem) };
      }
    }
    setProbe({ state: "done", reach: fresh });
    await refreshLocations();
  };

  const runRestore = (path: string | null) => {
    if (!open || restore.state === "busy") return;
    setRestore({ state: "busy", name: path ? splitPath(path)[1] : null });
    api
      .restoreArchive(job.id, open, path ?? undefined)
      .then((folder) => {
        setRestore({ state: "done", folder });
        void revealItemInDir(folder).catch(() => undefined);
      })
      .catch((reason) => setRestore({ state: "failed", failure: failureOf("Das Wiederherstellen ist fehlgeschlagen", reason, false) }));
  };

  if (!target) {
    return job.archive.enabled ? <UiText tone="neutral">Das Ziel dieses Jobs ist nicht mehr eingerichtet, darum lässt sich das Archiv nicht lesen.</UiText> : null;
  }

  if (unknown) {
    if (!job.archive.enabled) return null;
    return (
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1">
          <UiText tone="neutral">Ob {target.name} erreichbar ist, steht noch nicht fest. Das Archiv erscheint hier, sobald die Verbindung geprüft ist.</UiText>
        </span>
        <UiButton icon={probe.state === "busy" ? undefined : RefreshCw} disabled={probe.state === "busy"} onPress={() => void runProbe()}>
          {probe.state === "busy" ? "Wird geprüft …" : "Verbindung prüfen"}
        </UiButton>
      </div>
    );
  }

  if (unreachable) {
    if (!job.archive.enabled) return null;
    return (
      <p>
        <UiText tone="neutral">{unreachableSentence(target, known)}</UiText>{" "}
        <UiLinkButton onPress={() => navigate({ kind: "location", locationId: target.id })}>{target.name} ansehen</UiLinkButton>
      </p>
    );
  }

  const snapshots = list.state === "ready" ? list.value : [];
  if (!job.archive.enabled && snapshots.length === 0) return null;

  if (list.state === "loading") return <UiStatusLine state="busy">Das Archiv wird gelesen …</UiStatusLine>;

  if (list.state === "failed") {
    return (
      <UiNotice
        tone="danger"
        actions={
          <UiButton variant="ghost" icon={RotateCw} onPress={() => setAttempt((count) => count + 1)}>
            Erneut versuchen
          </UiButton>
        }
      >
        {/* The backend's English words stay in the tooltip until labels.ts translates them. */}
        <span title={list.failure.detail ?? undefined}>{list.failure.text}</span>
      </UiNotice>
    );
  }

  const twoWayNote =
    job.mode === "bidirectional" ? (
      <UiText variant="caption" tone="neutral">
        Die Liste zeigt nur das Archiv im Ziel. Was in der Quelle aufbewahrt wird, liegt dort im Ordner {ARCHIVE_FOLDER}.
      </UiText>
    ) : null;

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <UiText tone="neutral">Bisher ist nichts aufbewahrt. Sobald ein Lauf im Ziel etwas löscht oder überschreibt, erscheint die vorige Fassung hier.</UiText>
        {twoWayNote}
      </div>
    );
  }

  const keepMs = job.archive.keepDays * DAY;
  const snapshotItems: UiItemListItem[] = snapshots.map((snapshot) => {
    const at = stampDate(snapshot.stamp);
    const left = at ? at.getTime() + keepMs - now : keepMs;
    const days = Math.ceil(left / DAY);
    return {
      id: snapshot.stamp,
      title: at ? capitalize(momentWords(at, now)) : snapshot.stamp,
      detail: (
        <>
          {capitalize(filesWord(snapshot.files, formatCount))}, {formatBytes(snapshot.bytes)}
          {job.archive.enabled ? (
            <span className={days <= 2 ? "text-warn" : undefined}> · {days <= 0 ? "abgelaufen" : days === 1 ? "noch ein Tag" : `noch ${formatCount(days)} Tage`}</span>
          ) : null}
        </>
      ),
      hint: job.archive.enabled && days <= 0 ? "Die Frist ist abgelaufen. Der nächste Lauf räumt diesen Stand auf." : undefined,
    };
  });

  const openSnapshot = snapshots.find((item) => item.stamp === open);
  const openAt = openSnapshot ? stampDate(openSnapshot.stamp) : null;
  const all = files.state === "ready" ? files.value : [];
  const needle = query.trim().toLowerCase();
  const shown = needle ? all.filter((file) => file.path.toLowerCase().includes(needle)) : all;
  const fileItems: UiItemListItem[] = shown.map((file) => {
    const [folder, name] = splitPath(file.path);
    const Icon = fileIcon(name);
    return {
      id: file.path,
      leading: <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />,
      title: name,
      detail: folder ? <span className="font-mono">{folder}</span> : "Oberste Ebene",
      meta: formatBytes(file.size),
    };
  });
  const pickedFile = all.find((file) => file.path === picked);
  const busy = restore.state === "busy";

  // ↓ in the search field moves into the results, Escape empties the field.
  const searchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && fileItems.length > 0) {
      event.preventDefault();
      setPicked(fileItems[0]?.id ?? null);
      fileList.current?.focus();
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      {!job.archive.enabled ? (
        <UiText variant="caption" tone="neutral">
          Diese Fassungen stammen aus der Zeit, als das Archiv eingeschaltet war. Solange es aus ist, räumt clonq sie nicht auf.
        </UiText>
      ) : null}
      {twoWayNote}

      <div className="grid grid-cols-[16rem_minmax(0,1fr)] gap-3">
        <UiWell size="md" label="Aufbewahrt, nach Lauf">
          <UiItemList label="Aufbewahrt, nach Lauf" items={snapshotItems} selected={open} onSelect={(stamp) => stamp && setOpen(stamp)} deselectable={false} />
        </UiWell>

        <UiWell
          size="md"
          label="Aufbewahrte Dateien"
          header={
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <UiText variant="label" truncate>
                  {openAt ? `Vor dem Lauf von ${momentWords(openAt, now)}` : (open ?? "")}
                </UiText>
                <UiText variant="caption" tone="neutral" truncate>
                  {openSnapshot ? `${capitalize(filesWord(openSnapshot.files, formatCount))} (${formatBytes(openSnapshot.bytes)}), ersetzt oder gelöscht` : ""}
                </UiText>
              </div>
              {all.length >= SEARCH_FROM ? (
                <span className="w-40 shrink-0">
                  <UiInput value={query} onChange={setQuery} placeholder="Datei suchen …" onKeyDown={searchKeys} />
                </span>
              ) : null}
            </>
          }
          footer={
            <>
              <span className="min-w-0 flex-1">
                {needle && files.state === "ready" ? (
                  <UiText variant="caption" tone="neutral" truncate>
                    {formatCount(shown.length)} von {formatCount(all.length)} Dateien
                  </UiText>
                ) : null}
              </span>
              {pickedFile ? (
                <UiButton icon={ArchiveRestore} disabled={busy} onPress={() => runRestore(pickedFile.path)}>
                  Datei wiederherstellen
                </UiButton>
              ) : null}
              <UiButton
                variant={pickedFile ? "ghost" : "secondary"}
                icon={pickedFile ? undefined : ArchiveRestore}
                disabled={busy || all.length === 0}
                title={needle ? `Alle ${formatCount(all.length)} Dateien dieses Laufs, nicht nur die gefundenen` : undefined}
                onPress={() => runRestore(null)}
              >
                {needle ? "Ganzen Lauf wiederherstellen" : all.length === 1 ? "Wiederherstellen" : `Alle ${formatCount(all.length)} wiederherstellen`}
              </UiButton>
            </>
          }
        >
          {files.state === "loading" ? (
            <span className="px-2.5 py-2">
              <UiStatusLine state="busy">Wird gelesen …</UiStatusLine>
            </span>
          ) : files.state === "failed" ? (
            <div className="p-1.5">
              <UiNotice tone="danger">
                <span title={files.failure.detail ?? undefined}>{files.failure.text}</span>
              </UiNotice>
            </div>
          ) : (
            <UiItemList
              ref={fileList}
              label="Aufbewahrte Dateien"
              items={fileItems}
              selected={picked}
              onSelect={setPicked}
              empty={
                <span className="px-2.5 py-2">
                  <UiText variant="caption" tone="neutral">
                    {needle ? "Keine Datei passt zur Suche." : "Zu diesem Lauf liegen keine Dateien mehr im Archiv."}
                  </UiText>
                </span>
              }
            />
          )}
        </UiWell>
      </div>

      <RestoreStatus restore={restore} />
    </div>
  );
}

/** Under the lists: where restored files go, and what the last restore did. */
function RestoreStatus({ restore }: { restore: Restore }) {
  switch (restore.state) {
    case "busy":
      return <UiStatusLine state="busy">{restore.name ? `„${restore.name}“ wird wiederhergestellt …` : "Der ganze Lauf wird wiederhergestellt …"}</UiStatusLine>;
    case "done":
      return (
        <UiStatusLine
          state="done"
          title={tidyHome(restore.folder)}
          action={<UiLinkButton onPress={() => void revealItemInDir(restore.folder).catch(() => undefined)}>Im Finder zeigen</UiLinkButton>}
        >
          Wiederhergestellt in {tidyHome(restore.folder)}
        </UiStatusLine>
      );
    case "failed":
      return (
        <UiStatusLine state="failed" title={restore.failure.detail ?? restore.failure.text}>
          {restore.failure.text}
        </UiStatusLine>
      );
    default:
      return (
        <UiText variant="caption" tone="neutral">
          Wiederhergestellte Dateien werden in einem neuen Ordner unter Downloads/clonq-wiederhergestellt abgelegt; vorhandene Dateien bleiben unberührt.
        </UiText>
      );
  }
}

/** Why the archive cannot be looked at right now, in one sentence. */
function unreachableSentence(target: Location, reach: Reach | undefined): string {
  switch (reach?.state) {
    case "missing":
      return `Das Archiv liegt im Zielordner auf ${target.name}, doch dieser Ordner fehlt zurzeit.`;
    case "failed":
      return `Das Archiv liegt auf ${target.name}, und dorthin besteht zurzeit keine Verbindung.`;
    default:
      switch (target.kind.type) {
        case "volume":
          return `Das Archiv liegt auf ${target.name}. Sobald das Laufwerk angeschlossen ist, lässt es sich hier durchsehen.`;
        case "smb":
          return `Das Archiv liegt auf ${target.name}. Sobald die Freigabe verbunden ist, lässt es sich hier durchsehen.`;
        default:
          return `Das Archiv liegt auf ${target.name}. Sobald der Ort erreichbar ist, lässt es sich hier durchsehen.`;
      }
  }
}
