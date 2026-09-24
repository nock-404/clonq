// Deutsche Texte, die überall gebraucht werden; Schlüssel und Funktionen wie in ../en/common.ts.

import type { Shape } from "..";
import type { common as source } from "../en/common";

export const common: Shape<typeof source> = {
  percent: (shown) => `${shown} %`,
  justNow: "gerade eben",
  never: "noch nie",
  reels: (count, shown) => `${shown} ${count === 1 ? "Spule" : "Spulen"}`,
  reelsBelow: (limit) => `< ${limit} Spulen`,

  close: "Schließen",
  dismiss: "Ausblenden",
  cancel: "Abbrechen",
  save: "Speichern",
  saving: "Wird gespeichert …",
  choose: "Bitte wählen",
  searchActions: "Aktion suchen …",
  hours: (label) => `${label}, Stunden`,
  minutes: (label) => `${label}, Minuten`,

  copy: "Kopieren",
  copyNamed: (name) => `${name} kopieren`,
  copied: "In die Zwischenablage kopiert.",
  selectedForCopy: "Markiert. Mit ⌘C kopieren.",

  status: {
    running: "Läuft",
    succeeded: "Erfolgreich",
    partial: "Mit Warnungen",
    blocked: "Gestoppt",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen",
  },
  mode: {
    mirror: "Spiegel",
    backup: "Backup",
    blind: "Blind Backup",
    bidirectional: "Beidseitig",
    versioned: "Versionen",
  },
  locationKind: {
    folder: "Ordner auf dem Mac",
    volume: "Laufwerk",
    ssh: "Server (SSH)",
    smb: "Netzlaufwerk",
    cloud: "Cloud",
  },
  reach: {
    connected: "verbunden",
    disconnected: "nicht angeschlossen",
    missing: "Ordner fehlt",
    untested: "wird geprüft",
    failed: "keine Verbindung",
    unknown: "unbekannt",
  },
  unknownLocation: "unbekannter Ort",

  job: {
    checking: "prüft …",
    unreachable: "Ort nicht erreichbar",
    entries: (done, total) => `${done} / ${total} Einträge`,
    remaining: (duration) => `noch ${duration}`,
  },
};
