import type { Tone } from "../lib/labels";

interface UiLampProps {
  tone?: Tone;
  /** Blinks while something is in progress. */
  busy?: boolean;
  /** Glows, e.g. when a step has just finished. */
  lit?: boolean;
}

const colours: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

const glows: Record<Tone, string> = {
  neutral: "",
  accent: "shadow-[0_0_0.5rem_var(--accent)]",
  ok: "shadow-[0_0_0.5rem_var(--ok)]",
  warn: "shadow-[0_0_0.5rem_var(--warn)]",
  danger: "shadow-[0_0_0.5rem_var(--danger)]",
};

/** One indicator lamp, as on the front of a drive cabinet. */
export function UiLamp({ tone = "neutral", busy = false, lit = false }: UiLampProps) {
  return (
    <span
      aria-hidden
      className={[
        "inline-block size-2 shrink-0 rounded-full",
        colours[tone],
        lit || busy ? glows[tone] : "",
        busy ? "animate-lamp" : "",
      ].join(" ")}
    />
  );
}
