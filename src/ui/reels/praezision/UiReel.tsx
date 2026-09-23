import { useId } from "react";
import type { Ring } from "../../../lib/types";
import { ReelShape, type ReelDetail } from "./ReelShape";

type Size = "xs" | "sm" | "md" | "lg";

interface UiReelProps {
  ring: Ring;
  fill?: number;
  spinning?: boolean;
  size?: Size;
  label?: string;
}

const VIEW = 100;

const sizes: Record<Size, { box: string; detail: ReelDetail; rem: number }> = {
  xs: { box: "size-5", detail: "glyph", rem: 1.25 },
  sm: { box: "size-7", detail: "glyph", rem: 1.75 },
  md: { box: "size-10", detail: "mid", rem: 2.5 },
  lg: { box: "size-16", detail: "fine", rem: 4 },
};

/** Line width per detail, in CSS pixels: nothing thinner than one pixel below 4rem. */
const LINE_PIXELS: Record<ReelDetail, number> = { glyph: 1, mid: 1, fine: 0.75 };

/** Start offsets for the kick, so several turning reels in a list never tick in step. */
const PHASES = ["praezision-phase-0", "praezision-phase-1", "praezision-phase-2", "praezision-phase-3", "praezision-phase-4"] as const;

function phaseOf(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return PHASES[hash % PHASES.length] ?? PHASES[0];
}

/** A single reel as an icon. Below 2rem it switches to a bolder glyph instead of shrinking every line. */
export function UiReel({ ring, fill = 0.7, spinning = false, size = "sm", label }: UiReelProps) {
  const { box, detail, rem } = sizes[size];
  const phase = phaseOf(useId());
  // One CSS pixel in viewBox units: 1rem is 16 CSS pixels.
  const pixel = VIEW / (rem * 16);
  const line = pixel * LINE_PIXELS[detail];
  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={`shrink-0 ${box} ${spinning ? phase : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ReelShape cx={VIEW / 2} cy={VIEW / 2} r={VIEW / 2 - pixel * 0.5} ring={ring} fill={fill} spinning={spinning} detail={detail} line={line} angle={8} />
    </svg>
  );
}
