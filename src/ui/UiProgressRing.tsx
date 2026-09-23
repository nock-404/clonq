import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { Tone } from "../lib/labels";
import { toneStroke } from "./tone";

type Size = "sm" | "md" | "lg";

interface UiProgressRingProps {
  /** 0–100, or null while the amount is not known yet. */
  value: number | null;
  tone?: Tone;
  size?: Size;
  children?: ReactNode;
}

const sizes: Record<Size, string> = {
  sm: "size-7",
  md: "size-10",
  lg: "size-14",
};

// Drawn in viewBox units, so the ring scales with the rem-sized box.
const RADIUS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function UiProgressRing({ value, tone = "accent", size = "md", children }: UiProgressRingProps) {
  const known = value !== null;
  const fraction = known ? Math.min(100, Math.max(0, value)) / 100 : 0.28;
  return (
    <div className={`relative grid shrink-0 place-items-center ${sizes[size]}`}>
      <motion.svg
        viewBox="0 0 40 40"
        className="absolute inset-0 size-full"
        animate={known ? { rotate: -90 } : { rotate: 270 }}
        transition={known ? { duration: 0 } : { duration: 1.1, repeat: Infinity, ease: "linear" }}
      >
        <circle cx="20" cy="20" r={RADIUS} fill="none" strokeWidth="3.5" className="stroke-track" />
        <motion.circle
          cx="20"
          cy="20"
          r={RADIUS}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          className={toneStroke[tone]}
          initial={false}
          animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - fraction) }}
          transition={{ type: "spring", stiffness: 120, damping: 24 }}
        />
      </motion.svg>
      <div className="relative">{children}</div>
    </div>
  );
}
