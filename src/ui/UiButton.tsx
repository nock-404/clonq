import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { UiKbd } from "./UiKbd";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface UiButtonProps {
  children: ReactNode;
  onPress: () => void;
  variant?: Variant;
  icon?: LucideIcon;
  keys?: string[];
  disabled?: boolean;
  title?: string;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110",
  secondary: "bg-hover text-ink hover:bg-selected",
  ghost: "text-ink-soft hover:bg-hover hover:text-ink",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-ink",
};

export function UiButton({ children, onPress, variant = "secondary", icon: Icon, keys, disabled = false, title }: UiButtonProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onPress}
      className={[
        "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-[0.8125rem] font-medium",
        "transition-[background-color,filter,color] duration-150 active:brightness-95",
        "disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
      ].join(" ")}
    >
      {Icon ? <Icon className="size-4" strokeWidth={2.1} /> : null}
      {children}
      {keys ? <UiKbd keys={keys} inverse={variant === "primary"} /> : null}
    </button>
  );
}
