// Plain geometry for the tape drawings: reel proportions, tape pack radius and
// the tape path as a belt of tangents and arcs around rollers.

export interface Point {
  x: number;
  y: number;
}

/** A roller the tape wraps. `wrap` is 1 when the tape runs clockwise around it, -1 otherwise. */
export interface Pulley extends Point {
  r: number;
  wrap: 1 | -1;
}

/** Reel proportions after ECMA-62, as fractions of the flange radius. */
export const REEL = {
  driveHub: 0.36,
  ringInner: 0.37,
  ringOuter: 0.42,
  hub: 0.49,
  packMax: 0.94,
} as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Radius of the tape pack for a share of the tape length. Tape length grows
 * with the wound area, so the radius grows with its square root.
 */
export function packRadius(r: number, fill: number): number {
  const hub = r * REEL.hub;
  const max = r * REEL.packMax;
  return Math.sqrt(hub * hub + clamp(fill, 0, 1) * (max * max - hub * hub));
}

export function polar(cx: number, cy: number, radius: number, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
}

export function rotate(p: Point, origin: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * Math.cos(a) - dy * Math.sin(a), y: origin.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

export function n(value: number): string {
  return value.toFixed(2);
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M ${n(cx - r)} ${n(cy)} a ${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0 a ${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0 Z`;
}

/**
 * A lever with round ends of different radii: `ra` at `a`, `rb` at `b`.
 * Its sides are the outer tangents of the two end circles.
 */
export function taperedBar(a: Point, b: Point, ra: number, rb: number): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const sin = clamp((ra - rb) / length, -1, 1);
  const cos = Math.sqrt(1 - sin * sin);
  const side = (k: 1 | -1) => ({ x: -uy * cos * k + ux * sin, y: ux * cos * k + uy * sin });
  const m = side(1);
  const o = side(-1);
  return [
    `M ${n(a.x + ra * m.x)} ${n(a.y + ra * m.y)}`,
    `L ${n(b.x + rb * m.x)} ${n(b.y + rb * m.y)}`,
    `A ${n(rb)} ${n(rb)} 0 0 0 ${n(b.x + rb * o.x)} ${n(b.y + rb * o.y)}`,
    `L ${n(a.x + ra * o.x)} ${n(a.y + ra * o.y)}`,
    `A ${n(ra)} ${n(ra)} 0 1 0 ${n(a.x + ra * m.x)} ${n(a.y + ra * m.y)}`,
    "Z",
  ].join(" ");
}

/** A ring sector from `inner` to `outer`, `spanDegrees` wide, centred on `degrees`. */
export function sector(cx: number, cy: number, inner: number, outer: number, spanDegrees: number, degrees: number): string {
  const start = degrees - spanDegrees / 2;
  const end = degrees + spanDegrees / 2;
  const a = polar(cx, cy, inner, start);
  const b = polar(cx, cy, outer, start);
  const c = polar(cx, cy, outer, end);
  const d = polar(cx, cy, inner, end);
  return `M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)} A ${n(outer)} ${n(outer)} 0 0 1 ${n(c.x)} ${n(c.y)} L ${n(d.x)} ${n(d.y)} A ${n(inner)} ${n(inner)} 0 0 0 ${n(a.x)} ${n(a.y)} Z`;
}

/** An arc along a circle, clockwise from `from` to `to` degrees. */
export function arc(cx: number, cy: number, radius: number, from: number, to: number): string {
  const a = polar(cx, cy, radius, from);
  const b = polar(cx, cy, radius, to);
  return `M ${n(a.x)} ${n(a.y)} A ${n(radius)} ${n(radius)} 0 ${to - from > 180 ? 1 : 0} 1 ${n(b.x)} ${n(b.y)}`;
}

export interface Tangent {
  from: Point;
  to: Point;
}

/**
 * The straight run of tape leaving pulley `a` and arriving at pulley `b`.
 * A pulley wrapped clockwise has its centre on the right of the direction of
 * travel (screen coordinates, y down), so both touch points follow from one angle.
 */
export function tangent(a: Pulley, b: Pulley): Tangent {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const k = b.wrap * b.r - a.wrap * a.r;
  const theta = Math.atan2(dy, dx) - Math.asin(clamp(k / length, -1, 1));
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);
  return {
    from: { x: a.x - a.wrap * a.r * nx, y: a.y - a.wrap * a.r * ny },
    to: { x: b.x - b.wrap * b.r * nx, y: b.y - b.wrap * b.r * ny },
  };
}

function sweepAngle(p: Pulley, enter: Point, leave: Point): number {
  const a = Math.atan2(enter.y - p.y, enter.x - p.x);
  const b = Math.atan2(leave.y - p.y, leave.x - p.x);
  const turn = p.wrap === 1 ? b - a : a - b;
  return ((turn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Tape threaded through `pulleys` in order: it leaves the first (the supply
 * pack), wraps every roller in between and ends where it meets the last (the
 * take-up pack). Returns the SVG path and the free length of tape.
 */
export function beltPath(pulleys: readonly Pulley[]): { d: string; length: number } {
  const runs: Tangent[] = [];
  for (let i = 0; i + 1 < pulleys.length; i += 1) {
    const a = pulleys[i];
    const b = pulleys[i + 1];
    if (a && b) runs.push(tangent(a, b));
  }
  const first = runs[0];
  if (!first) return { d: "", length: 0 };
  const parts = [`M ${n(first.from.x)} ${n(first.from.y)}`];
  let length = 0;
  runs.forEach((run, i) => {
    parts.push(`L ${n(run.to.x)} ${n(run.to.y)}`);
    length += Math.hypot(run.to.x - run.from.x, run.to.y - run.from.y);
    const next = runs[i + 1];
    const p = pulleys[i + 1];
    if (next && p) {
      const angle = sweepAngle(p, run.to, next.from);
      // Almost a full turn means the roller does not touch the tape at all: go straight on.
      if (angle > Math.PI * 1.5) {
        parts.push(`L ${n(next.from.x)} ${n(next.from.y)}`);
      } else {
        length += angle * p.r;
        parts.push(`A ${n(p.r)} ${n(p.r)} 0 ${angle > Math.PI ? 1 : 0} ${p.wrap === 1 ? 1 : 0} ${n(next.from.x)} ${n(next.from.y)}`);
      }
    }
  });
  return { d: parts.join(" "), length };
}
