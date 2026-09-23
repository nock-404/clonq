import { open } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FolderSearch, Plug, RotateCw, Upload } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { refreshLocations, type ClonqState } from "../../hooks/useClonq";
import { api } from "../../lib/api";
import { navigate } from "../../lib/nav";
import type { CloudProviderInfo, Location, LocationKind, Reach } from "../../lib/types";
import { UiButton, UiField, UiInput, UiNotice, UiProgressBar, UiText } from "../../ui";
import { UiCopyBlock } from "../../ui/UiCopyBlock";
import { markChecked } from "./checks";
import { CloudFields } from "./CloudFields";
import { formatClock, SIGN_IN_SECONDS, useSeconds } from "./CloudSetup";
import { providerLabel, tidyPath } from "./kinds";
import { blockersOf, jobsUsing, moveJobsAndRemove } from "./replace";
import { useTask } from "./setup";

type Kind<T extends LocationKind["type"]> = Extract<LocationKind, { type: T }>;

interface LocationRepairProps {
  state: ClonqState;
  location: Location;
  reach: Reach | undefined;
  /** A repair in place worked; the drive front lays the tape in again. */
  onRepaired: () => void;
}

/** What can be done about a location that does not work: shown under its state, only when it applies. */
export function LocationRepair({ state, location, reach, onRepaired }: LocationRepairProps) {
  const kind = location.kind;
  if (kind.type === "ssh" && reach?.state === "failed") return <KeyRepair location={location} kind={kind} onRepaired={onRepaired} />;
  if (kind.type === "folder" && reach?.state === "missing") return <FolderRepair state={state} location={location} kind={kind} />;
  if (kind.type === "cloud" && reach?.state === "failed") return <CloudRepair state={state} location={location} kind={kind} />;
  return null;
}

function RepairBlock({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="hairline-t flex flex-col gap-2.5 pt-3">
      {title ? <UiText variant="label">{title}</UiText> : null}
      {children}
    </div>
  );
}

/** "Die 2 Jobs mit diesem Ort werden auf … umgestellt." */
function movingSentence(count: number, onto: string): string {
  if (count === 0) return `Der Ort zeigt danach auf ${onto}.`;
  if (count === 1) return `Der Job mit diesem Ort wird auf ${onto} umgestellt.`;
  return `Die ${count} Jobs mit diesem Ort werden auf ${onto} umgestellt.`;
}

/** Saving a job checks both of its places; a place that is not reachable holds the move up. */
function BlockerNote({ blockers }: { blockers: Location[] }) {
  if (blockers.length === 0) return null;
  const names = blockers.map((item) => `„${item.name}“`).join(", ");
  return (
    <UiText variant="caption" tone="warn">
      Das geht erst, wenn {names} wieder erreichbar {blockers.length === 1 ? "ist" : "sind"}: Beim Umstellen prüft clonq beide Orte jedes Jobs.
    </UiText>
  );
}

/** A server that refuses the key: put the key on it again with the password, or by hand. */
function KeyRepair({ location, kind, onRepaired }: { location: Location; kind: Kind<"ssh">; onRepaired: () => void }) {
  const [password, setPassword] = useState("");
  const task = useTask();

  const run = async () => {
    if (password === "") return;
    // The password is used for this one call and not kept.
    const secret = password;
    setPassword("");
    const status = await task.run(async () => {
      await api.installServerKey(
        { locationId: location.id, name: location.name, host: kind.host, port: kind.port, user: kind.user, basePath: kind.basePath },
        secret,
      );
      return api.testLocation(location.id);
    });
    if (!status) return;
    markChecked(location.id);
    await refreshLocations();
    if (status.reach.state === "connected") onRepaired();
  };

  return (
    <RepairBlock title="Schlüssel erneut hinterlegen">
      <UiText variant="caption" tone="neutral">
        Wurde der Schlüssel auf dem Server entfernt, trägt clonq ihn mit dem Passwort neu ein und testet die Anmeldung. Das Passwort wird nicht gespeichert.
      </UiText>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <UiField label={`Passwort für ${kind.user}`} error={task.error}>
            <UiInput
              value={password}
              onChange={setPassword}
              type="password"
              disabled={task.busy}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  void run();
                }
              }}
            />
          </UiField>
        </div>
        <UiButton icon={task.busy ? undefined : Upload} disabled={task.busy || password === ""} onPress={() => void run()}>
          {task.busy ? "Schlüssel wird hinterlegt …" : "Hinterlegen"}
        </UiButton>
      </div>
      <UiText variant="caption" tone="neutral">
        Zum Eintragen von Hand liegt der öffentliche Schlüssel in dieser Datei:
      </UiText>
      <UiCopyBlock value={tidyPath(`${kind.identityFile}.pub`)} label="Datei mit dem öffentlichen Schlüssel" />
    </RepairBlock>
  );
}

/** A folder that was moved or renamed: pick it again; the jobs move with it. */
function FolderRepair({ state, location, kind }: { state: ClonqState; location: Location; kind: Kind<"folder"> }) {
  const task = useTask();
  const [replacement, setReplacement] = useState<Location | null>(null);
  const blockers = blockersOf(state, location.id);
  const count = jobsUsing(state, location.id).length;

  const run = async () => {
    let next = replacement;
    if (!next) {
      const parent = kind.path.replace(/\/[^/]+\/?$/, "") || "/";
      const chosen = await task.run(() => open({ directory: true, title: `Neuer Ordner für „${location.name}“`, defaultPath: parent }));
      if (typeof chosen !== "string") return;
      next = (await task.run(() => api.addFolderLocation(location.name, chosen))) ?? null;
      if (!next) return;
      setReplacement(next);
    }
    const target = next;
    const moved = await task.run(async () => {
      await moveJobsAndRemove(state, location.id, target.id);
      return true;
    });
    if (moved) navigate({ kind: "location", locationId: target.id });
  };

  return (
    <RepairBlock>
      <UiText variant="caption" tone="neutral">
        {movingSentence(count, "den neuen Ordner")}
      </UiText>
      <BlockerNote blockers={blockers} />
      <span className="flex">
        <UiButton icon={task.busy ? undefined : replacement ? RotateCw : FolderSearch} disabled={task.busy || blockers.length > 0} onPress={() => void run()}>
          {task.busy ? "Wird umgestellt …" : replacement ? "Umstellen erneut versuchen" : "Ordner neu wählen …"}
        </UiButton>
      </span>
      {task.error ? <UiNotice tone="danger">{task.error}</UiNotice> : null}
    </RepairBlock>
  );
}

/**
 * A cloud location whose access stopped working: sign in again (browser providers)
 * or enter new keys. clonq adds a fresh connection, moves the jobs, and removes the old one.
 */
function CloudRepair({ state, location, kind }: { state: ClonqState; location: Location; kind: Kind<"cloud"> }) {
  const [provider, setProvider] = useState<CloudProviderInfo | null>(null);
  const load = useTask();
  const task = useTask();
  const [values, setValues] = useState<Record<string, string>>({});
  const [root, setRoot] = useState(kind.root);
  const [replacement, setReplacement] = useState<Location | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const blockers = blockersOf(state, location.id);
  const count = jobsUsing(state, location.id).length;
  const label = providerLabel[kind.provider];

  const fetchProvider = () =>
    void load.run(api.cloudProviders).then((list) => {
      const found = list?.find((item) => item.id === kind.provider);
      if (found) setProvider(found);
    });

  useEffect(() => {
    fetchProvider();
  }, [kind.provider]);

  const waiting = task.busy && waitingSince !== null;
  const now = useSeconds(waiting);
  const left = waitingSince === null ? SIGN_IN_SECONDS : Math.min(SIGN_IN_SECONDS, SIGN_IN_SECONDS - (now - waitingSince) / 1000);
  const missing = (provider?.fields ?? []).some((field) => field.required && (values[field.key] ?? "").trim() === "");

  const run = async () => {
    if (!provider) return;
    let next = replacement;
    if (!next) {
      const fields = Object.fromEntries(provider.fields.map((field) => [field.key, (values[field.key] ?? "").trim()]));
      const started = Date.now();
      setWaitingSince(provider.browserLogin ? started : null);
      next = (await task.run(() => api.addCloudLocation(location.name, kind.provider, fields, root.trim()))) ?? null;
      setWaitingSince((current) => (current === started ? null : current));
      if (!next) return;
      setReplacement(next);
    }
    const target = next;
    const moved = await task.run(async () => {
      await moveJobsAndRemove(state, location.id, target.id);
      return true;
    });
    if (moved) navigate({ kind: "location", locationId: target.id });
  };

  const abandon = () => {
    task.cancel();
    setWaitingSince(null);
  };

  if (load.error) {
    return (
      <RepairBlock title="Zugang erneuern">
        <UiNotice
          tone="danger"
          actions={
            <UiButton icon={RotateCw} onPress={fetchProvider} disabled={load.busy}>
              Erneut laden
            </UiButton>
          }
        >
          Die Angaben zu {label} ließen sich nicht laden. {load.error}
        </UiNotice>
      </RepairBlock>
    );
  }
  if (!provider) return null;

  const browser = provider.browserLogin;
  return (
    <RepairBlock title={browser ? "Neu anmelden" : "Zugang erneuern"}>
      <UiText variant="caption" tone="neutral">
        {browser ? `Ist die Anmeldung bei ${label} abgelaufen, meldest du dich im Browser neu an.` : "Stimmen die Zugangsdaten nicht mehr, gib sie hier neu ein."}{" "}
        {movingSentence(count, "den neuen Zugang")}
      </UiText>
      <BlockerNote blockers={blockers} />
      {waiting ? (
        <div className="flex flex-col gap-1.5">
          <UiProgressBar value={(left / SIGN_IN_SECONDS) * 100} />
          <UiText variant="caption" tone="neutral">
            Im Browser ist die Anmeldeseite von {label} geöffnet. Die Anmeldung muss in den nächsten {formatClock(left)} Minuten abgeschlossen sein.
          </UiText>
        </div>
      ) : !browser && !replacement ? (
        <CloudFields
          provider={provider}
          values={values}
          onValue={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          root={root}
          onRoot={setRoot}
          disabled={task.busy}
        />
      ) : null}
      <span className="flex gap-2">
        {waiting ? (
          <UiButton variant="ghost" onPress={abandon}>
            Abbrechen
          </UiButton>
        ) : (
          <UiButton
            icon={task.busy ? undefined : replacement ? RotateCw : browser ? ExternalLink : Plug}
            disabled={task.busy || blockers.length > 0 || (!browser && !replacement && missing)}
            onPress={() => void run()}
          >
            {task.busy ? "Zugang wird geprüft …" : replacement ? "Umstellen erneut versuchen" : browser ? "Im Browser anmelden" : "Verbinden und umstellen"}
          </UiButton>
        )}
      </span>
      {task.error ? <UiNotice tone="danger">{task.error}</UiNotice> : null}
    </RepairBlock>
  );
}
