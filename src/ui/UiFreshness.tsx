import { formatRelative } from "../lib/format";
import type { Tone } from "../lib/labels";
import { toneText } from "./tone";
import { useT } from "../i18n";

interface UiFreshnessProps {
  /** When the target was last up to date; null if never. */
  at: string | null;
  now: number;
}

const HOUR = 3600;

/** How old the copy is. Fresh copies are green; the older, the warmer the colour. */
export function freshnessTone(at: string | null, now: number): Tone {
  if (!at) return "neutral";
  const age = (now - new Date(at).getTime()) / 1000;
  if (age < 6 * HOUR) return "ok";
  if (age < 48 * HOUR) return "warn";
  return "danger";
}

export function UiFreshness({ at, now }: UiFreshnessProps) {
  const t = useT();
  const tone = freshnessTone(at, now);
  const age = at ? (now - new Date(at).getTime()) / 1000 : Infinity;
  // A week of age empties the bar.
  const remaining = at ? Math.max(0.04, 1 - age / (7 * 24 * HOUR)) : 0;
  return (
    <div className="flex flex-col gap-2">
      <span className={`text-2xl font-semibold tracking-tight ${toneText[tone]}`}>{at ? formatRelative(at, now) : t.common.never}</span>
      <svg viewBox="0 0 100 3" preserveAspectRatio="none" className="h-[0.1875rem] w-full" aria-hidden>
        <rect width="100" height="3" rx="1.5" className="fill-track" />
        <rect width={remaining * 100} height="3" rx="1.5" className={`fill-current ${toneText[tone]}`} />
      </svg>
    </div>
  );
}
