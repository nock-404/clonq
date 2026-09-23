// Every user-facing word for states and modes, in one place.

import type { Endpoint, Mode, RunStatus } from "./types";

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

export function endpointLabel(endpoint: Endpoint): string {
  if (endpoint.kind === "remote") return `${endpoint.host}:${endpoint.path}`;
  return endpoint.path.replace(HOME, "~");
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
    [/^remote endpoints arrive with the Storage Box connection/, () => "Die Storage Box ist noch nicht verbunden"],
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
