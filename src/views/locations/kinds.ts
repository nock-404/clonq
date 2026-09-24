// The kinds of location a user can add, and the words for them.

import type { CloudField, CloudProvider, Location } from "../../lib/types";
import { texts } from "../../i18n";
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

/** The order of the list in "Add location". */
export const KIND_ORDER: SetupKind[] = ["folder", "volume", "ssh", "smb", "cloud", "webdav"];

/** The kinds with their words in the current language. */
export function kinds(): KindInfo[] {
  return KIND_ORDER.map(kindInfo);
}

export function kindInfo(kind: SetupKind): KindInfo {
  const t = texts().locations.kinds;
  // In the order of the steps, whatever order a catalog lists them in.
  const lamps: Record<SetupKind, string[]> = {
    folder: [t.folder.lamps.folder, t.folder.lamps.added],
    volume: [t.volume.lamps.drive, t.volume.lamps.added],
    ssh: [t.ssh.lamps.trusted, t.ssh.lamps.installed, t.ssh.lamps.tested, t.ssh.lamps.folder],
    smb: [t.smb.lamps.address, t.smb.lamps.mount, t.smb.lamps.added],
    cloud: [t.cloud.lamps.provider, t.cloud.lamps.access, t.cloud.lamps.added],
    webdav: [t.webdav.lamps.address, t.webdav.lamps.access, t.webdav.lamps.added],
  };
  const words = t[kind];
  return { kind, title: words.title, short: words.short, long: words.long, needs: words.needs, lamps: lamps[kind] };
}

/** WebDAV is stored as a cloud location but drawn and named as its own kind. */
export function glyphOf(location: Location): GlyphKind {
  return glyphKindOf(location);
}

/** The kind of a location in words, the same as in "Add location". */
export function kindTitle(location: Location): string {
  return kindInfo(glyphOf(location)).title;
}

/** The full name of a provider; read at call time, so it follows the language. */
export const providerLabel: Record<CloudProvider, string> = {
  get s3() {
    return texts().locations.provider.s3;
  },
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
function knownField(key: string): FieldWords | undefined {
  const t = texts().locations.fields;
  const words: Record<string, FieldWords> = {
    endpoint: { label: t.endpoint, placeholder: t.endpointPlaceholder, hint: t.endpointHint },
    region: { label: t.region, placeholder: t.regionPlaceholder },
    access_key_id: { label: t.accessKeyId },
    secret_access_key: { label: t.secretAccessKey },
    account: { label: t.account },
    key: { label: t.key },
    url: { label: t.url, placeholder: t.urlPlaceholder },
    user: { label: t.user },
    pass: { label: t.pass },
  };
  return words[key];
}

/** Label, placeholder and hint of a provider field in the words of the form. */
export function fieldWords(field: CloudField): { label: string; placeholder: string; hint: string | undefined } {
  const t = texts().locations.fields;
  const words = knownField(field.key);
  const label = words?.label ?? field.label;
  return {
    label: field.required ? label : t.optional(label),
    placeholder: words?.placeholder ?? (field.placeholder ? t.example(field.placeholder) : ""),
    hint: words?.hint ?? field.hint ?? undefined,
  };
}

/** Where on the provider the location starts: a bucket for object storage, a folder otherwise. */
export function rootWords(provider: CloudProvider): FieldWords {
  const t = texts().locations.fields;
  if (provider === "s3" || provider === "b2") {
    return { label: t.bucket, placeholder: t.bucketPlaceholder, hint: t.bucketHint };
  }
  return { label: t.folder, placeholder: t.folderPlaceholder, hint: t.folderHint };
}

const HOME = /^\/Users\/[^/]+/;

/** "/Users/anna/Desktop" → "~/Desktop". */
export function tidyPath(path: string): string {
  return path.replace(HOME, "~");
}

/** A name for a folder location, from its path; the standard folders of the home folder get the Finder's name for them. */
export function folderName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  const last = parts.at(-1) ?? "";
  const inHome = parts.length === 4 && parts[1] === "Users";
  const finder: Record<string, string> = texts().locations.finder;
  return (inHome && Object.hasOwn(finder, last) ? finder[last] : undefined) ?? last;
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
