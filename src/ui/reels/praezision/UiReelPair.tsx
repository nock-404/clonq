import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Ring } from "../../../lib/types";
import { capstanMoving, capstanTravel, reelTravel, slack, SUPPLY_CLOCK, TAKEUP_CLOCK } from "./drive";
import { beltPath, clamp, n, packRadius, rotate, type Point, type Pulley } from "./geometry";
import { ReelShape } from "./ReelShape";
import { useSvgId } from "./svgId";
import { ArmLever, Capstan, DeckPlate, Guide, HeadAssembly, Idler, paintsFor, PhotoCell, TransportPaints } from "./TransportParts";
import { useReducedMotion } from "./useReducedMotion";

interface UiReelPairProps {
  ring: Ring;
  /** 0–100 while running; decides how much tape has moved from top to bottom. */
  progress: number;
  running: boolean;
  label: string;
}

// Geometry in viewBox units. The reels are stacked as on a CDC 607 or DEC TE16.
// The transport sits on its own plate to the right: supply reel, tension arm,
// guide, photocell, head, capstan, guide, tension arm, take-up reel. Between the
// guides the tape runs straight down; it only bends a little over the head
// face and the capstan, and wraps the idlers.
const W = 170;
const H = 260;
const R = 51;
const TOP: Point = { x: 56, y: 56 };
const BOTTOM: Point = { x: 56, y: 204 };
/** Half the tape thickness: the tape lies on the rollers, not in them. */
const TAPE = 0.75;
/** A reel is never quite empty: a few turns of leader stay on the hub. */
const LEADER = 0.035;

/** Where the tape runs down past the head. */
const TAPE_X = 155;
const IDLER_R = 6.5;
const GUIDE_R = 4;
const CAPSTAN_R = 8;
/** The head face is a flat arc; it and the capstan push the tape a little out of line. */
const HEAD_FACE = 60;
const HEAD_HALF = 15;
const HEAD_REACH = 0.9;
const CAPSTAN_REACH = 0.6;
/** The idlers rest inside the tape line by more than the arms swing, so the tape always wraps the guides. */
const IDLER_IN = 6;

const DECK = { x: 113, y: 5, w: 51, h: 250 };
const SUPPLY_PIVOT: Point = { x: 126, y: 57 };
const SUPPLY_IDLER: Point = { x: TAPE_X - IDLER_IN - TAPE - IDLER_R, y: 21 };
const TAKEUP_PIVOT: Point = { x: 126, y: 203 };
const TAKEUP_IDLER: Point = { x: TAPE_X - IDLER_IN - TAPE - IDLER_R, y: 239 };
const GUIDE_IN: Point = { x: TAPE_X - TAPE - GUIDE_R, y: 80 };
const PHOTOCELL_Y = 88;
const HEAD: Point = { x: TAPE_X - TAPE + HEAD_REACH - HEAD_FACE, y: 120 };
const HEAD_BACK = 125;
const CAPSTAN: Point = { x: TAPE_X - TAPE + CAPSTAN_REACH - CAPSTAN_R, y: 153 };
const GUIDE_OUT: Point = { x: TAPE_X - TAPE - GUIDE_R, y: 176 };

/** How far the arms swing per unit of slack, and at most, in degrees. */
const ARM_GAIN = 0.2;
const ARM_LIMIT = 5;

const TOP_ANGLE = 14;
const BOTTOM_ANGLE = -22;
/** A moment into the run, so a still picture shows the arms off centre. */
const START_TIME = 0.83;

/** CSS pixels per viewBox unit from which screws and knurls are drawn. */
const FINE_FROM = 1.8;
/** Lines are three quarters of a CSS pixel wide at any rendered size. */
const LINE_PIXELS = 0.75;

function fills(progress: number): { top: number; bottom: number } {
  const p = clamp(progress, 0, 100) / 100;
  const moved = LEADER + p * (1 - 2 * LEADER);
  return { top: 1 - moved, bottom: moved };
}

function thread(top: number, bottom: number, supplyArm: number, takeupArm: number): Pulley[] {
  const supply = rotate(SUPPLY_IDLER, SUPPLY_PIVOT, supplyArm);
  const takeup = rotate(TAKEUP_IDLER, TAKEUP_PIVOT, takeupArm);
  return [
    { ...TOP, r: top, wrap: 1 },
    { ...supply, r: IDLER_R + TAPE, wrap: 1 },
    { ...GUIDE_IN, r: GUIDE_R + TAPE, wrap: 1 },
    { ...HEAD, r: HEAD_FACE + TAPE, wrap: 1 },
    { ...CAPSTAN, r: CAPSTAN_R + TAPE, wrap: 1 },
    { ...GUIDE_OUT, r: GUIDE_R + TAPE, wrap: 1 },
    { ...takeup, r: IDLER_R + TAPE, wrap: 1 },
    { ...BOTTOM, r: bottom, wrap: 1 },
  ];
}

// Which way each arm has to swing to give tape: the one that lengthens its stretch of the path.
const MID_PACK = packRadius(R, 0.5);
const supplyStretch = (angle: number) => beltPath(thread(MID_PACK, MID_PACK, angle, 0).slice(0, 3)).length;
const takeupStretch = (angle: number) => beltPath(thread(MID_PACK, MID_PACK, 0, angle).slice(5)).length;
const SUPPLY_SIGN = supplyStretch(1) > supplyStretch(-1) ? 1 : -1;
const TAKEUP_SIGN = takeupStretch(1) > takeupStretch(-1) ? 1 : -1;

function armAngles(t: number): { supply: number; takeup: number } {
  const s = slack(t);
  return {
    supply: clamp(SUPPLY_SIGN * ARM_GAIN * s.supply, -ARM_LIMIT, ARM_LIMIT),
    takeup: clamp(TAKEUP_SIGN * ARM_GAIN * s.takeup, -ARM_LIMIT, ARM_LIMIT),
  };
}

function turn(degrees: number, at: Point): string {
  return `rotate(${n(degrees)} ${n(at.x)} ${n(at.y)})`;
}

const degreesOf = (travel: number, radius: number) => ((travel / radius) * 180) / Math.PI;

/** CSS pixels per viewBox unit at the size the drawing is shown, so lines stay the same width everywhere. */
function useUnitPixels(ref: RefObject<SVGSVGElement | null>): number {
  const [pixels, setPixels] = useState(1);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const measure = () => {
      const height = svg.getBoundingClientRect().height;
      if (height > 0) setPixels(Math.round((height / H) * 100) / 100);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [ref]);
  return pixels;
}

export function UiReelPair({ ring, progress, running, label }: UiReelPairProps) {
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const pixels = useUnitPixels(svg);
  const line = LINE_PIXELS / pixels;
  const fine = pixels >= FINE_FROM;
  const paintId = useSvgId("praezision-transport");
  const paints = paintsFor(paintId);

  const fill = fills(progress);
  const topPack = packRadius(R, fill.top);
  const bottomPack = packRadius(R, fill.bottom);
  const still = running ? armAngles(START_TIME) : { supply: 0, takeup: 0 };
  const tape = beltPath(thread(topPack, bottomPack, still.supply, still.takeup)).d;

  const packs = useRef({ top: topPack, bottom: bottomPack });
  const clock = useRef({ t: START_TIME, top: TOP_ANGLE, bottom: BOTTOM_ANGLE });
  const topRotor = useRef<SVGGElement>(null);
  const bottomRotor = useRef<SVGGElement>(null);
  const supplyArm = useRef<SVGGElement>(null);
  const takeupArm = useRef<SVGGElement>(null);
  const supplySpin = useRef<SVGGElement>(null);
  const takeupSpin = useRef<SVGGElement>(null);
  const guideInSpin = useRef<SVGGElement>(null);
  const guideOutSpin = useRef<SVGGElement>(null);
  const capstanSpin = useRef<SVGGElement>(null);
  const tapeBack = useRef<SVGPathElement>(null);
  const tapeFace = useRef<SVGPathElement>(null);
  const lamp = useRef<SVGCircleElement>(null);

  useEffect(() => {
    packs.current = { top: topPack, bottom: bottomPack };
  }, [topPack, bottomPack]);

  // One frame loop moves every part from the same clock, so the arms answer the reels exactly.
  useEffect(() => {
    if (!running || reduced) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const state = clock.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const before = { supply: reelTravel(state.t, SUPPLY_CLOCK), takeup: reelTravel(state.t, TAKEUP_CLOCK) };
      state.t += dt;
      const { top, bottom } = packs.current;
      state.top += degreesOf(reelTravel(state.t, SUPPLY_CLOCK) - before.supply, top);
      state.bottom += degreesOf(reelTravel(state.t, TAKEUP_CLOCK) - before.takeup, bottom);
      const arms = armAngles(state.t);
      const pulled = capstanTravel(state.t);
      const path = beltPath(thread(top, bottom, arms.supply, arms.takeup)).d;
      topRotor.current?.setAttribute("transform", turn(state.top, TOP));
      bottomRotor.current?.setAttribute("transform", turn(state.bottom, BOTTOM));
      supplyArm.current?.setAttribute("transform", turn(arms.supply, SUPPLY_PIVOT));
      takeupArm.current?.setAttribute("transform", turn(arms.takeup, TAKEUP_PIVOT));
      supplySpin.current?.setAttribute("transform", turn(degreesOf(pulled, IDLER_R + TAPE), SUPPLY_IDLER));
      takeupSpin.current?.setAttribute("transform", turn(degreesOf(pulled, IDLER_R + TAPE), TAKEUP_IDLER));
      guideInSpin.current?.setAttribute("transform", turn(degreesOf(pulled, GUIDE_R + TAPE), GUIDE_IN));
      guideOutSpin.current?.setAttribute("transform", turn(degreesOf(pulled, GUIDE_R + TAPE), GUIDE_OUT));
      capstanSpin.current?.setAttribute("transform", turn(degreesOf(pulled, CAPSTAN_R + TAPE), CAPSTAN));
      tapeBack.current?.setAttribute("d", path);
      tapeFace.current?.setAttribute("d", path);
      lamp.current?.setAttribute("opacity", capstanMoving(state.t) ? "1" : "0.35");
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const lit = lamp.current;
    return () => {
      cancelAnimationFrame(frame);
      lit?.removeAttribute("opacity");
    };
  }, [running, reduced]);

  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="h-full w-auto" role="img" aria-label={label}>
      <TransportPaints id={paintId} />
      <DeckPlate {...DECK} line={line} paints={paints} />

      <ReelShape cx={TOP.x} cy={TOP.y} r={R} ring={ring} fill={fill.top} line={line} layer="pack" />
      <ReelShape cx={BOTTOM.x} cy={BOTTOM.y} r={R} ring={ring} fill={fill.bottom} line={line} layer="pack" />

      <g ref={supplyArm} transform={turn(still.supply, SUPPLY_PIVOT)}>
        <ArmLever pivot={SUPPLY_PIVOT} end={SUPPLY_IDLER} line={line} />
        <Idler at={SUPPLY_IDLER} r={IDLER_R} line={line} spinRef={supplySpin} />
      </g>
      <g ref={takeupArm} transform={turn(still.takeup, TAKEUP_PIVOT)}>
        <ArmLever pivot={TAKEUP_PIVOT} end={TAKEUP_IDLER} line={line} />
        <Idler at={TAKEUP_IDLER} r={IDLER_R} line={line} spinRef={takeupSpin} />
      </g>

      <Guide at={GUIDE_IN} r={GUIDE_R} line={line} spinRef={guideInSpin} />
      <Guide at={GUIDE_OUT} r={GUIDE_R} line={line} spinRef={guideOutSpin} />
      <HeadAssembly at={HEAD} face={HEAD_FACE} half={HEAD_HALF} back={HEAD_BACK} line={line} fine={fine} paints={paints} />
      <Capstan at={CAPSTAN} r={CAPSTAN_R} line={line} spinRef={capstanSpin} />

      {/* Half-inch tape seen edge-on: a dark back edge under a lighter oxide face. */}
      <path ref={tapeBack} d={tape} fill="none" strokeWidth={TAPE * 2} strokeLinejoin="round" className="praezision-stroke-tape-edge" />
      <path ref={tapeFace} d={tape} fill="none" strokeWidth={TAPE * 1.3} strokeLinejoin="round" className="praezision-stroke-tape" />

      <PhotoCell tapeX={TAPE_X} y={PHOTOCELL_Y} line={line} active={running} paints={paints} lampRef={lamp} />

      <ReelShape cx={TOP.x} cy={TOP.y} r={R} ring={ring} fill={fill.top} line={line} layer="flange" angle={TOP_ANGLE} rotorRef={topRotor} />
      <ReelShape cx={BOTTOM.x} cy={BOTTOM.y} r={R} ring={ring} fill={fill.bottom} line={line} layer="flange" angle={BOTTOM_ANGLE} rotorRef={bottomRotor} />
    </svg>
  );
}
