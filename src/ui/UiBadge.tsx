import type { ReactNode } from "react";
import type { Tone } from "../lib/labels";
import { toneSoft } from "./tone";

interface UiBadgeProps {
  children: ReactNode;
  tone?: Tone;
}

export function UiBadge({ children, tone = "neutral" }: UiBadgeProps) {
  return (
    <span className={`inline-flex h-[1.125rem] shrink-0 items-center rounded-[0.25rem] px-1.5 text-[0.6875rem] font-medium ${toneSoft[tone]}`}>
      {children}
    </span>
  );
}
