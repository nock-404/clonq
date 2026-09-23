// Numbers, sizes and times the way a German Mac shows them.

const LOCALE = "de-DE";

const number = new Intl.NumberFormat(LOCALE);
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatCount(value: number): string {
  return number.format(value);
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
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: digits })} ${UNITS[unit]}`;
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
    if (Math.abs(diffSeconds) >= size) return relative.format(Math.round(diffSeconds / size), unit);
  }
  return "gerade eben";
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
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
  if (reels === 0) return "0 Spulen";
  if (reels < 0.1) return "< 0,1 Spulen";
  const digits = reels < 10 ? 1 : 0;
  const text = reels.toLocaleString(LOCALE, { maximumFractionDigits: digits });
  return `${text} ${reels === 1 ? "Spule" : "Spulen"}`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}

export function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });
}

/** "2026-09-23_14-05-09" as a readable local date and time. */
export function formatStamp(stamp: string): string {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return stamp;
  const [, y, mo, d, h, mi, se] = match;
  return dateTime.format(new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)));
}
