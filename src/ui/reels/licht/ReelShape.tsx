import { useId, type ReactNode } from "react";
import type { Ring } from "../../../lib/types";
import { ringText } from "../../rings";

/** "icon" is a bold, simplified reel for 1.25–1.75rem; "full" is the smoked-glass reel with all its parts. */
export type ReelDetail = "icon" | "full";

interface ReelShapeProps {
  cx: number;
  cy: number;
  /** Outer radius of the flange. */
  r: number;
  ring: Ring;
  /** How much tape is wound on, 0 (empty hub) to 1 (full reel). */
  fill: number;
  spinning: boolean;
  /** Turns counter-clockwise. */
  reverse?: boolean;
  /** Uses the machine reel's kick pattern, so two reels never move in step. */
  slow?: boolean;
  detail?: ReelDetail;
  /** Drawn between the tape pack and the front flange, e.g. the tape leaving the reel. */
  children?: ReactNode;
}

interface WindowShape {
  inner: number;
  outer: number;
  span: number;
  round: number;
}

// Proportions of a 10½-inch computer tape reel (ECMA-62), as fractions of the flange radius.
const HUB = 0.49;
const FULL = 0.94;
const BORE = 0.35;
const DRIVE = 0.345;
const WRITE_RING = { inner: 0.37, outer: 0.42 };
const RIB = 0.915;
const LIP = 0.972;
const SPECULAR = 0.944;
// Three wide windows in the front flange, so the jerky rotation reads at a glance.
const WINDOW: WindowShape = { inner: 0.56, outer: 0.865, span: 46, round: 0.075 };
const WINDOW_ANGLES = [-90, 30, 150];
// The drive hub clamps the reel with three latch pads, set between the windows.
const PAD_ANGLES = [-30, 90, 210];
const WINDINGS = [0.16, 0.34, 0.5, 0.63, 0.75, 0.86];

// The icon keeps only what survives 1.25rem: rim, flange, windows, ring, hub.
const ICON = { rim: 0.945, rimWidth: 0.11, flange: 0.9, bore: 0.47, ring: 0.4, ringWidth: 0.12, hub: 0.315 };
const ICON_WINDOW: WindowShape = { inner: 0.535, outer: 0.845, span: 50, round: 0.08 };

/** Radius of the wound tape. The pack grows by area, as real tape does. */
export function packRadius(r: number, fill: number): number {
  const f = Math.min(1, Math.max(0, fill));
  return r * Math.sqrt(HUB * HUB + f * (FULL * FULL - HUB * HUB));
}

function disc(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
}

function polar(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
}

function pt(p: [number, number]): string {
  return `${p[0].toFixed(3)} ${p[1].toFixed(3)}`;
}

/** A flange window: an annular sector with radial sides and rounded corners. */
function windowPath(cx: number, cy: number, r: number, center: number, shape: WindowShape): string {
  const inner = r * shape.inner;
  const outer = r * shape.outer;
  const round = r * shape.round;
  const a = center - shape.span / 2;
  const b = center + shape.span / 2;
  const degOuter = (round / outer) * (180 / Math.PI);
  const degInner = (round / inner) * (180 / Math.PI);
  const at = (radius: number, deg: number) => pt(polar(cx, cy, radius, deg));
  return [
    `M ${at(outer, a + degOuter)}`,
    `A ${outer} ${outer} 0 0 1 ${at(outer, b - degOuter)}`,
    `Q ${at(outer, b)} ${at(outer - round, b)}`,
    `L ${at(inner + round, b)}`,
    `Q ${at(inner, b)} ${at(inner, b - degInner)}`,
    `A ${inner} ${inner} 0 0 0 ${at(inner, a + degInner)}`,
    `Q ${at(inner, a)} ${at(inner + round, a)}`,
    `L ${at(outer - round, a)}`,
    `Q ${at(outer, a)} ${at(outer, a + degOuter)}`,
    "Z",
  ].join(" ");
}

function windows(cx: number, cy: number, r: number, shape: WindowShape): string[] {
  return WINDOW_ANGLES.map((angle) => windowPath(cx, cy, r, angle, shape));
}

/** A thin wedge from the centre, for the fixed reflections on the turned hub. */
function wedge(cx: number, cy: number, radius: number, center: number, half: number): string {
  return `M ${cx} ${cy} L ${pt(polar(cx, cy, radius, center - half))} A ${radius} ${radius} 0 0 1 ${pt(polar(cx, cy, radius, center + half))} Z`;
}

function hexagon(cx: number, cy: number, radius: number): string {
  const corners = Array.from({ length: 6 }, (_, i) => pt(polar(cx, cy, radius, i * 60 + 15)));
  return `M ${corners.join(" L ")} Z`;
}

function motionClass(spinning: boolean, reverse: boolean, slow: boolean): string {
  if (!spinning) return "";
  return `${slow ? "licht-reel-b" : "licht-reel-a"} ${reverse ? "licht-ccw" : ""}`;
}

/** One reel, drawn into a surrounding SVG. Flange windows and hub latches turn; the light and the round pack stay put. */
export function ReelShape({ cx, cy, r, ring, fill, spinning, reverse = false, slow = false, detail = "full", children }: ReelShapeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `licht-${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const pack = packRadius(r, fill);
  const spin = `spin-origin ${motionClass(spinning, reverse, slow)}`;

  if (detail === "icon") {
    const holes = windows(cx, cy, r, ICON_WINDOW);
    return (
      <g className={ringText[ring]}>
        <defs>
          <linearGradient id={id("gloss")} x1="0.2" y1="0" x2="0.55" y2="1">
            <stop offset="0" className="licht-stop-glint" stopOpacity="0.3" />
            <stop offset="0.45" className="licht-stop-glint" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Through the windows: the tape where there is tape, the dark cabinet where there is none. */}
        <circle cx={cx} cy={cy} r={r * ICON.flange} className="licht-fill-cabinet" />
        <circle cx={cx} cy={cy} r={Math.min(pack, r * ICON.flange)} className="licht-fill-pack-bright" />
        {children}
        <g className={spin}>
          <path d={[disc(cx, cy, r * ICON.flange), disc(cx, cy, r * ICON.bore), ...holes].join(" ")} fillRule="evenodd" className="licht-fill-flange" />
        </g>
        <circle cx={cx} cy={cy} r={r * ICON.rim} fill="none" strokeWidth={r * ICON.rimWidth} stroke="currentColor" />
        <circle cx={cx} cy={cy} r={r * ICON.ring} fill="none" strokeWidth={r * ICON.ringWidth} stroke="currentColor" />
        <circle cx={cx} cy={cy} r={r * ICON.hub} className="licht-fill-hub-metal" />
        <g className={spin}>
          <circle cx={cx} cy={cy} r={r * ICON.hub} fill="none" />
          <rect x={cx - r * 0.05} y={cy - r * ICON.hub} width={r * 0.1} height={r * ICON.hub * 2} className="licht-fill-metal-lo" />
        </g>
        <circle cx={cx} cy={cy} r={r * 0.1} className="licht-fill-glass" />
        <circle cx={cx} cy={cy} r={r} fill={url("gloss")} />
      </g>
    );
  }

  const holes = windows(cx, cy, r, WINDOW);
  const flange = [disc(cx, cy, r), disc(cx, cy, r * BORE), ...holes].join(" ");
  const [crescentX, crescentY] = polar(cx, cy, r * 0.05, 45);
  const ringMid = (r * (WRITE_RING.inner + WRITE_RING.outer)) / 2;
  const ringWidth = r * (WRITE_RING.outer - WRITE_RING.inner);
  // Two highlights on the curved edge of the plastic: the key light at the upper left, its refraction at the lower right.
  const glints = [
    { name: "keyLight", from: 196, to: 252, peak: 0.7 },
    { name: "refraction", from: 18, to: 58, peak: 0.28 },
  ].map((glint) => ({ ...glint, a: polar(cx, cy, r * SPECULAR, glint.from), b: polar(cx, cy, r * SPECULAR, glint.to) }));

  return (
    <g className={ringText[ring]}>
      <defs>
        <radialGradient id={id("shadow")}>
          <stop offset="0.78" className="licht-stop-shade" stopOpacity="0.55" />
          <stop offset="1" className="licht-stop-shade" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("back")} cx="0.42" cy="0.36" r="0.7">
          <stop offset="0" className="licht-stop-cabinet-hi" />
          <stop offset="1" className="licht-stop-cabinet" />
        </radialGradient>
        <radialGradient id={id("pack")} cx={cx} cy={cy} r={pack} gradientUnits="userSpaceOnUse">
          <stop offset={(r * HUB) / pack} className="licht-stop-pack-deep" />
          <stop offset="0.93" className="licht-stop-pack" />
          <stop offset="0.985" className="licht-stop-pack-edge" />
          <stop offset="1" className="licht-stop-pack" />
        </radialGradient>
        <radialGradient id={id("smoke")} cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
          <stop offset={BORE} className="licht-stop-smoke" stopOpacity="0.42" />
          <stop offset="0.8" className="licht-stop-smoke" stopOpacity="0.36" />
          <stop offset="1" className="licht-stop-smoke" stopOpacity="0.52" />
        </radialGradient>
        <linearGradient id={id("haze")} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" className="licht-stop-glint" stopOpacity="0.1" />
          <stop offset="0.55" className="licht-stop-glint" stopOpacity="0.035" />
          <stop offset="1" className="licht-stop-glint" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id={id("crescent")} x1="0.15" y1="0.1" x2="0.75" y2="0.9">
          <stop offset="0" className="licht-stop-glint" stopOpacity="0.5" />
          <stop offset="0.4" className="licht-stop-glint" stopOpacity="0.08" />
          <stop offset="1" className="licht-stop-glint" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("rim")} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" className="licht-stop-glint" stopOpacity="0.35" />
          <stop offset="0.5" className="licht-stop-glint" stopOpacity="0.05" />
          <stop offset="1" className="licht-stop-glint" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={id("ringGloss")} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" className="licht-stop-glint" stopOpacity="0.45" />
          <stop offset="0.5" className="licht-stop-glint" stopOpacity="0" />
          <stop offset="1" className="licht-stop-shade" stopOpacity="0.25" />
        </linearGradient>
        <radialGradient id={id("cap")} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" className="licht-stop-metal-hi" />
          <stop offset="0.6" className="licht-stop-metal" />
          <stop offset="1" className="licht-stop-metal-lo" />
        </radialGradient>
        <linearGradient id={id("pad")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="licht-stop-metal-lo" />
          <stop offset="1" className="licht-stop-anodized" />
        </linearGradient>
        {glints.map((glint) => (
          <linearGradient key={glint.name} id={id(glint.name)} x1={glint.a[0]} y1={glint.a[1]} x2={glint.b[0]} y2={glint.b[1]} gradientUnits="userSpaceOnUse">
            <stop offset="0" className="licht-stop-glint" stopOpacity="0" />
            <stop offset="0.5" className="licht-stop-glint" stopOpacity={glint.peak} />
            <stop offset="1" className="licht-stop-glint" stopOpacity="0" />
          </linearGradient>
        ))}
        {[-45, 135].map((angle) => {
          const [ax, ay] = polar(cx, cy, r * DRIVE * 0.6, angle - 90);
          const [bx, by] = polar(cx, cy, r * DRIVE * 0.6, angle + 90);
          return (
            <linearGradient key={angle} id={id(`turn${angle}`)} x1={ax} y1={ay} x2={bx} y2={by} gradientUnits="userSpaceOnUse">
              <stop offset="0.3" className="licht-stop-glint" stopOpacity="0" />
              <stop offset="0.5" className="licht-stop-glint" stopOpacity={angle < 0 ? 0.8 : 0.45} />
              <stop offset="0.7" className="licht-stop-glint" stopOpacity="0" />
            </linearGradient>
          );
        })}
      </defs>

      {/* Soft shadow under the reel, cast downwards. */}
      <circle cx={cx + r * 0.02} cy={cy + r * 0.07} r={r * 1.07} fill={url("shadow")} />

      {/* The cabinet, seen through both flanges wherever there is no tape. */}
      <circle cx={cx} cy={cy} r={r} fill={url("back")} />

      {/* The tape pack: matte oxide, a slightly lighter outer turn, very fine windings. */}
      <circle cx={cx} cy={cy} r={pack} fill={url("pack")} />
      {pack > r * (HUB + 0.03)
        ? WINDINGS.map((t) => (
            <circle key={t} cx={cx} cy={cy} r={r * HUB + (pack - r * HUB) * t} fill="none" strokeWidth={r * 0.005} className="licht-stroke-pack-line" />
          ))
        : null}
      <circle cx={cx} cy={cy} r={r * HUB} className="licht-fill-hub" />

      {children}

      {/* The flange's moulded edge, visible as a thickness along the bottom. */}
      <circle cx={cx} cy={cy + r * 0.02} r={r * 0.985} fill="none" strokeWidth={r * 0.028} className="licht-stroke-smoke" strokeOpacity="0.8" />

      {/* Front flange in smoked plastic; the windows show the bare tape, with a bright cut edge. */}
      <g className={spin}>
        <path d={flange} fillRule="evenodd" fill={url("smoke")} />
        <path d={flange} fillRule="evenodd" fill={url("haze")} />
        {holes.map((d) => (
          <path key={d} d={d} fill="none" strokeWidth={r * 0.014} className="licht-stroke-cut" />
        ))}
      </g>

      {/* The moulded boss around the hub, a raised rib near the rim, the tinted edge of the plastic. */}
      <circle cx={cx} cy={cy} r={r * 0.525} fill="none" strokeWidth={r * 0.008} className="licht-stroke-glint" strokeOpacity="0.1" />
      <circle cx={cx} cy={cy} r={r * RIB} fill="none" strokeWidth={r * 0.012} className="licht-stroke-shade" strokeOpacity="0.4" />
      <circle cx={cx} cy={cy} r={r * (RIB + 0.011)} fill="none" strokeWidth={r * 0.008} className="licht-stroke-glint" strokeOpacity="0.12" />
      <circle cx={cx} cy={cy} r={r * LIP} fill="none" strokeWidth={r * 0.042} stroke="currentColor" strokeOpacity="0.6" />

      {/* Hub: the write-enable ring in its groove, then the machine's turned drive hub. */}
      <circle cx={cx} cy={cy} r={ringMid} fill="none" strokeWidth={ringWidth + r * 0.024} className="licht-stroke-groove" />
      <circle cx={cx} cy={cy} r={ringMid} fill="none" strokeWidth={ringWidth} stroke="currentColor" />
      <circle cx={cx} cy={cy} r={ringMid} fill="none" strokeWidth={ringWidth} stroke={url("ringGloss")} />

      <circle cx={cx} cy={cy} r={r * DRIVE} fill={url("cap")} />
      {/* A turned surface: the reflections run through the centre and stay put while the hub turns. */}
      <path d={wedge(cx, cy, r * DRIVE, -45, 16)} fill={url("turn-45")} />
      <path d={wedge(cx, cy, r * DRIVE, 135, 16)} fill={url("turn135")} />
      <circle cx={cx} cy={cy} r={r * 0.215} fill="none" strokeWidth={r * 0.01} className="licht-stroke-shade" strokeOpacity="0.35" />
      <circle cx={cx} cy={cy} r={r * 0.222} fill="none" strokeWidth={r * 0.006} className="licht-stroke-glint" strokeOpacity="0.4" />
      <g className={spin}>
        <circle cx={cx} cy={cy} r={r * DRIVE} fill="none" />
        {/* Knurled edge of the cap. */}
        <circle
          cx={cx}
          cy={cy}
          r={r * (DRIVE - 0.016)}
          fill="none"
          strokeWidth={r * 0.028}
          strokeDasharray={`${r * 0.011} ${r * 0.011}`}
          className="licht-stroke-metal-lo"
          strokeOpacity="0.85"
        />
        {PAD_ANGLES.map((angle) => (
          <rect
            key={angle}
            x={cx + r * 0.225}
            y={cy - r * 0.036}
            width={r * 0.115}
            height={r * 0.072}
            rx={r * 0.02}
            fill={url("pad")}
            strokeWidth={r * 0.008}
            className="licht-stroke-glint-soft"
            transform={`rotate(${angle} ${cx} ${cy})`}
          />
        ))}
        <circle cx={cx} cy={cy} r={r * 0.085} className="licht-fill-anodized" />
        <path d={hexagon(cx, cy, r * 0.042)} className="licht-fill-glass" />
      </g>
      <circle cx={cx} cy={cy} r={r * DRIVE} fill="none" strokeWidth={r * 0.01} className="licht-stroke-glint" strokeOpacity="0.35" />

      {/* Light on the plastic: a crescent along the upper rim and a thin lit edge. */}
      <path d={`${disc(cx, cy, r * 0.99)} ${disc(crescentX, crescentY, r * 0.935)}`} fillRule="evenodd" fill={url("crescent")} />
      <circle cx={cx} cy={cy} r={r * 0.992} fill="none" strokeWidth={r * 0.016} stroke={url("rim")} />
      {glints.map((glint) => (
        <path
          key={glint.name}
          d={`M ${pt(glint.a)} A ${r * SPECULAR} ${r * SPECULAR} 0 0 1 ${pt(glint.b)}`}
          fill="none"
          strokeWidth={r * 0.02}
          strokeLinecap="round"
          stroke={url(glint.name)}
        />
      ))}
    </g>
  );
}
