import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import type { Tone } from "../lib/labels";
import type { Ring } from "../lib/types";
import { LocationShape, type GlyphKind, type GlyphLamp } from "./LocationShape";
import { ReelShape } from "./ReelShape";
import { toneText } from "./tone";

/** off: dark · active: waiting for the user, outlined · busy: blinking · done: lit (ok) · failed: lit (danger). */
export type UiLampState = "off" | "active" | "busy" | "done" | "failed";

export interface UiDriveLamp {
  key: string;
  label: string;
  state: UiLampState;
}

interface UiDriveFrontProps {
  /** The location mounted in the bay; null leaves the bay empty. */
  kind: GlyphKind | null;
  /** Text on the label strip under the bay, e.g. the location's name. */
  label: string;
  /** Shown faint on the strip while the label is empty. */
  placeholder?: string;
  lamp: GlyphLamp;
  /** The tape runs from reel to reel through the head, and down to the bay: the location is connected. */
  threaded: boolean;
  /** Drawn faint in the bay, e.g. a drive that is not plugged in. */
  dimmed?: boolean;
  /** The reels keep turning, e.g. while a job uses the location. */
  spinning?: boolean;
  /** Any value; whenever it changes, the tape is laid in anew and the reels turn once. */
  pulse?: string | number;
  /** A row of panel lamps with a word under each. */
  lamps?: UiDriveLamp[];
  /** The lamps are steps in order; a tape between them is written up to the last finished one. */
  sequence?: boolean;
  /** One line under the lamps. */
  status?: ReactNode;
  statusTone?: Tone;
  /** Between the label strip and the lamps, e.g. a description. */
  children?: ReactNode;
  /** Stretch to the height of the column and keep the lamps at the bottom. */
  fill?: boolean;
  ring?: Ring;
}

// Deck geometry in viewBox units: two reels side by side behind a smoked window,
// the tape running down past two rollers and under the head, the bay below.
const W = 200;
const H = 160;
const WINDOW_H = 86;
const R = 32;
const LEFT = { x: 50, y: 40 };
const RIGHT = { x: 150, y: 40 };
const ROLLERS = [80, 120];
const ROLLER_Y = 76;
const TAPE_Y = 79.5;
const BAY = { x: 56, y: 94, w: 88, h: 64 };
const GLYPH = 56;
/** One turn of the reel keyframes, see --animate-reel in app.css. */
const TURN_MS = 2400;

function packRadius(fill: number): number {
  const hub = R * 0.3;
  return hub + (R * 0.94 - hub) * fill;
}

function onCircle(cx: number, cy: number, r: number, degrees: number): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

/** True for one revolution of the reels after `play` changes. */
function useOneTurn(play: number): boolean {
  const [turning, setTurning] = useState(false);
  useEffect(() => {
    if (play === 0) return;
    setTurning(true);
    const timer = window.setTimeout(() => setTurning(false), TURN_MS);
    return () => window.clearTimeout(timer);
  }, [play]);
  return turning;
}

/**
 * The front of a tape drive, with a location mounted in its bay: two reels behind
 * a smoked window, the tape laid through the head when the location is connected,
 * a label strip with its name, and a row of panel lamps that light only while
 * something happens.
 */
export function UiDriveFront({
  kind,
  label,
  placeholder = "",
  lamp,
  threaded,
  dimmed = false,
  spinning = false,
  pulse,
  lamps = [],
  sequence = false,
  status,
  statusTone = "neutral",
  children,
  fill = false,
  ring = "white",
}: UiDriveFrontProps) {
  // A new pulse, or the tape being threaded, lays the tape in again and turns the reels once.
  const [seen, setSeen] = useState({ pulse, threaded });
  const [play, setPlay] = useState(0);
  if (seen.pulse !== pulse || seen.threaded !== threaded) {
    const replay = seen.pulse !== pulse || (threaded && !seen.threaded);
    setSeen({ pulse, threaded });
    if (replay) setPlay((count) => count + 1);
  }
  const turning = useOneTurn(play) || spinning;

  const leftFill = threaded ? 0.72 : 0.86;
  const rightFill = threaded ? 0.34 : 0;
  const [lx, ly] = onCircle(LEFT.x, LEFT.y, packRadius(leftFill), 55);
  const [rx, ry] = onCircle(RIGHT.x, RIGHT.y, packRadius(rightFill), 125);
  const tape = `M ${lx.toFixed(2)} ${ly.toFixed(2)} L ${(ROLLERS[0] ?? 0) - 2} ${TAPE_Y} L ${(ROLLERS[1] ?? 0) + 2} ${TAPE_Y} L ${rx.toFixed(2)} ${ry.toFixed(2)}`;
  const [dx, dy] = onCircle(LEFT.x, LEFT.y, packRadius(leftFill), 76);
  const leader = `M ${dx.toFixed(2)} ${dy.toFixed(2)} C ${dx + 4} ${dy + 7} ${dx - 6} ${dy + 10} ${dx - 2} ${dy + 15}`;
  const laying = threaded && play > 0;

  return (
    <section
      className={`hairline flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] bg-well p-3 ${fill ? "h-full" : ""}`}
      aria-label={label || placeholder}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full shrink-0" aria-hidden>
        <rect x="1" y="1" width={W - 2} height={WINDOW_H} rx="9" strokeWidth="1" className="fill-glass stroke-edge" />
        <ReelShape cx={LEFT.x} cy={LEFT.y} r={R} ring={ring} fill={leftFill} spinning={turning} reverse />
        <ReelShape cx={RIGHT.x} cy={RIGHT.y} r={R} ring={ring} fill={rightFill} spinning={turning} slow />
        {threaded ? (
          <>
            <motion.path
              key={play}
              d={tape}
              fill="none"
              strokeWidth="1.6"
              strokeLinejoin="round"
              className="stroke-oxide"
              initial={laying ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: [0.3, 0.7, 0.2, 1] }}
            />
            {turning ? (
              <path d={tape} fill="none" strokeWidth="1.6" strokeDasharray="0.4 0.8" pathLength={20} className="animate-tape stroke-accent/70" />
            ) : null}
          </>
        ) : (
          <path d={leader} fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-oxide" />
        )}
        {ROLLERS.map((x) => (
          <circle key={x} cx={x} cy={ROLLER_Y} r="3.5" strokeWidth="0.8" className="fill-ink/20 stroke-ink/40" />
        ))}
        <rect x={W / 2 - 8} y={TAPE_Y - 8} width="16" height="8" rx="1.8" className={turning ? "fill-accent" : "fill-ink/25"} />
        <path
          d={`M ${W / 2} ${TAPE_Y} V ${BAY.y}`}
          strokeWidth="1.6"
          strokeDasharray={threaded ? undefined : "2 2"}
          className={threaded ? "stroke-oxide" : "stroke-ink/25"}
        />
        <rect
          x={BAY.x}
          y={BAY.y}
          width={BAY.w}
          height={BAY.h}
          rx="7"
          strokeWidth="1"
          strokeDasharray={kind ? undefined : "4 3"}
          className={kind ? "fill-well stroke-edge" : "fill-none stroke-ink/25"}
        />
        {kind ? (
          <LocationShape kind={kind} x={W / 2 - GLYPH / 2} y={BAY.y + (BAY.h - GLYPH) / 2} size={GLYPH} lamp={lamp} dimmed={dimmed} />
        ) : null}
      </svg>

      <div className="flex h-7 shrink-0 items-center rounded-[0.25rem] bg-lamp-off px-2.5">
        <span className={`min-w-0 flex-1 truncate text-center font-mono text-xs ${label ? "text-ink" : "text-ink-faint"}`}>{label || placeholder}</span>
      </div>

      {children}

      {lamps.length > 0 || status ? (
        <div className={`hairline-t flex flex-col gap-3 pt-3 ${fill ? "mt-auto" : ""}`}>
          {lamps.length > 0 ? <LampRow lamps={lamps} sequence={sequence} /> : null}
          {status ? <p className={`text-xs leading-snug ${toneText[statusTone]}`}>{status}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

const lens: Record<UiLampState, string> = {
  off: "hairline bg-lamp-off",
  active: "bg-lamp-off ring-[0.0625rem] ring-accent/70",
  busy: "animate-lamp bg-accent glow-accent",
  done: "bg-ok glow-ok",
  failed: "bg-danger glow-danger",
};

/** What a lamp says to a screen reader. */
const spoken: Record<UiLampState, string> = {
  off: "aus",
  active: "wartet",
  busy: "läuft",
  done: "erledigt",
  failed: "Fehler",
};

const word: Record<UiLampState, string> = {
  off: "text-ink-faint",
  active: "text-ink",
  busy: "text-ink",
  done: "text-ink-soft",
  failed: "text-danger",
};

/** Panel lamps side by side; in a sequence they sit on a tape that is written up to the last finished step. */
function LampRow({ lamps, sequence }: { lamps: UiDriveLamp[]; sequence: boolean }) {
  const lastDone = lamps.findLastIndex((item) => item.state === "done");
  return (
    <ol className="flex">
      {lamps.map((item, index) => (
        <li key={item.key} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5" aria-label={`${item.label}: ${spoken[item.state]}`}>
          {sequence && index > 0 ? (
            <span aria-hidden className={`absolute top-[0.3125rem] right-1/2 left-0 h-[0.125rem] ${index <= lastDone ? "bg-oxide" : "bg-track"}`} />
          ) : null}
          {sequence && index < lamps.length - 1 ? (
            <span aria-hidden className={`absolute top-[0.3125rem] right-0 left-1/2 h-[0.125rem] ${index < lastDone ? "bg-oxide" : "bg-track"}`} />
          ) : null}
          <span aria-hidden className={`relative size-3 rounded-[0.1875rem] ${lens[item.state]}`} />
          <span className={`max-w-full truncate text-[0.625rem] leading-none ${word[item.state]}`}>{item.label}</span>
        </li>
      ))}
    </ol>
  );
}
