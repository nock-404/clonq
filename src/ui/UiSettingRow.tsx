import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface UiSettingRowProps {
  title: string;
  /** A sentence under the title; it wraps instead of being cut off. */
  description?: ReactNode;
  /** Id of the description, so a control can point at it with aria-describedby. */
  descriptionId?: string;
  /** Shows the description as an error. */
  invalid?: boolean;
  icon?: LucideIcon;
  /** The row's own control at the far right, e.g. a switch, a menu or a number field. */
  control?: ReactNode;
  /**
   * Settings that belong to the control, shown to its left, e.g. "for 30 days". They follow the
   * control in the tab order, so a switch is reached before the field it unlocks.
   */
  inline?: ReactNode;
  /**
   * A control that takes the rest of the line after the title, e.g. a list of patterns. The
   * description then runs under both.
   */
  field?: ReactNode;
  /** Dims the icon, the title and the inline settings, e.g. while the option is switched off. */
  off?: boolean;
  /** A second line of controls under the title, e.g. a choice that only matters for this setting. */
  below?: ReactNode;
}

/**
 * One setting in a list of settings: an icon, a title with a sentence under it, and its controls
 * on the right. Rows stacked in a list are separated by hairlines, as with UiSwitchRow.
 */
export function UiSettingRow({ title, description, descriptionId, invalid = false, icon: Icon, control, inline, field, off = false, below }: UiSettingRowProps) {
  const icon = Icon ? <Icon className={`size-4 shrink-0 ${off ? "text-ink-faint" : "text-ink"}`} strokeWidth={2} aria-hidden /> : null;
  const heading = <span className={`shrink-0 text-[0.8125rem] font-medium ${off ? "text-ink-soft" : "text-ink"}`}>{title}</span>;
  const sentence = description ? (
    <span id={descriptionId} className={`text-[0.6875rem] leading-snug ${invalid ? "text-danger" : "text-ink-faint"}`}>
      {description}
    </span>
  ) : null;

  if (field) {
    return (
      <div className="flex flex-col gap-0.5 px-3 pt-0.5 pb-1.5 not-last:hairline-b">
        <div className="flex min-h-8 items-center gap-3">
          {icon}
          {heading}
          <div className="min-w-0 flex-1">{field}</div>
        </div>
        {sentence ? <div className={Icon ? "pl-7" : ""}>{sentence}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-0.5 not-last:hairline-b">
      <div className="flex min-h-8 items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          {heading}
          {sentence}
        </div>
        {control || inline ? (
          <div className="flex shrink-0 flex-row-reverse items-center gap-3">
            {control}
            {inline ? (
              <div className={`flex items-center gap-1.5 text-xs transition-opacity ${off ? "text-ink-faint opacity-60" : "text-ink-soft"}`}>{inline}</div>
            ) : null}
          </div>
        ) : null}
      </div>
      {below ? <div className={Icon ? "pb-1.5 pl-7" : "pb-1.5"}>{below}</div> : null}
    </div>
  );
}
