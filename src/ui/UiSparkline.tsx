import { useId } from "react";

interface UiSparklineProps {
  values: number[];
  /** Fixed number of slots, so a young run's curve grows from the left. */
  slots?: number;
  /** Marks the highest value with a dot. */
  markPeak?: boolean;
  label: string;
}

const W = 240;
const H = 60;

export function UiSparkline({ values, slots, markPeak = true, label }: UiSparklineProps) {
  const gradient = useId();
  const count = Math.max(slots ?? values.length, 2);
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => ({
    x: (index / (count - 1)) * W,
    y: H - 3 - (value / max) * (H - 8),
  }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const last = points.at(-1);
  const area = last ? `${line} L ${last.x.toFixed(1)} ${H} L 0 ${H} Z` : "";
  const peakIndex = values.indexOf(Math.max(...values));
  const peak = peakIndex >= 0 ? points[peakIndex] : undefined;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full text-accent" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-edge" />
      {points.length > 1 ? (
        <>
          <path d={area} fill={`url(#${gradient})`} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
      {markPeak && peak && values.length > 2 ? (
        <circle cx={peak.x} cy={peak.y} r="2.5" fill="currentColor" vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}
