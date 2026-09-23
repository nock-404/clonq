import type { ReactNode } from "react";
import type { Tone } from "../lib/labels";
import { toneSoft } from "./tone";

interface UiBadgeProps {
  children: ReactNode;
  tone?: Tone;
}

export function UiBadge({ children, tone = "neutral" }: UiBadgeProps) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.6875rem] font-semibold ${toneSoft[tone]}`}>
      {children}
    </span>
  );
}
