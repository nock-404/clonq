import type { Ring } from "../lib/types";

export const RINGS: Ring[] = ["blue", "green", "red", "yellow", "white"];

/** The job's own ring colour, or one picked by its position. */
export function ringOf(ring: Ring | null, index: number): Ring {
  return ring ?? RINGS[index % RINGS.length] ?? "blue";
}

export const ringStroke: Record<Ring, string> = {
  red: "stroke-ring-red",
  yellow: "stroke-ring-yellow",
  blue: "stroke-ring-blue",
  green: "stroke-ring-green",
  white: "stroke-ring-white",
};

export const ringFill: Record<Ring, string> = {
  red: "fill-ring-red",
  yellow: "fill-ring-yellow",
  blue: "fill-ring-blue",
  green: "fill-ring-green",
  white: "fill-ring-white",
};

export const ringText: Record<Ring, string> = {
  red: "text-ring-red",
  yellow: "text-ring-yellow",
  blue: "text-ring-blue",
  green: "text-ring-green",
  white: "text-ring-white",
};

export const ringBg: Record<Ring, string> = {
  red: "bg-ring-red",
  yellow: "bg-ring-yellow",
  blue: "bg-ring-blue",
  green: "bg-ring-green",
  white: "bg-ring-white",
};
