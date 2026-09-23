import { useSyncExternalStore } from "react";
import type { Reels } from "../../lib/types";

// The reel style is a setting of the whole app, but the reel primitives should
// not reach into the app store. The app hands the setting over here instead.
let current: Reels = "licht";
const listeners = new Set<() => void>();

export function setReelStyle(style: Reels) {
  if (style === current) return;
  current = style;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReelStyle(): Reels {
  return useSyncExternalStore(subscribe, () => current);
}
