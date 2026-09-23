# Übergabe (Stand 23.09.2026)

## Fertig und getestet (auf `main`)

- rsync-Engine (Spiegel, Backup, Probelauf, Schutzschwelle, Löschgrenze, Abbrechen), 20 Tests grün, 60 Stresstläufe ohne Hänger.
- Kennzahlen pro Lauf: neu/geändert/gelöscht mit Größen, Quelle gesamt, Literal/Matched (Delta), Wire-Bytes, Durchsatz-Samples, Ordner mit den meisten Änderungen.
- Statistik: `job_stats` (Alter der Sicherung, Serie, Ø-Dauer, 30 Tage pro Tag, Top-Ordner 7 Tage, Summen), `overview` (Summen, heute).
- UI-Einstellungen in der Konfiguration (`ui.accent` = ring|amber|blue, `ui.lamps`), `set_ui_settings`, Event `config-changed`.
- `open_main_window(jobId?)` sendet `show-job` ans Hauptfenster.

## In Arbeit (Branch `wip/raycast-ui`)

Design: Raycast + Großrechner-Datenspulen (10,5″, Schreibring, ruckartiges Drehen). Dunkel, fast deckend.

Erledigt:
- Tokens in `src/styles/app.css` (Akzent per `data-accent`, Schreibring-Farben, Oxid, Spulen-/Lampen-/Band-Animationen).
- Bausteine in `src/ui/`: ReelShape, UiReel, UiReelPair, UiSparkline, UiBars, UiCounter, UiStat, UiLamps, UiKbd, UiSearchField, UiListRow, UiActionBar, UiActionPanel (⌘K), UiSegmented, UiSwitch, UiFreshness, UiPanel; UiButton/UiIconButton/UiBadge/UiTable/UiNavItem neu gestylt.
- Store `useClonq` lädt Stats und Übersicht, `useNow` als Uhr, `useHotkeys`.
- `views/Popover.tsx` neu (Suche, Liste mit Spulen, Aktionsleiste, ⌘K, Tastatur).

Offen:
1. `views/MainWindow.tsx` neu bauen: Seitenleiste (Übersicht, Jobs mit Spulen, Verlauf, Einstellungen), Job-Detail (Spulenpaar + Lämpchen, Live-Kurve, Zähler neu/geändert/gelöscht, Alter der Sicherung, Serie, 30-Tage-Balken, Top-Ordner, Gesamtzähler mit Spulen-Umrechnung), `HistoryView` neu, Einstellungen (Akzent, Lämpchen). Die alte MainWindow importiert noch gelöschte Dateien (JobList) — daher baut das Frontend gerade nicht.
2. `preview/scenes.ts` an neue Typen anpassen (Stats, Samples, ring, ui).
3. Glas weniger durchsichtig: `native/glass.m` NSGlassEffectView `tintColor` dunkel setzen, Popover-Radius 12.
4. Selbst prüfen: Vorschau-Seite per Headless-Chrome screenshotten (Chrome-Erweiterung war nicht verbunden), tsc, `pnpm build`, dann nach `main` mergen.

## Offene Fragen an Matthias

- Akzentfarbe: in den Einstellungen umschaltbar gebaut, Wahl steht aus (Standard Bernstein).
- Zugangsdaten Storage Box.
- Repo öffentlich? (für `curl | sh` und Auto-Update)
- Okay für die Erstkopie M.2-WORK → `~/Desktop/WORK`.
