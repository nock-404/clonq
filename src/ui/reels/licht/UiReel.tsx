import type { Ring } from "../../../lib/types";
import { ReelShape, type ReelDetail } from "./ReelShape";

type Size = "xs" | "sm" | "md" | "lg";

interface UiReelProps {
  ring: Ring;
  fill?: number;
  spinning?: boolean;
  size?: Size;
  label?: string;
}

const sizes: Record<Size, string> = {
  xs: "size-5",
  sm: "size-7",
  md: "size-10",
  lg: "size-16",
};

// List icons get their own drawing: fewer, bolder parts that stay crisp at 1.25rem.
// From 2.5rem up the reel has room for its glass, so md and lg share one drawing.
const details: Record<Size, ReelDetail> = {
  xs: "icon",
  sm: "icon",
  md: "full",
  lg: "full",
};

export function UiReel({ ring, fill = 0.7, spinning = false, size = "sm", label }: UiReelProps) {
  const detail = details[size];
  return (
    <svg
      viewBox="0 0 100 100"
      className={`shrink-0 overflow-visible ${sizes[size]}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ReelShape cx={50} cy={50} r={detail === "icon" ? 48 : 46} ring={ring} fill={fill} spinning={spinning} detail={detail} />
    </svg>
  );
}
