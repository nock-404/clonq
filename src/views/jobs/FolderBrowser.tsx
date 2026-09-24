import { ChevronRight, Eye, EyeOff, Folder, FolderPlus, RotateCw, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { locale, texts, useT } from "../../i18n";
import { api } from "../../lib/api";
import { messageLabel } from "../../lib/labels";
import type { FolderEntry, Location } from "../../lib/types";
import { UiBadge, UiButton, UiIconButton, UiInput, UiNotice, UiReel } from "../../ui";
import { UiBreadcrumb } from "../../ui/UiBreadcrumb";
import { UiLamp } from "../../ui/UiLamp";
import { UiLinkButton } from "../../ui/UiLinkButton";
import { UiListbox } from "../../ui/UiListbox";
import { UiLocationGlyph } from "../../ui/UiLocationGlyph";
import { ringOf } from "../../ui/rings";
import { joinPath, trimPath, type PlaceUse } from "./draft";

export interface FolderMark {
  /** The other end of the job is this folder, lies in it or holds it. */
  clash: string | null;
  /** Jobs that already use this folder. */
  uses: PlaceUse[];
}

interface FolderBrowserProps {
  location: Location;
  /** The open folder, which is also the chosen one. */
  path: string;
  onPath: (path: string) => void;
  markOf: (path: string) => FolderMark;
  /** Told whether the open folder could be read; an unreadable folder is no good as either end. */
  onReadable?: (path: string, readable: boolean) => void;
}

type Listing =
  | { state: "loading"; path: string; entries: FolderEntry[] | null }
  | { state: "ready"; path: string; entries: FolderEntry[] }
  | { state: "failed"; path: string; message: string };

function folderNameProblem(name: string, siblings: FolderEntry[]): string | null {
  const t = texts().wizard.folders;
  const trimmed = name.trim();
  if (!trimmed) return t.needsName;
  if (trimmed.includes("/")) return t.noSlash;
  if (trimmed === "." || trimmed === "..") return t.notAllowed;
  if (siblings.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) return t.exists;
  return null;
}

/** What a job does with a folder, e.g. "Source of “A” and “B”". */
function roleWords(role: PlaceUse["role"], names: string): string {
  const t = texts().wizard.folders;
  return role === "source" ? t.sourceOf(names) : t.targetOf(names);
}

/** "Source of “A” and “B”, Target of “C”". */
function usesTitle(uses: PlaceUse[]): string {
  const list = new Intl.ListFormat(locale(), { type: "conjunction" });
  const { quote } = texts().wizard;
  return (["source", "target"] as const)
    .map((role) => {
      const names = uses.filter((use) => use.role === role).map((use) => quote(use.job.name));
      return names.length > 0 ? roleWords(role, list.format(names)) : null;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Folders inside a location. The open folder is the chosen place; a click on a sub-folder, or ↵
 * on the highlighted one, opens it. ← and ⌘↑ go back up.
 */
export function FolderBrowser({ location, path, onPath, markOf, onReadable }: FolderBrowserProps) {
  const t = useT();
  const f = t.wizard.folders;
  const current = trimPath(path);
  const [listing, setListing] = useState<Listing>({ state: "loading", path: current, entries: null });
  const [reload, setReload] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  // After going up, the folder that was left stays highlighted.
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const segments = current.split("/").filter(Boolean);

  useEffect(() => {
    let alive = true;
    setListing((previous) => ({ state: "loading", path: current, entries: previous.state === "failed" ? null : previous.entries }));
    api
      .listFolders(location.id, current)
      .then((entries) => {
        if (!alive) return;
        setListing({ state: "ready", path: current, entries: entries ?? [] });
        onReadable?.(current, true);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setListing({ state: "failed", path: current, message: messageLabel(String(error)) });
        onReadable?.(current, false);
      });
    return () => {
      alive = false;
    };
  }, [location.id, current, reload]);

  const entries = listing.state === "failed" ? [] : (listing.entries ?? []);
  const settled = listing.state === "ready";
  const hiddenCount = settled ? entries.filter((entry) => entry.hidden).length : 0;
  const visible = entries.filter((entry) => showHidden || !entry.hidden);

  useEffect(() => {
    if (listing.state !== "ready") return;
    setActive(cameFrom !== null && listing.entries.some((entry) => entry.name === cameFrom) ? cameFrom : null);
    setCameFrom(null);
    // Only a new listing moves the highlight; cameFrom is read at that moment.
  }, [listing]);

  const open = (name: string) => {
    if (!settled) return;
    onPath(joinPath(current, name));
  };
  const up = () => {
    if (segments.length === 0) return;
    setCameFrom(segments.at(-1) ?? null);
    onPath(segments.slice(0, -1).join("/"));
  };

  const stopCreating = () => {
    setCreating(false);
    setNewName("");
    setCreateError(null);
  };

  const create = async () => {
    const problem = folderNameProblem(newName, entries);
    if (problem) {
      setCreateError(problem);
      return;
    }
    const next = joinPath(current, newName.trim());
    setBusy(true);
    try {
      await api.createFolder(location.id, next);
      stopCreating();
      onPath(next);
    } catch (error) {
      setCreateError(messageLabel(String(error)));
    } finally {
      setBusy(false);
    }
  };

  // Enter and Escape in the name field belong to the field, not to the wizard around it.
  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void create();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopCreating();
    }
  };

  const here = markOf(current);
  // Inside a folder that already clashes with the other end, every sub-folder does too; saying so on each row is noise.
  const markRows = here.clash === null;
  const hereTitle = usesTitle(here.uses);
  const count = visible.length;
  const status =
    listing.state === "loading"
      ? f.loading
      : listing.state === "failed"
        ? f.unreadable
        : count === 0
          ? hiddenCount > 0
            ? f.onlyHidden(hiddenCount)
            : f.none
          : f.count(count, showHidden ? 0 : hiddenCount);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <div className="min-w-0 flex-1">
          <UiBreadcrumb
            label={f.chosen}
            root={
              <>
                <UiLocationGlyph kind={location.kind.type} size="xs" connected />
                {location.name}
              </>
            }
            segments={segments}
            onJump={(depth) => {
              setCameFrom(segments[depth] ?? null);
              onPath(segments.slice(0, depth).join("/"));
            }}
          />
        </div>
        {segments.length === 0 ? <UiBadge>{t.wizard.tape.whole}</UiBadge> : null}
        <UiIconButton
          icon={showHidden ? Eye : EyeOff}
          label={showHidden ? f.hideHidden : hiddenCount > 0 ? f.showHidden(hiddenCount) : f.noHidden}
          tone={showHidden ? "accent" : "neutral"}
          disabled={hiddenCount === 0 && !showHidden}
          onPress={() => setShowHidden((value) => !value)}
        />
      </div>

      <div className="hairline flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-panel)] bg-well">
        {listing.state === "failed" ? (
          <div className="p-2">
            <UiNotice
              tone="danger"
              actions={
                <UiButton variant="ghost" icon={RotateCw} onPress={() => setReload((value) => value + 1)}>
                  {f.retry}
                </UiButton>
              }
            >
              {listing.message}
            </UiNotice>
          </div>
        ) : (
          <UiListbox
            label={f.listLabel([location.name, ...segments].join("/"))}
            autoFocus
            busy={listing.state === "loading" && listing.entries !== null}
            active={active}
            onActive={setActive}
            onOpen={open}
            onBack={segments.length > 0 ? up : undefined}
            items={visible.map((entry) => {
              const mark = markOf(joinPath(current, entry.name));
              return {
                id: entry.name,
                dimmed: entry.hidden,
                leading: <Folder className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />,
                title: entry.name,
                accessory: (
                  <>
                    {mark.uses.slice(0, 3).map((use) => (
                      <UiReel key={use.job.id} size="xs" ring={ringOf(use.job.ring, use.index)} label={roleWords(use.role, t.wizard.quote(use.job.name))} />
                    ))}
                    {markRows && mark.clash ? <UiBadge tone="danger">{mark.clash}</UiBadge> : null}
                    <ChevronRight className="size-3.5 text-ink-faint" strokeWidth={2.2} />
                  </>
                ),
              };
            })}
            empty={
              settled ? (
                <span className="flex items-center gap-2 px-2.5 py-2 text-xs text-ink-faint">
                  {hiddenCount > 0 ? f.emptyHidden : f.empty}
                  {hiddenCount > 0 ? <UiLinkButton onPress={() => setShowHidden(true)}>{f.show}</UiLinkButton> : null}
                </span>
              ) : null
            }
            after={
              creating ? (
                <div className="flex flex-col gap-1 px-1.5 pt-1">
                  <div className="flex items-center gap-2">
                    <FolderPlus className="size-4 shrink-0 text-ink-soft" strokeWidth={2} />
                    <span className="min-w-0 flex-1" data-own-enter>
                      <UiInput
                        value={newName}
                        onChange={(value) => {
                          setNewName(value);
                          setCreateError(null);
                        }}
                        placeholder={f.newName}
                        autoFocus
                        disabled={busy}
                        onKeyDown={onNameKey}
                      />
                    </span>
                    <UiButton variant="secondary" disabled={busy} onPress={() => void create()} keys={["↵"]}>
                      {busy ? t.wizard.footer.creating : t.wizard.footer.create}
                    </UiButton>
                    <UiIconButton icon={X} label={t.common.cancel} onPress={stopCreating} />
                  </div>
                </div>
              ) : settled ? (
                <div className="px-0.5 pt-0.5">
                  <UiButton variant="ghost" icon={FolderPlus} onPress={() => setCreating(true)}>
                    {f.newFolder}
                  </UiButton>
                </div>
              ) : null
            }
          />
        )}
        <div className="hairline-t flex h-7 shrink-0 items-center gap-2 px-3 text-[0.6875rem] text-ink-faint">
          {listing.state === "loading" ? <UiLamp tone="accent" busy /> : null}
          {createError ? <UiLamp tone="danger" lit /> : null}
          <span className={createError ? "min-w-0 flex-1 truncate text-danger" : "shrink-0"} title={createError ?? undefined}>
            {createError ?? status}
          </span>
          {!createError && here.uses.length > 0 ? (
            <span className="min-w-0 flex-1 truncate text-right" title={hereTitle}>
              {hereTitle}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
