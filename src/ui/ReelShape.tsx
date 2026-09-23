import type { Ring } from "../lib/types";
import { ReelShape as LichtReel } from "./reels/licht/ReelShape";
import { ReelShape as PraezisionReel } from "./reels/praezision/ReelShape";
import { useReelStyle } from "./reels/style";
import { ReelShape as VakuumReel } from "./reels/vakuum/ReelShape";

interface ReelShapeProps {
  cx: number;
  cy: number;
  /** Outer radius of the flange. */
  r: number;
  ring: Ring;
  /** How much tape is wound on, 0 (empty hub) to 1 (full reel). */
  fill: number;
  spinning: boolean;
  reverse?: boolean;
  slow?: boolean;
  /** "icon" draws fewer, bolder parts for reels that end up small on screen. */
  detail?: "icon" | "full";
}

/** One reel in the chosen style, drawn into a surrounding SVG. */
export function ReelShape({ detail = "full", ...reel }: ReelShapeProps) {
  const style = useReelStyle();
  if (style === "vakuum") return <VakuumReel {...reel} detail={detail} />;
  if (style === "praezision") return <PraezisionReel {...reel} detail={detail === "icon" ? "glyph" : "fine"} />;
  return <LichtReel {...reel} detail={detail} />;
}
