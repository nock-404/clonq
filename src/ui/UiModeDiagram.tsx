interface UiModeDiagramProps {
  /** What the target holds after a run: an exact copy (mirror) or everything it had plus what is new (backup). */
  mode: "mirror" | "backup";
  /** Plays the run once, e.g. when the option is picked. */
  active: boolean;
  sourceLabel?: string;
  targetLabel?: string;
  /** What happens to the record that only the target has, e.g. "wird gelöscht". */
  extraLabel?: string;
}

// One strip of tape with records on it, in viewBox units.
const W = 132;
const H = 14;
const SLOT = 24;
const RECORD = { w: 20, h: 8, y: 3 };
const x = (slot: number) => 5 + slot * SLOT;

type TapeRecord = { slot: number; fill: string; state?: "arrives" | "erased" | "kept" };

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

/**
 * What a copy mode does to the target, drawn as records on two strips of tape: the source above,
 * the target after a run below. A record that exists only in the target is erased by a mirror
 * and kept by a backup.
 */
export function UiModeDiagram({ mode, active, sourceLabel = "Quelle", targetLabel = "Ziel", extraLabel }: UiModeDiagramProps) {
  return (
    <span className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5" aria-hidden>
      <span className="text-[0.6875rem] text-ink-faint">{sourceLabel}</span>
      <Strip records={SOURCE} active={false} />
      <span />
      <span className="text-[0.6875rem] text-ink-faint">{targetLabel}</span>
      <Strip records={targetOf(mode)} active={active} />
      {extraLabel ? (
        <span className={`truncate text-[0.6875rem] font-medium ${mode === "mirror" ? "text-danger" : "text-ink-soft"}`}>{extraLabel}</span>
      ) : (
        <span />
      )}
    </span>
  );
}

function Strip({ records, active }: { records: TapeRecord[]; active: boolean }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-[1.125rem] w-auto">
      <rect x="0" y="1" width={W} height={H - 2} rx="2" className="fill-oxide-deep" />
      <line x1="2" x2={W - 2} y1={H / 2} y2={H / 2} strokeWidth="0.4" strokeDasharray="1 2" className="stroke-oxide" />
      {records.map((record) =>
        record.state === "erased" ? (
          <g key={record.slot} className={active ? "animate-record-erase" : "opacity-100"}>
            <rect
              x={x(record.slot) + 0.4}
              y={RECORD.y + 0.4}
              width={RECORD.w - 0.8}
              height={RECORD.h - 0.8}
              rx="1.2"
              fill="none"
              strokeWidth="0.8"
              strokeDasharray="2 1.4"
              className="stroke-danger"
            />
            <path
              d={`M ${x(record.slot) + 7} ${RECORD.y + 2} l 6 4 M ${x(record.slot) + 13} ${RECORD.y + 2} l -6 4`}
              strokeWidth="0.9"
              strokeLinecap="round"
              className="stroke-danger"
            />
          </g>
        ) : (
          <rect
            key={record.slot}
            x={x(record.slot)}
            y={RECORD.y}
            width={RECORD.w}
            height={RECORD.h}
            rx="1.2"
            className={`${record.fill} ${active && record.state === "arrives" ? "animate-record-arrive spin-origin" : ""}`}
          />
        ),
      )}
    </svg>
  );
}
