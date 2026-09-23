import type { LucideIcon } from "lucide-react";
import type { Tone } from "../lib/labels";
import { toneText } from "./tone";

interface UiIconButtonProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
}

export function UiIconButton({ icon: Icon, label, onPress, tone = "neutral", disabled = false }: UiIconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={[
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)]",
        "transition-colors duration-150 hover:bg-hover disabled:pointer-events-none disabled:opacity-35",
        toneText[tone],
      ].join(" ")}
    >
      <Icon className="size-4" strokeWidth={2.1} />
    </button>
  );
}
