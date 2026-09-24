import { Check, Plug } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
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
  const t = useT();
  const ts = t.locations.smb;
  const tw = t.locations.flow;
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
        label={ts.address}
        error={url.trim() !== "" && !valid ? ts.addressError : null}
        hint={ts.addressHint}
      >
        <UiInput value={url} onChange={setUrl} placeholder={ts.addressPlaceholder} mono autoFocus disabled={locked} />
      </UiField>
      <div className="grid grid-cols-2 gap-3">
        <UiField label={tw.user}>
          <UiInput value={user} onChange={setUser} placeholder={ts.userPlaceholder} disabled={locked} />
        </UiField>
        <UiField label={tw.password} hint={ts.passwordHint}>
          <UiInput value={password} onChange={setPassword} type="password" disabled={locked} />
        </UiField>
      </div>
      <NameField value={name} onChange={setName} taken={taken} hint={ts.nameHint} disabled={locked} />
      {existing ? <ExistingNotice subject={ts.subject} location={existing} onOpen={() => context.reveal(existing.id)} /> : null}
      {add.error ? (
        <UiNotice tone="danger">{add.error}</UiNotice>
      ) : (
        <UiText variant="caption" tone="neutral">
          {ts.trial}
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
      ? tw.added
      : add.busy
        ? ts.mounting
        : add.error
          ? ts.mountFailed
          : existing
            ? tw.alreadyAdded
            : ready
              ? tw.readyToConnect
              : tw.notConnected,
    tone: added ? ("ok" as const) : add.error ? ("danger" as const) : ("neutral" as const),
  };

  const base = { body, plate, dirty: url.trim() !== "" || user.trim() !== "" || password !== "" || edited, busy: add.busy };
  if (added) return { ...base, final: true, action: { label: tw.added, icon: Check, run: () => {}, disabled: true } };
  return {
    ...base,
    action: {
      label: add.busy ? ts.mounting : tw.connectAndAdd,
      icon: add.busy ? undefined : Plug,
      run: () => void submit(),
      disabled: add.busy || !ready,
    },
  };
}
