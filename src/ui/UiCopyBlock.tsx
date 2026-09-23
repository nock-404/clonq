import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UiIconButton } from "./UiIconButton";

interface UiCopyBlockProps {
  value: string;
  label: string;
}

/**
 * A long machine value, e.g. a public key, in mono and selectable, with a copy
 * button. If the clipboard is not available, the text is selected instead so
 * ⌘C copies it.
 */
export function UiCopyBlock({ value, label }: UiCopyBlockProps) {
  const text = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      const node = text.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setState("selected");
    }
  };

  return (
    <div className="hairline flex items-start gap-2 rounded-[var(--radius-control)] bg-well py-2 pr-1 pl-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span ref={text} aria-label={label} className="font-mono text-[0.6875rem] leading-relaxed break-all text-ink-soft select-text">
          {value}
        </span>
        {state !== "idle" ? (
          <span className="text-[0.6875rem] text-accent">{state === "copied" ? "In die Zwischenablage kopiert." : "Markiert. Mit ⌘C kopieren."}</span>
        ) : null}
      </div>
      <UiIconButton icon={state === "copied" ? Check : Copy} label="Kopieren" tone={state === "copied" ? "accent" : "neutral"} onPress={() => void copy()} />
    </div>
  );
}
