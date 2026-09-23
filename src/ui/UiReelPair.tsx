import type { Ring } from "../lib/types";
import { UiReelPair as LichtPair } from "./reels/licht/UiReelPair";
import { UiReelPair as PraezisionPair } from "./reels/praezision/UiReelPair";
import { useReelStyle } from "./reels/style";
import { UiReelPair as VakuumPair } from "./reels/vakuum/UiReelPair";

interface UiReelPairProps {
  ring: Ring;
  /** 0–100 while running; decides how much tape has moved from the file reel to the machine reel. */
  progress: number;
  running: boolean;
  label: string;
}

/** The tape drive of a job: two reels and the transport between them, in the style picked in the settings. */
export function UiReelPair(props: UiReelPairProps) {
  const style = useReelStyle();
  if (style === "vakuum") return <VakuumPair {...props} />;
  if (style === "praezision") return <PraezisionPair {...props} />;
  return <LichtPair {...props} />;
}
