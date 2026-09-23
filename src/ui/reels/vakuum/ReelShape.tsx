import { useId } from "react";
import type { Ring } from "../../../lib/types";
import { clamp01, disc, polar, pt, roundedSector, sector } from "./geometry";

/**
 * How much of the reel is drawn. All three speak the same language (dark
 * tinted flange, coloured rim, three windows onto the wound tape, a small hub
 * in a coloured ring); "icon" keeps only what survives at 1.25–1.75rem,
 * "medium" adds the hub latch and the sheen on the pack, "full" is the hero.
 */
export type ReelDetail = "icon" | "medium" | "full";

interface ReelShapeProps {
  cx: number;
  cy: number;
  /** Outer radius of the flange. */
  r: number;
  ring: Ring;
  /** How much tape is wound on, 0 (bare hub) to 1 (full 2400 ft reel). */
  fill: number;
  spinning: boolean;
  /** Turn counter-clockwise. */
  reverse?: boolean;
  /** Use the second kick pattern, so two reels never move in step. */
  slow?: boolean;
  /** Where the flange came to rest, in degrees; two reels side by side should not stand alike. */
  angle?: number;
  detail?: ReelDetail;
}

// ECMA-62 proportions, as fractions of the flange radius.
const BARREL = 0.49;
const FULL = 0.94;

/** Radius of the wound tape. Tape length grows with the area, not the radius. */
export function packRadius(r: number, fill: number): number {
  return r * Math.sqrt(BARREL * BARREL + clamp01(fill) * (FULL * FULL - BARREL * BARREL));
}

const ringClasses: Record<Ring, string> = {
  red: "vakuum-ring-red",
  yellow: "vakuum-ring-yellow",
  blue: "vakuum-ring-blue",
  green: "vakuum-ring-green",
  white: "vakuum-ring-white",
};

interface Look {
  /** Half the opening angle of each window, in degrees. */
  span: number;
  /** Inner and outer edge of the windows. */
  inner: number;
  outer: number;
  /** Stroke width of the coloured rim. */
  rim: number;
  /** Centre line and stroke width of the write-enable ring. */
  band: number;
  bandWidth: number;
  /** Radius of the drive hub knob. */
  hub: number;
}

// Fractions of the flange radius. Icons get narrower windows and a heavier
// rim, so the glyph stays a reel at 1.25rem and never turns into a trefoil.
const looks: Record<ReelDetail, Look> = {
  icon: { span: 20, inner: 0.52, outer: 0.84, rim: 0.1, band: 0.33, bandWidth: 0.09, hub: 0.19 },
  medium: { span: 25, inner: 0.52, outer: 0.87, rim: 0.06, band: 0.37, bandWidth: 0.055, hub: 0.26 },
  full: { span: 28, inner: 0.5, outer: 0.89, rim: 0.035, band: 0.39, bandWidth: 0.04, hub: 0.27 },
};

const WINDOW_ANGLES = [-90, 30, 150];

function flangeWindows(cx: number, cy: number, r: number, look: Look): string {
  return WINDOW_ANGLES.map((a) => roundedSector(cx, cy, r * look.inner, r * look.outer, a - look.span, a + look.span, r * 0.07)).join(" ");
}

/** Fine concentric hairlines in the wound tape, spaced unevenly like real layers. */
function packLines(r: number, pack: number): number[] {
  const lines: number[] = [];
  let radius = r * BARREL + r * 0.035;
  let step = 0;
  while (radius < pack - r * 0.02) {
    lines.push(radius);
    step += 1;
    radius += r * (0.028 + ((step * 7) % 5) * 0.007);
  }
  return lines;
}

/** The drive hub's latch: a knob with three rounded grip lobes, so its turn reads. */
function lobes(cx: number, cy: number, base: number, amplitude: number): string {
  const points = Array.from({ length: 72 }, (_, i) => {
    const a = i * 5;
    return polar(cx, cy, base + amplitude * Math.cos((3 * (a + 90) * Math.PI) / 180), a);
  });
  return `M ${points.map(pt).join(" L ")} Z`;
}

/**
 * A satin bow-tie band across the wound layers: the light stays put while the
 * flange turns, so it slides through the windows as the reel kicks.
 */
function PackSheen({ cx, cy, from, to }: { cx: number; cy: number; from: number; to: number }) {
  return (
    <g className="fill-white">
      {[34, 22, 13, 6, 2].map((half) => (
        <path
          key={half}
          d={`${sector(cx, cy, from, to, 222 - half, 222 + half)} ${sector(cx, cy, from, to, 42 - half, 42 + half)}`}
          fillOpacity={0.05}
        />
      ))}
    </g>
  );
}

function motionClass(spinning: boolean, reverse: boolean, slow: boolean): string {
  if (!spinning) return "";
  return `vakuum-kick-${slow ? "b" : "a"}${reverse ? "-ccw" : ""}`;
}

/** One reel, drawn into a surrounding SVG. The flange and hub turn; the wound tape and the light on it stay put. */
export function ReelShape({ cx, cy, r, ring, fill, spinning, reverse = false, slow = false, angle = 0, detail = "full" }: ReelShapeProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const look = looks[detail];
  const pack = packRadius(r, fill);
  const motion = motionClass(spinning, reverse, slow);
  const windows = flangeWindows(cx, cy, r, look);
  const face = `${disc(cx, cy, r * 0.985)} ${windows}`;
  const rest = angle ? `rotate(${angle} ${cx} ${cy})` : undefined;

  if (detail === "icon") {
    return (
      <g className={ringClasses[ring]}>
        <circle cx={cx} cy={cy} r={r * 0.98} className="vakuum-face-back" />
        <circle cx={cx} cy={cy} r={pack} className="fill-(--vakuum-tape)" />
        <g className={`spin-origin ${motion}`}>
          <g transform={rest}>
            <path d={face} fillRule="evenodd" className="vakuum-face" />
            <circle cx={cx} cy={cy} r={r * (0.985 - look.rim / 2)} fill="none" strokeWidth={r * look.rim} className="vakuum-rim" />
            <circle cx={cx} cy={cy} r={r * look.band} fill="none" strokeWidth={r * look.bandWidth} className="vakuum-rim" />
            <circle cx={cx} cy={cy} r={r * look.hub} className="fill-(--vakuum-steel-lo)" />
            <circle cx={cx} cy={cy} r={r * 0.07} className="fill-(--vakuum-plastic-lo)" />
          </g>
        </g>
      </g>
    );
  }

  const full = detail === "full";

  return (
    <g className={ringClasses[ring]}>
      <defs>
        <clipPath id={`${id}-windows`}>
          <path d={windows} />
        </clipPath>
        <radialGradient id={`${id}-knob`} cx="0.5" cy="0.5" r="0.5" fx="0.38" fy="0.32">
          <stop offset="0" className="vakuum-stop-steel-lo" />
          <stop offset="1" className="vakuum-stop-steel-dk" />
        </radialGradient>
        <linearGradient id={`${id}-latch`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" className="vakuum-stop-steel" />
          <stop offset="1" className="vakuum-stop-steel-lo" />
        </linearGradient>
        {/* Light on glossy plastic: brighter towards the top left, a shade darker at the bottom right. */}
        <linearGradient id={`${id}-gloss`} x1="0.15" y1="0.05" x2="0.85" y2="0.95">
          <stop offset="0" className="vakuum-stop-glint" stopOpacity="0.09" />
          <stop offset="0.45" className="vakuum-stop-glint" stopOpacity="0" />
          <stop offset="0.6" className="vakuum-stop-shade" stopOpacity="0" />
          <stop offset="1" className="vakuum-stop-shade" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <circle cx={cx + r * 0.02} cy={cy + r * 0.045} r={r * 0.99} className="fill-black/35" />

      {/* The back flange, seen through the windows where there is no tape. */}
      <circle cx={cx} cy={cy} r={r * 0.985} className="vakuum-face-back" />

      {/* The wound tape: the hero behind the windows, in full oxide colour. */}
      <circle cx={cx} cy={cy} r={pack} className="fill-oxide" />
      {full
        ? packLines(r, pack).map((radius, i) => (
            <circle
              key={radius}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              strokeWidth={r * 0.007}
              className={i % 3 === 1 ? "stroke-(--vakuum-tape)/70" : "stroke-oxide-deep/80"}
            />
          ))
        : null}
      {pack > r * (BARREL + 0.03) ? <PackSheen cx={cx} cy={cy} from={r * BARREL} to={pack} /> : null}
      <circle cx={cx} cy={cy} r={pack - r * 0.012} fill="none" strokeWidth={r * 0.024} className="stroke-(--vakuum-tape)" />

      {/* Flange and hub: this is what turns. */}
      <g className={`spin-origin ${motion}`}>
        <g transform={rest}>
          <path d={face} fillRule="evenodd" className="vakuum-face" />
          {/* The flange has thickness: its cut edge throws a shadow into each window, and a moulded lip catches the light. */}
          <path d={windows} fill="none" strokeWidth={r * 0.06} clipPath={`url(#${id}-windows)`} className="stroke-black/45" />
          <path d={windows} fill="none" strokeWidth={r * 0.012} strokeOpacity={0.4} className="vakuum-rim" />
          {full ? <circle cx={cx} cy={cy} r={r * 0.925} fill="none" strokeWidth={r * 0.012} className="stroke-white/6" /> : null}
          <circle cx={cx} cy={cy} r={r * (0.985 - look.rim / 2)} fill="none" strokeWidth={r * look.rim} className="vakuum-rim" />
          <circle cx={cx} cy={cy} r={r * look.band} fill="none" strokeWidth={r * look.bandWidth} className="vakuum-band" />

          {/* Drive hub: a dark steel knob sunk into the bore, with a three-lobed latch. */}
          <circle cx={cx} cy={cy} r={r * (look.hub + 0.018)} className="fill-black/55" />
          <circle cx={cx} cy={cy} r={r * look.hub} fill={`url(#${id}-knob)`} />
          <path d={lobes(cx, cy, r * 0.155, r * 0.035)} fill={`url(#${id}-latch)`} strokeWidth={r * 0.008} className="stroke-black/45" />
          <circle cx={cx} cy={cy} r={r * 0.05} className="fill-(--vakuum-plastic-lo)" />
        </g>
      </g>

      {/* The light on the plastic stays where it is while the flange turns. */}
      <circle cx={cx} cy={cy} r={r * 0.985} fill={`url(#${id}-gloss)`} />
      <path d={sector(cx, cy, r * (0.985 - look.rim), r * 0.985, 200, 250)} className="fill-white/30" />
    </g>
  );
}
