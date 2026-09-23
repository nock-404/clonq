import { useId } from "react";
import { polar, sector, type Wheel } from "./geometry";

/** Stroke width of the tape in viewBox units; 1.6 still reads at h-64 on a 1x screen. */
export const TAPE = 1.6;

/**
 * The loop's legs keep this much distance (centre line) from the column walls.
 * A real loop touches both walls; the gap keeps the tape from reading as the wall.
 */
export const LEG_INSET = 2.2;

/** Wall thickness of a vacuum column. */
const WALL = 2.2;

function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

// ---------------------------------------------------------------------------
// Transport plate

interface TransportPlateProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The machine face that carries columns, head and guides, so they read as one drive. */
export function TransportPlate({ x, y, width, height }: TransportPlateProps) {
  const id = useSvgId();
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-plate`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="vakuum-stop-plate-hi" />
          <stop offset="0.35" className="vakuum-stop-plate" />
          <stop offset="1" className="vakuum-stop-plate" />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={height} rx="4" fill={`url(#${id}-plate)`} />
      <rect x={x + 0.25} y={y + 0.25} width={width - 0.5} height={height - 0.5} rx="3.8" fill="none" strokeWidth="0.5" className="stroke-white/7" />
    </g>
  );
}

/** A brushed insert set into the plate, carrying the head and the capstan. */
export function PlatePocket({ x, y, width, height }: TransportPlateProps) {
  const id = useSvgId();
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-insert`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" className="vakuum-stop-alu-hi" />
          <stop offset="0.5" className="vakuum-stop-alu" />
          <stop offset="1" className="vakuum-stop-alu-lo" />
        </linearGradient>
      </defs>
      <rect x={x + 0.5} y={y + 1} width={width} height={height} rx="2.4" className="fill-black/30" />
      <rect x={x} y={y} width={width} height={height} rx="2.4" fill={`url(#${id}-insert)`} strokeWidth="0.4" className="stroke-black/45" />
      <path d={`M ${x + 0.4} ${y + height - 2.4} V ${y + 2.4} Q ${x + 0.4} ${y + 0.4} ${x + 2.4} ${y + 0.4} H ${x + width - 2.4}`} fill="none" strokeWidth="0.4" className="stroke-white/14" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Vacuum column

interface VacuumColumnProps {
  /** Left wall of the channel the tape runs in. */
  x: number;
  /** Inner width of the channel. */
  width: number;
  /** The open mouth, where the tape comes in and goes out. */
  top: number;
  /** End of the rounded foot. */
  bottom: number;
  /** Where the bottom of the loop rests when the drive stands still. */
  rest: number;
  running: boolean;
  /** Which reel's clock the loop follows: a is the file reel, b the machine reel. */
  phase: "a" | "b";
}

/** The moving loop group reaches this far above and below its rest, 500 units in all (see lab.css). */
const REACH = 250;

/**
 * A vacuum column seen from the front: the tape stands on edge, so a loop is a
 * thin U. Inside the U is air, lit faintly; below it the vacuum, dark.
 */
export function VacuumColumn({ x, width, top, bottom, rest, running, phase }: VacuumColumnProps) {
  const id = useSvgId();
  const outerLeft = x - WALL;
  const outerRight = x + width + WALL;
  const half = width / 2;
  const channelBottom = bottom - WALL * 1.6;
  // The column is a flat machined plate; only the channel inside has a rounded foot.
  const body = { x: outerLeft, y: top - 1.2, width: outerRight - outerLeft, height: bottom - top + 1.2 };
  const channel = `M ${x} ${top} V ${channelBottom - half} A ${half} ${half} 0 0 0 ${x + width} ${channelBottom - half} V ${top} Z`;

  const leftLeg = x + LEG_INSET;
  const rightLeg = x + width - LEG_INSET;
  const radius = (rightLeg - leftLeg) / 2;
  const bend = rest - radius;
  const u = `M ${leftLeg} ${rest - REACH} V ${bend} A ${radius} ${radius} 0 0 0 ${rightLeg} ${bend} V ${rest - REACH}`;
  const vacuum = `M ${x} ${bend} H ${leftLeg} A ${radius} ${radius} 0 0 0 ${rightLeg} ${bend} H ${x + width} V ${rest + REACH} H ${x} Z`;

  // Two sensors keep the bend between them, two more stop the drive on a fault.
  const sensors = [top + 14, rest - 20, rest + 20, channelBottom - half - 4];

  return (
    <g>
      <defs>
        <linearGradient id={`${id}-alu`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="vakuum-stop-alu-hi" />
          <stop offset="0.4" className="vakuum-stop-alu" />
          <stop offset="1" className="vakuum-stop-alu-lo" />
        </linearGradient>
        <clipPath id={`${id}-channel`}>
          <path d={channel} />
        </clipPath>
      </defs>

      <rect {...body} rx="1.4" transform="translate(0.5 1)" className="fill-black/30" />
      <rect {...body} rx="1.4" fill={`url(#${id}-alu)`} strokeWidth="0.4" className="stroke-black/45" />
      <line x1={outerLeft + 0.4} y1={top - 0.9} x2={outerLeft + 0.4} y2={bottom - 1} strokeWidth="0.35" className="stroke-white/12" />
      <path d={channel} className="fill-(--vakuum-channel)" />

      <g clipPath={`url(#${id}-channel)`}>
        <g className={`spin-origin ${running ? `vakuum-loop-${phase}` : ""}`}>
          <path d={vacuum} className="fill-black/65" />
          <path d={`${u} Z`} className="fill-white/9" />
          <path d={u} fill="none" strokeWidth={TAPE} className="stroke-(--vakuum-tape)" />
        </g>
        {/* The channel is sunk into the column: its walls throw a thin shadow inwards. */}
        <path d={channel} fill="none" strokeWidth="1.4" className="stroke-black/45" />
      </g>

      {/* Mouth: the channel opens at the top edge of the plate. */}
      <line x1={x} y1={top - 0.2} x2={x + width} y2={top - 0.2} strokeWidth="0.5" className="stroke-black/50" />
      {sensors.map((y) => (
        <circle key={y} cx={outerRight - WALL / 2} cy={y} r="0.55" className="fill-black/55" />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Guides, idler, capstan

/** A fixed guide puck, the light kind a TE16 has at the top of its columns. */
export function Puck({ at }: { at: Wheel }) {
  const { x: cx, y: cy, r } = at;
  return (
    <g>
      <circle cx={cx + 0.3} cy={cy + 0.6} r={r} className="fill-black/35" />
      <circle cx={cx} cy={cy} r={r} strokeWidth="0.35" className="fill-(--vakuum-puck) stroke-(--vakuum-puck-lo)" />
      <circle cx={cx} cy={cy} r={r * 0.3} className="fill-(--vakuum-puck-lo)" />
    </g>
  );
}

/** The steel idler with four holes. Tape turns it, so it follows the capstan's clock (see lab.css). */
export function Idler({ at, running }: { at: Wheel; running: boolean }) {
  const id = useSvgId();
  const { x: cx, y: cy, r } = at;
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-steel`} cx="0.5" cy="0.5" r="0.5" fx="0.38" fy="0.32">
          <stop offset="0" className="vakuum-stop-steel" />
          <stop offset="0.7" className="vakuum-stop-steel-lo" />
          <stop offset="1" className="vakuum-stop-steel-dk" />
        </radialGradient>
      </defs>
      <circle cx={cx + 0.4} cy={cy + 0.9} r={r} className="fill-black/35" />
      <g className={`spin-origin ${running ? "vakuum-idler" : ""}`}>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-steel)`} strokeWidth="0.4" className="stroke-black/45" />
        <circle cx={cx} cy={cy} r={r * 0.82} fill="none" strokeWidth="0.3" className="stroke-black/25" />
        {[45, 135, 225, 315].map((a) => {
          const h = polar(cx, cy, r * 0.5, a);
          return <circle key={a} cx={h.x} cy={h.y} r={r * 0.19} className="fill-(--vakuum-plate)" />;
        })}
        <circle cx={cx} cy={cy} r={r * 0.16} strokeWidth="0.3" className="fill-(--vakuum-steel) stroke-black/40" />
      </g>
    </g>
  );
}

/** The capstan: a matte rubber roller on a thin steel shaft, one index mark to show it jerk. */
export function Capstan({ at, running }: { at: Wheel; running: boolean }) {
  const { x: cx, y: cy, r } = at;
  const mark = polar(cx, cy, r * 0.7, -90);
  return (
    <g>
      <circle cx={cx + 0.4} cy={cy + 0.9} r={r} className="fill-black/40" />
      <g className={`spin-origin ${running ? "vakuum-capstan" : ""}`}>
        <circle cx={cx} cy={cy} r={r} className="fill-(--vakuum-rubber)" />
        <circle cx={mark.x} cy={mark.y} r={r * 0.13} className="fill-ink/45" />
        <circle cx={cx} cy={cy} r={r * 0.3} className="fill-(--vakuum-steel-lo)" />
        <circle cx={cx} cy={cy} r={r * 0.12} className="fill-(--vakuum-steel-dk)" />
      </g>
      <circle cx={cx} cy={cy} r={r - 0.2} fill="none" strokeWidth="0.4" className="stroke-black/60" />
      <path d={sector(cx, cy, r * 0.72, r * 0.95, 200, 250)} className="fill-white/7" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Head cover

/** Height of the head cover in viewBox units; the tape enters at its top and leaves at its bottom. */
export const HEAD_HEIGHT = 46;

// Extent of the cover to the left and right of the tape's centre line.
const HEAD_LEFT = 15;
const HEAD_RIGHT = 7;
const SLOT = 1.9;
/** The flap is a D, as on the TE16: flat on the tape side, round away from it. */
const D_RADIUS = 11;
const EDGE_RADIUS = 1.6;

/** Where the tape touches the head, relative to the top of the cover. */
export const HEAD_CONTACT = { from: 14, to: 30 };

interface TapeHeadProps {
  /** Where the tape runs through the head (its centre line). */
  x: number;
  /** Top of the cover. */
  y: number;
  running: boolean;
}

/**
 * One compact head cover in matte dark anodising: a D-shaped flap, one
 * engraved parting line, a slot the tape runs through, and inside the slot only
 * the polished strip of the head where the tape touches it. The lamp on the
 * flap is the drive's running light.
 */
export function TapeHead({ x, y, running }: TapeHeadProps) {
  const id = useSvgId();
  const l = -HEAD_LEFT;
  const rt = HEAD_RIGHT;
  const h = HEAD_HEIGHT;
  const d = D_RADIUS;
  const e = EDGE_RADIUS;
  const body = [
    `M ${rt - e} 0 Q ${rt} 0 ${rt} ${e}`,
    `V ${h - e} Q ${rt} ${h} ${rt - e} ${h}`,
    `H ${l + d} A ${d} ${d} 0 0 1 ${l} ${h - d}`,
    `V ${d} A ${d} ${d} 0 0 1 ${l + d} 0 Z`,
  ].join(" ");
  // Light falls from the top left: a bright edge along the round side and the top.
  const litEdge = `M ${l + 0.35} ${h - d} V ${d} A ${d - 0.35} ${d - 0.35} 0 0 1 ${l + d} 0.35 H ${rt - e}`;
  const lamp = { x: -5.4, y: 8.2 };
  const parting = 33.5;

  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <linearGradient id={`${id}-anod`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" className="vakuum-stop-anod-hi" />
          <stop offset="1" className="vakuum-stop-anod" />
        </linearGradient>
        <linearGradient id={`${id}-polish`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="vakuum-stop-steel-lo" />
          <stop offset="0.5" className="vakuum-stop-steel-hi" />
          <stop offset="1" className="vakuum-stop-steel-lo" />
        </linearGradient>
      </defs>

      <path d={body} transform="translate(0.7 1.5)" className="fill-black/45" />
      <path d={body} fill={`url(#${id}-anod)`} strokeWidth="0.4" className="stroke-black/60" />
      <path d={litEdge} fill="none" strokeWidth="0.5" className="stroke-white/16" />

      {/* The slot the tape runs through, and the polished head face inside it. */}
      <rect x={-SLOT} y="0" width={SLOT * 2} height={h} className="fill-(--vakuum-slot)" />
      <rect
        x={-SLOT}
        y={HEAD_CONTACT.from}
        width={SLOT - TAPE / 2}
        height={HEAD_CONTACT.to - HEAD_CONTACT.from}
        rx="0.3"
        fill={`url(#${id}-polish)`}
      />
      <line
        x1={-SLOT}
        y1={(HEAD_CONTACT.from + HEAD_CONTACT.to) / 2}
        x2={-TAPE / 2}
        y2={(HEAD_CONTACT.from + HEAD_CONTACT.to) / 2}
        strokeWidth="0.35"
        className="stroke-black/70"
      />

      {/* One engraved parting line. */}
      {[
        [l + 1.2, -SLOT - 1.2],
        [SLOT + 1.2, rt - 1.2],
      ].map(([from = 0, to = 0]) => (
        <g key={from}>
          <line x1={from} y1={parting} x2={to} y2={parting} strokeWidth="0.5" className="stroke-black/60" />
          <line x1={from} y1={parting + 0.5} x2={to} y2={parting + 0.5} strokeWidth="0.3" className="stroke-white/8" />
        </g>
      ))}

      {/* Running lamp in a small bezel, beside the tape where it enters the head. */}
      <circle cx={lamp.x} cy={lamp.y} r="2.7" strokeWidth="0.35" className="fill-black/60 stroke-white/12" />
      {running ? (
        <g className="vakuum-lamp">
          <circle cx={lamp.x} cy={lamp.y} r="5" className="fill-accent/20" />
          <circle cx={lamp.x} cy={lamp.y} r="3.2" className="fill-accent/25" />
          <circle cx={lamp.x} cy={lamp.y} r="1.95" className="fill-accent" />
          <circle cx={lamp.x - 0.5} cy={lamp.y - 0.5} r="0.6" className="fill-white/65" />
        </g>
      ) : (
        <circle cx={lamp.x} cy={lamp.y} r="1.95" className="fill-ink/10" />
      )}
    </g>
  );
}
