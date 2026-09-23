interface UiSegmentMeterProps {
  /** How full, 0 to 1. */
  value: number;
  /** Number of blocks along the bar. */
  segments?: number;
  size?: "sm" | "md";
  /** Colour of the filled blocks: written tape, or plain ink where tape colour would not stand out (e.g. on an amber card). */
  tone?: "oxide" | "ink";
  label: string;
}

const heights = { sm: "h-2", md: "h-3" };
const fills = { oxide: "fill-oxide-light", ink: "fill-ink/70" };

/**
 * A meter made of separate blocks, like the level lamps on an old drive
 * cabinet. Filled blocks have the colour of written tape; near the end they
 * turn to warning colours.
 */
export function UiSegmentMeter({ value, segments = 48, size = "md", tone = "oxide", label }: UiSegmentMeterProps) {
  const share = Math.min(1, Math.max(0, value));
  const lit = Math.round(share * segments);
  const fill = share >= 0.95 ? "fill-danger" : share >= 0.85 ? "fill-warn" : fills[tone];
  return (
    <svg
      viewBox={`0 0 ${segments * 4} 10`}
      preserveAspectRatio="none"
      className={`block w-full ${heights[size]}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
    >
      {Array.from({ length: segments }, (_, index) => (
        <rect key={index} x={index * 4} y="0" width="3" height="10" rx="0.5" className={index < lit ? fill : "fill-track"} />
      ))}
    </svg>
  );
}
