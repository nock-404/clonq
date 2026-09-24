import type { ReactNode } from "react";
import { UiKbd } from "./UiKbd";

interface UiOptionCardProps {
  title: string;
  /** One or two lines under the title. */
  description?: ReactNode;
  /** A picture: beside the title in a row card, above it in a tall one. */
  art?: ReactNode;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Small text on the right, e.g. free space or a state. */
  aside?: ReactNode;
  /** A key that picks this option, shown in the corner. */
  shortcut?: string;
  layout?: "row" | "tall";
}

/**
 * One option of a radio group, drawn as a card. The chosen card gets a fine accent outline and a
 * lit lamp instead of a coloured fill, so it stays quiet next to other accent elements.
 */
export function UiOptionCard({ title, description, art, selected, onPress, disabled = false, aside, shortcut, layout = "row" }: UiOptionCardProps) {
  const tall = layout === "tall";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onPress}
      className={[
        "relative flex w-full rounded-[var(--radius-panel)] text-left transition-[background-color,box-shadow] duration-150",
        tall ? "flex-col gap-3 p-3" : "items-center gap-3 px-3 py-2.5",
        selected ? "border-[0.0625rem] border-transparent bg-selected ring-[0.0625rem] ring-inset ring-accent/70" : "hairline bg-well hover:bg-hover",
        disabled ? "pointer-events-none opacity-40" : "",
      ].join(" ")}
    >
      {art ? <span className={tall ? "block w-full" : "shrink-0"}>{art}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className={`size-1.5 shrink-0 rounded-full ${selected ? "bg-accent shadow-[0_0_0.375rem_var(--accent)]" : "bg-ink/20"}`} aria-hidden />
          <span className="min-w-0 truncate text-[0.8125rem] font-medium text-ink">{title}</span>
          {shortcut ? (
            <span className="ml-auto">
              <UiKbd keys={[shortcut]} />
            </span>
          ) : null}
        </span>
        {description ? <span className="pl-3.5 text-xs leading-snug text-ink-faint">{description}</span> : null}
      </span>
      {aside ? <span className="shrink-0 text-[0.6875rem] text-ink-faint tabular">{aside}</span> : null}
    </button>
  );
}
