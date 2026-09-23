import type { Ring } from "../../../lib/types";
import { arcTo, pt, tangent, type Point, type Wheel } from "./geometry";
import { ReelShape, packRadius } from "./ReelShape";
import {
  Capstan,
  HEAD_CONTACT,
  HEAD_HEIGHT,
  Idler,
  LEG_INSET,
  PlatePocket,
  Puck,
  TAPE,
  TapeHead,
  TransportPlate,
  VacuumColumn,
} from "./TapeTransport";

interface UiReelPairProps {
  ring: Ring;
  /** 0–100 while running; decides how much tape has moved from top to bottom. */
  progress: number;
  running: boolean;
  label: string;
}

// Geometry in viewBox units, laid out like a DEC TE16 with the reels stacked:
// the file reel on top, the machine reel below, and to their right a transport
// plate. The tape runs over two guides into the tall column, back up over the
// steel idler, down through the head and past the capstan into the short
// column, and from there over a guide onto the machine reel.
const W = 158;
const H = 256;
const R = 46;
const TOP: Point = { x: 49, y: 49 };
const BOTTOM: Point = { x: 49, y: 207 };

const PLATE = { x: 99, y: 1, width: 57, height: 254 };
/** The recess in the plate that holds the head and the capstan. */
const POCKET = { x: 103, y: 30.5, width: 29, height: 70 };

/** The tape passes through the head along this line. */
const TAPE_X = 121;
const HEAD_Y = 35;

const CHANNEL = 14;
const SHORT = { x: TAPE_X + LEG_INSET - CHANNEL, top: 111, bottom: 253, rest: 207 };
const TALL = { x: 136.2, top: 33, bottom: 253, rest: 156 };
const TALL_LEFT_LEG = TALL.x + LEG_INSET;
const TALL_RIGHT_LEG = TALL.x + CHANNEL - LEG_INSET;
const SHORT_LEFT_LEG = SHORT.x + LEG_INSET;

/** The supply run along the top of the plate. */
const SUPPLY_Y = 6;
const GUIDE_R = 2.6;
const ENTRY: Wheel = { x: 104.5, y: SUPPLY_Y + GUIDE_R, r: GUIDE_R };
const CORNER: Wheel = { x: TALL_RIGHT_LEG - GUIDE_R, y: SUPPLY_Y + GUIDE_R, r: GUIDE_R };
const EXIT: Wheel = { x: SHORT_LEFT_LEG - GUIDE_R, y: SHORT.top - GUIDE_R - 3.6, r: GUIDE_R };

/** The idler bridges the tall column's inner leg and the head line. */
const IDLER: Wheel = { x: (TAPE_X + TALL_LEFT_LEG) / 2, y: 19.5, r: (TALL_LEFT_LEG - TAPE_X) / 2 };

/**
 * The capstan sits beside the head, as on the IBM 3420. Its radius is three
 * quarters of the idler's, so the tape turns the idler through 3/4 of the
 * capstan's angle; the keyframes in lab.css rely on that ratio.
 */
const CAPSTAN_R = IDLER.r * 0.75;
const CAPSTAN: Wheel = {
  x: TAPE_X - TAPE / 2 - CAPSTAN_R,
  y: HEAD_Y + HEAD_HEIGHT + 3 + CAPSTAN_R,
  r: CAPSTAN_R,
};

/** Pick the tangent whose point on the reel lies furthest to the right. */
function reelTangent(reel: Wheel, guide: Wheel): [Point, Point] {
  const a = tangent(reel, guide, 1);
  const b = tangent(reel, guide, -1);
  return a[0].x > b[0].x ? a : b;
}

function tapePath(topPack: number, bottomPack: number): string {
  // File reel -> entry guide (crossing), along the top, over the corner guide, down into the tall column.
  const [leave, onEntry] = reelTangent({ ...TOP, r: topPack }, { ...ENTRY, r: -ENTRY.r });
  const entryTop = { x: ENTRY.x, y: ENTRY.y - ENTRY.r };
  const cornerTop = { x: CORNER.x, y: CORNER.y - CORNER.r };
  const cornerSide = { x: CORNER.x + CORNER.r, y: CORNER.y };
  const supply = [
    `M ${pt(leave)} L ${pt(onEntry)}`,
    arcTo(ENTRY, entryTop, 1),
    `L ${pt(cornerTop)}`,
    arcTo(CORNER, cornerSide, 1),
    `L ${pt({ x: cornerSide.x, y: TALL.top + 1 })}`,
  ].join(" ");

  // Tall column's inner leg -> over the idler -> down through the head, past the capstan, into the short column.
  const idlerRight = { x: IDLER.x + IDLER.r, y: IDLER.y };
  const idlerLeft = { x: IDLER.x - IDLER.r, y: IDLER.y };
  const transport = [
    `M ${pt({ x: idlerRight.x, y: TALL.top + 1 })} L ${pt(idlerRight)}`,
    arcTo(IDLER, idlerLeft, 0),
    `L ${pt({ x: TAPE_X, y: SHORT.top + 1 })}`,
  ].join(" ");

  // Short column's outer leg -> over the exit guide -> down onto the machine reel.
  const [arrive, offExit] = reelTangent({ ...BOTTOM, r: bottomPack }, { ...EXIT, r: -EXIT.r });
  const exitRight = { x: EXIT.x + EXIT.r, y: EXIT.y };
  const takeUp = [`M ${pt({ x: exitRight.x, y: SHORT.top + 1 })} L ${pt(exitRight)}`, arcTo(EXIT, offExit, 0), `L ${pt(arrive)}`].join(" ");

  return `${supply} ${transport} ${takeUp}`;
}

// A few wraps of leader stay on the file reel at the end, and on the machine reel at the start.
const LEADER = 0.03;

export function UiReelPair({ ring, progress, running, label }: UiReelPairProps) {
  const p = Math.min(100, Math.max(0, progress)) / 100;
  const topFill = LEADER + (1 - p) * (1 - 2 * LEADER);
  const bottomFill = LEADER + p * (1 - 2 * LEADER);
  const tape = tapePath(packRadius(R, topFill), packRadius(R, bottomFill));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-auto" role="img" aria-label={label}>
      <TransportPlate {...PLATE} />
      <PlatePocket {...POCKET} />
      <VacuumColumn x={TALL.x} width={CHANNEL} top={TALL.top} bottom={TALL.bottom} rest={TALL.rest} running={running} phase="a" />
      <VacuumColumn x={SHORT.x} width={CHANNEL} top={SHORT.top} bottom={SHORT.bottom} rest={SHORT.rest} running={running} phase="b" />
      <TapeHead x={TAPE_X} y={HEAD_Y} running={running} />

      <Puck at={ENTRY} />
      <Puck at={CORNER} />
      <Puck at={EXIT} />
      <Idler at={IDLER} running={running} />
      <Capstan at={CAPSTAN} running={running} />

      <path d={tape} fill="none" strokeWidth={TAPE} strokeLinejoin="round" className="stroke-(--vakuum-tape)" />
      {/* Blocks passing the head: the tape on the head face brightens in step with the lamp. */}
      {running ? (
        <line
          x1={TAPE_X}
          y1={HEAD_Y + HEAD_CONTACT.from}
          x2={TAPE_X}
          y2={HEAD_Y + HEAD_CONTACT.to}
          strokeWidth={TAPE}
          className="vakuum-lamp stroke-(--vakuum-tape-hi)"
        />
      ) : null}

      <ReelShape cx={TOP.x} cy={TOP.y} r={R} ring={ring} fill={topFill} spinning={running} angle={14} reverse />
      <ReelShape cx={BOTTOM.x} cy={BOTTOM.y} r={R} ring={ring} fill={bottomFill} spinning={running} angle={-31} slow />
    </svg>
  );
}
