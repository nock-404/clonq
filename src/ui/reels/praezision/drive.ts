// How a start-stop tape drive moves, as plain functions of time.
//
// The capstan pulls tape past the head in short blocks with gaps in between.
// Each reel kicks on its own clock: an abrupt burst with a little overshoot,
// then it holds. The tension arms take up the difference, so they swing in
// small steps while the capstan pulls and snap back when their reel kicks.

/** Tape through the head, in viewBox units per second, averaged over the gaps. */
export const TAPE_SPEED = 34;

const BLOCK_PERIOD = 0.46;
const BLOCK_MOVE = 0.3;

interface ReelClock {
  period: number;
  phase: number;
}

export const SUPPLY_CLOCK: ReelClock = { period: 1.13, phase: 0.21 };
export const TAKEUP_CLOCK: ReelClock = { period: 0.87, phase: 0.58 };

/** Share of a kick that is done, `seconds` after it started: fast rise, overshoot, settle. */
function kick(seconds: number): number {
  const rise = 0.2;
  if (seconds >= rise) return 1;
  const x = seconds / rise - 1;
  const c1 = 1.9;
  return 1 + (c1 + 1) * x * x * x + c1 * x * x;
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Tape the capstan has moved since t = 0. */
export function capstanTravel(t: number): number {
  const block = Math.floor(t / BLOCK_PERIOD);
  const inside = Math.min(1, (t - block * BLOCK_PERIOD) / BLOCK_MOVE);
  return TAPE_SPEED * BLOCK_PERIOD * (block + smooth(inside));
}

/** True while the capstan is pulling, false in the gap between blocks. */
export function capstanMoving(t: number): boolean {
  return t - Math.floor(t / BLOCK_PERIOD) * BLOCK_PERIOD < BLOCK_MOVE;
}

/** Tape a reel has paid out or taken up since t = 0. */
export function reelTravel(t: number, clock: ReelClock): number {
  const x = t + clock.phase;
  const count = Math.floor(x / clock.period);
  return TAPE_SPEED * clock.period * (count + kick(x - count * clock.period)) - TAPE_SPEED * clock.period;
}

/** Mean of a slack function over a long stretch, so the arms swing around their rest position. */
function meanOf(slack: (t: number) => number): number {
  let sum = 0;
  const steps = 4000;
  for (let i = 0; i < steps; i += 1) sum += slack(i * 0.01);
  return sum / steps;
}

const supplyMean = meanOf((t) => reelTravel(t, SUPPLY_CLOCK) - capstanTravel(t));
const takeupMean = meanOf((t) => capstanTravel(t) - reelTravel(t, TAKEUP_CLOCK));

/** Slack in front of the head (supply side) and behind it (take-up side), centred on zero. */
export function slack(t: number): { supply: number; takeup: number } {
  const pulled = capstanTravel(t);
  return {
    supply: reelTravel(t, SUPPLY_CLOCK) - pulled - supplyMean,
    takeup: pulled - reelTravel(t, TAKEUP_CLOCK) - takeupMean,
  };
}
