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
    [/^a server as the source is not built yet$/, () => "Ein Server als Quelle kommt später"],
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
