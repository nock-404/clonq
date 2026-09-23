# Übergabe (Stand 23.09.2026, 16:10)

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
- Committet in `92609e9` zusammen mit den Abläufen, `tsc` sauber.
- Workflow `wf_90b7d5a2-119` fertig: „Ort hinzufügen“ für alle Arten mit Laufwerksfront (`UiDriveFront`), Ortsansicht mit Reparaturwegen, Job-Assistent. Nur in der Vorschau geprüft. Zusammenfassung pro Agent im Journal `subagents/workflows/wf_90b7d5a2-119/journal.jsonl`, Bilder in `~/Downloads/clonq-ablaeufe/`. Als Nächstes: Ergebnis selbst durchsehen, dann Punkte aus „Danach einhängen“.
- Vorschau-Server: Vite auf Port 1440 (`preview.html?window=main&scene=running&job=work-to-m2mini`, `&sheet=addLocation|jobWizard`, `&location=box`). Weitere alte Vite-Prozesse auf 1430/1441/1442/1443/1452 aufräumen, sobald der Workflow fertig ist.
- Danach einhängen: `ArchivePanel` und Konfliktregeln ins Job-Detail/Assistenten, `FileBrowser` in `LocationDetail`, Hostschlüssel-Bestätigung (API: `prepareServer(name, host, port)` → `hostKeys`, dann `trustServer(locationId)`) in den Server-Ablauf, `connectLocation` für SMB.

## Veröffentlichung (23.09.2026, 17:25)

- `nock-404/clonq` ist öffentlich (Apache 2.0) mit bereinigter Historie (Beispieldaten ohne Arbeits- und Privatnamen). Das alte private Repo heißt `nock-404/clonq-privat` (Remote `privat`), der alte Stand liegt lokal im Tag `pre-public-backup` – diesen Tag nie pushen, kein `git push --tags`.
- Installation und Update: `curl -fsSL https://raw.githubusercontent.com/nock-404/clonq/main/install.sh | sh`; in der App Update-Band (Seitenleiste, Popover) und „Nach Updates suchen“ in den Einstellungen.
- Release: Version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` setzen, committen, `git tag vX.Y.Z && git push origin main vX.Y.Z`. Workflow `.github/workflows/release.yml` baut auf macOS 26 (arm64), signiert mit den Secrets und lädt `latest.json` hoch.
- Update-Signierschlüssel: `~/.tauri/clonq.key` (+ `.pub`), Passwort im Schlüsselbund unter „clonq-updater-signing“, beides als Repo-Secrets hinterlegt. Geht der Schlüssel verloren, können installierte Apps keine Updates mehr annehmen.
- Pushen mit dem Token von nock-404 pro Aufruf, der aktive gh-Account ist mg-pr.

## Stand 23.09.2026 nachmittags (zweite Session)

- Logo „Spule“ gewählt und überall drin: App-Icon (`src-tauri/icons`, aus `~/Downloads/clonq-logo/spule/app-icon-1024.png`), Menüleiste mit drei Drehstufen (`icons/tray*.png`, `tray.rs` dreht ruckartig, solange `engine.busy()`), `UiLogo` (mark/wordmark/icon) in Seitenleiste, Popover-Fußleiste, Einführung, Einstellungen „Über clonq“. Schriftzug zart grau (#a4a4ab), auf die Tinte zugeschnitten.
- Dock: clonq steht im Dock und in ⌘Tab, solange das Hauptfenster offen ist (`show_main`, Reopen-Ereignis).
- Workflow `wf_af2245fa-77a` fertig und eingebaut: Fingerabdruck-Prüfung im Server-Ablauf (prepareServer mit Port und Entwurfs-Id, trustServer), Archiv im Job-Detail, Dateibrowser mit Box-Snapshots in der Ort-Ansicht, „Beidseitig“ mit Konfliktregeln und Archiv-Einstellungen im Assistenten. Bilder `~/Downloads/clonq-ablaeufe/{server,panels,modus}-*.png`.
- Danach selbst: Server als Quelle (rclone über SFTP), neu bestätigte Hostschlüssel ersetzen alte, keyscan- und Archiv-Fehler sauber, deutsche Texte, Fokus bleibt im offenen Blatt (`inert`), Art-Schritt klappt Konflikte/Archiv/Ausschlüsse zu, Assistent eine Zeile höher, Blatt darf bis 1,5 rem an den Fensterrand, beidseitige Namen mit ⇄.
- Dev-App läuft mit `pnpm tauri dev` (Log im Scratchpad `tauri-dev.log`), Konfiguration ist auf v2 umgestellt und leer, v1 liegt als `config.json.v1.bak` daneben.

### Offen (aus den Workflow-Berichten)
- Archiv bei „Beidseitig“: Die Engine archiviert auch auf der Quellseite, `archive.rs` liest nur das Ziel (Parameter side fehlt).
- Wiederherstellen mehrerer ausgewählter Dateien in einem Aufruf; Umbenennen nur der Groß-/Kleinschreibung auf APFS wird abgelehnt.
- LocationRepair kann neue Fingerabdrücke nach einer Server-Neuinstallation nicht bestätigen.
- Papierkorb auf SMB-Freigaben ungetestet.
- Mögliche Race in MainWindow (Seitenleiste markiert „Übersicht“, während ein Job angezeigt wird), nur in der Vorschau gesehen.
- Nichts davon gegen echte Storage Box, NAS oder Cloud geprüft.

## Offene Fragen an Matthias

- Akzentfarbe (umschaltbar gebaut, Standard Bernstein).
- Repo öffentlich? (Installation per `curl | sh`, Auto-Update)
- Zugangsdaten Storage Box; Okay für die Erstkopie M.2-WORK → `~/Desktop/WORK`.

## Nicht gegen echte Gegenstellen geprüft

Storage Box (install-ssh-key, rsync --mkpath dort, `.zfs`-Name), SMB, echte Cloud-Anbieter, Mitteilungen im Dev-Modus.
