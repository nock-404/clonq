// Deutsche Texte für Hauptfenster, Popover, Einführung, Übersicht, Einstellungen und Updates; Schlüssel wie in ../en/shell.ts.

import type { Shape } from "..";
import type { shell as source } from "../en/shell";

export const shell: Shape<typeof source> = {
  settings: {
    language: "Sprache",
    languageSystem: "Wie der Mac",
  },
};
