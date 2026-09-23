import { X } from "lucide-react";
import type { ReactNode } from "react";

interface UiChipProps {
  children: ReactNode;
  leading?: ReactNode;
  mono?: boolean;
  /** Makes the chip a toggle, e.g. one of several jobs to pick. */
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** Adds a small cross that removes the chip. */
  onRemove?: () => void;
  removeLabel?: string;
}

/** A small pill: an exclude pattern, a pickable item, a tag with a way to remove it. */
export function UiChip({ children, leading, mono = false, onPress, selected = false, disabled = false, onRemove, removeLabel = "Entfernen" }: UiChipProps) {
  const tone = selected ? "bg-accent-soft text-accent" : "bg-hover text-ink";
  const text = mono ? "font-mono text-[0.6875rem]" : "text-xs font-medium";
  const body = (
    <>
      {leading}
      <span className="truncate">{children}</span>
    </>
  );
  return (
    <span className={`inline-flex h-6 max-w-full min-w-0 items-center rounded-full ${tone} ${disabled ? "opacity-40" : ""}`}>
      {onPress ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          disabled={disabled}
          onClick={onPress}
          className={`flex h-full min-w-0 items-center gap-1.5 rounded-full pl-2 ${onRemove ? "pr-1" : "pr-2.5"} ${text} ${selected ? "" : "hover:bg-selected"}`}
        >
          {body}
        </button>
      ) : (
        <span className={`flex min-w-0 items-center gap-1.5 pl-2.5 ${onRemove ? "pr-1" : "pr-2.5"} ${text}`}>{body}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          disabled={disabled}
          onClick={onRemove}
          className="mr-0.5 grid size-5 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-selected hover:text-ink"
        >
          <X className="size-3" strokeWidth={2.4} />
        </button>
      ) : null}
    </span>
  );
}
