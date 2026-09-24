import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface UiListboxItem {
  id: string;
  leading?: ReactNode;
  title: ReactNode;
  /** Small things on the right, e.g. badges and a chevron. */
  accessory?: ReactNode;
  dimmed?: boolean;
}

interface UiListboxProps {
  items: UiListboxItem[];
  label: string;
  /** The row the keyboard points at, or null. */
  active: string | null;
  onActive: (id: string | null) => void;
  /** A click on a row, or ↵ and → on the active row. */
  onOpen: (id: string) => void;
  /** ← and ⌘↑: one level up. */
  onBack?: () => void;
  /** While true the rows are dimmed, e.g. while the next level loads. */
  busy?: boolean;
  /** Shown instead of rows when there are none. */
  empty?: ReactNode;
  /** Rows after the items that are not part of the choice, e.g. a field for a new entry. */
  after?: ReactNode;
  autoFocus?: boolean;
}

/**
 * A list that is driven by the keyboard like a Finder column: ↑ and ↓ move, ↵ or → opens the row,
 * ← or ⌘↑ goes back. The mouse opens a row with one click; hovering only highlights it.
 * With no active row, ↵ is left to the surrounding form.
 */
export function UiListbox({ items, label, active, onActive, onOpen, onBack, busy = false, empty, after, autoFocus = false }: UiListboxProps) {
  const base = useId();
  const root = useRef<HTMLDivElement>(null);
  const rowId = (id: string) => `${base}-${id.replace(/[^\w-]/g, "_")}`;
  const index = active === null ? -1 : items.findIndex((item) => item.id === active);

  // An empty list has nothing to point at, so it takes no focus; Enter then belongs to the form.
  const focusable = items.length > 0;
  useEffect(() => {
    if (autoFocus && focusable) root.current?.focus({ preventScroll: true });
  }, [autoFocus, focusable]);

  useEffect(() => {
    if (active === null) return;
    root.current?.querySelector(`#${CSS.escape(rowId(active))}`)?.scrollIntoView({ block: "nearest" });
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const move = (to: number) => {
      event.preventDefault();
      const item = items[Math.max(0, Math.min(items.length - 1, to))];
      if (item) onActive(item.id);
    };
    switch (event.key) {
      case "ArrowDown":
        if (event.metaKey) return;
        move(index + 1);
        break;
      case "ArrowUp":
        if (event.metaKey) {
          event.preventDefault();
          onBack?.();
        } else {
          move(index < 0 ? items.length - 1 : index - 1);
        }
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(items.length - 1);
        break;
      case "ArrowRight":
      case "Enter":
        if (active === null || event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        onOpen(active);
        break;
      case "ArrowLeft":
        if (event.metaKey || !onBack) return;
        event.preventDefault();
        onBack();
        break;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
      <div
        ref={root}
        role="listbox"
        aria-label={label}
        tabIndex={focusable ? 0 : -1}
        aria-activedescendant={active !== null && index >= 0 ? rowId(active) : undefined}
        aria-busy={busy}
        data-own-enter={active !== null ? "" : undefined}
        onKeyDown={onKeyDown}
        className={`flex flex-col rounded-[var(--radius-control)] outline-none transition-opacity focus-visible:ring-[0.125rem] focus-visible:ring-inset focus-visible:ring-accent/50 ${busy ? "opacity-45" : ""}`}
      >
        {items.map((item) => (
          <div
            key={item.id}
            id={rowId(item.id)}
            role="option"
            aria-selected={item.id === active}
            onClick={() => onOpen(item.id)}
            className={[
              "flex min-h-8 cursor-default items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-1.5",
              item.id === active ? "bg-selected" : "hover:bg-hover",
              item.dimmed ? "opacity-55" : "",
            ].join(" ")}
          >
            {item.leading}
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-ink">{item.title}</span>
            {item.accessory ? <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-soft">{item.accessory}</span> : null}
          </div>
        ))}
        {items.length === 0 && empty ? empty : null}
      </div>
      {after}
    </div>
  );
}
