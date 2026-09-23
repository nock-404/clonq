import { motion } from "motion/react";
import type { Tone } from "../lib/labels";
import { toneFill } from "./tone";

interface UiProgressBarProps {
  /** 0–100, or null while the amount is not known yet. */
  value: number | null;
  tone?: Tone;
}

// An SVG in viewBox units: the bar length is an attribute, not a style.
export function UiProgressBar({ value, tone = "accent" }: UiProgressBarProps) {
  const known = value !== null;
  const width = known ? Math.min(100, Math.max(0, value)) : 30;
  return (
    <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="block h-1 w-full overflow-hidden rounded-full">
      <rect x="0" y="0" width="100" height="4" rx="2" className="fill-track" />
      <motion.rect
        y="0"
        height="4"
        rx="2"
        className={toneFill[tone]}
        initial={false}
        animate={known ? { width, x: 0 } : { width, x: [-30, 100] }}
        transition={known ? { type: "spring", stiffness: 120, damping: 24 } : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  );
}
