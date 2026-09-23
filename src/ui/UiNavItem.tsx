import type { LucideIcon } from "lucide-react";

interface UiNavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
}

export function UiNavItem({ icon: Icon, label, active, onPress, count }: UiNavItemProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-current={active ? "page" : undefined}
      className={[
        "flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-left text-[0.8125rem] font-medium",
        "transition-colors duration-150",
        active ? "bg-surface-strong text-ink" : "text-ink-soft hover:bg-surface-hover hover:text-ink",
      ].join(" ")}
    >
      <Icon className={`size-4 ${active ? "text-accent" : ""}`} strokeWidth={2.1} />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="tabular text-xs text-ink-faint">{count}</span> : null}
    </button>
  );
}
