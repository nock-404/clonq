import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowUp, ChevronRight, Download, Eye, EyeOff, History, Pencil, RotateCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { texts, useT } from "../i18n";
import { api } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import type { BrowseEntry, FilePreview, Location } from "../lib/types";
import { UiBadge, UiButton, UiIconButton, UiInput, UiNotice, UiText } from "../ui";
import { UiBreadcrumb } from "../ui/UiBreadcrumb";
import { UiConfirmBar } from "../ui/UiConfirmBar";
import { UiItemList, type UiItemListItem } from "../ui/UiItemList";
import { UiLinkButton } from "../ui/UiLinkButton";
import { UiLocationGlyph } from "../ui/UiLocationGlyph";
import { UiStatusLine } from "../ui/UiStatusLine";
import { UiWell } from "../ui/UiWell";
import { glyphOf, providerLabel } from "./locations/kinds";
import { failureOf, fileIcon, fixedMoment, joinPath, momentWords, snapshotDate, tidyHome, type Failure } from "./files";

interface FileBrowserProps {
  location: Location;
  now: number;
  /** False while the location's last check failed; the glyph in the crumbs then goes dark. */
  connected?: boolean;
}

/** The folder whose rows are on screen. While the next folder loads, these rows stay, dimmed. */
interface Listing {
  path: string;
  entries: BrowseEntry[] | null;
  state: "loading" | "ready" | "failed";
  failure: Failure | null;
}

type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; failure: Failure };

/** What the last action on a file did, shown in the bar under the list. */
type Outcome = { state: "busy"; text: string } | { state: "done"; text: string; reveal?: string } | { state: "failed"; failure: Failure } | null;

interface Renaming {
  name: string;
  value: string;
  error: string | null;
  busy: boolean;
}

/** Where a Hetzner Storage Box keeps its read-only snapshots once the snapshot directory is shown. */
const SNAPSHOT_ROOT = ".zfs/snapshot";

/** A snapshot folder by the moment it was taken, where its name says so. */
function snapshotLabel(name: string): string {
  const at = snapshotDate(name);
  return at ? fixedMoment(at) : name;
}

/**
 * Everything inside a location: open folders, look at a file, copy it to Downloads, rename it or
 * delete it. On the Mac, deleting moves to the Trash; elsewhere it depends on the place, and the
 * question before it says what happens. A Storage Box also shows its snapshots, read-only.
 * ↑↓ select, ↵ opens, ← goes up, space shows a file, ⌘⌫ deletes.
 */
export function FileBrowser({ location, now, connected = true }: FileBrowserProps) {
  const kind = location.kind;
  // Folders, drives and shares are paths on this Mac, whose file system ignores case.
  const onMac = kind.type === "folder" || kind.type === "volume" || kind.type === "smb";
  const storageBox = kind.type === "ssh" && /\.your-storagebox\.de$/i.test(kind.host);
  // The snapshot folder sits at the top of the box; a location further down cannot reach it.
  const boxTop = kind.type === "ssh" && storageBox && ["", ".", "/home"].includes(kind.basePath.replace(/\/+$/, ""));

  const [path, setPath] = useState("");
  const [listing, setListing] = useState<Listing>({ path: "", entries: null, state: "loading", failure: null });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [preview, setPreview] = useState<{ entry: BrowseEntry; path: string; load: Load<FilePreview> } | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [deleting, setDeleting] = useState<BrowseEntry | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [snapshots, setSnapshots] = useState<number | "none" | null>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const t = useT();
  const b = t.detail.browser;
  const q = t.detail.quote;
  // Where the view is headed; an answer that arrives later only touches the list if it is still there.
  const here = useRef(path);

  useEffect(() => {
    let alive = true;
    setListing((before) => ({ ...before, state: "loading" }));
    api
      .browseList(location.id, path)
      .then((entries) => {
        if (!alive) return;
        setListing({ path, entries, state: "ready", failure: null });
        // Coming back up selects the folder just left; a reload keeps the selection if the row is still there.
        setSelected((current) => {
          const wanted = cameFrom ?? current;
          return wanted !== null && entries.some((entry) => entry.name === wanted) ? wanted : null;
        });
        setCameFrom(null);
      })
      .catch((reason) => alive && setListing({ path, entries: null, state: "failed", failure: failureOf(texts().detail.browser.readFailed, reason) }));
    return () => {
      alive = false;
    };
  }, [location.id, path, reload]);

  // A Storage Box may show its snapshots in a hidden folder; look once whether they can be reached.
  useEffect(() => {
    if (!boxTop) return;
    let alive = true;
    api
      .browseList(location.id, SNAPSHOT_ROOT)
      .then((entries) => alive && setSnapshots(entries.filter((entry) => entry.dir).length))
      .catch(() => alive && setSnapshots("none"));
    return () => {
      alive = false;
    };
  }, [location.id, boxTop]);

  const focusList = () => listbox.current?.focus({ preventScroll: true });

  // When the delete question closes, it hands the focus back to whatever had it before, which may
  // be nothing or a button that is gone by then. Afterwards the keyboard returns to the list, so
  // ↵ keeps working here instead of reaching the location view.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (deleting !== null || !returnFocus.current) return;
    returnFocus.current = false;
    focusList();
  }, [deleting]);

  const go = (target: string, from: string | null = null) => {
    here.current = target;
    setCameFrom(from);
    setSelected(null);
    setPreview(null);
    setRenaming(null);
    setDeleting(null);
    // A copy or deletion still under way keeps its line: it names its file, wherever the view stands.
    setOutcome((before) => (before?.state === "busy" ? before : null));
    setPath(target);
  };

  // Everything below acts on the folder on screen, which is the one just left while the next one loads.
  const folder = listing.path;
  const parts = folder ? folder.split("/") : [];
  const settled = listing.state === "ready";
  const entries = listing.entries ?? [];
  const snapshotCount = typeof snapshots === "number" && snapshots > 0 ? snapshots : null;
  const inSnapshots = folder === SNAPSHOT_ROOT || folder.startsWith(`${SNAPSHOT_ROOT}/`);
  const atSnapshotList = folder === SNAPSHOT_ROOT;
  // Nothing under .zfs can be changed; the server refuses, so the buttons are not offered.
  const readOnly = folder === ".zfs" || folder.startsWith(".zfs/");
  const hiddenCount = entries.filter((entry) => entry.name.startsWith(".")).length;
  const visible = entries.filter((entry) => showHidden || !entry.name.startsWith("."));
  const chosen = visible.find((entry) => entry.name === selected) ?? null;
  const working = outcome?.state === "busy";

  const up = () => {
    if (parts.length === 0) return;
    // The snapshots are one step below the top in the crumbs, whatever folders hold them on the server.
    if (atSnapshotList) go("");
    else go(parts.slice(0, -1).join("/"), parts.at(-1) ?? null);
  };

  // Inside the snapshots the crumbs read "Snapshots › 22.09.2026, 02:00 › …" instead of ".zfs › snapshot › <name> › …".
  const segments = inSnapshots ? [b.snapshots, ...parts.slice(2).map((part, index) => (index === 0 ? snapshotLabel(part) : part))] : parts;
  const jump = (depth: number) => {
    if (depth === 0) go("", inSnapshots ? null : (parts[0] ?? null));
    else if (inSnapshots) go(parts.slice(0, depth + 1).join("/"), parts[depth + 1] ?? null);
    else go(parts.slice(0, depth).join("/"), parts[depth] ?? null);
  };

  const showPreview = (entry: BrowseEntry) => {
    const full = joinPath(folder, entry.name);
    setPreview({ entry, path: full, load: { state: "loading" } });
    api
      .browsePreview(location.id, full)
      .then((value) => setPreview((current) => (current?.path === full ? { ...current, load: { state: "ready", value } } : current)))
      .catch((reason) =>
        setPreview((current) => (current?.path === full ? { ...current, load: { state: "failed", failure: failureOf(b.previewFailed, reason, false) } } : current)),
      );
  };

  const open = (name: string) => {
    const entry = visible.find((item) => item.name === name);
    if (!entry || !settled) return;
    if (entry.dir) go(joinPath(folder, entry.name));
    else showPreview(entry);
  };

  const download = (entry: BrowseEntry) => {
    if (working) return;
    setOutcome({ state: "busy", text: b.copying(q(entry.name)) });
    api
      .browseDownload(location.id, joinPath(folder, entry.name))
      .then((copy) => setOutcome({ state: "done", text: b.copied(tidyHome(copy)), reveal: copy }))
      .catch((reason) => setOutcome({ state: "failed", failure: failureOf(b.copyFailed(q(entry.name)), reason, false) }));
  };

  const startRename = (entry: BrowseEntry) => {
    setDeleting(null);
    setRenaming({ name: entry.name, value: entry.name, error: null, busy: false });
  };

  const cancelRename = () => {
    setRenaming(null);
    focusList();
  };

  const submitRename = () => {
    if (!renaming || renaming.busy) return;
    const wanted = renaming.value.trim();
    const problem = nameProblem(wanted, renaming.name, entries, onMac);
    if (problem === "same") {
      cancelRename();
      return;
    }
    if (problem) {
      setRenaming({ ...renaming, error: problem });
      return;
    }
    const at = folder;
    const before = joinPath(at, renaming.name);
    setRenaming({ ...renaming, busy: true, error: null });
    api
      .browseRename(location.id, before, wanted)
      .then(() => {
        setRenaming(null);
        setOutcome({ state: "done", text: b.renamed(q(wanted)) });
        setPreview((current) => (current?.path === before ? null : current));
        if (here.current === at) {
          setCameFrom(wanted);
          setReload((count) => count + 1);
        }
        focusList();
      })
      // The field keeps the focus, so the name can be corrected right away.
      .catch((reason) => setRenaming((current) => (current ? { ...current, busy: false, error: failureOf(b.renameFailed, reason).text } : current)));
  };

  const askDelete = (entry: BrowseEntry) => {
    setRenaming(null);
    setDeleting(entry);
  };

  const cancelDelete = () => {
    returnFocus.current = true;
    setDeleting(null);
  };

  const confirmDelete = () => {
    const entry = deleting;
    if (!entry) return;
    const at = folder;
    const full = joinPath(at, entry.name);
    const words = deleteWords(location, entry, snapshotCount !== null);
    returnFocus.current = true;
    setDeleting(null);
    setOutcome({ state: "busy", text: words.busy });
    api
      .browseDelete(location.id, full)
      .then(() => {
        setOutcome({ state: "done", text: words.done });
        setPreview((current) => (current?.path === full ? null : current));
        if (here.current === at) {
          setSelected((current) => (current === entry.name ? null : current));
          setReload((count) => count + 1);
        }
      })
      .catch((reason) => setOutcome({ state: "failed", failure: failureOf(b.deleteFailed(q(entry.name)), reason, false) }));
  };

  // ↵ in here opens or answers; it never reaches the location view, where it would check the location.
  // Space shows a file, ⌘⌫ asks to delete it.
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") event.stopPropagation();
    if (event.target !== listbox.current) return;
    if (event.key === " ") {
      // Space never scrolls the page from the list, with or without a selected row.
      event.preventDefault();
      if (!chosen || !settled) return;
      if (preview?.path === joinPath(folder, chosen.name)) setPreview(null);
      else if (!chosen.dir) showPreview(chosen);
    } else if (event.key === "Backspace" && event.metaKey && chosen && settled && !readOnly) {
      event.preventDefault();
      askDelete(chosen);
    }
  };

  const items: UiItemListItem[] = visible.map((entry) => {
    const Icon = atSnapshotList ? History : fileIcon(entry.name, entry.dir);
    const taken = atSnapshotList ? snapshotDate(entry.name) : null;
    return {
      id: entry.name,
      dimmed: entry.name.startsWith("."),
      leading: <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />,
      title: taken ? fixedMoment(taken) : entry.name,
      detail: taken ? <span className="font-mono">{entry.name}</span> : undefined,
      meta: (
        <>
          <span className="w-16 text-right">{entry.dir ? "" : formatBytes(entry.size)}</span>
          {/* Next to a preview the list is narrow; the date of the file shown is in the preview. */}
          {preview || atSnapshotList ? null : <span className="w-28 text-right">{entry.modified ? fixedMoment(new Date(entry.modified)) : ""}</span>}
          {entry.dir ? <ChevronRight className="size-3.5 text-ink-faint" strokeWidth={2.2} /> : <span className="w-3.5" />}
        </>
      ),
    };
  });

  const count = visible.length;
  const hiddenNote = hiddenCount > 0 && !showHidden;
  const summary =
    listing.state === "failed"
      ? b.unreadable
      : count === 0
        ? hiddenNote
          ? b.onlyHidden(hiddenCount, formatCount(hiddenCount))
          : b.empty
        : b.items(count, formatCount(count), hiddenNote ? hiddenCount : 0, formatCount(hiddenCount));
  const heading = path === SNAPSHOT_ROOT ? b.snapshots : path.startsWith(`${SNAPSHOT_ROOT}/`) && path.split("/").length === 3 ? snapshotLabel(path.split("/")[2] ?? "") : path.split("/").at(-1) || location.name;
  const loadingLine =
    listing.state !== "loading" ? null : listing.entries === null || path === folder ? t.detail.reading : b.opening(q(heading));

  const status = outcome ? (
    outcome.state === "failed" ? (
      <UiStatusLine state="failed" title={outcome.failure.detail ?? outcome.failure.text}>
        {outcome.failure.text}
      </UiStatusLine>
    ) : (
      <UiStatusLine
        state={outcome.state}
        title={outcome.text}
        action={
          outcome.state === "done" && outcome.reveal ? (
            <UiLinkButton onPress={() => void revealItemInDir(outcome.reveal ?? "").catch(() => undefined)}>{t.detail.showInFinder}</UiLinkButton>
          ) : undefined
        }
      >
        {outcome.text}
      </UiStatusLine>
    )
  ) : loadingLine ? (
    <UiStatusLine state="busy">{loadingLine}</UiStatusLine>
  ) : (
    <UiText variant="caption" tone="neutral" truncate>
      {summary}
    </UiText>
  );

  const footer = renaming ? (
    <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
      <div className="flex items-center gap-2">
        <Pencil className="size-3.5 shrink-0 text-ink-faint" strokeWidth={2.1} />
        <span className="min-w-0 flex-1">
          <UiInput
            value={renaming.value}
            placeholder={b.newName}
            autoFocus
            onChange={(value) => !renaming.busy && setRenaming({ ...renaming, value, error: null })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                submitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelRename();
              }
            }}
          />
        </span>
        <UiButton variant="secondary" keys={["↵"]} disabled={renaming.busy} onPress={submitRename}>
          {renaming.busy ? b.renaming : b.rename}
        </UiButton>
        <UiIconButton icon={X} label={t.common.cancel} onPress={cancelRename} />
      </div>
      {renaming.error ? (
        <span className="pl-5.5">
          <UiStatusLine state="failed" title={renaming.error}>
            {renaming.error}
          </UiStatusLine>
        </span>
      ) : null}
    </div>
  ) : (
    <>
      <span className="flex min-w-0 flex-1 items-center">{status}</span>
      {chosen && !deleting ? (
        <>
          <UiButton variant="ghost" keys={["↵"]} disabled={!settled} onPress={() => open(chosen.name)}>
            {chosen.dir ? b.open : b.preview}
          </UiButton>
          <UiIconButton icon={Download} label={b.copyToDownloads} disabled={!settled || working} onPress={() => download(chosen)} />
          {readOnly ? null : (
            <>
              <UiIconButton icon={Pencil} label={b.rename} disabled={!settled} onPress={() => startRename(chosen)} />
              <UiIconButton icon={Trash2} label={b.delete} disabled={!settled || working} onPress={() => askDelete(chosen)} />
            </>
          )}
        </>
      ) : null}
    </>
  );

  const question = deleting ? deleteWords(location, deleting, snapshotCount !== null) : null;

  return (
    <div className="flex flex-col gap-2" onKeyDown={onKey}>
      <div className="flex min-h-7 items-center gap-2">
        <div className="min-w-0 flex-1">
          <UiBreadcrumb
            label={b.currentFolder}
            root={
              <>
                <UiLocationGlyph kind={glyphOf(location)} size="xs" connected={connected} />
                {location.name}
              </>
            }
            segments={segments}
            onJump={jump}
          />
        </div>
        {readOnly ? <UiBadge>{atSnapshotList ? b.readOnly : b.snapshotReadOnly}</UiBadge> : null}
        {snapshotCount !== null && !inSnapshots ? (
          <UiButton variant="ghost" icon={History} onPress={() => go(SNAPSHOT_ROOT)} title={b.snapshotsTitle(formatCount(snapshotCount))}>
            {b.snapshotsButton(formatCount(snapshotCount))}
          </UiButton>
        ) : null}
        <UiIconButton
          icon={showHidden ? Eye : EyeOff}
          label={showHidden ? b.hideHidden : hiddenCount > 0 ? b.showHidden(hiddenCount, formatCount(hiddenCount)) : b.noHidden}
          tone={showHidden ? "accent" : "neutral"}
          disabled={hiddenCount === 0 && !showHidden}
          onPress={() => setShowHidden((value) => !value)}
        />
      </div>

      {storageBox && folder === "" && (snapshots === "none" || !boxTop) ? (
        <UiText variant="caption" tone="neutral">
          {boxTop
            ? b.boxSnapshotsHidden
            : b.boxSnapshotsAbove}
        </UiText>
      ) : null}

      <div className={preview ? "grid grid-cols-[minmax(0,1fr)_19rem] gap-3" : "flex flex-col"}>
        <UiWell size="lg" label={b.contents([location.name, ...segments].join("/"))} footer={footer}>
          {listing.state === "failed" && listing.failure ? (
            <div className="p-1.5">
              <UiNotice
                tone="danger"
                actions={
                  <>
                    <UiButton variant="ghost" icon={RotateCw} onPress={() => setReload((value) => value + 1)}>
                      {t.detail.retry}
                    </UiButton>
                    {parts.length > 0 ? (
                      <UiButton variant="ghost" icon={ArrowUp} onPress={up}>
                        {b.up}
                      </UiButton>
                    ) : null}
                  </>
                }
              >
                {/* The backend's English words stay in the tooltip until labels.ts translates them. */}
                <span title={listing.failure.detail ?? undefined}>{listing.failure.text}</span>
              </UiNotice>
            </div>
          ) : (
            <UiItemList
              ref={listbox}
              label={b.contents([location.name, ...segments].join("/"))}
              items={items}
              selected={chosen?.name ?? null}
              onSelect={setSelected}
              onOpen={open}
              onBack={parts.length > 0 ? up : undefined}
              busy={listing.state === "loading" && listing.entries !== null}
              empty={
                settled ? (
                  <span className="flex items-center gap-2 px-2.5 py-2">
                    <UiText variant="caption" tone="neutral">
                      {hiddenCount > 0 ? b.onlyHiddenHere : b.emptyFolder}
                    </UiText>
                    {hiddenCount > 0 ? <UiLinkButton onPress={() => setShowHidden(true)}>{b.show}</UiLinkButton> : null}
                  </span>
                ) : null
              }
            />
          )}
        </UiWell>

        {preview ? (
          <PreviewPane entry={preview.entry} load={preview.load} now={now} onClose={() => setPreview(null)} onDownload={() => download(preview.entry)} />
        ) : null}
      </div>

      {deleting && question ? (
        <UiConfirmBar
          title={question.title}
          cancelLabel={b.keep}
          confirmLabel={question.confirm}
          confirmIcon={Trash2}
          tone={question.tone}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        >
          {question.body}
        </UiConfirmBar>
      ) : null}
    </div>
  );
}

/** The file next to the list: text or picture, its size and when it last changed. It takes the height of the list. */
function PreviewPane({ entry, load, now, onClose, onDownload }: { entry: BrowseEntry; load: Load<FilePreview>; now: number; onClose: () => void; onDownload: () => void }) {
  const Icon = fileIcon(entry.name);
  const b = useT().detail.browser;
  return (
    <UiWell
      follow
      inset="text"
      label={b.previewOf(entry.name)}
      header={
        <>
          <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
          <span className="min-w-0 flex-1">
            <UiText variant="label" truncate title={entry.name}>
              {entry.name}
            </UiText>
          </span>
          <UiIconButton icon={X} label={b.closePreview} onPress={onClose} />
        </>
      }
      footer={
        <>
          <span className="min-w-0 flex-1">
            <UiText variant="caption" tone="neutral">
              {formatBytes(entry.size)}
            </UiText>
          </span>
          {entry.modified ? (
            <span className="pr-1.5">
              <UiText variant="caption" tone="neutral">
                {b.modified(momentWords(new Date(entry.modified), now))}
              </UiText>
            </span>
          ) : null}
        </>
      }
    >
      {load.state === "loading" ? (
        <UiStatusLine state="busy">{b.loadingPreview}</UiStatusLine>
      ) : load.state === "failed" ? (
        <div className="flex flex-col items-start gap-2">
          <UiText variant="caption" tone="neutral">
            {load.failure.text}
          </UiText>
          <UiButton variant="secondary" icon={Download} onPress={onDownload}>
            {b.copyToDownloads}
          </UiButton>
        </div>
      ) : load.value.base64 ? (
        <img alt={entry.name} src={`data:${load.value.mime};base64,${load.value.base64}`} className="min-h-0 w-full flex-1 rounded-[var(--radius-control)] object-contain" />
      ) : (
        <pre className="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-ink-soft select-text">{load.value.text}</pre>
      )}
    </UiWell>
  );
}

interface DeleteWords {
  title: string;
  body: string;
  confirm: string;
  /** Amber when the file can be brought back, red when it is gone. */
  tone: "warn" | "danger";
  busy: string;
  done: string;
}

/**
 * What deleting does here, in the words of the place: the Trash on the Mac, the provider's own
 * bin in some clouds, gone for good on a server. rclone's defaults decide for the clouds: Google
 * Drive and OneDrive use their bin, B2 hides a file but purges a folder with all its versions.
 */
function deleteWords(location: Location, entry: BrowseEntry, snapshots: boolean): DeleteWords {
  const t = texts().detail.browser.remove;
  const name = texts().detail.quote(entry.name);
  const dir = entry.dir;
  const gone = { busy: t.busy(name), done: t.done(name) };
  const kind = location.kind;
  switch (kind.type) {
    case "folder":
    case "volume":
      return { tone: "warn", title: t.trash.title(name), body: t.trash.body(dir), confirm: t.trash.confirm, busy: t.trash.busy(name), done: t.trash.done(name) };
    case "smb":
      return { tone: "danger", title: t.title(name), body: t.share(dir), confirm: t.confirm, ...gone };
    case "ssh":
      return snapshots
        ? { tone: "danger", title: t.title(name), body: t.serverWithSnapshots(dir), confirm: t.confirm, ...gone }
        : { tone: "danger", title: t.titleForever(name), body: t.server(dir), confirm: t.confirmForever, ...gone };
    case "cloud": {
      const provider = providerLabel[kind.provider];
      switch (kind.provider) {
        case "drive":
        case "onedrive":
          return {
            tone: "warn",
            title: t.cloudTrash.title(name, provider),
            body: t.cloudTrash.body(dir, provider),
            confirm: t.trash.confirm,
            busy: t.cloudTrash.busy(name, provider),
            done: t.cloudTrash.done(name, provider),
          };
        case "dropbox":
          return { tone: "warn", title: t.title(name), body: t.dropbox, confirm: t.confirm, ...gone };
        case "b2":
          return dir
            ? { tone: "danger", title: t.titleForever(name), body: t.b2Folder, confirm: t.confirmForever, ...gone }
            : { tone: "warn", title: t.title(name), body: t.b2File, confirm: t.confirm, ...gone };
        case "s3":
          return { tone: "danger", title: t.title(name), body: t.s3(dir), confirm: t.confirm, ...gone };
        default:
          return { tone: "danger", title: t.title(name), body: t.other(dir), confirm: t.confirm, ...gone };
      }
    }
  }
}

/**
 * Why a new name cannot be used, "same" for no change, or null. On the Mac names ignore case, so a
 * name that differs only in case is taken, and the backend refuses a change of case alone.
 */
function nameProblem(wanted: string, current: string, siblings: BrowseEntry[], ignoreCase: boolean): string | null {
  if (wanted === current) return "same";
  const t = texts().detail.browser.name;
  if (!wanted) return t.empty;
  if (wanted.includes("/")) return t.slash;
  if (wanted === "." || wanted === "..") return t.notAllowed;
  if (ignoreCase && wanted.toLowerCase() === current.toLowerCase()) return t.caseOnly;
  const same = (name: string) => (ignoreCase ? name.toLowerCase() === wanted.toLowerCase() : name === wanted);
  if (siblings.some((entry) => entry.name !== current && same(entry.name))) return t.taken(texts().detail.quote(wanted));
  return null;
}
