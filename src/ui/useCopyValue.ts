import { useEffect, useRef, useState } from "react";

/** How long "kopiert" or "markiert" stays visible. */
const SHOWN_MS = 2400;

export type CopyState = "idle" | "copied" | "selected";

/**
 * Copies a value to the clipboard. If the clipboard is not available, the text of
 * the element behind `text` is selected instead, so ⌘C copies it. `state` says
 * for a moment which of the two happened.
 */
export function useCopyValue<T extends HTMLElement>(value: string) {
  const text = useRef<T>(null);
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), SHOWN_MS);
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

  return { text, state, copy };
}

/** What the user reads after pressing copy. */
export const copyWords: Record<Exclude<CopyState, "idle">, string> = {
  copied: "In die Zwischenablage kopiert.",
  selected: "Markiert. Mit ⌘C kopieren.",
};
