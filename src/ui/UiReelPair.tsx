import type { Ring } from "../lib/types";
import { ReelShape } from "./ReelShape";

interface UiReelPairProps {
  ring: Ring;
  /** 0–100 while running; decides how much tape has moved from top to bottom. */
  progress: number;
  running: boolean;
  label: string;
}

// Geometry in viewBox units: two reels stacked like in a tape cabinet,
// the tape running down the right side past two rollers and the head.
const W = 120;
const H = 250;
const R = 50;
const TOP = { x: 58, y: 60 };
const BOTTOM = { x: 58, y: 190 };
const ROLLER_X = 110;

function packRadius(fill: number): number {
  const hub = R * 0.3;
  return hub + (R * 0.94 - hub) * fill;
}

export function UiReelPair({ ring, progress, running, label }: UiReelPairProps) {
  const p = Math.min(100, Math.max(0, progress)) / 100;
  const topFill = 0.9 - p * 0.65;
  const bottomFill = 0.25 + p * 0.65;
  const topEdge = TOP.x + packRadius(topFill);
  const bottomEdge = BOTTOM.x + packRadius(bottomFill);
  const tape = `M ${topEdge} ${TOP.y} L ${ROLLER_X - 3} 104 L ${ROLLER_X - 3} 146 L ${bottomEdge} ${BOTTOM.y}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-auto" role="img" aria-label={label}>
      <ReelShape cx={TOP.x} cy={TOP.y} r={R} ring={ring} fill={topFill} spinning={running} reverse />
      <ReelShape cx={BOTTOM.x} cy={BOTTOM.y} r={R} ring={ring} fill={bottomFill} spinning={running} slow />
      <path d={tape} fill="none" strokeWidth="1.6" strokeLinejoin="round" className="stroke-oxide" />
      {running ? (
        <path
          d={tape}
          fill="none"
          strokeWidth="1.6"
          strokeDasharray="0.4 0.8"
          pathLength={20}
          className="animate-tape stroke-accent/70"
        />
      ) : null}
      <circle cx={ROLLER_X} cy={104} r="4" className="fill-ink/20 stroke-ink/40" strokeWidth="0.8" />
      <circle cx={ROLLER_X} cy={146} r="4" className="fill-ink/20 stroke-ink/40" strokeWidth="0.8" />
      <rect x={ROLLER_X - 7} y={116} width="10" height="18" rx="2" className={running ? "fill-accent" : "fill-ink/25"} />
    </svg>
  );
}
