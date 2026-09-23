// Small vector helpers for drawing reels and tape paths in viewBox units.

export interface Point {
  x: number;
  y: number;
}

/** A wheel the tape wraps around: reel pack, roller, capstan. */
export interface Wheel extends Point {
  r: number;
}

const f = (n: number) => Number(n.toFixed(2));

export function pt(p: Point): string {
  return `${f(p.x)} ${f(p.y)}`;
}

export function polar(cx: number, cy: number, radius: number, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A full circle as a path, so several can be combined into one even-odd shape. */
export function disc(cx: number, cy: number, r: number): string {
  return `M ${f(cx - r)} ${f(cy)} a ${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0 a ${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0 Z`;
}

/** A ring sector between two radii, from one angle to another (degrees, clockwise). */
export function sector(cx: number, cy: number, inner: number, outer: number, from: number, to: number): string {
  const large = to - from > 180 ? 1 : 0;
  return [
    `M ${pt(polar(cx, cy, inner, from))}`,
    `L ${pt(polar(cx, cy, outer, from))}`,
    `A ${f(outer)} ${f(outer)} 0 ${large} 1 ${pt(polar(cx, cy, outer, to))}`,
    `L ${pt(polar(cx, cy, inner, to))}`,
    `A ${f(inner)} ${f(inner)} 0 ${large} 0 ${pt(polar(cx, cy, inner, from))}`,
    "Z",
  ].join(" ");
}

/** A closed polygon whose corners are rounded off with the given radius. */
export function roundedPolygon(points: Point[], radius: number): string {
  const n = points.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i + n - 1) % n];
    const corner = points[i];
    const next = points[(i + 1) % n];
    if (!prev || !corner || !next) continue;
    const toPrev = Math.hypot(prev.x - corner.x, prev.y - corner.y);
    const toNext = Math.hypot(next.x - corner.x, next.y - corner.y);
    const a = Math.min(radius, toPrev / 2) / toPrev;
    const b = Math.min(radius, toNext / 2) / toNext;
    const start = { x: corner.x + (prev.x - corner.x) * a, y: corner.y + (prev.y - corner.y) * a };
    const end = { x: corner.x + (next.x - corner.x) * b, y: corner.y + (next.y - corner.y) * b };
    parts.push(`${i === 0 ? "M" : "L"} ${pt(start)} Q ${pt(corner)} ${pt(end)}`);
  }
  return `${parts.join(" ")} Z`;
}

/** A square of the given half-diagonal, turned by `turn` degrees, corners rounded. */
export function roundedSquare(center: Point, halfDiagonal: number, turn: number, radius: number): string {
  const corners = [0, 90, 180, 270].map((a) => polar(center.x, center.y, halfDiagonal, a + turn));
  return roundedPolygon(corners, radius);
}

/**
 * The straight run of tape between two wheels. A wheel's radius is signed:
 * two wheels with the same sign are wrapped on the same side (an open belt),
 * opposite signs cross between them. `side` picks one of the two solutions.
 */
export function tangent(a: Wheel, b: Wheel, side: 1 | -1): [Point, Point] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const theta = Math.atan2(dy, dx) + side * Math.acos(Math.min(1, Math.max(-1, (a.r - b.r) / length)));
  const nx = Math.cos(theta);
  const ny = Math.sin(theta);
  return [
    { x: a.x + a.r * nx, y: a.y + a.r * ny },
    { x: b.x + b.r * nx, y: b.y + b.r * ny },
  ];
}

/** An arc around a wheel to the given point; sweep 1 is clockwise on screen. */
export function arcTo(wheel: Wheel, to: Point, sweep: 0 | 1): string {
  const r = Math.abs(wheel.r);
  return `A ${f(r)} ${f(r)} 0 0 ${sweep} ${pt(to)}`;
}

/** A ring sector with its four corners rounded off, for windows that read as moulded holes. */
export function roundedSector(cx: number, cy: number, inner: number, outer: number, from: number, to: number, radius: number): string {
  const steps = 8;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) points.push(polar(cx, cy, outer, from + ((to - from) * i) / steps));
  for (let i = steps; i >= 0; i -= 1) points.push(polar(cx, cy, inner, from + ((to - from) * i) / steps));
  return roundedPolygon(points, radius);
}
