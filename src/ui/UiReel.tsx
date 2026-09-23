import type { Ring } from "../lib/types";
import { UiReel as LichtReel } from "./reels/licht/UiReel";
import { UiReel as PraezisionReel } from "./reels/praezision/UiReel";
import { useReelStyle } from "./reels/style";
import { UiReel as VakuumReel } from "./reels/vakuum/UiReel";

interface UiReelProps {
  ring: Ring;
  fill?: number;
  spinning?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  label?: string;
}

/** A single reel as an icon, in the style picked in the settings. */
export function UiReel(props: UiReelProps) {
  const style = useReelStyle();
  if (style === "vakuum") return <VakuumReel {...props} />;
  if (style === "praezision") return <PraezisionReel {...props} />;
  return <LichtReel {...props} />;
}
