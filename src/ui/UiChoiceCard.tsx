import type { ReactNode } from "react";

interface UiChoiceCardProps {
  title: string;
  description?: ReactNode;
  /** A picture on the left, e.g. a location glyph. */
  art?: ReactNode;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Extra line in the corner, e.g. "kommt bald" or a size. */
  aside?: ReactNode;
}

/** A large selectable option: type of location, mode of a job, a drive to pick. */
export function UiChoiceCard({ title, description, art, selected, onPress, disabled = false, aside }: UiChoiceCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onPress}
      className={[
        "hairline flex w-full items-center gap-3 rounded-[var(--radius-panel)] px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent-soft" : "bg-well hover:bg-hover",
        disabled ? "pointer-events-none opacity-40" : "",
      ].join(" ")}
    >
      {art ? <span className="shrink-0">{art}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-[0.8125rem] font-medium ${selected ? "text-accent" : "text-ink"}`}>{title}</span>
        {description ? <span className="text-xs text-ink-faint">{description}</span> : null}
      </span>
      {aside ? <span className="shrink-0 text-[0.6875rem] text-ink-faint tabular">{aside}</span> : null}
    </button>
  );
}
