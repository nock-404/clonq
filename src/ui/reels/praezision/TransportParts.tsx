import type { Ref } from "react";
import { n, polar, taperedBar, type Point } from "./geometry";

// The machined parts of the tape path, drawn like a product drawing: opaque
// solid parts, exact circles and bars, one highlight where the light falls.
// `line` is the width of one line in viewBox units at the rendered size;
// `fine` is true when the drawing is large enough for screws and similar
// small parts (they are left out below that).

interface Drawn {
  line: number;
}

/** Fill references for the gradients that `TransportPaints` defines once per drawing. */
export interface Paints {
  deck: string;
  anodised: string;
  chrome: string;
}

export function paintsFor(id: string): Paints {
  return { deck: `url(#${id}-deck)`, anodised: `url(#${id}-anodised)`, chrome: `url(#${id}-chrome)` };
}

/** The plate and the anodised parts are lit from above; the polished head face has the banded look of chrome. */
export function TransportPaints({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-deck`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="praezision-stop-deck-top" />
        <stop offset="1" className="praezision-stop-deck" />
      </linearGradient>
      <linearGradient id={`${id}-anodised`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="praezision-stop-head-top" />
        <stop offset="1" className="praezision-stop-head" />
      </linearGradient>
      <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="praezision-stop-chrome-lo" />
        <stop offset="0.16" className="praezision-stop-chrome-hi" />
        <stop offset="0.4" className="praezision-stop-chrome" />
        <stop offset="0.52" className="praezision-stop-chrome-hi" />
        <stop offset="0.7" className="praezision-stop-chrome-lo" />
        <stop offset="0.88" className="praezision-stop-chrome" />
        <stop offset="1" className="praezision-stop-chrome-lo" />
      </linearGradient>
    </defs>
  );
}

/** A slotted screw head. Only drawn when the transport is shown large. */
function Screw({ at, line, slot }: Drawn & { at: Point; slot: number }) {
  const a = polar(at.x, at.y, 0.72, slot);
  const b = polar(at.x, at.y, 0.72, slot + 180);
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={1.15} strokeWidth={line} className="praezision-fill-steel-lo praezision-stroke-head" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={0.36} strokeLinecap="round" className="praezision-stroke-head" />
    </g>
  );
}

/** The transport plate everything on the tape path is mounted on. */
export function DeckPlate({ x, y, w, h, line, paints }: Drawn & { x: number; y: number; w: number; h: number; paints: Paints }) {
  const rx = 4;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={rx} strokeWidth={line} fill={paints.deck} className="praezision-stroke-deck-lo" />
      <path d={`M ${n(x + rx)} ${n(y + line * 1.5)} L ${n(x + w - rx)} ${n(y + line * 1.5)}`} strokeWidth={line} strokeLinecap="round" className="praezision-stroke-deck-hi" />
    </g>
  );
}

/** A tension arm: a tapered steel lever on a pivot boss. The boss stays put while the lever swings. */
export function ArmLever({ pivot, end, line }: Drawn & { pivot: Point; end: Point }) {
  return (
    <g>
      <path d={taperedBar(pivot, end, 3.2, 2.1)} strokeWidth={line} className="praezision-fill-steel praezision-stroke-steel-lo" />
      <circle cx={pivot.x} cy={pivot.y} r={4.8} strokeWidth={line} className="praezision-fill-steel-lo praezision-stroke-steel" />
      <circle cx={pivot.x} cy={pivot.y} r={2.3} className="praezision-fill-steel-hi" />
      <circle cx={pivot.x} cy={pivot.y} r={0.9} className="praezision-fill-bore" />
    </g>
  );
}

interface SpinProps extends Drawn {
  at: Point;
  r: number;
  spinRef?: Ref<SVGGElement>;
}

/** The idler at the end of a tension arm: a bright steel wheel with four holes, like on a DEC TE16. */
export function Idler({ at, r, line, spinRef }: SpinProps) {
  return (
    <g ref={spinRef}>
      <circle cx={at.x} cy={at.y} r={r} strokeWidth={line} className="praezision-fill-steel-hi praezision-stroke-steel-lo" />
      <circle cx={at.x} cy={at.y} r={r * 0.8} fill="none" strokeWidth={line} className="praezision-stroke-steel" />
      {[45, 135, 225, 315].map((a) => {
        const h = polar(at.x, at.y, r * 0.47, a);
        return <circle key={a} cx={h.x} cy={h.y} r={r * 0.19} className="praezision-fill-deck-lo" />;
      })}
      <circle cx={at.x} cy={at.y} r={r * 0.17} className="praezision-fill-steel-lo" />
    </g>
  );
}

/** A fixed guide roller with its flange behind the tape. */
export function Guide({ at, r, line, spinRef }: SpinProps) {
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={r * 1.4} strokeWidth={line} className="praezision-fill-steel-lo praezision-stroke-deck-lo" />
      <g ref={spinRef}>
        <circle cx={at.x} cy={at.y} r={r} strokeWidth={line} className="praezision-fill-steel praezision-stroke-steel-lo" />
        <circle cx={at.x} cy={at.y} r={r * 0.45} className="praezision-fill-deck-lo" />
        <circle cx={at.x + r * 0.72} cy={at.y} r={r * 0.12} className="praezision-fill-steel-lo" />
      </g>
    </g>
  );
}

/** The capstan: a black disc with a bright rim on its motor flange. A paint mark on the rubber shows every burst. */
export function Capstan({ at, r, line, spinRef }: SpinProps) {
  const mark = polar(at.x, at.y, r * 0.72, -90);
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={r + 2.2} strokeWidth={line} className="praezision-fill-deck-lo praezision-stroke-deck-hi" />
      <g ref={spinRef}>
        <circle cx={at.x} cy={at.y} r={r} className="praezision-fill-rubber" />
        <circle cx={at.x} cy={at.y} r={r - 0.55} fill="none" strokeWidth={1.1} className="praezision-stroke-steel-hi" />
        <circle cx={mark.x} cy={mark.y} r={r * 0.1} className="praezision-fill-steel" />
        <circle cx={at.x} cy={at.y} r={r * 0.36} strokeWidth={line} className="praezision-fill-steel praezision-stroke-steel-lo" />
        <circle cx={at.x} cy={at.y} r={r * 0.12} className="praezision-fill-bore" />
      </g>
    </g>
  );
}

interface PhotoCellProps extends Drawn {
  /** Centre line of the tape it straddles. */
  tapeX: number;
  /** Top edge of the block. */
  y: number;
  active: boolean;
  paints: Paints;
  lampRef?: Ref<SVGCircleElement>;
}

/**
 * The BOT/EOT photocell block: a small housing the tape runs through just
 * before the head, lamp on one side of the tape and cell on the other. Its
 * lamp flashes while a block passes.
 */
export function PhotoCell({ tapeX, y, line, active, paints, lampRef }: PhotoCellProps) {
  const x = tapeX - 8.4;
  const w = 12;
  const h = 9;
  const lamp = { x: x + 3.4, y: y + h / 2 };
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={1.6} strokeWidth={line} fill={paints.anodised} className="praezision-stroke-head-edge" />
      <path d={`M ${n(x + 1.6)} ${n(y + line * 1.2)} L ${n(x + w - 1.6)} ${n(y + line * 1.2)}`} strokeWidth={line} strokeLinecap="round" className="praezision-stroke-head-hi" />
      {/* The channel the tape runs through. */}
      <rect x={tapeX - 0.9} y={y + 1.3} width={1.8} height={h - 2.6} rx={0.9} className="praezision-fill-bore" />
      <circle cx={lamp.x} cy={lamp.y} r={2.2} className="praezision-fill-bore" />
      <circle ref={lampRef} cx={lamp.x} cy={lamp.y} r={1.45} className={active ? "praezision-fill-lamp" : "praezision-fill-lamp-off"} />
    </g>
  );
}

interface HeadProps extends Drawn {
  /** Centre of the curved head face. */
  at: Point;
  /** Radius of the head face the tape bends over. */
  face: number;
  /** Half the height of the head cover. */
  half: number;
  /** Left end of the cover. */
  back: number;
  fine: boolean;
  paints: Paints;
}

/** Width of the polished face between the cover and the tape. */
const FACE_STRIP = 3.4;

/**
 * The read/write head seen from the front of the drive: a machined block
 * under an opaque anodised cover whose upper half pivots up for threading.
 * Only the face that touches the tape shows: a narrow polished contour with
 * the write gap and the read gap across it (the tape runs downwards, so write
 * comes first), between two ceramic shoes.
 */
export function HeadAssembly({ at, face, half, back, line, fine, paints }: HeadProps) {
  const top = at.y - half;
  const bottom = at.y + half;
  const front = at.x + face;
  const flat = front - FACE_STRIP;
  const round = 3.2;
  const corner = 1.2;
  const reach = (y: number) => at.x + Math.sqrt(face * face - (y - at.y) ** 2);
  const stripTop = top + 1.8;
  const stripBottom = bottom - 1.8;
  const split = top + (bottom - top) * 0.38;
  const gaps = [at.y - 2.2, at.y + 2.2];
  const shoe = { width: reach(stripTop) - flat + 1.4, height: 2.6 };
  const cover = [
    `M ${n(flat - corner)} ${n(top)}`,
    `L ${n(back + round)} ${n(top)}`,
    `A ${n(round)} ${n(round)} 0 0 0 ${n(back)} ${n(top + round)}`,
    `L ${n(back)} ${n(bottom - round)}`,
    `A ${n(round)} ${n(round)} 0 0 0 ${n(back + round)} ${n(bottom)}`,
    `L ${n(flat - corner)} ${n(bottom)}`,
    `Q ${n(flat)} ${n(bottom)} ${n(flat)} ${n(bottom - corner)}`,
    `L ${n(flat)} ${n(top + corner)}`,
    `Q ${n(flat)} ${n(top)} ${n(flat - corner)} ${n(top)}`,
    "Z",
  ].join(" ");
  const strip = [
    `M ${n(flat - 0.4)} ${n(stripTop)}`,
    `L ${n(reach(stripTop))} ${n(stripTop)}`,
    `A ${n(face)} ${n(face)} 0 0 1 ${n(reach(stripBottom))} ${n(stripBottom)}`,
    `L ${n(flat - 0.4)} ${n(stripBottom)}`,
    "Z",
  ].join(" ");
  return (
    <g>
      {/* The polished face, then the cover in front of its back edge. */}
      <path d={strip} fill={paints.chrome} />
      {gaps.map((y) => (
        <line key={y} x1={flat} y1={y} x2={reach(y) + 0.1} y2={y} strokeWidth={Math.max(0.45, line)} className="praezision-stroke-bore" />
      ))}
      <path d={cover} fill={paints.anodised} strokeWidth={line} className="praezision-stroke-head-edge" />
      <path d={`M ${n(back + round)} ${n(top + line * 1.2)} L ${n(flat - corner)} ${n(top + line * 1.2)}`} strokeWidth={line} strokeLinecap="round" className="praezision-stroke-head-hi" />

      {/* The ceramic shoes just above and below the face keep the tape on track. */}
      {[top - 1.2, bottom + 1.2].map((y) => (
        <rect
          key={y}
          x={flat - 1.2}
          y={y - shoe.height / 2}
          width={shoe.width}
          height={shoe.height}
          rx={1.1}
          strokeWidth={line}
          className="praezision-fill-ceramic praezision-stroke-head-edge"
        />
      ))}

      {/* Where the upper half pivots up for threading. */}
      <path d={`M ${n(back + 0.6)} ${n(split)} L ${n(flat - 0.6)} ${n(split)}`} strokeWidth={line} className="praezision-stroke-bore" />
      <path d={`M ${n(back + 0.6)} ${n(split + line)} L ${n(flat - 0.6)} ${n(split + line)}`} strokeWidth={line} className="praezision-stroke-head-hi" />

      {fine ? (
        <>
          <Screw at={{ x: back + 3.6, y: bottom - 3.6 }} line={line} slot={28} />
          <Screw at={{ x: flat - 3.6, y: bottom - 3.6 }} line={line} slot={-52} />
        </>
      ) : null}
    </g>
  );
}
