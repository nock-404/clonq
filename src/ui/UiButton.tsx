import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface UiButtonProps {
  children: ReactNode;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  disabled?: boolean;
  title?: string;
  wide?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-110 active:brightness-95",
  secondary: "pane text-ink hover:bg-surface-hover",
  ghost: "text-ink-soft hover:bg-surface-hover hover:text-ink",
  danger: "bg-danger text-white hover:brightness-110 active:brightness-95",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 gap-1.5 text-xs",
  md: "h-8 px-3.5 gap-2 text-[0.8125rem]",
};

export function UiButton({
  children,
  onPress,
  variant = "secondary",
  size = "md",
  icon: Icon,
  disabled = false,
  title,
  wide = false,
}: UiButtonProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onPress}
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-medium",
        "transition-[background-color,filter,color] duration-150",
        "disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        wide ? "w-full" : "",
      ].join(" ")}
    >
      {Icon ? <Icon className="size-3.5" strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}
