import { useEffect } from "react";

/** `mod` is ⌘. Keys use `KeyboardEvent.key`, e.g. "Enter", "k", "ArrowDown". */
export type Hotkey = `${"mod+" | ""}${string}`;

export function useHotkeys(bindings: Partial<Record<Hotkey, (event: KeyboardEvent) => void>>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const combo = `${event.metaKey ? "mod+" : ""}${event.key}` as Hotkey;
      const handler = bindings[combo];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, enabled]);
}
