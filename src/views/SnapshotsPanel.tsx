import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArchiveRestore, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { refreshLocations } from "../hooks/useClonq";
import { texts, useT } from "../i18n";
import { api } from "../lib/api";
import { formatBytes, formatRelative, formatStamp } from "../lib/format";
import { navigate } from "../lib/nav";
import type { BrowseEntry, Job, Location, LocationStatus, Reach } from "../lib/types";
import { UiBadge, UiButton, UiNotice, UiText } from "../ui";
import { UiItemList, type UiItemListItem } from "../ui/UiItemList";
import { UiLinkButton } from "../ui/UiLinkButton";
import { UiStatusLine } from "../ui/UiStatusLine";
import { UiWell } from "../ui/UiWell";
import { localPath } from "./jobs/draft";
import { errorText } from "./locations/kinds";
import { capitalize, failureOf, fileIcon, joinPath, snapshotDate, tidyHome, type Failure } from "./files";

interface SnapshotsPanelProps {
  job: Job;
  /** Changes whenever a run ends, so the list reloads. */
  revision: string;
  /** The job's target, where the snapshots live. */
  target: Location | undefined;
  status: LocationStatus | undefined;
  now: number;
}

type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; failure: Failure };

type Restore = { state: "idle" } | { state: "busy"; name: string | null } | { state: "done"; folder: string } | { state: "failed"; failure: Failure };

type Probe = { state: "idle" } | { state: "busy" } | { state: "done"; reach: Reach };

/**
 * The dated snapshots of a versioned job, newest first, and a way to get one back. Restoring
 * copies the whole snapshot into a new folder in Downloads and never touches the target. On a
 * target on this Mac the snapshot folder can also be opened in the Finder.
 */
export function SnapshotsPanel({ job, revision, target, status, now }: SnapshotsPanelProps) {
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [list, setList] = useState<Load<string[]>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<Load<BrowseEntry[]>>({ state: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const [restore, setRestore] = useState<Restore>({ state: "idle" });
  const t = useT();
  const s = t.detail.snapshots;
  const reach = status?.reach;

  // A check run from here counts until the app reports the location anew.
  useEffect(() => setProbe({ state: "idle" }), [reach?.state]);
  const known = probe.state === "done" ? probe.reach : reach;
  // Servers are only tested every ten minutes; until the first test they may be unreachable.
  const unknown = !known || (known.state === "untested" && target?.kind.type === "ssh");
  const unreachable = known?.state === "disconnected" || known?.state === "missing" || known?.state === "failed";
  const readable = target !== undefined && !unknown && !unreachable;

  useEffect(() => {
    if (!readable) return;
    let current = true;
    // A reload after a run keeps the old list on screen until the new one is there.
    setList((before) => (before.state === "ready" ? before : { state: "loading" }));
    api
      .versionSnapshots(job.id)
      .then((stamps) => {
        if (!current) return;
        setList({ state: "ready", value: stamps });
        setOpen((before) => (before && stamps.includes(before) ? before : (stamps[0] ?? null)));
      })
      .catch((reason) => current && setList({ state: "failed", failure: failureOf(texts().detail.snapshots.readFailed, reason) }));
    return () => {
      current = false;
    };
  }, [job.id, revision, readable, attempt]);

  // The top level of the chosen snapshot, read like any folder of the target.
  useEffect(() => {
    setPicked(null);
    // A restore that is still running keeps its line; when it is done, the line names where it landed.
    setRestore((before) => (before.state === "busy" ? before : { state: "idle" }));
    if (!open) return;
    let current = true;
    setEntries({ state: "loading" });
    api
      .browseList(job.target.location, joinPath(job.target.path.replace(/^\/+|\/+$/g, ""), open))
      .then((value) => current && setEntries({ state: "ready", value: sortEntries(value) }))
      .catch((reason) => current && setEntries({ state: "failed", failure: failureOf(texts().detail.snapshots.contentsFailed, reason) }));
    return () => {
      current = false;
    };
  }, [job.target.location, job.target.path, open]);

  const runProbe = async () => {
    if (!target || probe.state === "busy") return;
    setProbe({ state: "busy" });
    let fresh: Reach;
    try {
      fresh = (await api.testLocation(target.id)).reach;
    } catch (problem) {
      fresh = { state: "failed", message: errorText(problem) };
    }
    setProbe({ state: "done", reach: fresh });
    await refreshLocations();
  };

  /** The whole snapshot, or one item of its top level. */
  const runRestore = (name: string | null) => {
    if (!open || restore.state === "busy") return;
    setRestore({ state: "busy", name });
    api
      .restoreArchive(job.id, open, name ?? undefined, "snapshots")
      .then((folder) => {
        setRestore({ state: "done", folder });
        void revealItemInDir(folder).catch(() => undefined);
      })
      .catch((reason) => setRestore({ state: "failed", failure: failureOf(texts().detail.snapshots.restoreFailed, reason, false) }));
  };

  if (!target) return <UiText tone="neutral">{s.targetGone}</UiText>;

  if (unknown) {
    return (
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1">
          <UiText tone="neutral">{s.unknown(target.name)}</UiText>
        </span>
        <UiButton icon={probe.state === "busy" ? undefined : RefreshCw} disabled={probe.state === "busy"} onPress={() => void runProbe()}>
          {probe.state === "busy" ? t.detail.archive.checking : t.detail.archive.checkConnection}
        </UiButton>
      </div>
    );
  }

  if (unreachable) {
    return (
      <p>
        <UiText tone="neutral">{unreachableSentence(target, known)}</UiText>{" "}
        <UiLinkButton onPress={() => navigate({ kind: "location", locationId: target.id })}>{t.detail.archive.viewLocation(target.name)}</UiLinkButton>
      </p>
    );
  }

  if (list.state === "loading") return <UiStatusLine state="busy">{s.loading}</UiStatusLine>;

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

  const stamps = list.value;
  if (stamps.length === 0) return <UiText tone="neutral">{s.empty}</UiText>;

  const items: UiItemListItem[] = stamps.map((stamp, index) => {
    const at = snapshotDate(stamp);
    return {
      id: stamp,
      title: formatStamp(stamp),
      detail: at ? formatRelative(at.toISOString(), now) : undefined,
      meta: index === 0 ? <UiBadge tone="accent">{s.newest}</UiBadge> : undefined,
    };
  });

  // Only a folder or a drive on this Mac (or a mounted share) can show the snapshot in the Finder.
  const base =
    localPath(job.target, target, status) ??
    (target.kind.type === "smb" && reach?.state === "connected" && reach.path ? joinLocal(reach.path, job.target.path) : null);
  const folder = base && open ? joinLocal(base, open) : null;
  const openAt = open ? snapshotDate(open) : null;
  const shown = entries.state === "ready" ? entries.value : [];
  const entryItems: UiItemListItem[] = shown.map((entry) => {
    const Icon = fileIcon(entry.name, entry.dir);
    return {
      id: entry.name,
      leading: <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />,
      title: entry.name,
      meta: entry.dir ? undefined : formatBytes(entry.size),
      dimmed: entry.name.startsWith("."),
    };
  });
  const busy = restore.state === "busy";

  return (
    <div className="flex flex-col gap-2.5">
      <UiText variant="caption" tone="neutral">
        {s.rule} {s.whole}
      </UiText>

      <div className="grid grid-cols-[16rem_minmax(0,1fr)] gap-3">
        <UiWell size="md" label={s.list}>
          <UiItemList label={s.list} items={items} selected={open} onSelect={(stamp) => stamp && setOpen(stamp)} deselectable={false} />
        </UiWell>

        <UiWell
          size="md"
          label={s.contents}
          header={
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <UiText variant="label" truncate>
                  {open ? formatStamp(open) : ""}
                </UiText>
                <UiText variant="caption" tone="neutral" truncate>
                  {openAt ? `${capitalize(formatRelative(openAt.toISOString(), now))} · ` : ""}
                  <span className="font-mono">{open ?? ""}</span>
                </UiText>
              </div>
              {folder ? <UiLinkButton onPress={() => void revealItemInDir(folder).catch(() => undefined)}>{t.detail.showInFinder}</UiLinkButton> : null}
            </>
          }
          footer={
            <>
              <span className="min-w-0 flex-1" />
              {picked ? (
                <UiButton icon={ArchiveRestore} disabled={busy} onPress={() => runRestore(picked)}>
                  {s.restoreItem}
                </UiButton>
              ) : null}
              <UiButton variant={picked ? "ghost" : "secondary"} icon={picked ? undefined : ArchiveRestore} disabled={busy || !open} onPress={() => runRestore(null)}>
                {s.restore}
              </UiButton>
            </>
          }
        >
          {entries.state === "loading" ? (
            <span className="px-2.5 py-2">
              <UiStatusLine state="busy">{t.detail.reading}</UiStatusLine>
            </span>
          ) : entries.state === "failed" ? (
            <div className="p-1.5">
              <UiNotice tone="danger">
                <span title={entries.failure.detail ?? undefined}>{entries.failure.text}</span>
              </UiNotice>
            </div>
          ) : (
            <UiItemList
              label={s.contents}
              items={entryItems}
              selected={picked}
              onSelect={setPicked}
              empty={
                <span className="px-2.5 py-2">
                  <UiText variant="caption" tone="neutral">
                    {s.noContents}
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

/** Folders first, then files, each by name as the Finder sorts them. */
function sortEntries(entries: BrowseEntry[]): BrowseEntry[] {
  return [...entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

/** "/Volumes/Photos Drive" and "Backups/Photos" as one path. */
function joinLocal(base: string, path: string): string {
  const tail = path.replace(/^\/+|\/+$/g, "");
  return tail ? `${base.replace(/\/+$/, "")}/${tail}` : base;
}

/** Under the lists: where a restored snapshot goes, and what the last restore did. */
function RestoreStatus({ restore }: { restore: Restore }) {
  const t = useT().detail;
  switch (restore.state) {
    case "busy":
      return <UiStatusLine state="busy">{restore.name ? t.archive.restoring(t.quote(restore.name)) : t.snapshots.restoring}</UiStatusLine>;
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
          {t.snapshots.whereTo}
        </UiText>
      );
  }
}

/** Why the snapshots cannot be looked at right now, in one sentence. */
function unreachableSentence(target: Location, reach: Reach | undefined): string {
  const t = texts().detail.snapshots.unreachable;
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
