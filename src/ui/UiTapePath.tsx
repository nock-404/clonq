import { useEffect, useRef, useState, type AnimationEvent } from "react";
import { useT } from "../i18n";
import type { Tone } from "../lib/labels";
import type { LocationKind, Ring } from "../lib/types";
import { toneSoft } from "./tone";
import { ReelShape } from "./ReelShape";
import { UiLocationGlyph } from "./UiLocationGlyph";

/** A small label stuck on the tape. */
export interface UiTapeTag {
  text: string;
  tone?: Tone;
  /** The full wording, when the text is a short form. */
  title?: string;
}

export interface UiTapeEnd {
  kind: LocationKind["type"];
  name: string;
  /** Path inside the location; "" is the location itself. */
  path: string;
  connected: boolean;
}

interface UiTapePathProps {
  source: UiTapeEnd | null;
  target: UiTapeEnd | null;
  ring: Ring;
  /** How far the tape has moved from the left reel to the right one, 0–1. */
  wound: number;
  /** The end that is being chosen right now; it gets an outline. */
  active?: "source" | "target" | null;
  /** A label on the tape between the source and the deck, e.g. the mode. */
  sourceTag?: UiTapeTag | null;
  /** A label on the tape between the deck and the target, e.g. the triggers. */
  targetTag?: UiTapeTag | null;
  /** A second label, under the tape between the source and the deck, e.g. the conflict rule of a two-way job. */
  sourceNote?: UiTapeTag | null;
  /** Changes run both ways: after each pulse the reels wind one turn forward and one turn back. */
  twoWay?: boolean;
  /** Any value; whenever it changes, the reels turn one revolution. */
  pulse?: string | number;
  /** The reels spool, the tape runs and the lamp on the head glows, e.g. once a job is saved. */
  spooling?: boolean;
  /** The words over the sockets; "Source" and "Target" by default. */
  sourceLabel?: string;
  targetLabel?: string;
  /** Shown in an empty socket. */
  emptyText?: string;
  /** Shown instead of an empty path. */
  wholeText?: string;
}

// Deck geometry in viewBox units; at the drawn height one unit is 1/16 rem. Two reels side by
// side, the tape running along the bottom under two guide rollers and the head between them.
const W = 152;
const H = 76;
const R = 28;
const LEFT = { x: 32, y: 30 };
const RIGHT = { x: W - 32, y: 30 };
const TAPE_Y = 66;
const ROLLER_R = 3.2;
const ROLLERS = [64, W - 64] as const;
const HEAD = { x: W / 2 - 8, y: 53, w: 16, h: TAPE_Y - 53 };
/** One turn of the slow reel keyframes, see --animate-reel-slow in app.css. */
const TURN_MS = 3400;

function packRadius(fill: number): number {
  const hub = R * 0.3;
  return hub + (R * 0.94 - hub) * fill;
}

/** Keeps the reels turning for whole revolutions after each pulse, so they stop where they started. */
function useTurns(pulse: string | number | undefined, enabled: boolean): boolean {
  const [spinning, setSpinning] = useState(false);
  const startedAt = useRef<number | null>(null);
  const last = useRef(pulse);
  useEffect(() => {
    if (last.current === pulse) return;
    last.current = pulse;
    if (!enabled) return;
    const now = performance.now();
    const start = startedAt.current ?? now;
    startedAt.current = start;
    const turns = Math.floor((now - start) / TURN_MS) + 1;
    const timer = window.setTimeout(() => {
      startedAt.current = null;
      setSpinning(false);
    }, start + turns * TURN_MS - now);
    setSpinning(true);
    return () => window.clearTimeout(timer);
  }, [pulse, enabled]);
  return spinning && enabled;
}

/** A turn of every reel style lasts longer than this; several events of one turn count once. */
const SAME_TURN_MS = 600;
/** In case no turn ever ends, e.g. with animations switched off. */
const TWO_WAY_LIMIT_MS = 20000;

/**
 * Two-way: after each pulse the reels wind one turn forward and one turn back, then stop. The
 * turns are counted from the reels' own animation, so the direction changes and the reels stop
 * exactly where a turn ends, whatever the reel style's timing. A pulse during a turn never flips
 * the direction on the spot; it only adds turns. While spooling the reels change direction at the
 * end of every turn.
 */
function useTwoWayTurns(pulse: string | number | undefined, enabled: boolean, spooling: boolean) {
  const [spinning, setSpinning] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const back = useRef(false);
  const remaining = useRef(0);
  const lastTurn = useRef(0);
  const last = useRef(pulse);
  const wind = (value: boolean) => {
    back.current = value;
    setRewinding(value);
  };
  useEffect(() => {
    if (last.current === pulse) return;
    last.current = pulse;
    if (!enabled) {
      // The job is no longer two-way: the one-way turns take over, forwards.
      setSpinning(false);
      wind(false);
      return;
    }
    remaining.current = 2;
    setSpinning(true);
    const timer = window.setTimeout(() => {
      setSpinning(false);
      wind(false);
    }, TWO_WAY_LIMIT_MS);
    return () => window.clearTimeout(timer);
  }, [pulse, enabled]);

  const onTurn = (event: AnimationEvent<SVGGElement>) => {
    if (!enabled || event.timeStamp - lastTurn.current < SAME_TURN_MS) return;
    lastTurn.current = event.timeStamp;
    if (spooling) return wind(!back.current);
    if (!spinning) return;
    remaining.current -= 1;
    // Stop only after a turn back, so the reels end where they began.
    if (remaining.current <= 0 && back.current) {
      setSpinning(false);
      wind(false);
      return;
    }
    if (remaining.current <= 0) remaining.current = 1;
    wind(!back.current);
  };

  return { spinning: spinning && enabled, rewinding: rewinding && enabled, onTurn };
}

const describe = (end: UiTapeEnd | null, emptyText: string) => (end ? [end.name, end.path].filter(Boolean).join("/") : emptyText);
const endKey = (end: UiTapeEnd | null) => (end ? `${end.name}/${end.path}` : "none");

/**
 * Where a job copies from and to, drawn as a tape deck between two sockets. One line of tape runs
 * from the source socket through the deck to the target socket; an end without a place is an
 * empty socket with slack tape, and setting it threads the tape.
 */
export function UiTapePath({
  source,
  target,
  ring,
  wound,
  active = null,
  sourceTag,
  targetTag,
  sourceNote,
  twoWay = false,
  pulse,
  spooling = false,
  ...words
}: UiTapePathProps) {
  const t = useT().wizard;
  const sourceLabel = words.sourceLabel ?? t.steps.source;
  const targetLabel = words.targetLabel ?? t.steps.target;
  const emptyText = words.emptyText ?? t.tape.empty;
  const wholeText = words.wholeText ?? t.tape.whole;
  const oneWayTurning = useTurns(pulse, !twoWay);
  const twoWayTurns = useTwoWayTurns(pulse, twoWay, spooling);
  const turning = oneWayTurning || twoWayTurns.spinning;
  const w = Math.min(1, Math.max(0, wound));
  const leftFill = 0.92 - w * 0.7;
  const rightFill = 0.22 + w * 0.7;
  const leftPack = packRadius(leftFill);
  const rightPack = packRadius(rightFill);
  // The tape leaves each pack on the side facing the head and runs down to the rollers.
  const feed = [
    `M ${LEFT.x + leftPack * 0.5} ${LEFT.y + leftPack * 0.866}`,
    `L ${ROLLERS[0]} ${TAPE_Y}`,
    `L ${ROLLERS[1]} ${TAPE_Y}`,
    `L ${RIGHT.x - rightPack * 0.5} ${RIGHT.y + rightPack * 0.866}`,
  ].join(" ");
  const complete = source !== null && target !== null;
  const lamp = spooling ? "fill-accent drop-shadow-[0_0_0.25rem_var(--accent)]" : complete ? "fill-accent" : "fill-ink/20";
  const spinning = turning || spooling;
  const rewinding = twoWayTurns.rewinding && spinning;

  return (
    <div
      role="img"
      aria-label={`${sourceLabel}: ${describe(source, emptyText)}, ${targetLabel}: ${describe(target, emptyText)}${twoWay ? t.tape.bothWays : ""}`}
      className="hairline-b bg-well px-5 pt-1.5 pb-2.5"
    >
      <div className="relative flex h-[5.5rem] min-w-0">
        <Socket end={source} label={sourceLabel} lit={active === "source"} emptyText={emptyText} wholeText={wholeText} />
        <Lead taut={source !== null} tag={sourceTag} note={sourceNote} thread={endKey(source)} />
        <svg viewBox={`0 0 ${W} ${H}`} className={`h-[4.75rem] w-auto shrink-0 self-start ${rewinding ? "rewind" : ""}`} aria-hidden>
          <TapeLine from={0} to={ROLLERS[0]} taut={source !== null} />
          <TapeLine from={ROLLERS[1]} to={W} taut={target !== null} />
          <g onAnimationIteration={twoWayTurns.onTurn}>
            <ReelShape cx={LEFT.x} cy={LEFT.y} r={R} ring={ring} fill={leftFill} spinning={spinning} slow={!spooling} />
            <ReelShape cx={RIGHT.x} cy={RIGHT.y} r={R} ring={ring} fill={rightFill} spinning={spinning} slow={!spooling} />
          </g>
          <path d={feed} fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-oxide-light" />
          {spooling ? <path d={feed} fill="none" strokeWidth="2" strokeDasharray="0.4 0.8" pathLength={20} className="animate-tape stroke-accent/80" /> : null}
          {ROLLERS.map((x) => (
            <circle key={x} cx={x} cy={TAPE_Y - ROLLER_R} r={ROLLER_R} strokeWidth="0.8" className="fill-canvas stroke-ink/45" />
          ))}
          <rect x={HEAD.x} y={HEAD.y} width={HEAD.w} height={HEAD.h} rx="2.4" strokeWidth="0.8" className="fill-ink/15 stroke-ink/30" />
          <rect x={HEAD.x + 3} y={TAPE_Y - 3.4} width={HEAD.w - 6} height="1.6" rx="0.8" className="fill-ink/35" />
          <circle cx={W / 2} cy={HEAD.y + 4.6} r="2.4" className={`transition-[fill] duration-300 ${lamp}`} />
        </svg>
        <Lead taut={target !== null} tag={targetTag} thread={endKey(target)} />
        <Socket end={target} label={targetLabel} lit={active === "target"} emptyText={emptyText} wholeText={wholeText} />
      </div>
    </div>
  );
}

/** The piece of tape inside the deck between its edge and a roller. */
function TapeLine({ from, to, taut }: { from: number; to: number; taut: boolean }) {
  return (
    <line
      x1={from}
      x2={to}
      y1={TAPE_Y}
      y2={TAPE_Y}
      strokeWidth="2"
      strokeDasharray={taut ? undefined : "6 4"}
      className={taut ? "stroke-oxide-light" : "stroke-ink/20"}
    />
  );
}

// The tape line runs 4.125rem below the top of the row: TAPE_Y at the deck's drawn height.
const LINE = "top-[4.125rem]";

/** The tape between a socket and the deck: taut when the end is set, slack when not, maybe with a label above it and another one below. */
function Lead({ taut, tag, note, thread }: { taut: boolean; tag?: UiTapeTag | null; note?: UiTapeTag | null; thread: string }) {
  return (
    <span className="relative min-w-6 flex-1 self-stretch">
      {taut ? (
        <span key={thread} aria-hidden className={`animate-thread absolute inset-x-0 ${LINE} h-[0.125rem] origin-left -translate-y-1/2 bg-oxide-light`} />
      ) : (
        <span aria-hidden className={`tape-slack absolute inset-x-0 ${LINE} h-[0.125rem] -translate-y-1/2`} />
      )}
      {tag ? <Tag tag={tag} position="top-[2.625rem]" /> : null}
      {note ? <Tag tag={note} position="top-[4.375rem]" /> : null}
    </span>
  );
}

function Tag({ tag, position }: { tag: UiTapeTag; position: string }) {
  return (
    <span className={`absolute inset-x-1 ${position} flex justify-center`} title={tag.title}>
      <span className={`h-[1.125rem] max-w-full truncate rounded-[0.25rem] px-1.5 text-[0.6875rem] leading-[1.125rem] font-medium ${toneSoft[tag.tone ?? "neutral"]}`}>
        {tag.text}
      </span>
    </span>
  );
}

interface SocketProps {
  end: UiTapeEnd | null;
  label: string;
  lit: boolean;
  emptyText: string;
  wholeText: string;
}

/** Where the tape comes from or goes to; its box is centred on the tape line. */
function Socket({ end, label, lit, emptyText, wholeText }: SocketProps) {
  const frame = lit ? "border-[0.0625rem] border-transparent bg-raised ring-[0.0625rem] ring-inset ring-accent/70" : end ? "hairline bg-raised" : "hairline-dashed";
  return (
    <div className="relative w-[10rem] shrink-0">
      <span className={`absolute top-[1.625rem] left-0.5 font-mono text-[0.625rem] font-medium tracking-wider uppercase ${lit ? "text-accent" : "text-ink-faint"}`}>
        {label}
      </span>
      <div
        className={`absolute inset-x-0 top-[2.75rem] flex h-[2.75rem] items-center gap-2.5 rounded-[var(--radius-panel)] px-2.5 transition-[box-shadow,background-color] ${frame}`}
        title={end ? [end.name, end.path].filter(Boolean).join("/") : undefined}
      >
        {end ? <UiLocationGlyph kind={end.kind} size="md" connected={end.connected} /> : <EmptySpindle />}
        <span className="flex min-w-0 flex-1 flex-col">
          {end ? (
            <>
              <span className="truncate text-[0.8125rem] leading-tight font-medium text-ink">{end.name}</span>
              {end.path ? (
                <span className="truncate font-mono text-[0.6875rem] text-ink-soft">/{end.path}</span>
              ) : (
                <span className="truncate text-[0.6875rem] text-ink-soft">{wholeText}</span>
              )}
            </>
          ) : (
            <span className="text-xs text-ink-faint">{emptyText}</span>
          )}
        </span>
      </div>
    </div>
  );
}

/** A drive spindle with no reel on it. */
function EmptySpindle() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <circle cx="16" cy="16" r="14.5" fill="none" strokeWidth="1" strokeDasharray="2.4 2.2" className="stroke-ink/30" />
      <circle cx="16" cy="16" r="4.2" className="fill-ink/20" />
      {[0, 1, 2].map((i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        return <circle key={i} cx={16 + 6.2 * Math.cos(angle)} cy={16 + 6.2 * Math.sin(angle)} r="1.1" className="fill-ink/25" />;
      })}
    </svg>
  );
}
