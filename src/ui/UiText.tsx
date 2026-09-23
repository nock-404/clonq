import type { ReactNode } from "react";
import type { Tone } from "../lib/labels";
import { toneText } from "./tone";

type Variant = "title" | "heading" | "body" | "label" | "caption" | "mono";

interface UiTextProps {
  children: ReactNode;
  variant?: Variant;
  tone?: Tone | "ink";
  truncate?: boolean;
  title?: string;
}

const variants: Record<Variant, string> = {
  title: "text-lg font-semibold tracking-tight",
  heading: "text-[0.8125rem] font-semibold",
  body: "text-[0.8125rem]",
  label: "text-xs font-medium",
  caption: "text-[0.6875rem]",
  mono: "font-mono text-[0.6875rem]",
};

export function UiText({ children, variant = "body", tone = "ink", truncate = false, title }: UiTextProps) {
  const color = tone === "ink" ? "text-ink" : toneText[tone];
  return (
    <span title={title} className={[variants[variant], color, "tabular", truncate ? "block min-w-0 truncate" : ""].join(" ")}>
      {children}
    </span>
  );
}
