import { Check, Plug } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { UiField, UiInput, UiNotice, UiText } from "../../ui";
import { nameTaken, sameShare } from "./duplicates";
import { ExistingNotice, NameField } from "./parts";
import { lampOf, useAdded, useSuggestedName, useTask, type Setup, type SetupContext } from "./setup";

const SHARE = /^smb:\/\/([^/\s]+)\/([^/\s][^\s]*)$/i;

/**
 * A network share. The backend puts the password into the macOS keychain and
 * mounts the share once; only when that works is the location saved.
 */
export function useSmbSetup(context: SetupContext): Setup {
  const config = context.state.config;
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const add = useTask();
  const { added, done } = useAdded(context.onAdded);

  const cleanUrl = url.trim().replace(/\/+$/, "");
  const match = cleanUrl.match(SHARE);
  const share = match?.[2]?.split("/").at(-1) ?? "";
  const { name, setName, edited } = useSuggestedName(share || (match?.[1] ?? ""));
  const valid = match !== null;
  const existing = add.busy || added || !valid ? undefined : sameShare(config, cleanUrl);
  const taken = add.busy || added ? undefined : nameTaken(config, name);
  const ready = valid && !existing && !taken && name.trim() !== "" && user.trim() !== "" && password !== "";

  const submit = async () => {
    if (!ready) return;
    // Kept until the share is connected, so a typo elsewhere does not mean typing it again.
    const location = await add.run(() => api.addSmbLocation(name.trim(), cleanUrl, user.trim(), password));
    if (location) {
      setPassword("");
      done(location);
    }
  };

  const locked = add.busy || !!added;
  const body = (
    <div className="flex flex-col gap-3.5">
      <UiField
        label="Adresse der Freigabe"
        error={url.trim() !== "" && !valid ? "Die Adresse hat die Form smb://server/freigabe." : null}
        hint="Dieselbe Adresse, die der Finder unter „Gehe zu“ › „Mit Server verbinden …“ erwartet."
      >
        <UiInput value={url} onChange={setUrl} placeholder="z. B. smb://nas.local/Fotos" mono autoFocus disabled={locked} />
      </UiField>
      <div className="grid grid-cols-2 gap-3">
        <UiField label="Benutzer">
          <UiInput value={user} onChange={setUser} placeholder="Benutzername" disabled={locked} />
        </UiField>
        <UiField label="Passwort" hint="Liegt danach im Schlüsselbund.">
          <UiInput value={password} onChange={setPassword} type="password" disabled={locked} />
        </UiField>
      </div>
      <NameField value={name} onChange={setName} taken={taken} hint="So erscheint die Freigabe in clonq." disabled={locked} />
      {existing ? <ExistingNotice subject="Diese Freigabe" location={existing} onOpen={() => context.reveal(existing.id)} /> : null}
      {add.error ? (
        <UiNotice tone="danger">{add.error}</UiNotice>
      ) : (
        <UiText variant="caption" tone="neutral">
          clonq hängt die Freigabe zur Probe ein und legt den Ort erst an, wenn das gelingt.
        </UiText>
      )}
    </div>
  );

  const plate = {
    name,
    lamp: added ? ("on" as const) : add.busy ? ("busy" as const) : add.error ? ("fault" as const) : ("off" as const),
    threaded: added !== null,
    steps: [
      lampOf({ done: valid, ready: true }),
      lampOf({ done: !!added, busy: add.busy, failed: !!add.error, ready }),
      lampOf({ done: !!added, ready: false }),
    ],
    status: added
      ? "Hinzugefügt"
      : add.busy
        ? "Freigabe wird eingehängt …"
        : add.error
          ? "Die Freigabe ließ sich nicht einhängen"
          : existing
            ? "Schon als Ort angelegt"
            : ready
              ? "Bereit zum Verbinden"
              : "Nicht verbunden",
    tone: added ? ("ok" as const) : add.error ? ("danger" as const) : ("neutral" as const),
  };

  const base = { body, plate, dirty: url.trim() !== "" || user.trim() !== "" || password !== "" || edited, busy: add.busy };
  if (added) return { ...base, final: true, action: { label: "Hinzugefügt", icon: Check, run: () => {}, disabled: true } };
  return {
    ...base,
    action: {
      label: add.busy ? "Freigabe wird eingehängt …" : "Verbinden und hinzufügen",
      icon: add.busy ? undefined : Plug,
      run: () => void submit(),
      disabled: add.busy || !ready,
    },
  };
}
