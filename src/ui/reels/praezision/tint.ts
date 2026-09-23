import type { Ring } from "../../../lib/types";

// Tailwind only sees class names written out in full, so every tint is listed.
// The ring colour belongs to the write-enable ring; the rim only carries a trace of it.

export const ringLine: Record<Ring, string> = {
  red: "stroke-ring-red",
  yellow: "stroke-ring-yellow",
  blue: "stroke-ring-blue",
  green: "stroke-ring-green",
  white: "stroke-ring-white",
};

/** Rim of the detailed reel: at most a third of the ring colour, so it never competes with the ring. */
export const rimLine: Record<Ring, string> = {
  red: "stroke-ring-red/35",
  yellow: "stroke-ring-yellow/30",
  blue: "stroke-ring-blue/35",
  green: "stroke-ring-green/30",
  white: "stroke-ring-white/30",
};
