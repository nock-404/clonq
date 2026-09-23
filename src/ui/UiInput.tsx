import type { KeyboardEvent, Ref } from "react";

interface UiInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number";
  mono?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
}

export function UiInput({ value, onChange, placeholder, type = "text", mono = false, autoFocus = false, disabled = false, onKeyDown, ref }: UiInputProps) {
  return (
    <input
      ref={ref}
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={[
        "hairline h-8 w-full rounded-[var(--radius-control)] bg-well px-2.5 text-[0.8125rem] text-ink outline-none",
        "placeholder:text-ink-faint focus:bg-hover disabled:opacity-50",
        mono ? "font-mono text-xs" : "",
      ].join(" ")}
    />
  );
}
