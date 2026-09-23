import type { ReactNode } from "react";
import { UiKbd } from "./UiKbd";

export interface UiBarAction {
  label: string;
  keys: string[];
  onPress: () => void;
  disabled?: boolean;
}

interface UiActionBarProps {
  status: ReactNode;
  primary?: UiBarAction;
  secondary?: UiBarAction;
}

export function UiActionBar({ status, primary, secondary }: UiActionBarProps) {
  return (
    <footer className="hairline-t flex h-10 shrink-0 items-center gap-2 bg-well pr-2 pl-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-ink-soft">{status}</div>
      {primary ? <BarButton action={primary} strong /> : null}
      {primary && secondary ? <span className="h-4 w-[0.0625rem] bg-edge" /> : null}
      {secondary ? <BarButton action={secondary} /> : null}
    </footer>
  );
}

function BarButton({ action, strong = false }: { action: UiBarAction; strong?: boolean }) {
  return (
    <button
      type="button"
      onClick={action.onPress}
      disabled={action.disabled}
      className={[
        "flex h-7 items-center gap-2 rounded-[var(--radius-control)] px-2 text-xs font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-40",
        strong ? "text-ink" : "text-ink-soft",
      ].join(" ")}
    >
      {action.label}
      <UiKbd keys={action.keys} />
    </button>
  );
}
