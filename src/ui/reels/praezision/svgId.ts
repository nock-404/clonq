import { useId } from "react";

/** An id that is safe inside `url(#…)`, for gradients that belong to one drawing. */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
