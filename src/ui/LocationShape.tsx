import type { ReactElement } from "react";
import type { Location, LocationKind } from "../lib/types";

// Drawings for the kinds of location, in the language of the tape reels:
// translucent ink for housings with a crisp outline, oxide wherever the data
// itself lives, and one round lamp. Openings are real holes (even-odd paths),
// so every drawing works on any surface. Nothing is filled with the canvas colour.
//
// Two sets: a detailed one on a 48-unit grid for the drive front and the larger
// glyphs, and a simplified one on a 16-unit grid that stays crisp at 1rem.

/** The location kinds, plus WebDAV, which is a cloud provider but has its own picture. */
export type GlyphKind = LocationKind["type"] | "webdav";

/** off: dark · busy: blinking accent · on: reachable (ok) · fault: failed (danger). */
export type GlyphLamp = "off" | "busy" | "on" | "fault";

/** The picture for a location; WebDAV gets its own. */
export function glyphKindOf(location: Location): GlyphKind {
  return location.kind.type === "cloud" && location.kind.provider === "webdav" ? "webdav" : location.kind.type;
}

interface LocationShapeProps {
  kind: GlyphKind;
  /** Top left corner and edge length in the units of the surrounding SVG. */
  x: number;
  y: number;
  size: number;
  lamp: GlyphLamp;
  /** Drawn faint, e.g. a drive that is not plugged in. */
  dimmed?: boolean;
  /** The 16-unit drawing, for small sizes. */
  simple?: boolean;
}

/** One location drawing placed into a surrounding SVG, like ReelShape. */
export function LocationShape({ kind, x, y, size, lamp, dimmed = false, simple = false }: LocationShapeProps) {
  const Drawing = simple ? smallDrawings[kind] : largeDrawings[kind];
  const grid = simple ? 16 : 48;
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={`0 0 ${grid} ${grid}`} overflow="visible">
      <g className={dimmed ? "opacity-45" : undefined}>
        <Drawing lamp={lamp} />
      </g>
    </svg>
  );
}

interface DrawingProps {
  lamp: GlyphLamp;
}

const lampFill: Record<Exclude<GlyphLamp, "off">, string> = {
  busy: "fill-accent",
  on: "fill-ok",
  fault: "fill-danger",
};

const lampHalo: Record<Exclude<GlyphLamp, "off">, string> = {
  busy: "fill-accent/25",
  on: "fill-ok/25",
  fault: "fill-danger/25",
};

/** A round lamp: dark glass when off, lit with a soft halo otherwise. */
function Lamp({ cx, cy, r, lamp, halo = 1.9 }: { cx: number; cy: number; r: number; lamp: GlyphLamp; halo?: number }) {
  if (lamp === "off") {
    return <circle cx={cx} cy={cy} r={r} strokeWidth={r * 0.3} className="fill-lamp-off stroke-ink/30" />;
  }
  return (
    <g className={lamp === "busy" ? "animate-lamp" : undefined}>
      <circle cx={cx} cy={cy} r={r * halo} className={lampHalo[lamp]} />
      <circle cx={cx} cy={cy} r={r} className={lampFill[lamp]} />
    </g>
  );
}

/** A rounded rectangle as a path, to combine with others into one even-odd shape. */
function box(x: number, y: number, w: number, h: number, r: number): string {
  return `M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
}

// ---------------------------------------------------------------------------
// Detailed drawings, 48 × 48

/** A file folder: back with its tab, papers of oxide, the front flap with a label holder. */
function FolderLarge({ lamp }: DrawingProps) {
  return (
    <g strokeLinejoin="round">
      <path
        d="M 5 14.5 Q 5 11.5 8 11.5 H 17.5 Q 19 11.5 20 13 L 21.5 15 H 40 Q 43 15 43 18 V 38 Q 43 41 40 41 H 8 Q 5 41 5 38 Z"
        strokeWidth="1.4"
        className="fill-ink/15 stroke-ink/45"
      />
      <rect x="9.5" y="17" width="29" height="6" rx="1" strokeWidth="0.8" className="fill-oxide-deep stroke-oxide" />
      <path d="M 12.5 19.8 H 29" strokeWidth="1.2" strokeLinecap="round" className="stroke-oxide-light" />
      <path
        d="M 5 24 Q 5 21.5 7.5 21.5 H 40.5 Q 43 21.5 43 24 V 38 Q 43 41 40 41 H 8 Q 5 41 5 38 Z"
        strokeWidth="1.4"
        className="fill-ink/25 stroke-ink/55"
      />
      <rect x="9.5" y="26" width="13" height="4.5" rx="1" className="fill-ink/45" />
      <Lamp cx={37.5} cy={36} r={2} lamp={lamp} />
    </g>
  );
}

/** An M.2 SSD: contact fingers either side of the key notch, controller, two flash packages, screw notch. */
function VolumeLarge({ lamp }: DrawingProps) {
  return (
    <g strokeLinejoin="round">
      <path
        d="M 3 16.5 H 42.5 Q 45 16.5 45 19 V 21.5 A 2.5 2.5 0 0 0 45 26.5 V 29 Q 45 31.5 42.5 31.5 H 3 V 26.5 H 6.5 V 24.5 H 3 Z"
        strokeWidth="1.3"
        className="fill-ink/20 stroke-ink/50"
      />
      {[18, 20, 22, 27.6, 29.6].map((y) => (
        <rect key={y} x="3.7" y={y} width="4" height="1.1" rx="0.3" className="fill-oxide-light" />
      ))}
      <rect x="10.5" y="19.5" width="8" height="9" rx="1" className="fill-ink/35" />
      <path d="M 12.5 22.2 H 16.5 M 12.5 24.8 H 15" strokeWidth="0.8" strokeLinecap="round" className="stroke-ink/55" />
      <rect x="21" y="19" width="9" height="10" rx="1" strokeWidth="0.8" className="fill-oxide-deep stroke-oxide" />
      <rect x="32" y="19" width="8" height="10" rx="1" strokeWidth="0.8" className="fill-oxide-deep stroke-oxide" />
      <Lamp cx={41.6} cy={28.6} r={1.5} lamp={lamp} halo={1.7} />
    </g>
  );
}

/** A server cabinet: operator panel with the status lamp, three units with drive slots. */
function SshLarge({ lamp }: DrawingProps) {
  return (
    <g strokeLinejoin="round">
      <rect x="15" y="41.5" width="5" height="3" rx="1" className="fill-ink/40" />
      <rect x="28" y="41.5" width="5" height="3" rx="1" className="fill-ink/40" />
      <rect x="12" y="4" width="24" height="38.5" rx="2.5" strokeWidth="1.4" className="fill-ink/20 stroke-ink/50" />
      <rect x="15" y="7" width="18" height="6" rx="1.2" className="fill-glass" />
      <Lamp cx={18.5} cy={10} r={1.8} lamp={lamp} halo={1.6} />
      {[24, 27, 30].map((cx) => (
        <circle key={cx} cx={cx} cy="10" r="0.9" className="fill-ink/40" />
      ))}
      {[16, 24.5, 33].map((y) => (
        <g key={y}>
          <rect x="15" y={y} width="18" height="6.5" rx="1" strokeWidth="0.8" className="fill-ink/10 stroke-ink/35" />
          <rect x="17" y={y + 2} width="7" height="2.5" rx="0.5" strokeWidth="0.6" className="fill-oxide-deep stroke-oxide" />
          <path
            d={`M 26.5 ${y + 1.8} V ${y + 4.7} M 28.5 ${y + 1.8} V ${y + 4.7} M 30.5 ${y + 1.8} V ${y + 4.7}`}
            strokeWidth="0.8"
            strokeLinecap="round"
            className="stroke-ink/40"
          />
        </g>
      ))}
    </g>
  );
}

/** A two-bay NAS on the network: the link lamp sits where it joins the line. */
function SmbLarge({ lamp }: DrawingProps) {
  return (
    <g strokeLinejoin="round">
      <rect x="9" y="4" width="30" height="24" rx="2.5" strokeWidth="1.4" className="fill-ink/20 stroke-ink/50" />
      {[12.5, 25].map((x) => (
        <g key={x}>
          <rect x={x} y="7.5" width="10.5" height="17" rx="1" strokeWidth="0.8" className="fill-ink/10 stroke-ink/35" />
          <rect x={x + 1.5} y="10" width="7.5" height="2.5" rx="0.5" strokeWidth="0.6" className="fill-oxide-deep stroke-oxide" />
          <path d={`M ${x + 2} 20.5 H ${x + 8.5}`} strokeWidth="1" strokeLinecap="round" className="stroke-ink/40" />
        </g>
      ))}
      <path d="M 24 28 V 38.5 M 5 38.5 H 43" strokeWidth="2" strokeLinecap="round" className="stroke-ink/50" />
      <rect x="2" y="35.5" width="5" height="6" rx="1.2" className="fill-ink/40" />
      <rect x="41" y="35.5" width="5" height="6" rx="1.2" className="fill-ink/40" />
      <Lamp cx={24} cy={38.5} r={2.4} lamp={lamp} halo={1.7} />
    </g>
  );
}

/** A cloud with tracks of data in it. */
function CloudLarge({ lamp }: DrawingProps) {
  return (
    <g strokeLinejoin="round">
      <path
        d="M 13 36 H 35 A 7 7 0 1 0 34 22.07 A 10 10 0 0 0 14.04 21.07 A 7.5 7.5 0 1 0 13 36 Z"
        strokeWidth="1.4"
        className="fill-ink/20 stroke-ink/50"
      />
      <path d="M 15.5 28.5 H 29 M 15.5 32 H 25" strokeWidth="1.6" strokeLinecap="round" className="stroke-oxide-light" />
      <Lamp cx={34.5} cy={31} r={2} lamp={lamp} />
    </g>
  );
}

/** A desk globe: wire meridians, the equator as a band of data, the lamp in the base. */
function WebdavLarge({ lamp }: DrawingProps) {
  return (
    <g strokeLinejoin="round">
      <path d="M 23 5 A 16 16 0 0 1 23 37" fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-ink/50" />
      <circle cx="23" cy="21" r="13" strokeWidth="1.4" className="fill-ink/15 stroke-ink/50" />
      <ellipse cx="23" cy="21" rx="5.5" ry="13" fill="none" strokeWidth="1" className="stroke-ink/35" />
      <path d="M 11.5 15 H 34.5 M 11.5 27 H 34.5" strokeWidth="1" className="stroke-ink/35" />
      <path d="M 10 21 H 36" strokeWidth="2.2" className="stroke-oxide-light" />
      <path d="M 23 37 V 40.5" strokeWidth="2" className="stroke-ink/50" />
      <rect x="14" y="40.5" width="18" height="4" rx="1.5" className="fill-ink/35" />
      <Lamp cx={28.5} cy={42.5} r={1.5} lamp={lamp} halo={1.7} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Simplified drawings, 16 × 16, for the sidebar and lists

function FolderSmall({ lamp }: DrawingProps) {
  return (
    <g>
      <path d="M 1.5 4.2 Q 1.5 3 2.7 3 H 5.8 Q 6.3 3 6.6 3.4 L 7.3 4.3 H 13.3 Q 14.5 4.3 14.5 5.5 V 7 H 1.5 Z" className="fill-ink/35" />
      <rect x="3" y="5.1" width="10" height="1.9" rx="0.3" className="fill-oxide-light" />
      <path
        d={`${box(1.5, 6.6, 13, 6.9, 1)} ${box(3.2, 8.3, 4.2, 1.6, 0.3)}`}
        fillRule="evenodd"
        className="fill-ink/65"
      />
      <Lamp cx={11.8} cy={11} r={1.25} lamp={lamp} halo={1.5} />
    </g>
  );
}

function VolumeSmall({ lamp }: DrawingProps) {
  return (
    <g>
      <path d="M 1 4.6 H 14 Q 15 4.6 15 5.6 V 7 A 1 1 0 0 0 15 9 V 10.4 Q 15 11.4 14 11.4 H 1 V 9.2 H 2.6 V 7.8 H 1 Z" className="fill-ink/65" />
      <rect x="6.1" y="6" width="3.8" height="4" rx="0.5" className="fill-oxide-deep" />
      <rect x="10.6" y="6" width="3.1" height="4" rx="0.5" className="fill-oxide-deep" />
      <Lamp cx={4.3} cy={8} r={1.2} lamp={lamp} halo={1.5} />
    </g>
  );
}

function SshSmall({ lamp }: DrawingProps) {
  const slots = [6.4, 8.9, 11.4];
  return (
    <g>
      <path
        d={[box(3.5, 1, 9, 13.2, 1), box(5, 2.4, 6, 2.6, 0.5), ...slots.map((y) => box(5, y, 6, 1.6, 0.3))].join(" ")}
        fillRule="evenodd"
        className="fill-ink/65"
      />
      {slots.map((y) => (
        <rect key={y} x="5.5" y={y + 0.4} width="2.4" height="0.8" className="fill-oxide-light" />
      ))}
      <rect x="4.5" y="14.2" width="2" height="1.2" className="fill-ink/65" />
      <rect x="9.5" y="14.2" width="2" height="1.2" className="fill-ink/65" />
      <Lamp cx={6.4} cy={3.7} r={1} lamp={lamp} halo={1.4} />
    </g>
  );
}

function SmbSmall({ lamp }: DrawingProps) {
  return (
    <g>
      <path d={`${box(2.5, 1, 11, 8, 1)} ${box(4, 2.5, 3.5, 5, 0.4)} ${box(8.5, 2.5, 3.5, 5, 0.4)}`} fillRule="evenodd" className="fill-ink/65" />
      <rect x="4.5" y="3.2" width="2.5" height="1.1" className="fill-oxide-light" />
      <rect x="9" y="3.2" width="2.5" height="1.1" className="fill-oxide-light" />
      <rect x="7.4" y="9" width="1.2" height="3.5" className="fill-ink/65" />
      <rect x="1.5" y="12" width="13" height="1.3" rx="0.4" className="fill-ink/65" />
      <rect x="0.5" y="10.9" width="2.2" height="3.5" rx="0.5" className="fill-ink/65" />
      <rect x="13.3" y="10.9" width="2.2" height="3.5" rx="0.5" className="fill-ink/65" />
      <Lamp cx={8} cy={12.65} r={1.4} lamp={lamp} halo={1.4} />
    </g>
  );
}

function CloudSmall({ lamp }: DrawingProps) {
  return (
    <g>
      <path d="M 4.33 12.2 H 11.67 A 2.33 2.33 0 1 0 11.33 7.56 A 3.33 3.33 0 0 0 4.68 7.22 A 2.5 2.5 0 1 0 4.33 12.2 Z" className="fill-ink/65" />
      <rect x="4.6" y="9.9" width="4.6" height="1.1" rx="0.4" className="fill-oxide-deep" />
      <Lamp cx={11.6} cy={10.4} r={1.2} lamp={lamp} halo={1.4} />
    </g>
  );
}

function WebdavSmall({ lamp }: DrawingProps) {
  return (
    <g>
      <path d="M 7.5 1 A 6 6 0 0 1 7.5 13" fill="none" strokeWidth="1" strokeLinecap="round" className="stroke-ink/65" />
      <circle cx="7.5" cy="7" r="4.8" strokeWidth="1" className="fill-ink/30 stroke-ink/65" />
      <ellipse cx="7.5" cy="7" rx="1.9" ry="4.8" fill="none" strokeWidth="0.8" className="stroke-ink/55" />
      <path d="M 2.7 7 H 12.3" strokeWidth="1.3" className="stroke-oxide-light" />
      <rect x="4.5" y="13.3" width="6" height="1.7" rx="0.5" className="fill-ink/65" />
      <Lamp cx={13.2} cy={13.6} r={1.15} lamp={lamp} halo={1.4} />
    </g>
  );
}

const largeDrawings: Record<GlyphKind, (props: DrawingProps) => ReactElement> = {
  folder: FolderLarge,
  volume: VolumeLarge,
  ssh: SshLarge,
  smb: SmbLarge,
  cloud: CloudLarge,
  webdav: WebdavLarge,
};

const smallDrawings: Record<GlyphKind, (props: DrawingProps) => ReactElement> = {
  folder: FolderSmall,
  volume: VolumeSmall,
  ssh: SshSmall,
  smb: SmbSmall,
  cloud: CloudSmall,
  webdav: WebdavSmall,
};
