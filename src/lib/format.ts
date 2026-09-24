// Numbers, sizes and times in the format of the interface language.

import { locale, texts } from "../i18n";

// Formatters are cached per locale, because the language can change while the app runs.
const cache = new Map<string, { number: Intl.NumberFormat; relative: Intl.RelativeTimeFormat; dateTime: Intl.DateTimeFormat }>();

function formatters() {
  const tag = locale();
  let found = cache.get(tag);
  if (!found) {
    found = {
      number: new Intl.NumberFormat(tag),
      relative: new Intl.RelativeTimeFormat(tag, { numeric: "auto" }),
      dateTime: new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }),
    };
    cache.set(tag, found);
  }
  return found;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatCount(value: number): string {
  return formatters().number.format(value);
}

/** Decimal units, like Finder. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString(locale(), { maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")} h`;
  if (minutes > 0) return `${minutes}:${String(rest).padStart(2, "0")} min`;
  return `${rest} s`;
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const diffSeconds = (new Date(iso).getTime() - now) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(diffSeconds) >= size) return formatters().relative.format(Math.round(diffSeconds / size), unit);
  }
  return texts().common.justNow;
}

export function formatDateTime(iso: string): string {
  return formatters().dateTime.format(new Date(iso));
}

export function runDurationSeconds(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  return (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000;
}

/**
 * A 2400-foot reel of 9-track tape at 6250 bpi held about 150 MB
 * (https://en.wikipedia.org/wiki/9-track_tape).
 */
export const BYTES_PER_REEL = 150_000_000;

export function formatReels(bytes: number): string {
  const reels = bytes / BYTES_PER_REEL;
  const t = texts().common;
  if (reels === 0) return t.reels(0, "0");
  if (reels < 0.1) return t.reelsBelow((0.1).toLocaleString(locale()));
  const digits = reels < 10 ? 1 : 0;
  return t.reels(reels, reels.toLocaleString(locale(), { maximumFractionDigits: digits }));
}

export function formatPercent(value: number, digits = 0): string {
  return texts().common.percent(value.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }));
}

export function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
}

/** A date with its year, e.g. for how long a licence covers updates: "24. Sept. 2027". */
export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}

/** "2026-09-23_14-05-09" as a readable local date and time. */
export function formatStamp(stamp: string): string {
  // Since 0.3.2 the name ends in milliseconds ("…_14-05-09-123"); older names have none.
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-\d{3})?$/);
  if (!match) return stamp;
  const [, y, mo, d, h, mi, se] = match;
  return formatters().dateTime.format(new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)));
}
