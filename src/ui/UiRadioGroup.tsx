import type { KeyboardEvent, ReactNode, Ref } from "react";

/**
 * Arrow keys inside a radio group: every arrow moves to the next or previous choice that is not
 * disabled, wrapping at the ends, and picks it, as radio buttons do on the Mac. Keys that come
 * from anything but a radio, e.g. a text field inside the group, are left alone.
 */
export function moveRadio(event: KeyboardEvent<HTMLElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
  if (step === 0) return;
  if (!(event.target instanceof Element) || !event.target.closest("[role=radio]")) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")].filter(
    (radio) => !radio.matches(":disabled, [aria-disabled=true]"),
  );
  if (radios.length === 0) return;
  const focused = radios.findIndex((radio) => radio === document.activeElement);
  const from = focused >= 0 ? focused : radios.findIndex((radio) => radio.getAttribute("aria-checked") === "true");
  const next = radios[from < 0 ? (step > 0 ? 0 : radios.length - 1) : (from + step + radios.length) % radios.length];
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  next.click();
}

interface UiRadioGroupProps {
  label: string;
  /** Radio buttons, e.g. option cards; the group lays them out side by side. */
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  ref?: Ref<HTMLDivElement>;
}

const grids = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

/** Choices that exclude each other, laid out in columns and reachable with the arrow keys. */
export function UiRadioGroup({ label, children, columns = 2, ref }: UiRadioGroupProps) {
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={moveRadio} className={`grid gap-2 ${grids[columns]}`}>
      {children}
    </div>
  );
}
