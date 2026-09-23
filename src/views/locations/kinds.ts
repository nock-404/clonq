// The kinds of location a user can add, and the words for them.

import type { CloudField, CloudProvider, Location } from "../../lib/types";
import { glyphKindOf, type GlyphKind } from "../../ui/UiLocationGlyph";

/** What the add-location flow offers: the location kinds, with WebDAV as its own choice. */
export type SetupKind = GlyphKind;

export interface KindInfo {
  kind: SetupKind;
  title: string;
  /** One line in the list. */
  short: string;
  /** A few sentences on the drive front next to the list. */
  long: string;
  /** What the user needs at hand. */
  needs: string;
  /** The panel lamps on the drive front, one per step of adding. */
  lamps: string[];
}

export const KINDS: KindInfo[] = [
  {
    kind: "folder",
    title: "Ordner auf dem Mac",
    short: "Ein Ordner auf der eingebauten SSD",
    long: "Ein Ordner auf dem Mac selbst, etwa der Schreibtisch oder die Dokumente. Für einen Ordner auf einem externen Laufwerk wähle „Laufwerk“.",
    needs: "Du brauchst nur den Ordner.",
    lamps: ["Ordner", "Angelegt"],
  },
  {
    kind: "volume",
    title: "Laufwerk",
    short: "Externe SSD, Festplatte oder USB-Stick",
    long: "clonq erkennt das Laufwerk an seiner Kennung wieder, auch unter einem anderen Namen. Jobs können starten, sobald es angesteckt wird.",
    needs: "Das Laufwerk muss gerade angeschlossen sein.",
    lamps: ["Laufwerk", "Angelegt"],
  },
  {
    kind: "ssh",
    title: "Server (SSH)",
    short: "Ein Rechner, der per SSH erreichbar ist",
    long: "Zum Beispiel eine Hetzner Storage Box. clonq meldet sich mit einem eigenen Schlüssel an. Das Passwort wird nur einmal gebraucht, um diesen Schlüssel zu hinterlegen.",
    needs: "Du brauchst Adresse, Benutzernamen und einmalig das Passwort.",
    lamps: ["Schlüssel", "Hinterlegt", "Getestet", "Ordner"],
  },
  {
    kind: "smb",
    title: "Netzlaufwerk (SMB/NAS)",
    short: "Eine Freigabe im lokalen Netzwerk",
    long: "Eine Freigabe auf einem NAS oder einem anderen Rechner im Netzwerk. Das Passwort bewahrt der Schlüsselbund von macOS auf.",
    needs: "Du brauchst die Adresse der Freigabe, Benutzernamen und Passwort.",
    lamps: ["Adresse", "Einhängen", "Angelegt"],
  },
  {
    kind: "cloud",
    title: "Cloud",
    short: "S3, B2, Google Drive, OneDrive, Dropbox",
    long: "Speicher bei einem Cloud-Anbieter. Bei Google Drive, OneDrive und Dropbox meldest du dich im Browser an, S3 und B2 brauchen einen Zugangsschlüssel.",
    needs: "Du brauchst ein Konto beim Anbieter.",
    lamps: ["Anbieter", "Zugang", "Angelegt"],
  },
  {
    kind: "webdav",
    title: "WebDAV",
    short: "Zum Beispiel eine Nextcloud",
    long: "Ein Speicher, der über WebDAV erreichbar ist, etwa eine Nextcloud oder ein NAS mit WebDAV-Zugang.",
    needs: "Du brauchst Adresse, Benutzernamen und Passwort.",
    lamps: ["Adresse", "Zugang", "Angelegt"],
  },
];

export function kindInfo(kind: SetupKind): KindInfo {
  return KINDS.find((info) => info.kind === kind) ?? (KINDS[0] as KindInfo);
}

/** WebDAV is stored as a cloud location but drawn and named as its own kind. */
export function glyphOf(location: Location): GlyphKind {
  return glyphKindOf(location);
}

/** The kind of a location in words, the same as in "Ort hinzufügen". */
export function kindTitle(location: Location): string {
  return kindInfo(glyphOf(location)).title;
}

export const providerLabel: Record<CloudProvider, string> = {
  s3: "Amazon S3 oder kompatibler Speicher",
  b2: "Backblaze B2",
  drive: "Google Drive",
  onedrive: "Microsoft OneDrive",
  dropbox: "Dropbox",
  webdav: "WebDAV",
};

/** Short enough for a segmented control. */
export const providerShort: Record<CloudProvider, string> = {
  s3: "S3",
  b2: "B2",
  drive: "Google Drive",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
  webdav: "WebDAV",
};

interface FieldWords {
  label: string;
  placeholder?: string;
  hint?: string;
}

// The backend names its fields in the provider's own (English) terms; the form uses these.
const FIELD_WORDS: Record<string, FieldWords> = {
  endpoint: {
    label: "Adresse des Anbieters",
    placeholder: "z. B. fsn1.your-objectstorage.com",
    hint: "Ohne Angabe verwendet clonq Amazon S3.",
  },
  region: { label: "Region", placeholder: "z. B. eu-central-1" },
  access_key_id: { label: "Schlüssel-ID" },
  secret_access_key: { label: "Geheimer Schlüssel" },
  account: { label: "Schlüssel-ID" },
  key: { label: "Anwendungsschlüssel" },
  url: { label: "Adresse", placeholder: "z. B. https://cloud.example.org/remote.php/webdav" },
  user: { label: "Benutzer" },
  pass: { label: "Passwort" },
};

/** Label, placeholder and hint of a provider field in the words of the form. */
export function fieldWords(field: CloudField): { label: string; placeholder: string; hint: string | undefined } {
  const words = FIELD_WORDS[field.key];
  const label = words?.label ?? field.label;
  return {
    label: field.required ? label : `${label} (optional)`,
    placeholder: words?.placeholder ?? (field.placeholder ? `z. B. ${field.placeholder}` : ""),
    hint: words?.hint ?? field.hint ?? undefined,
  };
}

/** Where on the provider the location starts: a bucket for object storage, a folder otherwise. */
export function rootWords(provider: CloudProvider): FieldWords {
  if (provider === "s3" || provider === "b2") {
    return { label: "Bucket und Ordner", placeholder: "z. B. fotos-backup/clonq", hint: "Den Bucket muss es beim Anbieter schon geben." };
  }
  return { label: "Ordner", placeholder: "z. B. Backups/clonq", hint: "Ohne Angabe verwendet clonq die oberste Ebene." };
}

const HOME = /^\/Users\/[^/]+/;

/** "/Users/anna/Desktop" → "~/Desktop". */
export function tidyPath(path: string): string {
  return path.replace(HOME, "~");
}

// Finder shows the standard folders of the home folder under German names.
const FINDER_NAMES: Record<string, string> = {
  Desktop: "Schreibtisch",
  Documents: "Dokumente",
  Downloads: "Downloads",
  Pictures: "Bilder",
  Movies: "Filme",
  Music: "Musik",
  Public: "Öffentlich",
};

/** A name for a folder location, from its path. */
export function folderName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  const last = parts.at(-1) ?? "";
  const inHome = parts.length === 4 && parts[1] === "Users";
  return (inHome ? FINDER_NAMES[last] : undefined) ?? last;
}

const FILE_SYSTEMS: Record<string, string> = {
  apfs: "APFS",
  hfs: "Mac OS Extended",
  exfat: "ExFAT",
  msdos: "FAT32",
  ntfs: "NTFS",
};

export function fileSystemLabel(fileSystem: string): string {
  return FILE_SYSTEMS[fileSystem.toLowerCase()] ?? fileSystem.toUpperCase();
}

/** Tauri rejects with the error text the Rust side sent. */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
