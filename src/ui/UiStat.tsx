import type { ReactNode } from "react";
import type { Tone } from "../lib/labels";
import { toneText } from "./tone";

interface UiStatProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone | "ink";
  size?: "md" | "lg" | "xl";
}

const sizes = {
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-4xl",
};

export function UiStat({ label, value, detail, tone = "ink", size = "lg" }: UiStatProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[0.6875rem] font-medium text-ink-faint">{label}</span>
      <span className={`font-semibold tracking-tight tabular leading-none ${sizes[size]} ${tone === "ink" ? "text-ink" : toneText[tone]}`}>
        {value}
      </span>
      {detail ? <span className="truncate text-[0.6875rem] text-ink-soft">{detail}</span> : null}
    </div>
  );
}
