import { useT } from "../i18n";

interface UiModeDiagramProps {
  /**
   * What a run does: the target becomes an exact copy (mirror), keeps everything it had plus what
   * is new (backup), or both sides take over each other's changes (bidirectional).
   */
  mode: "mirror" | "backup" | "bidirectional";
  /** Plays the run once, e.g. when the option is picked. */
  active: boolean;
  /** "Source" and "Target" by default. */
  sourceLabel?: string;
  targetLabel?: string;
  /** A caption beside the record that shows the difference, e.g. "deleted". */
  extraLabel?: string;
}

// One strip of tape with records on it, in viewBox units; drawn 1rem high, so a unit is 1/14 rem.
// The strip is short enough for its caption to sit beside it in a third of the sheet.
const W = 84;
const H = 14;
/** The gap between the two strips of a two-way diagram: 0.375rem, as between the other strips. */
const GAP = 5.25;
const SLOT = 19;
const RECORD = { w: 16, h: 8, y: 3 };
const x = (slot: number) => 4 + slot * SLOT;
const mid = (slot: number) => x(slot) + RECORD.w / 2;

type TapeRecord = { slot: number; fill: string; state?: "arrives" | "arrivesUp" | "erased" | "kept" | "conflict" };

const SOURCE: TapeRecord[] = [
  { slot: 0, fill: "fill-ring-blue" },
  { slot: 1, fill: "fill-ring-green" },
  { slot: 2, fill: "fill-ring-yellow" },
];

function targetOf(mode: "mirror" | "backup"): TapeRecord[] {
  return [
    { slot: 0, fill: "fill-ring-blue" },
    { slot: 1, fill: "fill-ring-green" },
    { slot: 2, fill: "fill-ring-yellow", state: "arrives" },
    { slot: 3, fill: "fill-ink/45", state: mode === "mirror" ? "erased" : "kept" },
  ];
}

// Two-way: the green record came down from the source, the yellow one up from the target, and the
// last file was changed on both sides, so each tape holds its own version of it.
const TWO_WAY_SOURCE: TapeRecord[] = [
  { slot: 0, fill: "fill-ring-blue" },
  { slot: 1, fill: "fill-ring-green" },
  { slot: 2, fill: "fill-ring-yellow", state: "arrivesUp" },
  { slot: 3, fill: "fill-warn/25", state: "conflict" },
];
const TWO_WAY_TARGET: TapeRecord[] = [
  { slot: 0, fill: "fill-ring-blue" },
  { slot: 1, fill: "fill-ring-green", state: "arrives" },
  { slot: 2, fill: "fill-ring-yellow" },
  { slot: 3, fill: "fill-warn/25", state: "conflict" },
];

const captionTone = { mirror: "text-danger", backup: "text-ink-soft", bidirectional: "text-warn" };

/**
 * What a copy mode does, drawn as records on two strips of tape: the source above, the target
 * after a run below, and a caption beside them. A record that exists only in the target is erased
 * by a mirror and kept by a backup; a two-way run carries records both ways and shows a file
 * changed on both tapes.
 */
export function UiModeDiagram({ mode, active, extraLabel, ...words }: UiModeDiagramProps) {
  const t = useT().wizard.steps;
  const sourceLabel = words.sourceLabel ?? t.source;
  const targetLabel = words.targetLabel ?? t.target;
  const twoWay = mode === "bidirectional";
  const caption = extraLabel ? <span className={`min-w-0 truncate text-[0.6875rem] font-medium ${captionTone[mode]}`}>{extraLabel}</span> : null;
  return (
    <span className="grid grid-cols-[auto_auto_auto] items-center justify-start gap-x-1.5 gap-y-1.5" aria-hidden>
      <span className="text-[0.6875rem] text-ink-faint">{sourceLabel}</span>
      {twoWay ? (
        <>
          <TwoWay active={active} />
          <span className="row-span-2 flex min-w-0">{caption}</span>
        </>
      ) : (
        <>
          <Strip records={SOURCE} active={false} />
          <span />
        </>
      )}
      <span className="text-[0.6875rem] text-ink-faint">{targetLabel}</span>
      {twoWay ? null : (
        <>
          <Strip records={targetOf(mode)} active={active} />
          {caption ?? <span />}
        </>
      )}
    </span>
  );
}

function Strip({ records, active }: { records: TapeRecord[]; active: boolean }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-4 w-auto">
      <Tape records={records} active={active} y={0} />
    </svg>
  );
}

/**
 * Both strips in one drawing. Between the two copies of a record an arrow shows the way it went;
 * it reaches from one record to the other across the edges of the tapes, so it is large enough to
 * read. The two versions of the conflicting file face each other across a spark.
 */
function TwoWay({ active }: { active: boolean }) {
  const bottom = H + GAP;
  const from = RECORD.y + RECORD.h + 0.9;
  const to = bottom + RECORD.y - 0.9;
  const head = 2.6;
  const arrow = (slot: number, down: boolean) => {
    const cx = mid(slot);
    const tip = down ? to : from;
    const back = down ? -head : head;
    return `M ${cx} ${from} L ${cx} ${to} M ${cx - head} ${tip + back} L ${cx} ${tip} L ${cx + head} ${tip + back}`;
  };
  const spark = mid(3);
  const middle = (from + to) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${2 * H + GAP}`} className="row-span-2 block h-[2.375rem] w-auto">
      <Tape records={TWO_WAY_SOURCE} active={active} y={0} />
      <Tape records={TWO_WAY_TARGET} active={active} y={bottom} />
      <path d={arrow(1, true)} fill="none" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink/70" />
      <path d={arrow(2, false)} fill="none" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink/70" />
      <path
        d={`M ${spark + 1.6} ${from} L ${spark - 1.4} ${middle + 0.4} L ${spark + 1.4} ${middle - 0.4} L ${spark - 1.6} ${to}`}
        fill="none"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`stroke-warn ${active ? "animate-record-erase" : ""}`}
      />
    </svg>
  );
}

function Tape({ records, active, y }: { records: TapeRecord[]; active: boolean; y: number }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <rect x="0" y="1" width={W} height={H - 2} rx="2" className="fill-oxide-deep" />
      <line x1="2" x2={W - 2} y1={H / 2} y2={H / 2} strokeWidth="0.4" strokeDasharray="1 2" className="stroke-oxide" />
      {records.map((record) => {
        if (record.state === "erased") return <Erased key={record.slot} slot={record.slot} active={active} />;
        if (record.state === "conflict") return <Conflicting key={record.slot} record={record} active={active} upper={y === 0} />;
        const motion =
          active && record.state === "arrives"
            ? "animate-record-arrive spin-origin"
            : active && record.state === "arrivesUp"
              ? "animate-record-arrive-up spin-origin"
              : "";
        return <rect key={record.slot} x={x(record.slot)} y={RECORD.y} width={RECORD.w} height={RECORD.h} rx="1.2" className={`${record.fill} ${motion}`} />;
      })}
    </g>
  );
}

function Erased({ slot, active }: { slot: number; active: boolean }) {
  const left = x(slot);
  const cx = left + RECORD.w / 2;
  return (
    <g className={active ? "animate-record-erase" : "opacity-100"}>
      <rect
        x={left + 0.4}
        y={RECORD.y + 0.4}
        width={RECORD.w - 0.8}
        height={RECORD.h - 0.8}
        rx="1.2"
        fill="none"
        strokeWidth="0.8"
        strokeDasharray="2 1.4"
        className="stroke-danger"
      />
      <path d={`M ${cx - 3} ${RECORD.y + 2} l 6 4 M ${cx + 3} ${RECORD.y + 2} l -6 4`} strokeWidth="0.9" strokeLinecap="round" className="stroke-danger" />
    </g>
  );
}

/** One version of a file that changed on both sides: outlined in warn, with its own written trace. */
function Conflicting({ record, active, upper }: { record: TapeRecord; active: boolean; upper: boolean }) {
  const left = x(record.slot);
  // The traces differ in phase, so the two versions do not look alike.
  const wave = upper
    ? `M ${left + 2.5} ${RECORD.y + 5.2} q 1.8 -3 3.6 0 t 3.6 0 t 3.6 0`
    : `M ${left + 2.5} ${RECORD.y + 2.8} q 1.8 3 3.6 0 t 3.6 0 t 3.6 0`;
  return (
    <g className={active ? "animate-record-erase" : "opacity-100"}>
      <rect
        x={left + 0.4}
        y={RECORD.y + 0.4}
        width={RECORD.w - 0.8}
        height={RECORD.h - 0.8}
        rx="1.2"
        strokeWidth="0.8"
        className={`${record.fill} stroke-warn`}
      />
      <path d={wave} fill="none" strokeWidth="0.8" strokeLinecap="round" className="stroke-warn" />
    </g>
  );
}
