interface UiDividerProps {
  orientation?: "vertical" | "horizontal";
}

/** A hairline between groups of controls. */
export function UiDivider({ orientation = "vertical" }: UiDividerProps) {
  return orientation === "vertical" ? (
    <span aria-hidden className="mx-1.5 h-5 w-[0.0625rem] shrink-0 bg-edge" />
  ) : (
    <span aria-hidden className="my-1.5 h-[0.0625rem] w-full shrink-0 bg-edge" />
  );
}
