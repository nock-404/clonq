import type { ReactNode } from "react";

export interface UiSegment<T extends string> {
  value: T;
  label: string;
  leading?: ReactNode;
}

interface UiSegmentedProps<T extends string> {
  segments: UiSegment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function UiSegmented<T extends string>({ segments, value, onChange, label }: UiSegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-[var(--radius-control)] bg-well p-0.5">
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          role="radio"
          aria-checked={segment.value === value}
          onClick={() => onChange(segment.value)}
          className={[
            "flex h-7 items-center gap-2 rounded-[0.3rem] px-3 text-xs font-medium",
            segment.value === value ? "bg-selected text-ink" : "text-ink-soft hover:text-ink",
          ].join(" ")}
        >
          {segment.leading}
          {segment.label}
        </button>
      ))}
    </div>
  );
}
