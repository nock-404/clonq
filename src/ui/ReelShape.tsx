import type { Ring } from "../lib/types";
import { ringStroke } from "./rings";

interface ReelShapeProps {
  cx: number;
  cy: number;
  /** Outer radius of the flange. */
  r: number;
  ring: Ring;
  /** How much tape is wound on, 0 (empty hub) to 1 (full reel). */
  fill: number;
  spinning: boolean;
  reverse?: boolean;
  slow?: boolean;
}

/** Three windows in the flange, as on a 10½-inch computer tape reel. */
function windows(cx: number, cy: number, r: number): string {
  const inner = r * 0.47;
  const outer = r * 0.9;
  const span = (78 * Math.PI) / 180;
  const parts: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const start = -Math.PI / 2 + (i * 2 * Math.PI) / 3 - span / 2;
    const end = start + span;
    const point = (radius: number, angle: number) =>
      `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
    parts.push(
      `M ${point(inner, start)} L ${point(outer, start)} A ${outer} ${outer} 0 0 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 0 0 ${point(inner, start)} Z`,
    );
  }
  return parts.join(" ");
}

function disc(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
}

/** One reel, drawn into a surrounding SVG. The flange and hub turn; the wound tape is round anyway. */
export function ReelShape({ cx, cy, r, ring, fill, spinning, reverse = false, slow = false }: ReelShapeProps) {
  const hub = r * 0.3;
  const pack = hub + (r * 0.94 - hub) * Math.min(1, Math.max(0, fill));
  const motion = spinning ? `${slow ? "animate-reel-slow" : "animate-reel"} ${reverse ? "reel-reverse" : ""}` : "";
  return (
    <g>
      <circle cx={cx} cy={cy} r={pack} className="fill-oxide-deep" />
      <circle cx={cx} cy={cy} r={pack * 0.82} fill="none" strokeWidth={r * 0.012} className="stroke-oxide" />
      <circle cx={cx} cy={cy} r={pack * 0.64} fill="none" strokeWidth={r * 0.012} className="stroke-oxide" />
      <g className={`spin-origin ${motion}`}>
        <path d={`${disc(cx, cy, r)} ${windows(cx, cy, r)}`} fillRule="evenodd" className="fill-ink/15" />
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={r * 0.025} className="stroke-ink/30" />
        <circle cx={cx} cy={cy} r={hub} className="fill-ink/25" />
        <circle cx={cx} cy={cy} r={hub * 0.78} fill="none" strokeWidth={hub * 0.34} className={ringStroke[ring]} />
        <circle cx={cx} cy={cy} r={hub * 0.3} className="fill-canvas" />
        {[0, 1, 2].map((i) => {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
          return (
            <circle
              key={i}
              cx={cx + hub * 0.46 * Math.cos(angle)}
              cy={cy + hub * 0.46 * Math.sin(angle)}
              r={hub * 0.09}
              className="fill-canvas"
            />
          );
        })}
      </g>
    </g>
  );
}
