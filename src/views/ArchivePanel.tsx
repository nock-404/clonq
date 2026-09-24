import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArchiveRestore, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { refreshLocations } from "../hooks/useClonq";
import { texts, useT } from "../i18n";
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
  const t = useT();
  const a = t.detail.archive;

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
      .catch((reason) => current && setList({ state: "failed", failure: failureOf(texts().detail.archive.readFailed, reason) }));
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
      .catch((reason) => current && setFiles({ state: "failed", failure: failureOf(texts().detail.archive.filesFailed, reason) }));
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
      .catch((reason) => setRestore({ state: "failed", failure: failureOf(texts().detail.archive.restoreFailed, reason, false) }));
  };

  if (!target) {
    return job.archive.enabled ? <UiText tone="neutral">{a.targetGone}</UiText> : null;
  }

  if (unknown) {
    if (!job.archive.enabled) return null;
    return (
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1">
          <UiText tone="neutral">{a.unknown(target.name)}</UiText>
        </span>
        <UiButton icon={probe.state === "busy" ? undefined : RefreshCw} disabled={probe.state === "busy"} onPress={() => void runProbe()}>
          {probe.state === "busy" ? a.checking : a.checkConnection}
        </UiButton>
      </div>
    );
  }

  if (unreachable) {
    if (!job.archive.enabled) return null;
    return (
      <p>
        <UiText tone="neutral">{unreachableSentence(target, known)}</UiText>{" "}
        <UiLinkButton onPress={() => navigate({ kind: "location", locationId: target.id })}>{a.viewLocation(target.name)}</UiLinkButton>
      </p>
    );
  }

  const snapshots = list.state === "ready" ? list.value : [];
  if (!job.archive.enabled && snapshots.length === 0) return null;

  if (list.state === "loading") return <UiStatusLine state="busy">{a.loading}</UiStatusLine>;

  if (list.state === "failed") {
    return (
      <UiNotice
        tone="danger"
        actions={
          <UiButton variant="ghost" icon={RotateCw} onPress={() => setAttempt((count) => count + 1)}>
            {t.detail.retry}
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
        {a.twoWayNote(ARCHIVE_FOLDER)}
      </UiText>
    ) : null;

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <UiText tone="neutral">{a.empty}</UiText>
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
            <span className={days <= 2 ? "text-warn" : undefined}> · {a.daysLeft(days, formatCount(days))}</span>
          ) : null}
        </>
      ),
      hint: job.archive.enabled && days <= 0 ? a.expiredHint : undefined,
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
      detail: folder ? <span className="font-mono">{folder}</span> : a.topLevel,
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
          {a.fromBefore}
        </UiText>
      ) : null}
      {twoWayNote}

      <div className="grid grid-cols-[16rem_minmax(0,1fr)] gap-3">
        <UiWell size="md" label={a.byRun}>
          <UiItemList label={a.byRun} items={snapshotItems} selected={open} onSelect={(stamp) => stamp && setOpen(stamp)} deselectable={false} />
        </UiWell>

        <UiWell
          size="md"
          label={a.keptFiles}
          header={
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <UiText variant="label" truncate>
                  {openAt ? a.beforeRun(momentWords(openAt, now)) : (open ?? "")}
                </UiText>
                <UiText variant="caption" tone="neutral" truncate>
                  {openSnapshot ? a.replaced(capitalize(filesWord(openSnapshot.files, formatCount)), formatBytes(openSnapshot.bytes)) : ""}
                </UiText>
              </div>
              {all.length >= SEARCH_FROM ? (
                <span className="w-40 shrink-0">
                  <UiInput value={query} onChange={setQuery} placeholder={a.search} onKeyDown={searchKeys} />
                </span>
              ) : null}
            </>
          }
          footer={
            <>
              <span className="min-w-0 flex-1">
                {needle && files.state === "ready" ? (
                  <UiText variant="caption" tone="neutral" truncate>
                    {a.matches(formatCount(shown.length), formatCount(all.length))}
                  </UiText>
                ) : null}
              </span>
              {pickedFile ? (
                <UiButton icon={ArchiveRestore} disabled={busy} onPress={() => runRestore(pickedFile.path)}>
                  {a.restoreFile}
                </UiButton>
              ) : null}
              <UiButton
                variant={pickedFile ? "ghost" : "secondary"}
                icon={pickedFile ? undefined : ArchiveRestore}
                disabled={busy || all.length === 0}
                title={needle ? a.restoreRunTitle(formatCount(all.length)) : undefined}
                onPress={() => runRestore(null)}
              >
                {needle ? a.restoreRun : all.length === 1 ? a.restore : a.restoreAll(formatCount(all.length))}
              </UiButton>
            </>
          }
        >
          {files.state === "loading" ? (
            <span className="px-2.5 py-2">
              <UiStatusLine state="busy">{t.detail.reading}</UiStatusLine>
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
              label={a.keptFiles}
              items={fileItems}
              selected={picked}
              onSelect={setPicked}
              empty={
                <span className="px-2.5 py-2">
                  <UiText variant="caption" tone="neutral">
                    {needle ? a.noMatch : a.noFiles}
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
  const t = useT().detail;
  switch (restore.state) {
    case "busy":
      return <UiStatusLine state="busy">{restore.name ? t.archive.restoring(t.quote(restore.name)) : t.archive.restoringRun}</UiStatusLine>;
    case "done":
      return (
        <UiStatusLine
          state="done"
          title={tidyHome(restore.folder)}
          action={<UiLinkButton onPress={() => void revealItemInDir(restore.folder).catch(() => undefined)}>{t.showInFinder}</UiLinkButton>}
        >
          {t.archive.restoredTo(tidyHome(restore.folder))}
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
          {t.archive.whereTo}
        </UiText>
      );
  }
}

/** Why the archive cannot be looked at right now, in one sentence. */
function unreachableSentence(target: Location, reach: Reach | undefined): string {
  const t = texts().detail.archive.unreachable;
  switch (reach?.state) {
    case "missing":
      return t.missing(target.name);
    case "failed":
      return t.failed(target.name);
    default:
      switch (target.kind.type) {
        case "volume":
          return t.volume(target.name);
        case "smb":
          return t.smb(target.name);
        default:
          return t.other(target.name);
      }
  }
}
