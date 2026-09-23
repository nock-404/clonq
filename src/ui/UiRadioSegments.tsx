import { moveRadio } from "./UiRadioGroup";

export interface UiRadioSegment<T extends string> {
  value: T;
  label: string;
}

interface UiRadioSegmentsProps<T extends string> {
  segments: UiRadioSegment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** The whole choice does not apply right now; say why in the text that describedBy points at. */
  disabled?: boolean;
  /** Id of the text that explains the choice, or why it does not apply. */
  describedBy?: string;
}

/**
 * A few choices that exclude each other, side by side in one quiet control. Only the chosen one is
 * in the tab order; the arrow keys move and pick, as radio buttons do on the Mac. The lamp of the
 * chosen segment is lit only while the choice applies.
 */
export function UiRadioSegments<T extends string>({ segments, value, onChange, label, disabled = false, describedBy }: UiRadioSegmentsProps<T>) {
  const chosen = segments.some((segment) => segment.value === value) ? value : segments[0]?.value;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onKeyDown={moveRadio}
      className={`hairline inline-flex shrink-0 gap-0.5 rounded-[var(--radius-control)] bg-well p-0.5 transition-opacity ${disabled ? "opacity-40" : ""}`}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            tabIndex={segment.value === chosen ? 0 : -1}
            onClick={() => onChange(segment.value)}
            className={[
              "flex h-6 items-center gap-2 rounded-[0.3rem] px-2.5 text-xs font-medium transition-colors",
              selected ? "bg-selected text-ink" : disabled ? "text-ink-soft" : "text-ink-soft hover:bg-hover hover:text-ink",
            ].join(" ")}
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${selected && !disabled ? "bg-accent shadow-[0_0_0.375rem_var(--accent)]" : "bg-ink/20"}`}
            />
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
