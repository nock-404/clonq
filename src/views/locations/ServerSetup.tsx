import { ArrowRight, Check, FolderPlus, Plus, RotateCw, Upload } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import type { Location, ServerDraft, ServerInput } from "../../lib/types";
import { UiBadge, UiField, UiInput, UiNotice, UiPanel, UiText } from "../../ui";
import { UiCopyBlock } from "../../ui/UiCopyBlock";
import { UiLinkButton } from "../../ui/UiLinkButton";
import { nameTaken, sameServer } from "./duplicates";
import { ExistingNotice, NameField } from "./parts";
import { lampOf, useAdded, useSuggestedName, useTask, type Setup, type SetupAction, type SetupContext } from "./setup";

const STORAGE_BOX = ".your-storagebox.de";

/** The base folder after adding: looked up on the server, and created there if the user wants. */
type FolderCheck = "none" | "checking" | "present" | "missing" | "creating" | "created";

/**
 * A server over SSH. clonq makes a key of its own, puts it on the server with a
 * single password login, tests a login with the key, and only then saves. After
 * saving it looks for the folder on the server and offers to create it.
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
  // What a step was done for; another address, user or port undoes it.
  const [installedFor, setInstalledFor] = useState<string | null>(null);
  const [tested, setTested] = useState<{ target: string; folder: string } | null>(null);
  const [created, setCreated] = useState<Location | null>(null);
  const [folder, setFolder] = useState<FolderCheck>("none");
  const keyTask = useTask();
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
  const installed = installedFor === target;
  const testedFolder = tested?.target === target ? tested.folder : null;
  // The backend announces the new location before the call returns; it must not count as a duplicate.
  const existing = created || addTask.busy ? undefined : sameServer(config, cleanHost, user.trim(), portNumber);
  const taken = created || addTask.busy ? undefined : nameTaken(config, name);
  const addressReady = cleanHost !== "" && user.trim() !== "" && portValid && name.trim() !== "" && !taken && !existing;
  const busy = keyTask.busy || installTask.busy || testTask.busy || addTask.busy || lookTask.busy || folderTask.busy;

  const server = (): ServerInput | null =>
    draft ? { locationId: draft.locationId, name: name.trim(), host: cleanHost, port: portNumber, user: user.trim(), basePath: cleanBase } : null;

  const next = async () => {
    if (!addressReady) return;
    // The key belongs to this location, not to an address: after "Adresse ändern" it is used again.
    if (!draft) {
      const made = await keyTask.run(() => api.prepareServer(name.trim(), cleanHost));
      if (!made) return;
      setDraft(made);
    }
    setLocked(true);
  };

  const unlock = () => {
    setLocked(false);
    installTask.clear();
    testTask.clear();
  };

  const test = async () => {
    const input = server();
    if (!input) return;
    const home = await testTask.run(() => api.testServer(input));
    if (home !== undefined) setTested({ target, folder: home });
  };

  const install = async () => {
    const input = server();
    if (!input || password === "") return;
    // The password is used for this one call and not kept, whatever the outcome.
    const secret = password;
    setPassword("");
    const ok = await installTask.run(async () => {
      await api.installServerKey(input, secret);
      return true;
    });
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

  const stage = created ? "saved" : !locked ? "address" : testedFolder !== null ? "tested" : "key";

  const summary = (
    <AddressSummary
      login={`${user.trim()}@${cleanHost}`}
      port={portNumber}
      folder={cleanBase}
      onChange={stage === "saved" || busy ? undefined : unlock}
    />
  );

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
            Mit „Weiter“ erzeugt clonq einen eigenen Schlüssel für diesen Server.
          </UiText>
        )}
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
    lamp: busy ? ("busy" as const) : lit ? ("on" as const) : testTask.error ? ("fault" as const) : ("off" as const),
    threaded: testedFolder !== null || created !== null,
    steps: [
      lampOf({ done: draft !== null, busy: keyTask.busy, failed: !!keyTask.error, ready: addressReady }),
      lampOf({ done: installed || testedFolder !== null, busy: installTask.busy, failed: !!installTask.error, ready: locked && draft !== null }),
      lampOf({ done: testedFolder !== null, busy: testTask.busy, failed: !!testTask.error, ready: installed }),
      lampOf({
        done: folder === "present" || folder === "created" || (added !== null && cleanBase === ""),
        busy: folder === "checking" || folder === "creating",
        failed: !!folderTask.error,
        ready: folder === "missing" || testedFolder !== null,
      }),
    ],
    status: added
      ? "Hinzugefügt"
      : keyTask.busy
        ? "Schlüssel wird erzeugt …"
        : installTask.busy
          ? "Schlüssel wird hinterlegt …"
          : testTask.busy
            ? "Verbindung wird getestet …"
            : addTask.busy
              ? "Wird hinzugefügt …"
              : folder === "checking"
                ? "Ordner wird geprüft …"
                : folder === "creating"
                  ? "Ordner wird angelegt …"
                  : folder === "missing"
                    ? "Angelegt, Ordner nicht gefunden"
                    : testTask.error
                      ? "Anmeldung fehlgeschlagen"
                      : installTask.error
                        ? "Schlüssel nicht hinterlegt"
                        : testedFolder !== null
                          ? "Verbunden"
                          : draft && locked
                            ? "Schlüssel bereit, noch nicht hinterlegt"
                            : "Nicht verbunden",
    tone: added || (testedFolder !== null && !busy && folder !== "missing") ? ("ok" as const) : testTask.error || installTask.error ? ("danger" as const) : ("neutral" as const),
  };

  let action: SetupAction;
  let secondary: Setup["secondary"];
  if (added) {
    action = { label: "Hinzugefügt", icon: Check, run: () => {}, disabled: true };
  } else if (stage === "address") {
    action = { label: keyTask.busy ? "Schlüssel wird erzeugt …" : "Weiter", icon: keyTask.busy ? undefined : ArrowRight, run: () => void next(), disabled: busy || !addressReady };
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
    final: created !== null,
    discardNote: draft && !created ? "Der schon erzeugte Schlüssel bleibt ungenutzt in clonq liegen." : undefined,
  };
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
