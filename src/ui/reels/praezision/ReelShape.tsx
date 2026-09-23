import type { Ref } from "react";
import type { Ring } from "../../../lib/types";
import { arc, circlePath, n, packRadius, polar, REEL, sector } from "./geometry";
import { useSvgId } from "./svgId";
import { ringLine, rimLine } from "./tint";

/**
 * How much of the reel is drawn.
 * "glyph" is for 1.25–1.75rem: bigger windows, bolder ring, no hairlines.
 * "mid" is for about 2.5rem: the real reel, but every line at least one CSS pixel.
 * "fine" is for 4rem and up: knurled hub, moulded rib, satin on the pack.
 */
export type ReelDetail = "glyph" | "mid" | "fine";
export type ReelLayer = "all" | "pack" | "flange";

interface ReelShapeProps {
  cx: number;
  cy: number;
  /** Outer radius of the flange. */
  r: number;
  ring: Ring;
  /** Share of the tape wound on, 0 (bare hub) to 1 (full reel). */
  fill: number;
  /** Turns in bursts by itself (CSS). Leave off when a parent drives `rotorRef`. */
  spinning?: boolean;
  detail?: ReelDetail;
  /** Width of one line in viewBox units, chosen by the caller for the rendered size. */
  line?: number;
  /** Lets a parent draw the tape between the pack and the flange. */
  layer?: ReelLayer;
  /** Resting angle of flange and hub, in degrees. */
  angle?: number;
  /** The group that turns: flange, windows and hub. */
  rotorRef?: Ref<SVGGElement>;
}

/**
 * Three round windows, as on DEC and third-party reels: a quarter of the
 * radius across at 0.64 of the radius. The glyph gets larger ones, so they
 * still read at 1.25rem.
 */
const WINDOWS: Record<ReelDetail, { at: number; radius: number }> = {
  glyph: { at: 0.665, radius: 0.185 },
  mid: { at: 0.645, radius: 0.145 },
  fine: { at: 0.645, radius: 0.13 },
};

function windowHoles(cx: number, cy: number, r: number, detail: ReelDetail): string {
  const { at, radius } = WINDOWS[detail];
  return [0, 120, 240]
    .map((a) => {
      const c = polar(cx, cy, r * at, a - 90);
      return circlePath(c.x, c.y, r * radius);
    })
    .join(" ");
}

interface PartProps {
  cx: number;
  cy: number;
  r: number;
  line: number;
}

/**
 * The wound tape and the back flange behind it. The pack is darker at the hub
 * and lighter toward its edge, with a satin sheen that stays with the light.
 */
function Pack({ cx, cy, r, line, fill, detail, gradient }: PartProps & { fill: number; detail: ReelDetail; gradient: string }) {
  const hub = r * REEL.hub;
  const pack = packRadius(r, fill);
  if (detail === "glyph") {
    return (
      <g>
        <circle cx={cx} cy={cy} r={r * 0.97} className="praezision-fill-back-flange" />
        <circle cx={cx} cy={cy} r={pack} className="praezision-fill-oxide-glyph" />
      </g>
    );
  }
  const inner = hub / pack;
  const sheen = detail === "fine" && pack - hub > r * 0.05;
  return (
    <g>
      <defs>
        <radialGradient id={gradient} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={pack}>
          <stop offset={inner} className="praezision-stop-oxide-deep" />
          <stop offset={inner + (1 - inner) * 0.55} className="praezision-stop-oxide" />
          <stop offset={1} className="praezision-stop-oxide-hi" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r * 0.985} className="praezision-fill-back-flange" />
      <circle cx={cx} cy={cy} r={pack} fill={`url(#${gradient})`} />
      {/* Satin: three nested wedges on each side add up to a soft bow tie of light. */}
      {sheen
        ? [-132, 48].flatMap((a) =>
            [34, 20, 9].map((span) => <path key={`${a}-${span}`} d={sector(cx, cy, hub, pack, span, a)} className="praezision-fill-sheen" />),
          )
        : null}
      <circle cx={cx} cy={cy} r={pack - line / 2} fill="none" strokeWidth={line} className="praezision-stroke-pack-edge" />
    </g>
  );
}

/** Knurls along the edge of the drive hub, as many as stay four lines apart. */
function knurl(cx: number, cy: number, radius: number, depth: number, line: number): string {
  const count = Math.min(72, Math.floor((2 * Math.PI * radius) / (line * 4) / 3) * 3);
  if (count < 36) return "";
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = polar(cx, cy, radius - depth, (i * 360) / count);
    const b = polar(cx, cy, radius - line, (i * 360) / count);
    parts.push(`M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}`);
  }
  return parts.join(" ");
}

/**
 * The drive hub of the machine: a dark knurled knob with three locking pads
 * that grip the reel's bore, like on an IBM 3420. The pads show every kick.
 */
function DriveHub({ cx, cy, r, line, detail }: PartProps & { detail: ReelDetail }) {
  const edge = r * REEL.driveHub;
  const face = r * 0.215;
  const grooves = detail === "fine" ? knurl(cx, cy, edge, r * 0.04, line) : "";
  const pad = { w: r * 0.078, h: r * 0.1, at: r * 0.288 };
  return (
    <>
      <circle cx={cx} cy={cy} r={edge} className="praezision-fill-knob" />
      {grooves ? <path d={grooves} strokeWidth={line} className="praezision-stroke-knob-lo" /> : null}
      <circle cx={cx} cy={cy} r={edge - line / 2} fill="none" strokeWidth={line} className="praezision-stroke-knob-hi" />
      <circle cx={cx} cy={cy} r={face} strokeWidth={line} className="praezision-fill-knob-face praezision-stroke-knob-lo" />
      {[30, 150, 270].map((a) => {
        const p = polar(cx, cy, pad.at, a);
        return (
          <rect
            key={a}
            x={p.x - pad.w / 2}
            y={p.y - pad.h / 2}
            width={pad.w}
            height={pad.h}
            rx={pad.w * 0.22}
            transform={`rotate(${n(a + 90)} ${n(p.x)} ${n(p.y)})`}
            className="praezision-fill-steel"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.05} strokeWidth={line} className="praezision-fill-bore praezision-stroke-knob-lo" />
    </>
  );
}

/** Clear flange with three windows, the reel hub, the write-enable ring and the drive hub. */
function Flange({ cx, cy, r, line, ring, detail }: PartProps & { ring: Ring; detail: ReelDetail }) {
  const holes = windowHoles(cx, cy, r, detail);
  const disc = `${circlePath(cx, cy, r)} ${holes}`;
  if (detail === "glyph") {
    return (
      <>
        <path d={disc} fillRule="evenodd" className="praezision-fill-frost-glyph" />
        <circle cx={cx} cy={cy} r={r - line / 2} fill="none" strokeWidth={line} className="stroke-ink/40" />
        <circle cx={cx} cy={cy} r={r * 0.36} strokeWidth={r * 0.2} className={`praezision-fill-knob ${ringLine[ring]}`} />
      </>
    );
  }
  return (
    <>
      <path d={disc} fillRule="evenodd" className="praezision-fill-frost" />
      <path d={holes} fill="none" strokeWidth={line} className="stroke-ink/30" />
      <circle cx={cx} cy={cy} r={r - line / 2} fill="none" strokeWidth={line} className={rimLine[ring]} />
      <circle cx={cx} cy={cy} r={r - line * 1.5} fill="none" strokeWidth={line} className="stroke-ink/20" />
      {detail === "fine" ? <circle cx={cx} cy={cy} r={r * 0.95} fill="none" strokeWidth={line} className="stroke-ink/[0.07]" /> : null}

      <circle cx={cx} cy={cy} r={r * REEL.hub} className="praezision-fill-reel-hub" />
      <circle cx={cx} cy={cy} r={r * REEL.hub - line / 2} fill="none" strokeWidth={line} className="stroke-ink/25" />
      <circle
        cx={cx}
        cy={cy}
        r={(r * (REEL.ringInner + REEL.ringOuter)) / 2}
        fill="none"
        strokeWidth={r * (REEL.ringOuter - REEL.ringInner)}
        className={ringLine[ring]}
      />
      <DriveHub cx={cx} cy={cy} r={r} line={line} detail={detail} />
    </>
  );
}

/** One crisp highlight along the rim. It stays where the light is while the reel turns. */
function Specular({ cx, cy, r, line }: PartProps) {
  const radius = r * 0.972;
  return <path d={arc(cx, cy, radius, -160, -108)} fill="none" strokeWidth={Math.max(line * 1.6, r * 0.024)} strokeLinecap="round" className="stroke-white/[0.18]" />;
}

/** One computer tape reel, drawn into a surrounding SVG. */
export function ReelShape({
  cx,
  cy,
  r,
  ring,
  fill,
  spinning = false,
  detail = "fine",
  line = 0.5,
  layer = "all",
  angle = 0,
  rotorRef,
}: ReelShapeProps) {
  const gradient = useSvgId("praezision-pack");
  return (
    <g>
      {layer !== "flange" ? <Pack cx={cx} cy={cy} r={r} line={line} fill={fill} detail={detail} gradient={gradient} /> : null}
      {layer !== "pack" ? (
        <g ref={rotorRef} transform={`rotate(${n(angle)} ${n(cx)} ${n(cy)})`} className={spinning ? "spin-origin praezision-kick" : undefined}>
          <Flange cx={cx} cy={cy} r={r} line={line} ring={ring} detail={detail} />
        </g>
      ) : null}
      {layer !== "pack" && detail !== "glyph" ? <Specular cx={cx} cy={cy} r={r} line={line} /> : null}
    </g>
  );
}
