import { Search } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";

interface UiSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function UiSearchField({ value, onChange, placeholder, onKeyDown, autoFocus = false, ref }: UiSearchFieldProps) {
  return (
    <label className="flex h-12 items-center gap-3 px-4">
      <Search className="size-4 shrink-0 text-ink-faint" strokeWidth={2.2} />
      <input
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
      />
    </label>
  );
}
