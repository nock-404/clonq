import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Check, FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import { api } from "../../lib/api";
import { UiButton, UiNotice } from "../../ui";
import { UiPathField } from "../../ui/UiPathField";
import { nameTaken, sameFolder } from "./duplicates";
import { folderName, tidyPath } from "./kinds";
import { ExistingNotice, NameField } from "./parts";
import { lampOf, useAdded, useSuggestedName, useTask, type Setup, type SetupContext } from "./setup";

/** A folder on the Mac: chosen in the macOS folder dialog, named after itself. */
export function useFolderSetup(context: SetupContext): Setup {
  const t = useT();
  const tf = t.locations.folder;
  const tw = t.locations.flow;
  const config = context.state.config;
  const [path, setPath] = useState<string | null>(null);
  const { name, setName, edited } = useSuggestedName(path ? folderName(path) : "");
  const pick = useTask();
  const add = useTask();
  const { added, done } = useAdded(context.onAdded);

  const external = path !== null && (path === "/Volumes" || path.startsWith("/Volumes/"));
  // The backend announces the new location before the call returns; it must not count as a duplicate.
  const existing = path !== null && !add.busy && !added ? sameFolder(config, path) : undefined;
  const taken = add.busy || added ? undefined : nameTaken(config, name);
  const blocked = external || existing !== undefined || taken !== undefined || name.trim() === "";

  const choose = async () => {
    const chosen = await pick.run(() => open({ directory: true, title: tf.dialogTitle, defaultPath: path ?? undefined }));
    if (typeof chosen === "string") {
      setPath(chosen);
      add.clear();
    }
  };

  const submit = async () => {
    if (!path || blocked) return;
    const location = await add.run(() => api.addFolderLocation(name.trim(), path));
    if (location) done(location);
  };

  const error = pick.error ?? add.error;
  const body = (
    <div className="flex flex-col gap-4">
      <UiPathField
        label={tf.label}
        path={path ? tidyPath(path) : null}
        placeholder={tf.none}
        action={path && !added ? { label: tf.other, onPress: () => void choose(), disabled: pick.busy || add.busy } : undefined}
        hint={path ? undefined : tf.hint}
      />
      {external ? (
        <UiNotice
          tone="warn"
          actions={
            <UiButton variant="secondary" icon={ArrowRight} onPress={() => context.switchKind("volume")}>
              {tf.addDrive}
            </UiButton>
          }
        >
          {tf.external}
        </UiNotice>
      ) : null}
      {existing && !added ? <ExistingNotice subject={tf.subject} location={existing} onOpen={() => context.reveal(existing.id)} /> : null}
      {path && !external && !existing ? (
        <NameField value={name} onChange={setName} taken={taken} hint={tf.nameHint} disabled={add.busy || !!added} />
      ) : null}
      {error ? <UiNotice tone="danger">{error}</UiNotice> : null}
    </div>
  );

  const plate = {
    name: path ? name : "",
    lamp: added ? ("on" as const) : add.busy ? ("busy" as const) : ("off" as const),
    threaded: added !== null,
    steps: [lampOf({ done: path !== null && !external, ready: true }), lampOf({ done: !!added, busy: add.busy, failed: !!add.error, ready: !!path && !blocked })],
    status: added
      ? tw.added
      : add.busy
        ? tw.adding
        : add.error
          ? tw.notAdded
          : !path
            ? tf.none
            : external
              ? tf.onExternal
              : existing
                ? tw.alreadyAdded
                : taken
                  ? tw.nameTaken
                  : name.trim() === ""
                    ? tw.nameMissing
                    : tw.readyToAdd,
    tone: added ? ("ok" as const) : add.error ? ("danger" as const) : ("neutral" as const),
  };

  const base = { body, plate, dirty: path !== null || edited, busy: pick.busy || add.busy };
  if (added) return { ...base, final: true, action: { label: tw.added, icon: Check, run: () => {}, disabled: true } };
  if (!path) return { ...base, action: { label: tf.choose, icon: FolderOpen, run: () => void choose(), disabled: pick.busy } };
  return {
    ...base,
    action: { label: add.busy ? tw.adding : tw.add, icon: add.busy ? undefined : Plus, run: () => void submit(), disabled: add.busy || blocked },
  };
}
