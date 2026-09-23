import type { ReactNode } from "react";

interface UiListRowProps {
  leading: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  accessory?: ReactNode;
  selected: boolean;
  onPress: () => void;
  onHover?: () => void;
  /** 0–100 draws a thin progress line along the bottom, null an indeterminate one. */
  progress?: number | null;
  dimmed?: boolean;
}

export function UiListRow({ leading, title, subtitle, accessory, selected, onPress, onHover, progress, dimmed = false }: UiListRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPress}
      onMouseMove={onHover}
      className={[
        "relative flex w-full items-center gap-3 overflow-hidden rounded-[var(--radius-panel)] px-2.5 py-2 text-left",
        selected ? "bg-selected" : "",
        dimmed ? "opacity-55" : "",
      ].join(" ")}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.8125rem] font-medium text-ink">{title}</span>
        {subtitle ? <span className="truncate text-xs text-ink-faint">{subtitle}</span> : null}
      </span>
      {accessory ? <span className="flex shrink-0 items-center gap-2 text-xs text-ink-soft tabular">{accessory}</span> : null}
      {progress !== undefined ? (
        <svg viewBox="0 0 100 2" preserveAspectRatio="none" className="absolute inset-x-2.5 bottom-0.5 h-0.5 w-[calc(100%-1.25rem)]" aria-hidden>
          <rect width="100" height="2" rx="1" className="fill-track" />
          {progress === null ? (
            <rect width="30" height="2" rx="1" className="fill-accent animate-pulse" />
          ) : (
            <rect width={Math.min(100, Math.max(0, progress))} height="2" rx="1" className="fill-accent" />
          )}
        </svg>
      ) : null}
    </button>
  );
}
