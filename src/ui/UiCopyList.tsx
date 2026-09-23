import { Check, Copy } from "lucide-react";
import { copyWords, useCopyValue } from "./useCopyValue";
import { UiIconButton } from "./UiIconButton";

export interface UiCopyItem {
  key: string;
  /** A short name above the value, e.g. the type of a key. */
  label: string;
  /** A quieter start of the value, e.g. "SHA256:"; it is copied with the value. */
  prefix?: string;
  value: string;
}

interface UiCopyListProps {
  items: UiCopyItem[];
  /** What the list holds, for assistive technology. */
  label: string;
}

/**
 * Short machine values that someone compares character by character, e.g.
 * fingerprints, in one well: each with its name and a copy button above it, and
 * the value on a line of its own in readable mono. If the clipboard is not
 * available, the value is selected instead so ⌘C copies it.
 */
export function UiCopyList({ items, label }: UiCopyListProps) {
  return (
    <ul aria-label={label} className="hairline flex flex-col rounded-[var(--radius-control)] bg-well">
      {items.map((item) => (
        <CopyRow key={item.key} item={item} />
      ))}
    </ul>
  );
}

function CopyRow({ item }: { item: UiCopyItem }) {
  const { text, state, copy } = useCopyValue<HTMLSpanElement>(`${item.prefix ?? ""}${item.value}`);
  return (
    <li className="flex flex-col pt-1 pr-1 pb-2 pl-3 not-last:hairline-b">
      {/* One fixed height, so the note after copying does not move the value; the button may reach into the padding. */}
      <span className="flex h-6 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.625rem] font-medium tracking-wider text-ink-faint uppercase">{item.label}</span>
        {state !== "idle" ? <span className="shrink-0 text-[0.6875rem] leading-none text-accent">{copyWords[state]}</span> : null}
        <UiIconButton
          icon={state === "copied" ? Check : Copy}
          label={`${item.label} kopieren`}
          tone={state === "copied" ? "accent" : "neutral"}
          onPress={() => void copy()}
        />
      </span>
      <span ref={text} className="pr-2 font-mono text-[0.8125rem] leading-snug break-all select-text">
        {item.prefix ? <span className="text-ink-faint">{item.prefix}</span> : null}
        <span className="text-ink">{item.value}</span>
      </span>
    </li>
  );
}
