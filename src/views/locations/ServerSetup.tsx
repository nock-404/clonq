import { ArrowRight, Check, CircleCheck, CircleX, FolderPlus, Plus, RotateCw, ShieldCheck, Upload, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import type { HostKey, Location, ServerDraft, ServerInput } from "../../lib/types";
import { UiBadge, UiField, UiInput, UiNotice, UiPanel, UiText } from "../../ui";
import { UiCopyBlock } from "../../ui/UiCopyBlock";
import { UiCopyList } from "../../ui/UiCopyList";
import { UiLinkButton } from "../../ui/UiLinkButton";
import { nameTaken, sameServer } from "./duplicates";
import { errorText } from "./kinds";
import { ExistingNotice, NameField } from "./parts";
import { lampOf, useAdded, useSuggestedName, useTask, type Setup, type SetupAction, type SetupContext } from "./setup";

const STORAGE_BOX = ".your-storagebox.de";

/**
 * What the backend reports when ssh refuses the server's host key: one that is not
 * the pinned one, or none that clonq knows for this address.
 */
const HOST_KEY_CHANGED = "the server's host key changed; check it before trusting it again";

/** The base folder after adding: looked up on the server, and created there if the user wants. */
type FolderCheck = "none" | "checking" | "present" | "missing" | "creating" | "created";

/** The fingerprints of one reading as a single string, to tell two readings apart. */
const printsOf = (keys: HostKey[]) =>
  keys
    .map((key) => `${key.kind} ${key.fingerprint}`)
    .sort()
    .join("\n");

/** Moves the keyboard to the fingerprints when their step opens. Defined once, so React calls it only on mount. */
const focusOnMount = (node: HTMLElement | null) => {
  node?.focus({ preventScroll: true });
};

/**
 * A server over SSH. clonq makes a key of its own and reads the server's host
 * keys; the user compares their fingerprints with what the hoster publishes, and
 * clonq pins them before any password is sent. Then it puts its key on the server
 * with a single password login, tests a login with the key, and only then saves.
 * After saving it looks for the folder on the server and offers to create it.
 */
export function useServerSetup(context: SetupContext): Setup {
  const config = context.state.config;
  const [host, setHost] = useState("");
  const [customUser, setUser] = useState<string | null>(null);
  const [customPort, setPort] = useState<string | null>(null);
  const [basePath, setBasePath] = useState("");
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  // Once the key exists the address is shown as a summary; "Adresse ändern" opens it again.
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  // Host and port of the last reading that worked; the draft's host keys belong to it.
  const [readFor, setReadFor] = useState<string | null>(null);
  // Host and port whose host keys the backend holds, read but not yet pinned; pinning uses them up.
  const [scannedFor, setScannedFor] = useState<string | null>(null);
  // Host and port whose host keys the user confirmed; only another host or port needs a new check.
  const [trustedFor, setTrustedFor] = useState<string | null>(null);
  // The fingerprints first read, or last confirmed, at an address; a later reading that differs is pointed out.
  const [baseline, setBaseline] = useState<{ address: string; prints: string; confirmed: boolean } | null>(null);
  // Installing or testing met a host key other than the confirmed one.
  const [unrecognised, setUnrecognised] = useState(false);
  // What a step was done for; another address, user or port undoes it.
  const [installedFor, setInstalledFor] = useState<string | null>(null);
  const [tested, setTested] = useState<{ target: string; folder: string } | null>(null);
  const [created, setCreated] = useState<Location | null>(null);
  const [folder, setFolder] = useState<FolderCheck>("none");
  const keyTask = useTask();
  const trustTask = useTask();
  const installTask = useTask();
  const testTask = useTask();
  const addTask = useTask();
  const lookTask = useTask();
  const folderTask = useTask();
  const { added, done } = useAdded(context.onAdded);

  const cleanHost = host.trim().toLowerCase();
  const storageBox = cleanHost.endsWith(STORAGE_BOX);
  const user = customUser ?? (storageBox ? (cleanHost.split(".")[0] ?? "") : "");
  const port = customPort ?? (storageBox ? "23" : "22");
  const portNumber = Number(port);
  const portValid = /^\d+$/.test(port.trim()) && portNumber > 0 && portNumber < 65536;
  // A second Storage Box gets its user in the suggested name.
  const boxName = nameTaken(config, "Storage Box") && user.trim() ? `Storage Box ${user.trim()}` : "Storage Box";
  const { name, setName, edited } = useSuggestedName(created ? created.name : storageBox ? boxName : cleanHost);
  const cleanBase = basePath.trim().replace(/\/+$/, "");
  const target = `${user.trim()}@${cleanHost}:${portNumber}`;
  // The host keys belong to host and port; the user name plays no part in them.
  const address = `${cleanHost}:${portNumber}`;
  const trusted = draft !== null && trustedFor === address;
  const installed = installedFor === target;
  const testedFolder = tested?.target === target ? tested.folder : null;
  // The backend announces the new location before the call returns; it must not count as a duplicate.
  const existing = created || addTask.busy ? undefined : sameServer(config, cleanHost, user.trim(), portNumber);
  const taken = created || addTask.busy ? undefined : nameTaken(config, name);
  const addressReady = cleanHost !== "" && user.trim() !== "" && portValid && name.trim() !== "" && !taken && !existing;
  const busy = keyTask.busy || trustTask.busy || installTask.busy || testTask.busy || addTask.busy || lookTask.busy || folderTask.busy;

  // Only fingerprints of the address in the fields, from a reading that worked, are shown.
  const fresh = draft !== null && readFor === address && !unrecognised;
  const hostKeys: HostKey[] = fresh && draft ? draft.hostKeys : [];
  const noKeys = fresh && hostKeys.length === 0;
  const one = hostKeys.length === 1;
  const changed = hostKeys.length > 0 && baseline?.address === address && baseline.prints !== printsOf(hostKeys);
  // The backend still holds what it read for this address, so it can be pinned.
  const canConfirm = hostKeys.length > 0 && scannedFor === address;

  // Nothing goes to the server with a password or the key before its host keys are pinned.
  const server = (): ServerInput | null =>
    draft && trusted ? { locationId: draft.locationId, name: name.trim(), host: cleanHost, port: portNumber, user: user.trim(), basePath: cleanBase } : null;

  /** Makes the key on the first call; later calls keep it and read the host keys of the address again. */
  const readHostKeys = async (): Promise<boolean> => {
    trustTask.clear();
    setUnrecognised(false);
    const made = await keyTask.run(() => api.prepareServer(name.trim(), cleanHost, portNumber, draft?.locationId ?? null));
    if (!made) {
      // What was read before must not look current.
      setReadFor(null);
      setScannedFor(null);
      return false;
    }
    setDraft(made);
    setReadFor(address);
    setScannedFor(address);
    if (made.hostKeys.length > 0 && baseline?.address !== address) setBaseline({ address, prints: printsOf(made.hostKeys), confirmed: false });
    return true;
  };

  const next = async () => {
    if (!addressReady) return;
    // The key belongs to this location, not to an address: after "Adresse ändern" it is used again.
    // The host keys belong to the address: one that is confirmed, or read and waiting, is not read again.
    if (!draft || (trustedFor !== address && scannedFor !== address)) {
      if (!(await readHostKeys())) return;
    }
    setLocked(true);
  };

  const trust = async () => {
    if (!draft || !canConfirm) return;
    const confirmed = printsOf(hostKeys);
    const ok = await trustTask.run(async () => {
      await api.trustServer(draft.locationId);
      return true;
    });
    // The backend lets go of the keys it read, whether pinning worked or not.
    setScannedFor(null);
    if (!ok) return;
    setTrustedFor(address);
    setBaseline({ address, prints: confirmed, confirmed: true });
  };

  /** A login that meets another host key than the confirmed one leads back to the fingerprints instead of failing. */
  async function pinned<T>(call: () => Promise<T>): Promise<T | undefined> {
    try {
      return await call();
    } catch (problem) {
      if (errorText(problem) !== HOST_KEY_CHANGED) throw problem;
      setTrustedFor(null);
      setScannedFor(null);
      setUnrecognised(true);
      return undefined;
    }
  }

  const unlock = () => {
    setLocked(false);
    keyTask.clear();
    trustTask.clear();
    installTask.clear();
    testTask.clear();
  };

  const test = async () => {
    const input = server();
    if (!input) return;
    const home = await testTask.run(() => pinned(() => api.testServer(input)));
    if (home !== undefined) setTested({ target, folder: home });
  };

  const install = async () => {
    const input = server();
    if (!input || password === "") return;
    // The password is used for this one call and not kept, whatever the outcome.
    const secret = password;
    setPassword("");
    const ok = await installTask.run(() =>
      pinned(async () => {
        await api.installServerKey(input, secret);
        return true;
      }),
    );
    if (!ok) return;
    setInstalledFor(target);
    await test();
  };

  const submit = async () => {
    const input = server();
    if (!input || name.trim() === "" || taken) return;
    const location = await addTask.run(() => api.addServerLocation(input));
    if (!location) return;
    setCreated(location);
    if (cleanBase === "") {
      done(location);
      return;
    }
    setFolder("checking");
    const listed = await lookTask.run(() => api.listFolders(location.id, ""));
    if (listed !== undefined) {
      setFolder("present");
      done(location);
    } else {
      setFolder("missing");
    }
  };

  const createFolder = async () => {
    if (!created) return;
    setFolder("creating");
    const ok = await folderTask.run(async () => {
      await api.createFolder(created.id, "");
      return true;
    });
    if (ok) {
      setFolder("created");
      done(created);
    } else {
      setFolder("missing");
    }
  };

  const stage = created ? "saved" : !locked ? "address" : !trusted ? "trust" : testedFolder !== null ? "tested" : "key";
  const summary = (
    <AddressSummary
      login={`${user.trim()}@${cleanHost}`}
      port={portNumber}
      folder={cleanBase}
      onChange={stage === "saved" || busy ? undefined : unlock}
    />
  );
  const confirmWords = one ? "Fingerabdruck stimmt" : "Fingerabdrücke stimmen";
  const asking = "clonq fragt den Server nach seinen Fingerabdrücken. Das kann einige Sekunden dauern.";

  let body;
  if (stage === "address") {
    body = (
      <div className="flex flex-col gap-3.5">
        <UiField label="Adresse" hint={storageBox ? <StorageBoxHint /> : "Name oder IP-Adresse des Servers"}>
          <UiInput value={host} onChange={setHost} placeholder="z. B. u123456.your-storagebox.de" mono autoFocus disabled={busy} />
        </UiField>
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <UiField label="Benutzer">
            <UiInput value={user} onChange={setUser} placeholder="z. B. u123456" mono disabled={busy} />
          </UiField>
          <UiField label="Port" error={portValid ? null : "1 bis 65535"}>
            <UiInput value={port} onChange={setPort} mono disabled={busy} />
          </UiField>
        </div>
        <UiField label="Ordner auf dem Server" hint="Ohne Angabe verwendet clonq den Anmeldeordner.">
          <UiInput value={basePath} onChange={setBasePath} placeholder="z. B. backups" mono disabled={busy} />
        </UiField>
        <NameField value={name} onChange={setName} taken={taken} hint="So erscheint der Server in clonq." disabled={busy} />
        {existing ? (
          <ExistingNotice subject="Dieser Benutzer auf diesem Server" location={existing} onOpen={() => context.reveal(existing.id)} />
        ) : keyTask.error ? (
          <UiNotice tone="danger">{keyTask.error}</UiNotice>
        ) : (
          <UiText variant="caption" tone="neutral">
            {keyTask.busy
              ? asking
              : !draft
                ? "Mit „Weiter“ liest clonq die Fingerabdrücke des Servers und erzeugt einen eigenen Schlüssel für ihn."
                : trusted
                  ? "Die Fingerabdrücke dieses Servers sind schon bestätigt."
                  : scannedFor === address
                    ? "Die Fingerabdrücke dieses Servers sind gelesen, aber noch nicht bestätigt."
                    : "Mit „Weiter“ liest clonq die Fingerabdrücke des Servers."}
          </UiText>
        )}
      </div>
    );
  } else if (stage === "trust" && draft) {
    // A little tighter than the other steps, so that three fingerprints and the rules still fit without scrolling.
    body = (
      <div className="flex flex-col gap-3">
        {summary}
        <div className="flex flex-col gap-1.5">
          <div ref={focusOnMount} tabIndex={-1} className="outline-none">
            <UiText variant="label" tone="neutral">
              {one ? "Fingerabdruck des Servers" : "Fingerabdrücke des Servers"}
            </UiText>
          </div>
          {keyTask.busy ? (
            <div className="hairline rounded-[var(--radius-control)] bg-well px-3 py-2.5">
              <UiText variant="caption" tone="neutral">
                {asking}
              </UiText>
            </div>
          ) : keyTask.error ? (
            <UiNotice tone="danger">{keyTask.error}</UiNotice>
          ) : unrecognised ? (
            <UiNotice tone="danger">
              Der Server hat sich mit einem Schlüssel gemeldet, den clonq für diese Adresse nicht kennt. Vielleicht wurde er neu eingerichtet, vielleicht antwortet
              unter dieser Adresse ein fremder Rechner. Lies die Fingerabdrücke neu und vergleiche sie, bevor du weitermachst.
            </UiNotice>
          ) : noKeys ? (
            <UiNotice tone="danger">Der Server hat keinen Schlüssel genannt, den clonq lesen kann. Ohne Fingerabdruck lässt sich seine Echtheit nicht prüfen.</UiNotice>
          ) : (
            <UiCopyList
              label={one ? "Fingerabdruck des Servers" : "Fingerabdrücke des Servers"}
              items={hostKeys.map((key) => {
                const [prefix, value] = splitFingerprint(key.fingerprint);
                return { key: `${key.kind}-${key.fingerprint}`, label: key.kind, prefix, value };
              })}
            />
          )}
        </div>
        {hostKeys.length > 0 && !keyTask.busy ? (
          <div className="flex flex-col gap-2.5">
            {changed ? <UiNotice tone="warn">{changedSentence(baseline?.confirmed ?? false, one)}</UiNotice> : null}
            <UiText variant="body">{compareSentence(draft.storageBox, one)}</UiText>
            {/* After a failed attempt there is nothing to confirm until the fingerprints are read again; a changed
                reading carries its own advice in the warning above. */}
            {trustTask.error ? (
              <UiNotice tone="danger">{trustTask.error}</UiNotice>
            ) : changed ? null : (
              <>
                <Outcome icon={CircleCheck} tone="ok">
                  {one
                    ? "Stimmt er überein, bestätige. clonq merkt sich den Schlüssel und lehnt den Server ab, falls er sich ändert."
                    : "Stimmen alle überein, bestätige. clonq merkt sich die Schlüssel und lehnt den Server ab, falls sie sich ändern."}
                </Outcome>
                <Outcome icon={CircleX} tone="danger">
                  Weicht auch nur ein Zeichen ab, bestätige nicht und brich ab. Unter dieser Adresse antwortet dann vielleicht ein fremder Rechner.
                </Outcome>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  } else if (stage === "key" && draft) {
    body = (
      <div className="flex flex-col gap-3.5">
        {summary}
        <NameField value={name} onChange={setName} taken={taken} hint="So erscheint der Server in clonq." disabled={busy} />
        <div className="flex flex-col gap-1.5">
          <UiText variant="label" tone="neutral">
            Öffentlicher Schlüssel
          </UiText>
          <UiCopyBlock value={draft.publicKey} label="Öffentlicher Schlüssel" />
          <UiText variant="caption" tone="neutral">
            Diesen Schlüssel überträgt clonq im nächsten Schritt auf den Server.
          </UiText>
        </div>
        <UiField label={`Passwort für ${user.trim()}`} error={installTask.error} hint="Nur für diese eine Anmeldung. clonq speichert das Passwort nicht.">
          <UiInput value={password} onChange={setPassword} type="password" autoFocus disabled={busy} />
        </UiField>
        {testTask.error ? (
          <UiNotice tone="danger">{testTask.error}</UiNotice>
        ) : (
          <span className="flex">
            <UiLinkButton onPress={() => void test()} title="Testet sofort, ohne Passwort.">
              Schlüssel ist schon eingetragen – nur testen
            </UiLinkButton>
          </span>
        )}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3.5">
        {summary}
        <NameField value={name} onChange={setName} taken={taken} hint="So erscheint der Server in clonq." disabled={busy || stage === "saved"} />
        <UiPanel>
          <UiText variant="heading" tone="ok">
            Die Anmeldung funktioniert.
          </UiText>
          <UiText variant="caption" tone="neutral">
            Anmeldeordner ist {testedFolder || "/"}.
            {cleanBase && stage === "tested" ? ` Nach dem Hinzufügen prüft clonq, ob es den Ordner „${cleanBase}“ gibt.` : ""}
          </UiText>
        </UiPanel>
        {folder === "missing" ? (
          <UiNotice tone="warn">
            clonq konnte den Ordner „{cleanBase}“ auf dem Server nicht öffnen. Wenn es ihn noch nicht gibt, legt clonq ihn jetzt an.
            {folderTask.error ? <UiText variant="label" tone="danger">{folderTask.error}</UiText> : null}
          </UiNotice>
        ) : null}
        {addTask.error ? <UiNotice tone="danger">{addTask.error}</UiNotice> : null}
      </div>
    );
  }

  const lit = added !== null || (testedFolder !== null && !testTask.error);
  const plate = {
    name,
    lamp: busy ? ("busy" as const) : lit ? ("on" as const) : testTask.error || unrecognised ? ("fault" as const) : ("off" as const),
    threaded: testedFolder !== null || created !== null,
    steps: [
      // Echtheit: the fingerprints are read (blinking), wait for the user (outlined), and are confirmed (green).
      lampOf({
        done: trusted,
        busy: keyTask.busy || trustTask.busy,
        failed: !!keyTask.error || !!trustTask.error || unrecognised || noKeys,
        ready: stage === "trust" || (stage === "address" && addressReady),
      }),
      lampOf({ done: installed || testedFolder !== null, busy: installTask.busy, failed: !!installTask.error, ready: stage === "key" }),
      lampOf({ done: testedFolder !== null, busy: testTask.busy, failed: !!testTask.error, ready: installed }),
      lampOf({
        done: folder === "present" || folder === "created" || (added !== null && cleanBase === ""),
        busy: folder === "checking" || folder === "creating",
        failed: !!folderTask.error,
        ready: folder === "missing" || testedFolder !== null,
      }),
    ],
    // The status line is 13 rem wide: every text fits on one line, and a no-break space keeps "…" with its word.
    status: added
      ? "Hinzugefügt"
      : keyTask.busy
        ? "Fingerabdrücke werden gelesen …"
        : trustTask.busy
          ? "Bestätigung wird gespeichert …"
          : installTask.busy
            ? "Schlüssel wird hinterlegt …"
            : testTask.busy
              ? "Verbindung wird getestet …"
              : addTask.busy
                ? "Wird hinzugefügt …"
                : folder === "checking"
                  ? "Ordner wird geprüft …"
                  : folder === "creating"
                    ? "Ordner wird angelegt …"
                    : folder === "missing"
                      ? "Angelegt, Ordner nicht gefunden"
                      : keyTask.error
                        ? "Server nicht erreicht"
                        : unrecognised
                          ? "Server nicht wiedererkannt"
                          : noKeys
                            ? "Kein lesbarer Schlüssel"
                            : trustTask.error
                              ? "Bestätigung nicht gespeichert"
                              : testTask.error
                                ? "Anmeldung fehlgeschlagen"
                                : installTask.error
                                  ? "Schlüssel nicht hinterlegt"
                                  : testedFolder !== null
                                    ? "Verbunden"
                                    : stage === "trust"
                                      ? changed
                                        ? "Abweichende Fingerabdrücke"
                                        : "Echtheit noch nicht bestätigt"
                                      : stage === "key"
                                        ? "Schlüssel bereit, noch nicht hinterlegt"
                                        : "Nicht verbunden",
    tone:
      added || (testedFolder !== null && !busy && folder !== "missing")
        ? ("ok" as const)
        : keyTask.error || trustTask.error || testTask.error || installTask.error || unrecognised || noKeys
          ? ("danger" as const)
          : stage === "trust" && changed
            ? ("warn" as const)
            : ("neutral" as const),
  };

  let action: SetupAction;
  let secondary: Setup["secondary"];
  if (added) {
    action = { label: "Hinzugefügt", icon: Check, run: () => {}, disabled: true };
  } else if (stage === "address") {
    action = { label: keyTask.busy ? "Wird gelesen …" : "Weiter", icon: keyTask.busy ? undefined : ArrowRight, run: () => void next(), disabled: busy || !addressReady };
  } else if (stage === "trust") {
    // Pinning uses up what was read; after a failed attempt, a failed reading or a refused login the fingerprints are read again.
    action =
      canConfirm && !keyTask.busy
        ? {
            label: trustTask.busy ? "Wird gespeichert …" : confirmWords,
            icon: trustTask.busy ? undefined : ShieldCheck,
            run: () => void trust(),
            disabled: busy,
            // A habitual Enter must not stand in for comparing; the button takes a click or ⌘↵.
            enter: false,
          }
        : {
            label: keyTask.busy ? "Wird gelesen …" : one ? "Fingerabdruck neu lesen" : "Fingerabdrücke neu lesen",
            icon: keyTask.busy ? undefined : RotateCw,
            run: () => void readHostKeys(),
            disabled: busy,
          };
  } else if (stage === "key") {
    action =
      installed && testTask.error
        ? { label: testTask.busy ? "Verbindung wird getestet …" : "Erneut testen", icon: testTask.busy ? undefined : RotateCw, run: () => void test(), disabled: busy }
        : {
            label: installTask.busy ? "Schlüssel wird hinterlegt …" : testTask.busy ? "Verbindung wird getestet …" : "Schlüssel hinterlegen",
            icon: busy ? undefined : Upload,
            run: () => void install(),
            disabled: busy || password === "",
          };
  } else if (stage === "tested") {
    action = { label: addTask.busy ? "Wird hinzugefügt …" : "Hinzufügen", icon: addTask.busy ? undefined : Plus, run: () => void submit(), disabled: busy || name.trim() === "" || !!taken };
  } else if (folder === "missing") {
    action = { label: "Ordner anlegen", icon: FolderPlus, run: () => void createFolder(), disabled: busy };
    secondary = { label: "Ohne Ordner abschließen", run: () => created && done(created), disabled: busy };
  } else {
    action = { label: folder === "creating" ? "Ordner wird angelegt …" : "Ordner wird geprüft …", run: () => {}, disabled: true };
  }

  return {
    body,
    action,
    secondary,
    plate,
    dirty: host.trim() !== "" || basePath.trim() !== "" || edited || customUser !== null || customPort !== null,
    busy,
    // Escape leads from the fingerprints, or from key and password, back to the address.
    back: (stage === "trust" || stage === "key") && !busy ? unlock : undefined,
    final: created !== null,
    discardNote: draft && !created ? "Der schon erzeugte Schlüssel bleibt ungenutzt in clonq liegen." : undefined,
  };
}

/** "SHA256:abc…" → ["SHA256:", "abc…"]; the hash name is shown quieter than the value. */
function splitFingerprint(fingerprint: string): [string | undefined, string] {
  const colon = fingerprint.indexOf(":");
  return colon > 0 && colon < 8 ? [fingerprint.slice(0, colon + 1), fingerprint.slice(colon + 1)] : [undefined, fingerprint];
}

/**
 * What to compare with, and where the user finds it: Hetzner's documentation, or whoever runs the server.
 * "Zeichen für Zeichen" is left to the rule below it, so that three fingerprints still fit without scrolling.
 */
function compareSentence(storageBox: boolean, one: boolean): ReactNode {
  const which = one ? "den Fingerabdruck" : "jeden Fingerabdruck";
  if (!storageBox) return `Vergleiche ${which} mit den Angaben des Anbieters oder Verwalters des Servers.`;
  return (
    <>
      Vergleiche {which} mit Hetzners Dokumentation: Seite „Storage Box Überblick“, Abschnitt{" "}
      {/* The section name stays on one line, so it is not split at a hyphen. */}
      <span className="whitespace-nowrap">„SSH-Host-Keys“.</span>
    </>
  );
}

/** A new reading at the same address that differs from the one before, with what to do about it; three lines at most. */
function changedSentence(confirmed: boolean, one: boolean): string {
  const stranger = "brich ab, denn dann antwortet vielleicht ein fremder Rechner.";
  if (confirmed) {
    return one
      ? `Dieser Fingerabdruck weicht vom bestätigten ab. Bestätige nur, wenn du den Grund kennst, etwa eine Neuinstallation. Sonst ${stranger}`
      : `Diese Fingerabdrücke weichen von den bestätigten ab. Bestätige nur, wenn du den Grund kennst, etwa eine Neuinstallation. Sonst ${stranger}`;
  }
  return one
    ? `Dieser Fingerabdruck weicht von dem ab, den clonq vorhin gelesen hat. Vergleiche ihn erneut. Weicht ein Zeichen ab, ${stranger}`
    : `Diese Fingerabdrücke weichen von denen ab, die clonq vorhin gelesen hat. Vergleiche sie erneut. Weicht ein Zeichen ab, ${stranger}`;
}

/** One possible result of comparing, with what to do then. */
function Outcome({ icon: Icon, tone, children }: { icon: LucideIcon; tone: "ok" | "danger"; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${tone === "ok" ? "text-ok" : "text-danger"}`} strokeWidth={2.2} aria-hidden />
      <UiText variant="caption" tone="neutral">
        {children}
      </UiText>
    </div>
  );
}

interface AddressSummaryProps {
  login: string;
  port: number;
  folder: string;
  /** Opens the address fields again; left out while that is not possible. */
  onChange?: () => void;
}

/** The address as one line once the key exists, with a way back to the fields. */
function AddressSummary({ login, port, folder, onChange }: AddressSummaryProps) {
  return (
    <div className="hairline flex items-center gap-3 rounded-[var(--radius-control)] bg-well py-2 pr-2 pl-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <UiText variant="mono" truncate>
          {login}
        </UiText>
        <UiText variant="caption" tone="neutral">
          Port {port} · {folder ? `Ordner ${folder}` : "Anmeldeordner"}
        </UiText>
      </div>
      {onChange ? <UiLinkButton onPress={onChange}>Adresse ändern</UiLinkButton> : null}
    </div>
  );
}

function StorageBoxHint() {
  return (
    <span className="flex items-center gap-1.5">
      <UiBadge tone="accent">Hetzner Storage Box</UiBadge>
      Port 23 und Benutzer sind vorbelegt.
    </span>
  );
}
