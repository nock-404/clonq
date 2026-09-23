import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronRight, Download, File, FileImage, FileText, Folder, History, Pencil, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/format";
import { messageLabel } from "../lib/labels";
import type { BrowseEntry, FilePreview, Location } from "../lib/types";
import { UiButton, UiIconButton, UiInput, UiNotice, UiPanel } from "../ui";

interface FileBrowserProps {
  location: Location;
}

const imageExt = /\.(png|jpe?g|gif|webp|svg|heic)$/i;
const textExt = /\.(txt|md|log|csv|json|ya?ml|toml|xml|html|css|jsx?|tsx?|rs|go|py|sh|swift|vue|php|sql|env|ini|conf)$/i;

function iconOf(entry: BrowseEntry): LucideIcon {
  if (entry.dir) return Folder;
  if (imageExt.test(entry.name)) return FileImage;
  if (textExt.test(entry.name)) return FileText;
  return File;
}

const join = (base: string, name: string) => (base ? `${base}/${name}` : name);

/** Everything inside a location, with preview, download, rename and delete. */
export function FileBrowser({ location }: FileBrowserProps) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<BrowseEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: FilePreview } | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const local = location.kind.type === "folder" || location.kind.type === "volume" || location.kind.type === "smb";

  const load = useCallback(
    (target: string) => {
      setEntries(null);
      setError(null);
      setPreview(null);
      api
        .browseList(location.id, target)
        .then((list) => {
          setPath(target);
          setEntries(list);
        })
        .catch((reason) => {
          setError(String(reason));
          setEntries([]);
        });
    },
    [location.id],
  );

  useEffect(() => load(""), [load]);

  const act = (promise: Promise<unknown>, done?: string) =>
    promise
      .then(() => {
        if (done) setNotice(done);
        load(path);
      })
      .catch((reason) => setError(String(reason)));

  const openSnapshots = async () => {
    // Hetzner shows its read-only snapshots under .zfs once enabled in the console.
    for (const candidate of [".zfs/snapshot", ".zfs/snapshots"]) {
      try {
        await api.browseList(location.id, candidate);
        load(candidate);
        return;
      } catch {
        // try the next spelling
      }
    }
    setError("Keine Snapshots sichtbar. In der Hetzner Console unter „Snapshots“ die Option „Snapshot-Verzeichnis anzeigen“ einschalten.");
  };

  const crumbs = path ? path.split("/") : [];
  const visible = (entries ?? []).filter((entry) => showHidden || !entry.name.startsWith("."));

  return (
    <UiPanel title="Dateien" aside={entries ? `${visible.length} Einträge` : undefined}>
      <div className="flex items-center gap-1 text-xs">
        <UiButton variant="ghost" onPress={() => load("")}>
          {location.name}
        </UiButton>
        {crumbs.map((crumb, index) => (
          <span key={`${index}-${crumb}`} className="flex items-center gap-1">
            <ChevronRight className="size-3 text-ink-faint" />
            <UiButton variant="ghost" onPress={() => load(crumbs.slice(0, index + 1).join("/"))}>
              {crumb}
            </UiButton>
          </span>
        ))}
        <span className="flex-1" />
        {location.kind.type === "ssh" ? (
          <UiButton variant="ghost" icon={History} onPress={() => void openSnapshots()}>
            Snapshots
          </UiButton>
        ) : null}
        <UiButton variant="ghost" onPress={() => setShowHidden(!showHidden)}>
          {showHidden ? "Versteckte ausblenden" : "Versteckte zeigen"}
        </UiButton>
      </div>
      {error ? <UiNotice tone="danger" onDismiss={() => setError(null)}>{messageLabel(error)}</UiNotice> : null}
      {notice ? <UiNotice tone="ok" onDismiss={() => setNotice(null)}>{notice}</UiNotice> : null}

      <div className={preview ? "grid grid-cols-[1fr_20rem] gap-3" : ""}>
        <ul className="hairline flex max-h-[28rem] flex-col overflow-y-auto rounded-[var(--radius-control)] bg-well">
          {entries === null ? <li className="px-3 py-6 text-center text-xs text-ink-faint">Wird gelesen …</li> : null}
          {entries !== null && visible.length === 0 ? <li className="px-3 py-6 text-center text-xs text-ink-faint">Dieser Ordner ist leer.</li> : null}
          {visible.map((entry) => {
            const Icon = iconOf(entry);
            const full = join(path, entry.name);
            const isRenaming = renaming?.name === entry.name;
            const isDeleting = deleting === entry.name;
            return (
              <li key={entry.name} className="hairline-b group flex items-center gap-2.5 px-2.5 py-1.5 last:border-b-0 hover:bg-hover">
                <Icon className={`size-4 shrink-0 ${entry.dir ? "text-accent" : "text-ink-faint"}`} strokeWidth={1.9} />
                {isRenaming ? (
                  <div className="flex flex-1 items-center gap-2">
                    <UiInput
                      value={renaming.value}
                      autoFocus
                      onChange={(value) => setRenaming({ name: entry.name, value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          setRenaming(null);
                          void act(api.browseRename(location.id, full, renaming.value));
                        }
                        if (event.key === "Escape") setRenaming(null);
                      }}
                    />
                    <UiIconButton icon={X} label="Abbrechen" onPress={() => setRenaming(null)} />
                  </div>
                ) : (
                  <UiButton
                    variant="ghost"
                    onPress={() => {
                      if (entry.dir) {
                        load(full);
                      } else {
                        api
                          .browsePreview(location.id, full)
                          .then((data) => setPreview({ name: entry.name, data }))
                          .catch((reason) => setError(String(reason)));
                      }
                    }}
                  >
                    {entry.name}
                  </UiButton>
                )}
                <span className="flex-1" />
                {isDeleting ? (
                  <span className="flex items-center gap-2 text-[0.6875rem] text-danger">
                    {local ? "In den Papierkorb legen?" : "Endgültig löschen?"}
                    <UiButton
                      variant="danger"
                      onPress={() => {
                        setDeleting(null);
                        void act(api.browseDelete(location.id, full), local ? `${entry.name} liegt im Papierkorb.` : `${entry.name} wurde gelöscht.`);
                      }}
                    >
                      Ja
                    </UiButton>
                    <UiButton variant="ghost" onPress={() => setDeleting(null)}>
                      Nein
                    </UiButton>
                  </span>
                ) : (
                  <>
                    <span className="text-[0.6875rem] text-ink-faint tabular">{entry.dir ? "" : formatBytes(entry.size)}</span>
                    <span className="w-32 text-right text-[0.6875rem] text-ink-faint tabular">{entry.modified ? formatDateTime(entry.modified) : ""}</span>
                    <span className="flex opacity-0 group-hover:opacity-100">
                      <UiIconButton
                        icon={Download}
                        label="In Downloads kopieren"
                        onPress={() =>
                          void api
                            .browseDownload(location.id, full)
                            .then((copy) => {
                              setNotice(`Kopiert nach ${copy.replace(/^\/Users\/[^/]+/, "~")}`);
                              void revealItemInDir(copy);
                            })
                            .catch((reason) => setError(String(reason)))
                        }
                      />
                      <UiIconButton icon={Pencil} label="Umbenennen" onPress={() => setRenaming({ name: entry.name, value: entry.name })} />
                      <UiIconButton icon={Trash2} label="Löschen" tone="danger" onPress={() => setDeleting(entry.name)} />
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {preview ? (
          <aside className="hairline flex max-h-[28rem] flex-col gap-2 overflow-hidden rounded-[var(--radius-control)] bg-well p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{preview.name}</span>
              <UiIconButton icon={X} label="Vorschau schließen" onPress={() => setPreview(null)} />
            </div>
            {preview.data.base64 ? (
              <img alt={preview.name} src={`data:${preview.data.mime};base64,${preview.data.base64}`} className="max-h-96 w-full rounded-[0.25rem] object-contain" />
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto font-mono text-[0.6875rem] whitespace-pre-wrap text-ink-soft">{preview.data.text}</pre>
            )}
          </aside>
        ) : null}
      </div>
    </UiPanel>
  );
}
