import type { ReactNode } from "react";

interface UiFormGroupProps {
  title: string;
  /** A short remark on the right of the title. */
  aside?: ReactNode;
  /** A line under the content. */
  hint?: ReactNode;
  /** Replaces the hint while something is wrong. */
  error?: string | null;
  children: ReactNode;
}

/** A titled part of a form that holds more than one control, e.g. a list of chips or a row of choices. */
export function UiFormGroup({ title, aside, hint, error, children }: UiFormGroupProps) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium text-ink-soft">{title}</h3>
        {aside ? <span className="text-[0.6875rem] text-ink-faint">{aside}</span> : null}
      </header>
      {children}
      {error ? (
        <span className="text-[0.6875rem] leading-snug text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[0.6875rem] leading-snug text-ink-faint">{hint}</span>
      ) : null}
    </section>
  );
}
