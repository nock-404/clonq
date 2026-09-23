// Every user-facing word for states and modes, in one place.

import type { Config, Location, Mode, Place, Reach, RunStatus } from "./types";

export const statusLabel: Record<RunStatus, string> = {
  running: "Läuft",
  succeeded: "Erfolgreich",
  partial: "Mit Warnungen",
  blocked: "Gestoppt",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};

export const modeLabel: Record<Mode, string> = {
  mirror: "Spiegel",
  backup: "Backup",
  blind: "Blind Backup",
  bidirectional: "Beidseitig",
};

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

export const statusTone: Record<RunStatus, Tone> = {
  running: "accent",
  succeeded: "ok",
  partial: "warn",
  blocked: "warn",
  failed: "danger",
  cancelled: "neutral",
};

const HOME = /^\/Users\/[^/]+/;

export function locationOf(place: Place, config: Config | null): Location | undefined {
  return config?.locations.find((location) => location.id === place.location);
}

/** "M2mini/WORK", "Storage Box/M2mini", "Schreibtisch" – a location name plus the path inside it. */
export function placeLabel(place: Place, config: Config | null): string {
  const location = locationOf(place, config);
  const name = location?.name ?? "unbekannter Ort";
  const path = place.path.replace(/^\/+|\/+$/g, "");
  return path ? `${name}/${path}` : name;
}

export const locationKindLabel: Record<Location["kind"]["type"], string> = {
  folder: "Ordner auf dem Mac",
  volume: "Laufwerk",
  ssh: "Server (SSH)",
  smb: "Netzlaufwerk",
  cloud: "Cloud",
};

export function locationDetail(location: Location): string {
  switch (location.kind.type) {
    case "folder":
      return location.kind.path.replace(HOME, "~");
    case "volume":
      return `/Volumes/${location.kind.volumeName}`;
    case "ssh":
      return `${location.kind.user}@${location.kind.host}:${location.kind.port}`;
    case "smb":
      return location.kind.url;
    case "cloud":
      return `${location.kind.remote}:${location.kind.root}`;
  }
}

export function reachLabel(reach: Reach | undefined): { text: string; tone: Tone } {
  switch (reach?.state) {
    case "connected":
      return { text: "verbunden", tone: "ok" };
    case "disconnected":
      return { text: "nicht angeschlossen", tone: "neutral" };
    case "missing":
      return { text: "Ordner fehlt", tone: "danger" };
    case "untested":
      return { text: "wird geprüft", tone: "neutral" };
    case "failed":
      return { text: "keine Verbindung", tone: "danger" };
    default:
      return { text: "unbekannt", tone: "neutral" };
  }
}

/** Messages come from the Rust side in English; the known ones get German words. */
export function messageLabel(message: string): string {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^source (.+) does not exist$/, (m) => `Quelle ${tidy(m[1])} gibt es nicht`],
    [/^source (.+) is empty, nothing is changed$/, (m) => `Quelle ${tidy(m[1])} ist leer – es wurde nichts verändert`],
    [/^source (.+) is not a folder$/, (m) => `Quelle ${tidy(m[1])} ist kein Ordner`],
    [/^target folder (.+) does not exist$/, (m) => `Zielordner ${tidy(m[1])} gibt es nicht`],
    [/^volume (.+) is not connected$/, (m) => `${tidy(m[1])} ist nicht angeschlossen`],
    [
      /^would delete (\d+) of (\d+) entries on the target \(([\d.]+) %\), limit is ([\d.]+) %$/,
      (m) => `Würde ${count(m[1])} von ${count(m[2])} Einträgen im Ziel löschen (${decimal(m[3])} %), erlaubt sind ${decimal(m[4])} %`,
    ],
    [
      /^deletion limit reached \((\d+) allowed\), the remaining deletions were skipped$/,
      (m) => `Löschgrenze erreicht (${count(m[1])} erlaubt) – weitere Löschungen wurden übersprungen`,
    ],
    [/^location (.+) does not exist$/, () => "Einer der Orte dieses Jobs existiert nicht mehr"],
    [/^folder (.+) does not exist$/, (m) => `Ordner ${tidy(m[1])} gibt es nicht`],
    [/^(.+) is not connected$/, (m) => `${tidy(m[1])} ist nicht angeschlossen`],
    [/^source and target are the same folder$/, () => "Quelle und Ziel sind derselbe Ordner"],
    [/^the target lies inside the source; it would copy itself$/, () => "Das Ziel liegt in der Quelle – clonq würde sich selbst kopieren"],
    [/^the source lies inside the target; a mirror would delete everything around it$/, () => "Die Quelle liegt im Ziel – ein Spiegel würde alles drumherum löschen"],
    [/^a name is required$/, () => "Bitte einen Namen eingeben"],
    [/^login refused: wrong user, password or key$/, () => "Anmeldung abgelehnt: Benutzer, Passwort oder Schlüssel falsch"],
    [/^host name not found$/, () => "Server-Adresse nicht gefunden"],
    [/^the server refused the connection on this port$/, () => "Der Server lehnt die Verbindung auf diesem Port ab"],
    [/^no answer from the server \(timeout\)$/, () => "Keine Antwort vom Server (Zeitüberschreitung)"],
    [/^still used by (.+)$/, (m) => `Wird noch benutzt von: ${m[1]}`],
    [/^(.+) is already a location$/, (m) => `${tidy(m[1])} ist schon als Ort angelegt`],
    [/^folders on external drives are added as a drive, not as a folder$/, () => "Ordner auf externen Laufwerken bitte als Laufwerk hinzufügen"],
    [/^two-way sync stopped: .*too many deletes \(>(\d+)%, (\d+) of (\d+)\)/, (m) => `Beidseitiger Abgleich gestoppt: ${count(m[2])} von ${count(m[3])} Dateien würden gelöscht, erlaubt sind ${m[1]} %`],
    [/^share (.+) is not connected$/, (m) => `Die Freigabe ${m[1]} ist nicht verbunden`],
    [/^the address must start with smb:\/\/$/, () => "Die Adresse muss mit smb:// beginnen"],
    [/^the address has no server$/, () => "In der Adresse fehlt der Server"],
    [/^the address has no share name, e\.g\. smb:\/\/nas\/daten$/, () => "In der Adresse fehlt die Freigabe, zum Beispiel smb://nas/daten"],
    [/^a user is required$/, () => "Bitte einen Benutzer eingeben"],
    [/^the keychain refused the password: (.+)$/, (m) => `Der Schlüsselbund hat das Passwort abgelehnt: ${m[1]}`],
    [/^the share could not be connected: (.*)$/, (m) => `Die Freigabe ließ sich nicht verbinden${m[1] ? `: ${m[1]}` : ""}`],
    [/^the sign-in did not finish within five minutes$/, () => "Die Anmeldung wurde nicht innerhalb von fünf Minuten abgeschlossen"],
    [/^no answer from the cloud \(timeout\)$/, () => "Keine Antwort vom Cloud-Speicher (Zeitüberschreitung)"],
    [/^(.+) is required$/, (m) => `${m[1]} fehlt noch`],
    [/^unknown cloud provider (.+)$/, (m) => `Unbekannter Cloud-Anbieter: ${m[1]}`],
    [/^(.+) cannot be created: (.+)$/, (m) => `${tidy(m[1])} lässt sich nicht anlegen: ${m[2]}`],
    [/^path (.+) must not climb out of its location$/, () => "Der Pfad darf den Ort nicht verlassen"],
    [/^(.+) has not been tested yet$/, (m) => `${m[1]} wird noch geprüft`],
    [/^(.+) no longer exists$/, (m) => `${m[1]} gibt es nicht mehr`],
    [/^choose a location$/, () => "Bitte einen Ort wählen"],
    [/^the jobs would start each other in a circle$/, () => "Die Jobs würden sich gegenseitig endlos starten"],
    [/^the interval must be between 1 minute and one year$/, () => "Der Abstand muss zwischen einer Minute und einem Jahr liegen"],
    [/^(.+) already exists$/, (m) => `${m[1]} gibt es dort schon`],
    [/^the new name must be a plain name$/, () => "Der neue Name darf keinen Schrägstrich enthalten"],
    [/^the file is too large for a preview$/, () => "Die Datei ist für eine Vorschau zu groß"],
    [/^there is no preview for this kind of file$/, () => "Für diese Art Datei gibt es keine Vorschau"],
    [/^moving to the Trash failed: (.+)$/, (m) => `In den Papierkorb legen hat nicht geklappt: ${m[1]}`],
    [/^the location itself cannot be deleted here$/, () => "Der Ort selbst lässt sich hier nicht löschen"],
    [/^restoring from the archive failed$/, () => "Das Wiederherstellen aus dem Archiv ist fehlgeschlagen"],
    [/^(.+) is not an archive folder$/, (m) => `${m[1]} ist kein Archivordner`],
    [/^path must not climb out of the archive$/, () => "Der Pfad darf das Archiv nicht verlassen"],
    [/^the copy failed$/, () => "Das Kopieren ist fehlgeschlagen"],
    [/^rename failed$/, () => "Das Umbenennen ist fehlgeschlagen"],
    [/^the server's key was not read; start again$/, () => "Der Schlüssel des Servers wurde nicht gelesen. Bitte von vorn beginnen."],
    [/^unknown server draft; start again$/, () => "Dieser Entwurf für den Server ist unbekannt. Bitte von vorn beginnen."],
    [/^the server's host key changed; check it before trusting it again$/, () => "Der Hostschlüssel des Servers hat sich geändert. Bitte prüfen, bevor er wieder vertraut wird."],
    [/^(.+) must be a single line$/, (m) => `${m[1]} darf keinen Zeilenumbruch enthalten`],
    [/^source (.+) does not exist$/, (m) => `Quelle ${tidy(m[1])} gibt es nicht`],
    [/^the app quit during this run$/, () => "clonq wurde während des Laufs beendet"],
  ];
  for (const [pattern, render] of rules) {
    const match = message.match(pattern);
    if (match) return render(match);
  }
  return message;
}

function count(digits: string | undefined): string {
  return Number(digits ?? 0).toLocaleString("de-DE");
}

function decimal(value: string | undefined): string {
  return Number(value ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function tidy(path: string | undefined): string {
  return (path ?? "").replace(HOME, "~");
}
