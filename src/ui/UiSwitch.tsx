import { motion } from "motion/react";

interface UiSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function UiSwitch({ checked, onChange, label }: UiSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? "justify-end bg-accent" : "justify-start bg-track"}`}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className="size-4 rounded-full bg-ink shadow" />
    </button>
  );
}
