import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { UiSwitch } from "./UiSwitch";

interface UiSwitchRowProps {
  title: string;
  /** A sentence under the title; it wraps instead of being cut off. */
  description?: ReactNode;
  icon?: LucideIcon;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Settings that belong to the option, beside the switch, e.g. "after 60 seconds". Dimmed while the option is off. */
  inline?: ReactNode;
  /** The switch cannot be turned on, e.g. a Pro option without a licence. */
  disabled?: boolean;
  /** Settings shown below the row while it is on. */
  children?: ReactNode;
}

/**
 * An option that is on or off, with its own small settings beside or below it.
 * Rows stacked in a list are separated by hairlines.
 */
export function UiSwitchRow({ title, description, icon: Icon, checked, onChange, inline, disabled, children }: UiSwitchRowProps) {
  return (
    <div className="flex flex-col gap-2 px-3 py-0.5 not-last:hairline-b">
      <div className="flex min-h-8 items-center gap-3">
        {Icon ? <Icon className={`size-4 shrink-0 ${checked ? "text-ink" : "text-ink-faint"}`} strokeWidth={2} /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={`text-[0.8125rem] font-medium ${checked ? "text-ink" : "text-ink-soft"}`}>{title}</span>
          {description ? <span className="text-[0.6875rem] leading-snug text-ink-faint">{description}</span> : null}
        </div>
        {inline ? (
          <div className={`flex shrink-0 items-center gap-1.5 text-xs transition-opacity ${checked ? "text-ink-soft" : "text-ink-faint opacity-60"}`}>{inline}</div>
        ) : null}
        <UiSwitch checked={checked} onChange={onChange} label={title} disabled={disabled} />
      </div>
      {checked && children ? <div className={Icon ? "pb-1 pl-7" : "pb-1"}>{children}</div> : null}
    </div>
  );
}
