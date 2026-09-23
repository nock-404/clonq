import { LocationShape, type GlyphKind, type GlyphLamp } from "./LocationShape";

export { glyphKindOf, type GlyphKind, type GlyphLamp } from "./LocationShape";

type Size = "xs" | "sm" | "md" | "lg";

interface UiLocationGlyphProps {
  kind: GlyphKind;
  size?: Size;
  /** Lit (ok) when the location is reachable. */
  connected?: boolean;
  /** Blinks (accent) while clonq is talking to the location, e.g. during a test. */
  busy?: boolean;
  /** Lit (danger) when the last attempt to reach the location failed. */
  failed?: boolean;
  /** Drawn faint, e.g. a drive that is not plugged in. */
  dimmed?: boolean;
  label?: string;
}

const sizes: Record<Size, string> = {
  xs: "size-4",
  sm: "size-5",
  md: "size-8",
  lg: "size-16",
};

/** A drawn picture of a kind of location with its status lamp; xs and sm use the simplified drawing. */
export function UiLocationGlyph({ kind, size = "sm", connected = false, busy = false, failed = false, dimmed = false, label }: UiLocationGlyphProps) {
  const lamp: GlyphLamp = busy ? "busy" : failed ? "fault" : connected ? "on" : "off";
  const simple = size === "xs" || size === "sm";
  const grid = simple ? 16 : 48;
  return (
    <svg
      viewBox={`0 0 ${grid} ${grid}`}
      className={`shrink-0 ${sizes[size]}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <LocationShape kind={kind} x={0} y={0} size={grid} lamp={lamp} dimmed={dimmed} simple={simple} />
    </svg>
  );
}
