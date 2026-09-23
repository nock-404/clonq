import type { Ring } from "../lib/types";
import { RINGS, ringText } from "./rings";
import { UiReel } from "./UiReel";

interface UiRingPickerProps {
  value: Ring;
  onChange: (ring: Ring) => void;
  label: string;
  /** The name of each colour, shown under its reel. */
  names: Record<Ring, string>;
  size?: "md" | "lg";
}

const widths = { md: "w-14", lg: "w-[4.125rem]" };

/** The five write-ring colours, each drawn as a reel. */
export function UiRingPicker({ value, onChange, label, names, size = "md" }: UiRingPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {RINGS.map((ring) => {
        const selected = ring === value;
        return (
          <button
            key={ring}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={names[ring]}
            onClick={() => onChange(ring)}
            className={[
              "flex flex-col items-center gap-1.5 rounded-[var(--radius-panel)] pt-2 pb-1.5 transition-colors",
              widths[size],
              selected ? "hairline bg-selected" : "hover:bg-hover",
            ].join(" ")}
          >
            <UiReel ring={ring} size={size} fill={selected ? 0.85 : 0.4} />
            <span className={`text-[0.6875rem] font-medium ${selected ? ringText[ring] : "text-ink-faint"}`}>{names[ring]}</span>
          </button>
        );
      })}
    </div>
  );
}
