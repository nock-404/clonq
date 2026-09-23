import type { KeyboardEvent } from "react";

interface UiNumberFieldProps {
  /** The number as typed, so a half-typed value can be shown and judged. */
  value: string;
  onChange: (value: string) => void;
  /** The field's name for assistive technology, e.g. "Schutzschwelle in Prozent". */
  label: string;
  /** Words right before the field, e.g. "für". */
  before?: string;
  /** Words right after the field, e.g. "%" or "Tage". */
  after?: string;
  /** Marks the field itself when its value is not accepted. */
  invalid?: boolean;
  disabled?: boolean;
  /** The arrow keys count up and down between these bounds. */
  min?: number;
  max?: number;
  /** Id of the text that explains the field or says what is wrong with it. */
  describedBy?: string;
}

/**
 * A short whole number inside a sentence, e.g. "für [30] Tage". It carries its own name, and the
 * arrow keys count up and down as in a stepper.
 */
export function UiNumberField({ value, onChange, label, before, after, invalid = false, disabled = false, min = 0, max = Number.MAX_SAFE_INTEGER, describedBy }: UiNumberFieldProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (step === 0 || event.metaKey || event.altKey || event.ctrlKey) return;
    event.preventDefault();
    const current = Number.parseInt(value.trim(), 10);
    const next = Number.isNaN(current) ? min : current + step * (event.shiftKey ? 10 : 1);
    onChange(String(Math.min(max, Math.max(min, next))));
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      {before ? <span aria-hidden>{before}</span> : null}
      <input
        type="text"
        inputMode="numeric"
        value={value}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={[
          "hairline h-7 w-12 rounded-[var(--radius-control)] bg-well px-2 text-right text-[0.8125rem] text-ink tabular outline-none",
          "focus:bg-hover disabled:opacity-50",
          invalid ? "text-danger ring-[0.0625rem] ring-danger/80" : "",
        ].join(" ")}
      />
      {after ? <span aria-hidden>{after}</span> : null}
    </span>
  );
}
