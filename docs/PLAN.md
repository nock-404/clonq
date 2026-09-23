# clonq – Bauplan

clonq ist eine Mac-App für Sync und Backup. Vorbild ist ChronoSync, gebaut mit
Tauri 2, React und rsync. Sie sitzt in der Menüleiste und hat ein Hauptfenster
für Jobs, Verlauf und Dateibrowser.

## Ziele

- Mac-WORK (`~/Desktop/WORK`) → M.2-WORK (`/Volumes/M2mini/WORK`)
- Mac-WORK → Hetzner Storage Box
- M.2 → Storage Box (ohne WORK, das kommt vom Mac)
- Status live, Verlauf, Start per Knopf, automatische Auslöser

## Technik

| Teil | Wahl |
|---|---|
| App | Tauri 2.11, Rust 1.98 |
| Oberfläche | React 19, TypeScript, Vite 8, Tailwind 4, Motion |
| Glas | `NSGlassEffectView` (AppKit, ab macOS 26), eigene Einbindung in Objective-C |
| Transport | rsync 3.x; zur Box über SSH Port 23, dort läuft rsync auf der Serverseite |
| Verlauf | SQLite |
| Konfiguration | JSON unter `~/Library/Application Support/io.github.nock404.clonq/` |

## Begriffe

- **Endpunkt:** lokaler Pfad oder Pfad auf einem SSH-Host.
- **Job:** Quelle, Ziel, Modus, Auslöser, Ausschlüsse, Sicherheitsregeln.
- **Modus:** Spiegel (Ziel wird exakt wie die Quelle), Backup (nur kopieren,
  nie löschen), Blind Backup (Ziel wird nicht gelesen), bidirektional.
- **Lauf:** eine Ausführung eines Jobs, mit Protokoll im Verlauf.

## Sicherheitsregeln (gelten ab dem ersten Abschnitt)

- Fehlt die Quelle oder ist sie leer, bricht der Lauf ab. Ein leerer Ordner
  darf nie ein volles Ziel leerspiegeln.
- Vor jedem Spiegel läuft ein Probelauf. Würden mehr Dateien gelöscht als die
  Schutzschwelle erlaubt (Standard 10 %), stoppt der Lauf und fragt.
- Voreingestellte Jobs sind ausgeschaltet, bis sie bewusst eingeschaltet werden.
- `node_modules` ist in jedem neuen Job ausgeschlossen. Ausschlüsse sind pro
  Job frei definierbar.

## Abschnitte

Jeder Abschnitt ist ein abgeschlossenes Stück. Nach jedem Abschnitt wird
gezeigt, geprüft und auf ein Okay gewartet.

| Nr. | Inhalt | Stand |
|---|---|---|
| 1 | Grundgerüst: Menüleiste, Hauptfenster (Raycast-Stil mit Datenspulen), rsync-Engine für Spiegel und Backup (lokal) mit Live-Fortschritt, Probelauf, Schutzschwelle, Kennzahlen und Statistik, Läufe in SQLite | fertig, Spulen-Feinschliff läuft |
| 2 | Orte: Ordner, Laufwerk (UUID), SSH-Server (eigener Schlüssel, einmalige Passwort-Hinterlegung), Netzlaufwerk (SMB, Schlüsselbund), Cloud und WebDAV (rclone als zweite Engine); Job-Assistent | Rust fertig, Oberfläche in Arbeit |
| 3 | Auslöser: Anstecken, Zeitplan, täglich, Änderungen (FSEvents), Ketten; Autostart; Mitteilungen | Rust fertig, Einstellungen fertig |
| 4 | Verlauf-Ansicht mit Log pro Lauf, Probelauf-Vorschau Datei für Datei | offen |
| 5 | Job-Editor: Modus, Quelle/Ziel, Ausschlüsse, Schwelle, Archiv | offen |
| 6 | Archiv für Gelöschtes und Überschriebenes, Wiederherstellen | offen |
| 7 | Bidirektional mit Konfliktregeln pro Job und Pfad | offen |
| 8 | Remote-Dateibrowser inkl. Box-Snapshots, falls erreichbar | offen |
| 9 | Installation per Terminal-Befehl wie bei plxr (`curl … \| sh` aus GitHub-Releases), Auto-Update über tauri-plugin-updater mit signierten Releases | offen |

## Noch nicht gegen echte Gegenstellen geprüft

- Storage Box: `install-ssh-key`, `--mkpath` auf der Box (braucht rsync ≥ 3.2.3 dort), Ordnerliste per `ls -1ap`.
- SMB: Einhängen per `mount volume` mit Schlüsselbund-Passwort (kein SMB-Server zum Testen da).
- Cloud mit echten Anbietern (S3, B2, Google Drive, OneDrive, Dropbox, WebDAV); getestet ist rclone mit einem lokalen Remote.
- Mitteilungen im Entwicklungsmodus (brauchen evtl. ein gebündeltes, signiertes App-Paket).

## Offene Punkte

- Zugangsdaten der Storage Box (kommen von Matthias).
- Repo öffentlich oder privat? Installation per `curl | sh` und Auto-Update brauchen bei einem privaten Repo überall einen Token.
- Erstkopie M.2-WORK → `~/Desktop/WORK`: erst nach seinem Okay.
