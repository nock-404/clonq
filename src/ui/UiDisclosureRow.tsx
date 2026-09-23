import { ChevronRight, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

interface UiDisclosureRowProps {
  title: string;
  icon?: LucideIcon;
  /** The current setting in a few words, shown on the right while the row is closed. */
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Shows the summary as an error, e.g. while a value inside is invalid. */
  invalid?: boolean;
  children: ReactNode;
}

/**
 * A setting in a list of settings that stays folded until it is needed: the title and the current
 * setting in one line, the controls underneath once opened. Looks like UiSettingRow when closed.
 */
export function UiDisclosureRow({ title, icon: Icon, summary, open, onToggle, invalid = false, children }: UiDisclosureRowProps) {
  const contentId = useId();
  return (
    <div className="flex flex-col not-last:hairline-b">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex min-h-9 w-full items-center gap-3 px-3 py-0.5 text-left hover:bg-hover"
      >
        {Icon ? <Icon className="size-4 shrink-0 text-ink" strokeWidth={2} aria-hidden /> : null}
        <span className="shrink-0 text-[0.8125rem] font-medium text-ink">{title}</span>
        <span className={`ml-auto min-w-0 truncate text-xs ${invalid ? "text-danger" : "text-ink-soft"}`}>{summary}</span>
        <ChevronRight className={`size-3.5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div id={contentId} className={`flex flex-col gap-1.5 pr-3 pb-2 ${Icon ? "pl-10" : "pl-3"}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
