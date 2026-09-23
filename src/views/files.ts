// Small helpers shared by the archive and the file browser: which icon a file gets, how paths,
// times and failures read.

import { File, FileCode, FileImage, FileText, Folder, type LucideIcon } from "lucide-react";
import { messageLabel } from "../lib/labels";

const imageExt = /\.(png|jpe?g|gif|webp|svg|heic|tiff?)$/i;
const codeExt = /\.(jsx?|tsx?|rs|go|py|sh|swift|vue|php|sql|css|html|json|ya?ml|toml|xml)$/i;
const textExt = /\.(txt|md|log|csv|env|ini|conf)$/i;

export function fileIcon(name: string, dir = false): LucideIcon {
  if (dir) return Folder;
  if (imageExt.test(name)) return FileImage;
  if (codeExt.test(name)) return FileCode;
  if (textExt.test(name)) return FileText;
  return File;
}

/** "a/b/c.txt" → ["a/b/", "c.txt"]. */
export function splitPath(path: string): [string, string] {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? ["", path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
}

export const joinPath = (base: string, name: string) => (base ? `${base}/${name}` : name);

/** A path under the home folder with ~ in front, as the Finder's Go menu writes it. */
export const tidyHome = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");

const DAY = 86_400_000;
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });
const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
const fixed = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "heute", "gestern", "Mo., 21. Sept.", "12. Sept.", "3. Feb. 2025": the day, as near as it is. */
export function dayWords(at: Date, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at.getTime())) / DAY);
  if (days === 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 7) return weekday.format(at);
  if (at.getFullYear() === new Date(now).getFullYear()) return dayMonth.format(at);
  return full.format(at);
}

/** "heute, 14:05". */
export function momentWords(at: Date, now: number): string {
  return `${dayWords(at, now)}, ${time.format(at)}`;
}

/** "23.09.2026, 14:05": one width for every date, for a column that is read top to bottom. */
export const fixedMoment = (at: Date) => fixed.format(at);

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** An archive folder name, "2026-09-23_14-05-09", as the local time it stands for. */
export function stampDate(stamp: string): Date | null {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, se] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
}

/**
 * A snapshot folder whose name starts with a date and a time, e.g. "2026-09-22T02-00-00", as that
 * moment; null for any other name, which is then shown as it is.
 */
export function snapshotDate(name: string): Date | null {
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})[T_ ](\d{2})[-:](\d{2})(?:[-:](\d{2}))?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, se] = match;
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0));
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "Datei" or "Dateien", with the number. */
export function filesWord(count: number, format: (value: number) => string): string {
  return count === 1 ? "eine Datei" : `${format(count)} Dateien`;
}

/** A text that ends like a sentence, whether or not it came with a full stop. */
export const sentence = (text: string) => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export interface Failure {
  /** One German sentence. */
  text: string;
  /** The backend's own words when there is no German for them yet, for a tooltip. */
  detail: string | null;
}

/**
 * A failed call in German: the lead says what did not work, and the backend message follows once
 * labels.ts knows it. Until then the English original stays out of the sentence. Messages that
 * already name what failed, e.g. "Das Kopieren ist fehlgeschlagen", can stand without the lead.
 */
export function failureOf(lead: string, reason: unknown, withLead = true): Failure {
  const raw = String(reason);
  const german = messageLabel(raw);
  if (german === raw) return { text: sentence(lead), detail: raw };
  return { text: sentence(withLead ? `${lead}: ${german}` : german), detail: null };
}
