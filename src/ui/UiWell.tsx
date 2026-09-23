import type { ReactNode } from "react";

interface UiWellProps {
  children: ReactNode;
  /** A bar above the content, e.g. a title with a search field. */
  header?: ReactNode;
  /** A bar under the content, e.g. a count and the actions for the selected row. */
  footer?: ReactNode;
  /**
   * How tall the content may get before it scrolls. Without a size the content takes the height
   * the well is given, e.g. by the row of a grid it stands in.
   */
  size?: "sm" | "md" | "lg";
  /** Lists sit close to the frame; text and pictures get room around them. */
  inset?: "list" | "text";
  /**
   * Adds no height of its own: the well stretches to whatever stands next to it in a grid row and
   * scrolls inside, so opening it beside a list does not move the page.
   */
  follow?: boolean;
  /** Names the well for assistive technology; it is then a region of the page. */
  label?: string;
}

const sizes = {
  sm: "min-h-24 max-h-64",
  md: "min-h-32 max-h-80",
  lg: "min-h-40 max-h-96",
};

/**
 * A framed pane inside a panel, like a list view of the Finder: an optional bar on top, content
 * that scrolls, and an optional bar at the bottom.
 */
export function UiWell({ children, header, footer, size, inset = "list", follow = false, label }: UiWellProps) {
  return (
    <section
      aria-label={label}
      className={`hairline flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-panel)] bg-well ${follow ? "contain-size" : ""}`}
    >
      {header ? <header className="hairline-b flex min-h-11 shrink-0 items-center gap-3 py-1.5 pr-1.5 pl-3">{header}</header> : null}
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${inset === "list" ? "p-1" : "p-3"} ${size ? sizes[size] : ""}`}>{children}</div>
      {footer ? <footer className="hairline-t flex min-h-10 shrink-0 items-center gap-1 py-1 pr-1.5 pl-3">{footer}</footer> : null}
    </section>
  );
}
