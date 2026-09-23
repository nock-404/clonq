import { Pencil } from "lucide-react";
import type { ReactNode } from "react";

interface UiSummaryRowProps {
  label: string;
  children: ReactNode;
  /** A second, quieter line. */
  detail?: ReactNode;
  /** Makes the whole row a button that leads to where the value is set. */
  onPress?: () => void;
  /** What pressing does, for assistive technology, e.g. "Quelle ändern". */
  pressLabel?: string;
}

/** One line of a summary: a name, its value, and the way back to where it was set. */
export function UiSummaryRow({ label, children, detail, onPress, pressLabel }: UiSummaryRowProps) {
  const body = (
    <>
      <span className="pt-px font-mono text-[0.625rem] font-medium tracking-wider text-ink-faint uppercase">{label}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs break-words text-ink">{children}</span>
        {detail ? <span className="text-[0.6875rem] break-words text-ink-faint">{detail}</span> : null}
      </span>
      {onPress ? <Pencil className="mt-0.5 size-3 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={2.2} aria-hidden /> : <span />}
    </>
  );
  const layout = "grid w-full grid-cols-[5.25rem_minmax(0,1fr)_0.75rem] items-start gap-2 px-3 py-2 text-left not-last:hairline-b";
  return onPress ? (
    <button type="button" title={pressLabel} onClick={onPress} className={`group ${layout} transition-colors hover:bg-hover`}>
      {body}
      {pressLabel ? <span className="sr-only">{pressLabel}</span> : null}
    </button>
  ) : (
    <div className={layout}>{body}</div>
  );
}
