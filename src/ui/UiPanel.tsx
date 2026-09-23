import type { ReactNode } from "react";

interface UiPanelProps {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  grow?: boolean;
}

/** A quiet section of the detail view: a label and its content on a faint well. */
export function UiPanel({ title, aside, children, grow = false }: UiPanelProps) {
  return (
    <section className={`hairline flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] bg-well p-4 ${grow ? "flex-1" : ""}`}>
      {title ? (
        <header className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-ink-soft">{title}</h3>
          {aside ? <span className="text-[0.6875rem] text-ink-faint">{aside}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
