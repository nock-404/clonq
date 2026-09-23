import { useId } from "react";
import type { Ring } from "../../../lib/types";
import { ReelShape, packRadius } from "./ReelShape";

interface UiReelPairProps {
  ring: Ring;
  /** 0–100 while running; decides how much tape has moved from top to bottom. */
  progress: number;
  running: boolean;
  label: string;
}

interface Point {
  x: number;
  y: number;
}

/** A circle the tape runs around; `r` is the radius of the tape's centre line. */
interface Circle extends Point {
  r: number;
}

// Geometry in viewBox units. A stacked tape cabinet: file reel on top, machine reel below,
// and on the right the tape path: vacuum column, head cluster, vacuum column.
const W = 168;
const H = 272;
const R = 50;
const TOP: Point = { x: 58, y: 62 };
const BOTTOM: Point = { x: 58, y: 210 };

const TAPE = 2;
const OPEN_TOP = 100;
const OPEN_BOTTOM = 172;
const COL = { x: 121, w: 22, top: 42, bottom: 230, corner: 4 };
const TL = COL.x + TAPE / 2 + 0.35;
const TR = COL.x + COL.w - TAPE / 2 - 0.35;
const LOOP_R = (TR - TL) / 2;
// The loops rest with their bends level with the reel centres. Each loop drawing is exactly
// 100 units tall, so a percentage in the CSS keyframes moves it by that many viewBox units.
const LOOP_LENGTH = 100;
const APEX_TOP = TOP.y;
const APEX_BOTTOM = BOTTOM.y;
// Four sensors per column, as offsets from the resting bend. The inner pair brackets the loop's
// travel and wakes the reel; the outer pair would stop the drive.
const SENSORS = [-10, -2.5, 4.4, 12];

// The deck the head cluster sits on. Its left side is cut to the reels, so it nestles between them.
const DECK = { left: 84, y: OPEN_TOP, right: 161, bottom: OPEN_BOTTOM, chamfer: 7, clearance: R + 5 };
const HEAD_Y = (OPEN_TOP + OPEN_BOTTOM) / 2;

// Flanged rollers where the tape enters and leaves the columns; the tape runs in a groove behind the flange.
const ROLLER = { flange: 5.2, groove: 4.2 };
const ROLLER_X = TL - ROLLER.groove - TAPE / 2;
const IDLER_TOP: Circle = { x: ROLLER_X, y: OPEN_TOP + 7.5, r: ROLLER.groove + TAPE / 2 };
const IDLER_BOTTOM: Circle = { x: ROLLER_X, y: OPEN_BOTTOM - 7.5, r: ROLLER.groove + TAPE / 2 };

// The tape wraps the head's crown by a few degrees, held by an air-bearing guide above and the capstan below.
const WRAP = 2.2;
const GUIDE_R = 2.6;
const CAPSTAN_R = 6.4;
const GUIDE: Circle = { x: TR + TAPE / 2 + GUIDE_R, y: OPEN_TOP + 11, r: GUIDE_R + TAPE / 2 };
const CAPSTAN: Circle = { x: TR + TAPE / 2 + CAPSTAN_R, y: OPEN_BOTTOM - 11, r: CAPSTAN_R + TAPE / 2 };

// The head: a machined block with a cylindrical face. Top down, in tape order: erase, write, read.
const HEAD = { left: COL.x, top: HEAD_Y - 14, bottom: HEAD_Y + 11, face: 26, round: 1.6 };
const CROWN_X = TR + WRAP - TAPE / 2;
const FACE: Circle = { x: CROWN_X - HEAD.face, y: HEAD_Y, r: HEAD.face + TAPE / 2 };
const SEAM = HEAD_Y - 6;
const GAPS = { erase: HEAD_Y - 9.5, write: HEAD_Y - 2.4, read: HEAD_Y + 2.4 };
// The cores behind the face: a narrow one for erase, a deeper one shared by write and read.
const CORES = [
  { top: HEAD.top + 2, bottom: SEAM - 1.2, depth: 1.3 },
  { top: SEAM + 1.2, bottom: HEAD.bottom - 2.2, depth: 1.8 },
];

// The brushed head plate carries the cleaner, the head and the BOT/EOT photocell.
const PLATE = { left: DECK.left + 24, top: HEAD_Y - 21, right: TR - TAPE / 2 - 1.8, bottom: HEAD_Y + 21, round: 2.4 };
const MOUNT = { left: PLATE.left + 4.5, top: HEAD_Y - 8, right: HEAD.left + 2, bottom: HEAD_Y + 7 };
const CLEANER = { y: (GUIDE.y + HEAD.top) / 2 + 0.5, blade: 4.4, holder: 3.8 };
const PHOTOCELL = { width: 7.5, top: HEAD.bottom + 3.2, height: 3.8 };
const LAMP = { x: DECK.left + 7, y: HEAD_Y, size: 4.4 };

const SCREWS: Point[] = [
  { x: DECK.left + 3.2, y: HEAD_Y - 20 },
  { x: DECK.left + 3.2, y: HEAD_Y + 20 },
  { x: DECK.right - 3.6, y: HEAD_Y },
  { x: PLATE.left + 2.6, y: PLATE.top + 2.6 },
  { x: PLATE.left + 2.6, y: PLATE.bottom - 2.6 },
  { x: MOUNT.left + 3, y: HEAD_Y - 4.5 },
  { x: MOUNT.left + 3, y: HEAD_Y + 4.5 },
];

function packFill(progress: number): { top: number; bottom: number } {
  const p = Math.min(100, Math.max(0, progress)) / 100;
  return { top: 0.95 - p * 0.88, bottom: 0.07 + p * 0.88 };
}

function f(n: number): string {
  return n.toFixed(2);
}

/** Common tangents of two circles. With `cross` the circles lie on opposite sides of the line. */
function tangents(a: Circle, b: Circle, cross: boolean): [Point, Point][] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const sa = a.r;
  const sb = cross ? -b.r : b.r;
  const k = sa - sb;
  const h2 = l2 - k * k;
  if (h2 <= 0) return [];
  const h = Math.sqrt(h2);
  return [1, -1].map((s) => {
    const nx = (k * dx - s * h * dy) / l2;
    const ny = (k * dy + s * h * dx) / l2;
    return [
      { x: a.x + sa * nx, y: a.y + sa * ny },
      { x: b.x + sb * nx, y: b.y + sb * ny },
    ];
  });
}

/** The straight run of tape between two circles, crossing between them, on the side `keep` accepts. */
function run(a: Circle, b: Circle, keep: (onA: Point, onB: Point) => boolean): [Point, Point] {
  const options = tangents(a, b, true);
  return options.find(([onA, onB]) => keep(onA, onB)) ?? options[0] ?? [a, b];
}

/** An arc of the tape around a circle, from one point on it to another. */
function arc(c: Circle, from: Point, to: Point, clockwise: boolean): string {
  const turn = 2 * Math.PI;
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  const delta = ((((clockwise ? a1 - a0 : a0 - a1) % turn) + turn) % turn) > Math.PI ? 1 : 0;
  return `A ${f(c.r)} ${f(c.r)} 0 ${delta} ${clockwise ? 1 : 0} ${f(to.x)} ${f(to.y)}`;
}

function xAt(p: Point, q: Point, y: number): number {
  return p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y);
}

/** Tape from the file reel, under the roller and up into the first column. */
function supplyPath(pack: number): string {
  const reel = { ...TOP, r: pack + TAPE / 2 };
  const [onReel, onIdler] = run(reel, IDLER_TOP, (a, b) => b.y > IDLER_TOP.y && a.x > TOP.x);
  return `M ${f(onReel.x)} ${f(onReel.y)} L ${f(onIdler.x)} ${f(onIdler.y)} ${arc(IDLER_TOP, onIdler, { x: TL, y: IDLER_TOP.y }, false)} L ${f(TL)} ${OPEN_TOP - 1}`;
}

/** Tape out of the second column, over the roller and onto the machine reel. */
function takeUpPath(pack: number): string {
  const reel = { ...BOTTOM, r: pack + TAPE / 2 };
  const [onIdler, onReel] = run(IDLER_BOTTOM, reel, (a, b) => a.y < IDLER_BOTTOM.y && b.x > BOTTOM.x);
  return `M ${f(TL)} ${OPEN_BOTTOM + 1} L ${f(TL)} ${f(IDLER_BOTTOM.y)} ${arc(IDLER_BOTTOM, { x: TL, y: IDLER_BOTTOM.y }, onIdler, false)} L ${f(onReel.x)} ${f(onReel.y)}`;
}

// Past the head: round the guide, over the crown of the head, round the capstan and down.
const [ON_GUIDE, FACE_IN] = run(GUIDE, FACE, (a, b) => a.y > GUIDE.y && b.y < FACE.y && b.x > FACE.x + HEAD.face * 0.9);
const [FACE_OUT, ON_CAPSTAN] = run(FACE, CAPSTAN, (a, b) => a.y > FACE.y && a.x > FACE.x + HEAD.face * 0.9 && b.y < CAPSTAN.y);
const GUIDE_LEFT: Point = { x: GUIDE.x - GUIDE.r, y: GUIDE.y };
const CAPSTAN_LEFT: Point = { x: CAPSTAN.x - CAPSTAN.r, y: CAPSTAN.y };
const HEAD_RUN = [
  `M ${f(TR)} ${OPEN_TOP - 1} L ${f(GUIDE_LEFT.x)} ${f(GUIDE_LEFT.y)}`,
  arc(GUIDE, GUIDE_LEFT, ON_GUIDE, false),
  `L ${f(FACE_IN.x)} ${f(FACE_IN.y)}`,
  arc(FACE, FACE_IN, FACE_OUT, true),
  `L ${f(ON_CAPSTAN.x)} ${f(ON_CAPSTAN.y)}`,
  arc(CAPSTAN, ON_CAPSTAN, CAPSTAN_LEFT, false),
  `L ${f(TR)} ${OPEN_BOTTOM + 1}`,
].join(" ");

// Loops hang in the columns; their legs reach past the open end and are clipped there.
const LOOP_TOP = `M ${f(TL)} ${APEX_TOP + LOOP_LENGTH} L ${f(TL)} ${f(APEX_TOP + LOOP_R)} A ${f(LOOP_R)} ${f(LOOP_R)} 0 0 1 ${f(TR)} ${f(APEX_TOP + LOOP_R)} L ${f(TR)} ${APEX_TOP + LOOP_LENGTH}`;
const LOOP_BOTTOM = `M ${f(TR)} ${APEX_BOTTOM - LOOP_LENGTH} L ${f(TR)} ${f(APEX_BOTTOM - LOOP_R)} A ${f(LOOP_R)} ${f(LOOP_R)} 0 0 1 ${f(TL)} ${f(APEX_BOTTOM - LOOP_R)} L ${f(TL)} ${APEX_BOTTOM - LOOP_LENGTH}`;

/** A column: square where the tape enters, softly rounded at the closed end. */
function columnPath(open: number, closed: number): string {
  const { x, w, corner } = COL;
  const s = closed < open ? 1 : -1;
  const sweep = s > 0 ? 1 : 0;
  return [
    `M ${x} ${open} L ${x} ${closed + s * corner}`,
    `A ${corner} ${corner} 0 0 ${sweep} ${x + corner} ${closed}`,
    `L ${x + w - corner} ${closed}`,
    `A ${corner} ${corner} 0 0 ${sweep} ${x + w} ${closed + s * corner}`,
    `L ${x + w} ${open} Z`,
  ].join(" ");
}

/** The deck outline: chamfered on the right, cut in a curve around each reel on the left. */
function deckPath(inset = 0): string {
  const { left, y, right, bottom, chamfer, clearance } = DECK;
  const top = y + inset;
  const low = bottom - inset;
  const r = right - inset;
  const l = left + inset;
  const c = clearance + inset;
  const topX = TOP.x + Math.sqrt(c * c - (top - TOP.y) ** 2);
  const topY = TOP.y + Math.sqrt(c * c - (l - TOP.x) ** 2);
  const lowX = BOTTOM.x + Math.sqrt(c * c - (BOTTOM.y - low) ** 2);
  const lowY = BOTTOM.y - Math.sqrt(c * c - (l - BOTTOM.x) ** 2);
  return [
    `M ${f(topX)} ${f(top)}`,
    `L ${f(r - chamfer)} ${f(top)} L ${f(r)} ${f(top + chamfer)}`,
    `L ${f(r)} ${f(low - chamfer)} L ${f(r - chamfer)} ${f(low)}`,
    `L ${f(lowX)} ${f(low)} A ${f(c)} ${f(c)} 0 0 0 ${f(l)} ${f(lowY)}`,
    `L ${f(l)} ${f(topY)} A ${f(c)} ${f(c)} 0 0 0 ${f(topX)} ${f(top)} Z`,
  ].join(" ");
}

/** Where the head's cylindrical face lies at a given height. */
function faceX(y: number): number {
  return FACE.x + Math.sqrt(HEAD.face ** 2 - (y - HEAD_Y) ** 2);
}

/** A strip just behind the face: the dark core in which the gaps sit. */
function coreStrip(top: number, bottom: number, depth: number): string {
  const { face } = HEAD;
  return [
    `M ${f(faceX(top))} ${f(top)}`,
    `A ${face} ${face} 0 0 1 ${f(faceX(bottom))} ${f(bottom)}`,
    `L ${f(faceX(bottom) - depth)} ${f(bottom)}`,
    `A ${face} ${face} 0 0 0 ${f(faceX(top) - depth)} ${f(top)} Z`,
  ].join(" ");
}

/** The head in profile: square at the back, the contoured face against the tape. */
function headPath(top: number, bottom: number): string {
  const { left, round, face } = HEAD;
  return [
    `M ${f(left + round)} ${f(top)} L ${f(faceX(top))} ${f(top)}`,
    `A ${face} ${face} 0 0 1 ${f(faceX(bottom))} ${f(bottom)}`,
    `L ${f(left + round)} ${f(bottom)} Q ${f(left)} ${f(bottom)} ${f(left)} ${f(bottom - round)}`,
    `L ${f(left)} ${f(top + round)} Q ${f(left)} ${f(top)} ${f(left + round)} ${f(top)} Z`,
  ].join(" ");
}

// The cleaner blade touches the tape just above the head, its edge against the direction of travel.
const CLEANER_TIP = xAt(ON_GUIDE, FACE_IN, CLEANER.y) - TAPE / 2 - 0.1;
const CLEANER_ROOT = CLEANER_TIP - CLEANER.blade;
const CLEANER_EDGE = `M ${f(CLEANER_ROOT)} ${f(CLEANER.y + 0.5)} L ${f(CLEANER_TIP)} ${f(CLEANER.y - 0.35)}`;
const CLEANER_BLADE = `${CLEANER_EDGE} L ${f(CLEANER_TIP)} ${f(CLEANER.y + 0.1)} L ${f(CLEANER_ROOT)} ${f(CLEANER.y + 2.6)} Z`;
const PHOTOCELL_RIGHT = xAt(FACE_OUT, ON_CAPSTAN, PHOTOCELL.top + PHOTOCELL.height / 2) - TAPE / 2 - 1;

export function UiReelPair({ ring, progress, running, label }: UiReelPairProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `licht-pair-${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const fills = packFill(progress);
  const supply = supplyPath(packRadius(R, fills.top));
  const takeUp = takeUpPath(packRadius(R, fills.bottom));
  const tape = "fill-none licht-stroke-tape";

  const roller = (c: Circle, motion: string) => (
    <g>
      <circle cx={c.x + 0.3} cy={c.y + 1.1} r={ROLLER.flange + 0.2} className="licht-fill-shade" fillOpacity="0.4" />
      <circle cx={c.x} cy={c.y} r={ROLLER.flange} fill={url("chrome")} />
      <circle cx={c.x} cy={c.y} r={ROLLER.flange - 0.35} fill="none" strokeWidth="0.3" className="licht-stroke-glint" strokeOpacity="0.5" />
      <circle cx={c.x} cy={c.y} r={ROLLER.flange * 0.66} fill="none" strokeWidth="0.7" className="licht-stroke-metal-lo" />
      <circle cx={c.x} cy={c.y} r={ROLLER.flange * 0.66 + 0.5} fill="none" strokeWidth="0.25" className="licht-stroke-glint" strokeOpacity="0.45" />
      <circle cx={c.x} cy={c.y} r={ROLLER.flange * 0.36} className="licht-fill-anodized" />
      <g className={`spin-origin ${running ? motion : ""}`}>
        <circle cx={c.x} cy={c.y} r={ROLLER.flange * 0.36} fill="none" />
        <circle cx={c.x} cy={c.y} r={ROLLER.flange * 0.22} fill={url("chrome")} />
        <line x1={c.x - ROLLER.flange * 0.16} y1={c.y} x2={c.x + ROLLER.flange * 0.16} y2={c.y} strokeWidth="0.35" className="licht-stroke-glass" />
      </g>
    </g>
  );

  const screw = (s: Point) => (
    <g key={`${s.x}-${s.y}`}>
      <circle cx={s.x} cy={s.y + 0.25} r="1.15" className="licht-fill-shade" fillOpacity="0.45" />
      <circle cx={s.x} cy={s.y} r="1" fill={url("chrome")} />
      <line x1={s.x - 0.66} y1={s.y + 0.3} x2={s.x + 0.66} y2={s.y - 0.3} strokeWidth="0.28" className="licht-stroke-glass" strokeOpacity="0.8" />
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-auto overflow-visible" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id("chrome")} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" className="licht-stop-metal-hi" />
          <stop offset="0.45" className="licht-stop-metal" />
          <stop offset="0.55" className="licht-stop-metal-lo" />
          <stop offset="1" className="licht-stop-metal" />
        </linearGradient>
        <linearGradient id={id("column")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="licht-stop-column-hi" />
          <stop offset="0.14" className="licht-stop-column" />
          <stop offset="0.86" className="licht-stop-column" />
          <stop offset="1" className="licht-stop-column-hi" />
        </linearGradient>
        <linearGradient id={id("glass")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.04" className="licht-stop-glint" stopOpacity="0" />
          <stop offset="0.1" className="licht-stop-glint" stopOpacity="0.07" />
          <stop offset="0.2" className="licht-stop-glint" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("deck")} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" className="licht-stop-anodized" />
          <stop offset="1" className="licht-stop-anodized-lo" />
        </linearGradient>
        <linearGradient id={id("bevel")} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" className="licht-stop-glint" stopOpacity="0.4" />
          <stop offset="0.45" className="licht-stop-glint" stopOpacity="0.05" />
          <stop offset="1" className="licht-stop-shade" stopOpacity="0.6" />
        </linearGradient>
        <radialGradient id={id("pool")}>
          <stop offset="0" className="licht-stop-shade" stopOpacity="0.5" />
          <stop offset="1" className="licht-stop-shade" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("plate")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="licht-stop-alu-hi" />
          <stop offset="0.55" className="licht-stop-alu" />
          <stop offset="1" className="licht-stop-alu-lo" />
        </linearGradient>
        <pattern id={id("brush")} width="17" height="1.3" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0.3" x2="11" y2="0.3" strokeWidth="0.18" className="licht-stroke-glint" strokeOpacity="0.09" />
          <line x1="6" y1="0.95" x2="17" y2="0.95" strokeWidth="0.16" className="licht-stroke-shade" strokeOpacity="0.14" />
        </pattern>
        <linearGradient id={id("head")} x1={HEAD.left} y1="0" x2={CROWN_X} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" className="licht-stop-metal-lo" />
          <stop offset="0.5" className="licht-stop-metal" />
          <stop offset="0.78" className="licht-stop-metal-hi" />
          <stop offset="0.9" className="licht-stop-metal" />
          <stop offset="1" className="licht-stop-metal-lo" />
        </linearGradient>
        <linearGradient id={id("headLight")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="licht-stop-glint" stopOpacity="0.35" />
          <stop offset="0.3" className="licht-stop-glint" stopOpacity="0" />
          <stop offset="0.75" className="licht-stop-shade" stopOpacity="0" />
          <stop offset="1" className="licht-stop-shade" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={id("blade")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="licht-stop-metal-hi" />
          <stop offset="1" className="licht-stop-metal-lo" />
        </linearGradient>
        <linearGradient id={id("block")} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" className="licht-stop-anodized-hi" />
          <stop offset="1" className="licht-stop-anodized-lo" />
        </linearGradient>
        <radialGradient id={id("rubber")} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" className="licht-stop-rubber-hi" />
          <stop offset="1" className="licht-stop-rubber" />
        </radialGradient>
        <clipPath id={id("colTop")}>
          <path d={columnPath(OPEN_TOP, COL.top)} />
        </clipPath>
        <clipPath id={id("colBottom")}>
          <path d={columnPath(OPEN_BOTTOM, COL.bottom)} />
        </clipPath>
        <clipPath id={id("plateClip")}>
          <rect x={PLATE.left} y={PLATE.top} width={PLATE.right - PLATE.left} height={PLATE.bottom - PLATE.top} rx={PLATE.round} />
        </clipPath>
      </defs>

      {/* Vacuum columns behind glass: a dark channel, one vacuum port at the closed end, four sensors. */}
      {[
        { d: columnPath(OPEN_TOP, COL.top), port: COL.top + 4.2, apex: APEX_TOP },
        { d: columnPath(OPEN_BOTTOM, COL.bottom), port: COL.bottom - 4.2, apex: APEX_BOTTOM },
      ].map((col) => (
        <g key={col.port}>
          <path d={col.d} fill={url("column")} />
          <rect x={COL.x + COL.w / 2 - 4.5} y={col.port - 1} width="9" height="2" rx="1" className="licht-fill-glass" />
          <line x1={COL.x + COL.w / 2 - 3.6} y1={col.port + 1.05} x2={COL.x + COL.w / 2 + 3.6} y2={col.port + 1.05} strokeWidth="0.22" className="licht-stroke-glint" strokeOpacity="0.12" />
          {SENSORS.map((offset) => (
            <circle key={offset} cx={COL.x + COL.w / 2} cy={col.apex + offset} r="0.6" className="licht-fill-sensor" />
          ))}
        </g>
      ))}
      <g clipPath={url("colTop")}>
        <path d={LOOP_TOP} strokeWidth={TAPE} className={`${tape} ${running ? "licht-loop-a" : ""}`} />
      </g>
      <g clipPath={url("colBottom")}>
        <path d={LOOP_BOTTOM} strokeWidth={TAPE} className={`${tape} ${running ? "licht-loop-b" : ""}`} />
      </g>
      {[columnPath(OPEN_TOP, COL.top), columnPath(OPEN_BOTTOM, COL.bottom)].map((d) => (
        <g key={d}>
          <path d={d} fill={url("glass")} />
          <path d={d} fill="none" strokeWidth="0.35" className="licht-stroke-glint" strokeOpacity="0.07" />
        </g>
      ))}

      {/* The deck: dark anodised aluminium with a bright bevel, lying in its own shadow. */}
      <ellipse cx={(DECK.left + DECK.right) / 2 + 3} cy={HEAD_Y + 6} rx={(DECK.right - DECK.left) / 2 + 7.5} ry={(DECK.bottom - DECK.y) / 2 + 6} fill={url("pool")} />
      <path d={deckPath()} fill={url("deck")} />
      <path d={deckPath(0.3)} fill="none" strokeWidth="0.6" stroke={url("bevel")} />

      {/* The drive's one lamp: dark amber glass that flashes with every block written. */}
      <rect x={LAMP.x - LAMP.size / 2 - 0.7} y={LAMP.y - LAMP.size / 2 - 0.7} width={LAMP.size + 1.4} height={LAMP.size + 1.4} rx="0.9" fill={url("chrome")} />
      <rect x={LAMP.x - LAMP.size / 2} y={LAMP.y - LAMP.size / 2} width={LAMP.size} height={LAMP.size} rx="0.5" className="licht-fill-lamp-off" />
      {running ? (
        <rect x={LAMP.x - LAMP.size / 2} y={LAMP.y - LAMP.size / 2} width={LAMP.size} height={LAMP.size} rx="0.5" className="licht-fill-lamp licht-lamp" />
      ) : null}
      <rect x={LAMP.x - LAMP.size / 2 + 0.5} y={LAMP.y - LAMP.size / 2 + 0.4} width={LAMP.size - 1} height={LAMP.size * 0.36} rx="0.35" className="licht-fill-glint" fillOpacity="0.2" />

      {/* Head plate: brushed aluminium, lifted off the deck by a hair of shadow. */}
      <rect x={PLATE.left + 0.3} y={PLATE.top + 0.9} width={PLATE.right - PLATE.left} height={PLATE.bottom - PLATE.top} rx={PLATE.round} className="licht-fill-shade" fillOpacity="0.55" />
      <rect x={PLATE.left} y={PLATE.top} width={PLATE.right - PLATE.left} height={PLATE.bottom - PLATE.top} rx={PLATE.round} fill={url("plate")} />
      <g clipPath={url("plateClip")}>
        <rect x={PLATE.left} y={PLATE.top} width={PLATE.right - PLATE.left} height={PLATE.bottom - PLATE.top} fill={url("brush")} />
      </g>
      <rect x={PLATE.left + 0.2} y={PLATE.top + 0.2} width={PLATE.right - PLATE.left - 0.4} height={PLATE.bottom - PLATE.top - 0.4} rx={PLATE.round} fill="none" strokeWidth="0.4" stroke={url("bevel")} />

      {SCREWS.slice(0, 5).map(screw)}

      {/* Tape cleaner: a thin steel blade on a small holder, just above the head. */}
      <rect x={CLEANER_ROOT - CLEANER.holder + 0.6} y={CLEANER.y - 0.4} width={CLEANER.holder} height="3.4" rx="0.6" fill={url("block")} />
      <path d={CLEANER_BLADE} fill={url("blade")} />
      <path d={CLEANER_EDGE} strokeWidth="0.22" className="licht-stroke-glint" strokeOpacity="0.8" />

      {/* BOT/EOT photocell below the head: a dark block with its lens towards the tape. */}
      <rect x={PHOTOCELL_RIGHT - PHOTOCELL.width} y={PHOTOCELL.top} width={PHOTOCELL.width} height={PHOTOCELL.height} rx="0.8" fill={url("block")} />
      <circle cx={PHOTOCELL_RIGHT - 1.5} cy={PHOTOCELL.top + PHOTOCELL.height / 2} r="1" className="licht-fill-lens" />
      <circle cx={PHOTOCELL_RIGHT - 1.75} cy={PHOTOCELL.top + PHOTOCELL.height / 2 - 0.3} r="0.3" className="licht-fill-glint" fillOpacity="0.5" />

      {/* The head: its mount, then the polished block with the cylindrical face. */}
      <rect x={MOUNT.left} y={MOUNT.top} width={MOUNT.right - MOUNT.left} height={MOUNT.bottom - MOUNT.top} rx="1.2" fill={url("block")} />
      {SCREWS.slice(5).map(screw)}
      <path d={headPath(HEAD.top, HEAD.bottom)} transform="translate(0.4 1.1)" className="licht-fill-shade" fillOpacity="0.5" />
      <path d={headPath(HEAD.top, HEAD.bottom)} fill={url("head")} />
      <path d={headPath(HEAD.top, SEAM)} className="licht-fill-shade" fillOpacity="0.16" />
      <path d={headPath(HEAD.top, HEAD.bottom)} fill={url("headLight")} />
      <path d={headPath(HEAD.top, HEAD.bottom)} fill="none" strokeWidth="0.3" className="licht-stroke-shade" strokeOpacity="0.45" />
      {/* Seams between erase, write and read sections; the shield between write and read. */}
      <line x1={HEAD.left + 0.4} y1={SEAM} x2={faceX(SEAM)} y2={SEAM} strokeWidth="0.3" className="licht-stroke-shade" strokeOpacity="0.55" />
      <line x1={HEAD.left + 0.4} y1={HEAD_Y} x2={faceX(HEAD_Y)} y2={HEAD_Y} strokeWidth="0.8" className="licht-stroke-shield" />
      <line x1={HEAD.left + 0.4} y1={HEAD_Y + 0.55} x2={faceX(HEAD_Y + 0.55)} y2={HEAD_Y + 0.55} strokeWidth="0.2" className="licht-stroke-glint" strokeOpacity="0.4" />
      {/* The cores behind the face, and the gaps across them where the tape is erased, written and read back. */}
      {CORES.map((core) => (
        <path key={core.top} d={coreStrip(core.top, core.bottom, core.depth)} className="licht-fill-shade" fillOpacity="0.3" />
      ))}
      {[
        { y: GAPS.erase, depth: CORES[0]?.depth ?? 0, width: 0.45 },
        { y: GAPS.write, depth: CORES[1]?.depth ?? 0, width: 0.24 },
        { y: GAPS.read, depth: CORES[1]?.depth ?? 0, width: 0.24 },
      ].map((gap) => (
        <g key={gap.y}>
          <line x1={faceX(gap.y) - gap.depth} y1={gap.y} x2={faceX(gap.y)} y2={gap.y} strokeWidth={gap.width} className="licht-stroke-glass" />
          <line x1={faceX(gap.y) - gap.depth} y1={gap.y + gap.width} x2={faceX(gap.y)} y2={gap.y + gap.width} strokeWidth="0.14" className="licht-stroke-glint" strokeOpacity="0.6" />
        </g>
      ))}
      {running ? (
        <line
          x1={faceX(GAPS.read) - (CORES[1]?.depth ?? 0)}
          y1={GAPS.read}
          x2={faceX(GAPS.read)}
          y2={GAPS.read}
          strokeWidth="0.4"
          className="licht-stroke-glint licht-glint"
        />
      ) : null}

      {/* File reel on top; the supply tape runs under its front flange. */}
      <ReelShape cx={TOP.x} cy={TOP.y} r={R} ring={ring} fill={fills.top} spinning={running}>
        <path d={supply} strokeWidth={TAPE} strokeLinejoin="round" className={tape} />
      </ReelShape>

      {/* Machine reel below; it takes up the written tape. */}
      <ReelShape cx={BOTTOM.x} cy={BOTTOM.y} r={R} ring={ring} fill={fills.bottom} spinning={running} slow>
        <path d={takeUp} strokeWidth={TAPE} strokeLinejoin="round" className={tape} />
      </ReelShape>

      {/* The tape past the head. */}
      <path d={HEAD_RUN} strokeWidth={TAPE} strokeLinejoin="round" className={tape} />

      {/* Air-bearing guide above the head. */}
      <circle cx={GUIDE.x + 0.3} cy={GUIDE.y + 0.9} r={GUIDE_R} className="licht-fill-shade" fillOpacity="0.45" />
      <circle cx={GUIDE.x} cy={GUIDE.y} r={GUIDE_R} fill={url("chrome")} />
      <circle cx={GUIDE.x} cy={GUIDE.y} r={GUIDE_R * 0.4} className="licht-fill-anodized" />

      {/* Capstan below the head: matte black rubber on a thin chrome hub, one index mark to show it turn. */}
      <circle cx={CAPSTAN.x + 0.4} cy={CAPSTAN.y + 1.3} r={CAPSTAN_R + 0.2} className="licht-fill-shade" fillOpacity="0.5" />
      <circle cx={CAPSTAN.x} cy={CAPSTAN.y} r={CAPSTAN_R} fill={url("rubber")} />
      <circle cx={CAPSTAN.x} cy={CAPSTAN.y} r={CAPSTAN_R - 0.3} fill="none" strokeWidth="0.35" className="licht-stroke-glint" strokeOpacity="0.1" />
      <circle cx={CAPSTAN.x} cy={CAPSTAN.y} r={CAPSTAN_R * 0.72} fill="none" strokeWidth="0.25" className="licht-stroke-glint" strokeOpacity="0.05" />
      <g className={`spin-origin ${running ? "licht-capstan licht-ccw" : ""}`}>
        <circle cx={CAPSTAN.x} cy={CAPSTAN.y} r={CAPSTAN_R} fill="none" />
        <line x1={CAPSTAN.x} y1={CAPSTAN.y - CAPSTAN_R * 0.7} x2={CAPSTAN.x} y2={CAPSTAN.y - CAPSTAN_R * 0.9} strokeWidth="0.55" strokeLinecap="round" className="licht-stroke-mark" />
      </g>
      <circle cx={CAPSTAN.x} cy={CAPSTAN.y} r={CAPSTAN_R * 0.26} fill={url("chrome")} />
      <circle cx={CAPSTAN.x} cy={CAPSTAN.y} r={CAPSTAN_R * 0.1} className="licht-fill-anodized" />

      {/* Rollers at the column mouths; their front flange hides the tape in the groove. */}
      {roller(IDLER_TOP, "licht-reel-a licht-ccw")}
      {roller(IDLER_BOTTOM, "licht-reel-b licht-ccw")}
    </svg>
  );
}
