import { ChevronsUpDown } from "lucide-react";
import { useT } from "../i18n";

export interface UiSelectOption<T extends string> {
  value: T;
  label: string;
}

interface UiSelectProps<T extends string> {
  value: T | null;
  options: UiSelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  /** Shown while nothing is chosen. */
  placeholder?: string;
  disabled?: boolean;
}

/** One choice out of a list, opened as the native macOS menu. */
export function UiSelect<T extends string>({ value, options, onChange, label, placeholder, disabled = false }: UiSelectProps<T>) {
  const t = useT();
  return (
    <span className="relative inline-flex min-w-0">
      <select
        aria-label={label}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}
        className={[
          "hairline h-8 w-full min-w-0 appearance-none truncate rounded-[var(--radius-control)] bg-well pr-7 pl-2.5 text-[0.8125rem] text-ink outline-none",
          "hover:bg-hover focus:bg-hover disabled:opacity-50",
        ].join(" ")}
      >
        {value === null ? (
          <option value="" disabled>
            {placeholder ?? t.common.choose}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-faint" strokeWidth={2.2} aria-hidden />
    </span>
  );
}
