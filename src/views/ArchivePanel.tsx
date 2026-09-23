import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArchiveRestore, FileClock } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatBytes, formatCount, formatStamp } from "../lib/format";
import { messageLabel } from "../lib/labels";
import type { ArchivedFile, Job, Snapshot } from "../lib/types";
import { UiButton, UiIconButton, UiNotice, UiPanel } from "../ui";

interface ArchivePanelProps {
  job: Job;
  /** Changes whenever a run ends, so the list reloads. */
  revision: string;
}

/** Earlier versions the job moved aside, and a way to get them back. */
export function ArchivePanel({ job, revision }: ArchivePanelProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<ArchivedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .archiveSnapshots(job.id)
      .then((list) => current && setSnapshots(list))
      .catch((reason) => current && setError(String(reason)));
    return () => {
      current = false;
    };
  }, [job.id, revision]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    api
      .archiveFiles(job.id, open)
      .then((list) => current && setFiles(list))
      .catch((reason) => current && setError(String(reason)));
    return () => {
      current = false;
    };
  }, [job.id, open]);

  const restore = (stamp: string, path?: string) => {
    setError(null);
    api
      .restoreArchive(job.id, stamp, path)
      .then((folder) => {
        setRestored(folder);
        void revealItemInDir(folder);
      })
      .catch((reason) => setError(String(reason)));
  };

  if (!job.archive.enabled) {
    return (
      <UiPanel title="Archiv">
        <span className="text-xs text-ink-faint">Für diesen Job ist das Archiv ausgeschaltet. Gelöschte und überschriebene Dateien werden nicht aufbewahrt.</span>
      </UiPanel>
    );
  }

  return (
    <UiPanel title="Archiv" aside={`${job.archive.keepDays} Tage aufbewahrt`}>
      {error ? <UiNotice tone="danger">{messageLabel(error)}</UiNotice> : null}
      {restored ? <UiNotice tone="ok">Wiederhergestellt nach {restored.replace(/^\/Users\/[^/]+/, "~")}</UiNotice> : null}
      {snapshots === null ? (
        <span className="text-xs text-ink-faint">Wird gelesen …</span>
      ) : snapshots.length === 0 ? (
        <span className="text-xs text-ink-faint">
          Noch nichts archiviert. Sobald ein Lauf etwas im Ziel löscht oder überschreibt, liegt die vorige Fassung hier.
        </span>
      ) : (
        <ul className="flex flex-col gap-1">
          {snapshots.map((snapshot) => (
            <li key={snapshot.stamp} className="flex flex-col">
              <div className="flex items-center gap-3 rounded-[var(--radius-control)] px-1 py-1 hover:bg-hover">
                <FileClock className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
                <UiButton variant="ghost" onPress={() => setOpen(open === snapshot.stamp ? null : snapshot.stamp)}>
                  {formatStamp(snapshot.stamp)}
                </UiButton>
                <span className="flex-1 text-[0.6875rem] text-ink-faint tabular">
                  {formatCount(snapshot.files)} Dateien · {formatBytes(snapshot.bytes)}
                </span>
                <UiIconButton icon={ArchiveRestore} label="Alles wiederherstellen" onPress={() => restore(snapshot.stamp)} />
              </div>
              {open === snapshot.stamp ? (
                <ul className="hairline ml-7 flex max-h-56 flex-col overflow-y-auto rounded-[var(--radius-control)] bg-well">
                  {files.map((file) => (
                    <li key={file.path} className="hairline-b flex items-center gap-2 px-2.5 py-1 last:border-b-0">
                      <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem]" title={file.path}>
                        {file.path}
                      </span>
                      <span className="text-[0.6875rem] text-ink-faint tabular">{formatBytes(file.size)}</span>
                      <UiIconButton icon={ArchiveRestore} label="Diese Datei wiederherstellen" onPress={() => restore(snapshot.stamp, file.path)} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <span className="text-[0.6875rem] text-ink-faint">Wiederhergestelltes landet in einem neuen Ordner unter Downloads und überschreibt nichts.</span>
    </UiPanel>
  );
}
