import type { LucideIcon } from "lucide-react";
import type { Tone } from "../lib/labels";
import { toneText } from "./tone";

type Size = "sm" | "md";

interface UiIconButtonProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: Tone;
  size?: Size;
  disabled?: boolean;
  filled?: boolean;
}

const sizes: Record<Size, { box: string; icon: string }> = {
  sm: { box: "size-7", icon: "size-3.5" },
  md: { box: "size-8", icon: "size-4" },
};

export function UiIconButton({
  icon: Icon,
  label,
  onPress,
  tone = "neutral",
  size = "md",
  disabled = false,
  filled = false,
}: UiIconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-full",
        "transition-[background-color,color,transform] duration-150 active:scale-95",
        "disabled:pointer-events-none disabled:opacity-35",
        filled ? "pane hover:bg-surface-hover" : "hover:bg-surface-hover",
        toneText[tone],
        sizes[size].box,
      ].join(" ")}
    >
      <Icon className={sizes[size].icon} strokeWidth={2.2} />
    </button>
  );
}
