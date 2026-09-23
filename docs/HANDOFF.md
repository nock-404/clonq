# Übergabe (Stand 23.09.2026, nachmittags)

## Auf `main`, getestet (71 Rust-Tests, `cargo test` in src-tauri)

- Orte: Ordner, Laufwerk (Volume-UUID), SSH-Server (eigener Schlüssel, Hostschlüssel wird beim Einrichten angezeigt, bestätigt und gepinnt), Netzlaufwerk (SMB, Passwort im Schlüsselbund, Einhängen wie Finder), Cloud/WebDAV (rclone, eigene rclone.conf, Geheimnisse nie in argv).
- Engines: rsync (lokal, SSH), rclone (Cloud), rclone bisync (beidseitig mit Konfliktregeln).
- Sicherheit: Probelauf vor dem ersten Spiegel und nach jedem Stopp, Löschgrenze pro Plan (Quelle/Ziel/Modus), leere Quellen werden abgelehnt, gestoppte Jobs starten nicht automatisch neu, Archiv `.clonq-archiv/<Zeit>/` mit Aufräumen nach N Tagen.
- Auslöser: Zeitplan, täglich, Anstecken, Änderungen (FSEvents), Ketten; Mitteilungen; Autostart.
- Verlauf Datei für Datei (`run_entries`), Archiv durchsuchen/wiederherstellen (nach Downloads, nie überschreibend), Dateibrowser für jeden Ort inkl. Box-Snapshots (`.zfs`).
- Code-Prüfung durch vier Prüfer, 31 bestätigte Befunde, alle behoben (Commits „Review fixes: …“).

## Oberfläche

- Fertig: Raycast-Stil, Popover, Hauptfenster (Übersicht, Job-Detail mit Statistik, Verlauf mit Lauf-Blatt, Einstellungen), `ArchivePanel.tsx`, `FileBrowser.tsx`.
- In Arbeit per Workflow: „Ort hinzufügen“ (`views/locations/*`, `ui/UiLocationGlyph.tsx`) und Job-Assistent (`views/jobs/*`); Spulen/Lesekopf-Varianten in `preview/reel-lab/` mit Bildern in `~/Downloads/clonq-spulen/`.
- Danach einhängen: `ArchivePanel` und Konfliktregeln ins Job-Detail/Assistenten, `FileBrowser` in `LocationDetail`, Hostschlüssel-Bestätigung (API: `prepareServer(name, host, port)` → `hostKeys`, dann `trustServer(locationId)`) in den Server-Ablauf, `connectLocation` für SMB.

## Offene Fragen an Matthias

- Spulen-Variante wählen (Vakuum, Präzision, Licht).
- Akzentfarbe (umschaltbar gebaut, Standard Bernstein).
- Repo öffentlich? (Installation per `curl | sh`, Auto-Update)
- Zugangsdaten Storage Box; Okay für die Erstkopie M.2-WORK → `~/Desktop/WORK`.

## Nicht gegen echte Gegenstellen geprüft

Storage Box (install-ssh-key, rsync --mkpath dort, `.zfs`-Name), SMB, echte Cloud-Anbieter, Mitteilungen im Dev-Modus.
