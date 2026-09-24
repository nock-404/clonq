import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";

export interface UiItemListItem {
  id: string;
  leading?: ReactNode;
  title: ReactNode;
  /** A quieter second line under the title. */
  detail?: ReactNode;
  /** Small facts on the right, e.g. a size and a date. */
  meta?: ReactNode;
  /** Drawn faint, e.g. a hidden file. */
  dimmed?: boolean;
  /** The whole row in words, shown when the pointer rests on it. */
  hint?: string;
}

interface UiItemListProps {
  items: UiItemListItem[];
  label: string;
  /** The selected row, or null. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** A double click, or ↵ and → on the selected row. Without it, ↵ does nothing here. */
  onOpen?: (id: string) => void;
  /** ← and ⌘↑: one level up. */
  onBack?: () => void;
  /** Escape clears the selection. Off for lists that always have one row picked. */
  deselectable?: boolean;
  /** While true the rows are dimmed and take no clicks or keys, e.g. while the next level loads. */
  busy?: boolean;
  /** Shown under the list when it has no rows. */
  empty?: ReactNode;
  autoFocus?: boolean;
  ref?: Ref<HTMLDivElement>;
}

const keysOfTheList = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"]);

/**
 * A list to pick one row from and then act on it, like the list view of the Finder: a click or
 * ↑ and ↓ select, a double click or ↵ opens, ← goes back up. What can be done with the selected
 * row lives next to the list, e.g. in a bar under it.
 */
export function UiItemList({ items, label, selected, onSelect, onOpen, onBack, deselectable = true, busy = false, empty, autoFocus = false, ref }: UiItemListProps) {
  const base = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const rowId = (id: string) => `${base}-${id.replace(/[^\w-]/g, "_")}`;
  const index = selected === null ? -1 : items.findIndex((item) => item.id === selected);

  const focusable = items.length > 0;
  useEffect(() => {
    if (autoFocus && focusable) root.current?.focus({ preventScroll: true });
  }, [autoFocus, focusable]);

  useEffect(() => {
    // Only while the list has the keyboard: a row chosen in advance must not scroll the page to it.
    if (selected === null || !root.current?.contains(document.activeElement)) return;
    root.current.querySelector(`#${CSS.escape(rowId(selected))}`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const setRoot = (element: HTMLDivElement | null) => {
    root.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (busy) {
      // The rows on screen are about to be replaced; a key meant for them must not act on the next ones.
      if (keysOfTheList.has(event.key)) event.preventDefault();
      return;
    }
    const move = (to: number) => {
      event.preventDefault();
      const item = items[Math.max(0, Math.min(items.length - 1, to))];
      if (item) onSelect(item.id);
    };
    switch (event.key) {
      case "ArrowDown":
        if (event.metaKey) {
          if (selected === null || !onOpen) return;
          event.preventDefault();
          onOpen(selected);
          return;
        }
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
        if (selected === null || index < 0 || !onOpen || event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        onOpen(selected);
        break;
      case "ArrowLeft":
        if (event.metaKey || !onBack) return;
        event.preventDefault();
        onBack();
        break;
      case "Escape":
        if (selected === null || !deselectable) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(null);
        break;
    }
  };

  return (
    <>
      <div
        ref={setRoot}
        role="listbox"
        aria-label={label}
        tabIndex={focusable ? 0 : -1}
        aria-activedescendant={selected !== null && index >= 0 ? rowId(selected) : undefined}
        aria-busy={busy}
        data-own-enter={selected !== null && onOpen ? "" : undefined}
        onKeyDown={onKeyDown}
        className={`flex flex-col rounded-[var(--radius-control)] outline-none transition-opacity focus-visible:ring-[0.125rem] focus-visible:ring-inset focus-visible:ring-accent/50 ${busy ? "pointer-events-none opacity-45" : ""}`}
      >
        {items.map((item) => (
          <div
            key={item.id}
            id={rowId(item.id)}
            role="option"
            aria-selected={item.id === selected}
            title={item.hint}
            onClick={() => !busy && onSelect(item.id)}
            onDoubleClick={onOpen ? () => !busy && onOpen(item.id) : undefined}
            className={[
              "flex min-h-8 cursor-default items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-1.5",
              item.id === selected ? "bg-selected" : "hover:bg-hover",
              item.dimmed ? "opacity-55" : "",
            ].join(" ")}
          >
            {item.leading}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[0.8125rem] font-medium text-ink">{item.title}</span>
              {item.detail ? <span className="truncate text-[0.6875rem] text-ink-faint">{item.detail}</span> : null}
            </span>
            {item.meta ? <span className="flex shrink-0 items-center gap-3 text-[0.6875rem] text-ink-faint tabular">{item.meta}</span> : null}
          </div>
        ))}
      </div>
      {items.length === 0 && empty ? empty : null}
    </>
  );
}
