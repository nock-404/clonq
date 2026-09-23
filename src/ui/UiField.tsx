import type { ReactNode } from "react";

interface UiFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function UiField({ label, hint, error, children }: UiFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
      {error ? <span className="text-[0.6875rem] text-danger">{error}</span> : hint ? <span className="text-[0.6875rem] text-ink-faint">{hint}</span> : null}
    </label>
  );
}
