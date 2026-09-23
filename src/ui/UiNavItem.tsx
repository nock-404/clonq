import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface UiNavItemProps {
  icon?: LucideIcon;
  /** Replaces the icon, e.g. with a reel. */
  leading?: ReactNode;
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
}

export function UiNavItem({ icon, leading, label, active, onPress, count }: UiNavItemProps) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-current={active ? "page" : undefined}
      className={[
        "flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-left text-[0.8125rem] font-medium",
        "transition-colors duration-150",
        active ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover hover:text-ink",
      ].join(" ")}
    >
      {leading ?? (Icon ? <Icon className={`size-4 ${active ? "text-accent" : ""}`} strokeWidth={2.1} /> : null)}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="tabular text-xs text-ink-faint">{count}</span> : null}
    </button>
  );
}
