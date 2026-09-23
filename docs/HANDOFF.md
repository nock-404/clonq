# Übergabe (Stand 23.09.2026, 13:30)

## Auf `main`, getestet (71 Rust-Tests, `cargo test` in src-tauri)

- Orte: Ordner, Laufwerk (Volume-UUID), SSH-Server (eigener Schlüssel, Hostschlüssel wird beim Einrichten angezeigt, bestätigt und gepinnt), Netzlaufwerk (SMB, Passwort im Schlüsselbund, Einhängen wie Finder), Cloud/WebDAV (rclone, eigene rclone.conf, Geheimnisse nie in argv).
- Engines: rsync (lokal, SSH), rclone (Cloud), rclone bisync (beidseitig mit Konfliktregeln).
- Sicherheit: Probelauf vor dem ersten Spiegel und nach jedem Stopp, Löschgrenze pro Plan (Quelle/Ziel/Modus), leere Quellen werden abgelehnt, gestoppte Jobs starten nicht automatisch neu, Archiv `.clonq-archiv/<Zeit>/` mit Aufräumen nach N Tagen.
- Auslöser: Zeitplan, täglich, Anstecken, Änderungen (FSEvents), Ketten; Mitteilungen; Autostart.
- Verlauf Datei für Datei (`run_entries`), Archiv durchsuchen/wiederherstellen (nach Downloads, nie überschreibend), Dateibrowser für jeden Ort inkl. Box-Snapshots (`.zfs`).
- Code-Prüfung durch vier Prüfer, 31 bestätigte Befunde, alle behoben (Commits „Review fixes: …“).

## Oberfläche

- Fertig: Raycast-Stil, Popover, Hauptfenster (Übersicht, Job-Detail mit Statistik, Verlauf mit Lauf-Blatt, Einstellungen), `ArchivePanel.tsx`, `FileBrowser.tsx`.
- Spulen: alle drei Stile (Licht, Vakuum, Präzision) liegen in `src/ui/reels/<stil>/`, CSS in `src/styles/reels.css`. `UiReel`, `UiReelPair` und `ReelShape` in `src/ui/` wählen per `useReelStyle()` (`src/ui/reels/style.ts`); `useClonq` setzt den Stil aus `config.ui.reels` (Rust `Reels`, Standard Licht). Schalter „Spulen“ in den Einstellungen. Vorschau: `&reels=vakuum|praezision`. Labor-Seiten bleiben in `preview/reel-lab/`.
- Job-Detail: kein Kasten mehr hinter den Spulen (Wunsch von Matthias), Laufwerksspalte fest `w-44`, damit beim Stilwechsel nichts springt.
- Matthias hat die App in der Vorschau gesehen und ist sehr angetan.
- NICHT COMMITTET: Spulen-Umbau und Job-Detail-Änderung liegen zusammen mit den Workflow-Änderungen im Arbeitsbaum. Typprüfung (`tsc --noEmit`) und 71 Rust-Tests liefen sauber, clippy auch.
- In Arbeit per Workflow `wf_90b7d5a2-119` (lief um 13:15 noch, Stufe refine „orte“): „Ort hinzufügen“ (`views/locations/*`, `ui/UiLocationGlyph.tsx`, viele neue `ui/Ui*.tsx`) und Job-Assistent (`views/jobs/*`, `JobHeader`). Screenshots in `~/Downloads/clonq-ablaeufe/`. Falls die Session vorher endet: Ergebnis im Arbeitsbaum durchsehen, `tsc`, Vorschau prüfen, dann committen.
- Vorschau-Server: Vite auf Port 1440 (`preview.html?window=main&scene=running&job=work-to-m2mini`, `&sheet=addLocation|jobWizard`, `&location=box`). Weitere alte Vite-Prozesse auf 1430/1441/1442/1443/1452 aufräumen, sobald der Workflow fertig ist.
- Danach einhängen: `ArchivePanel` und Konfliktregeln ins Job-Detail/Assistenten, `FileBrowser` in `LocationDetail`, Hostschlüssel-Bestätigung (API: `prepareServer(name, host, port)` → `hostKeys`, dann `trustServer(locationId)`) in den Server-Ablauf, `connectLocation` für SMB.

## Offene Fragen an Matthias

- Akzentfarbe (umschaltbar gebaut, Standard Bernstein).
- Repo öffentlich? (Installation per `curl | sh`, Auto-Update)
- Zugangsdaten Storage Box; Okay für die Erstkopie M.2-WORK → `~/Desktop/WORK`.

## Nicht gegen echte Gegenstellen geprüft

Storage Box (install-ssh-key, rsync --mkpath dort, `.zfs`-Name), SMB, echte Cloud-Anbieter, Mitteilungen im Dev-Modus.
