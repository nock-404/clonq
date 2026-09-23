import type { Ring } from "../lib/types";
import { ReelShape } from "./ReelShape";

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

export function UiReel({ ring, fill = 0.7, spinning = false, size = "sm", label }: UiReelProps) {
  return (
    <svg viewBox="0 0 100 100" className={`shrink-0 ${sizes[size]}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <ReelShape cx={50} cy={50} r={48} ring={ring} fill={fill} spinning={spinning} />
    </svg>
  );
}
