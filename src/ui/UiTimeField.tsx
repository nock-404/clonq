import { useRef, useState, type KeyboardEvent } from "react";

interface UiTimeFieldProps {
  /** "HH:MM", 24 hours. */
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");

function split(value: string): [string, string] {
  const [hours = "00", minutes = "00"] = value.split(":");
  return [hours, minutes];
}

/**
 * A time of day as two segments, hours and minutes. Digits move on to the next segment by
 * themselves, the arrow keys count up and down, and whatever is typed ends up as a valid time.
 */
export function UiTimeField({ value, onChange, label, disabled = false }: UiTimeFieldProps) {
  const [hours, minutes] = split(value);
  const [editing, setEditing] = useState<{ part: 0 | 1; text: string } | null>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const hourRef = useRef<HTMLInputElement>(null);
  const limits = [23, 59] as const;

  const commit = (part: 0 | 1, number: number) => {
    const clamped = Math.min(limits[part], Math.max(0, number));
    onChange(part === 0 ? `${pad(clamped)}:${minutes}` : `${hours}:${pad(clamped)}`);
  };

  const type = (part: 0 | 1, raw: string) => {
    const text = raw.replace(/\D/g, "").slice(-2);
    setEditing({ part, text });
    if (text === "") return;
    commit(part, Number(text));
    // Two digits, or a first digit that no second one could follow, finish the hours.
    if (part === 0 && (text.length === 2 || Number(text) > 2)) {
      setEditing(null);
      minuteRef.current?.focus();
      minuteRef.current?.select();
    }
  };

  const step = (part: 0 | 1, event: KeyboardEvent<HTMLInputElement>) => {
    const current = Number(part === 0 ? hours : minutes);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 1 : -1;
      const size = limits[part] + 1;
      commit(part, (current + delta + size) % size);
      setEditing(null);
    } else if (part === 1 && event.key === "Backspace" && (editing?.part !== 1 || editing.text === "")) {
      hourRef.current?.focus();
    } else if (part === 0 && (event.key === ":" || event.key === "ArrowRight")) {
      if (event.key === ":") event.preventDefault();
      minuteRef.current?.focus();
    } else if (part === 1 && event.key === "ArrowLeft") {
      hourRef.current?.focus();
    }
  };

  const segment = (part: 0 | 1) => {
    const shown = editing?.part === part ? editing.text : part === 0 ? hours : minutes;
    return (
      <input
        ref={part === 0 ? hourRef : minuteRef}
        inputMode="numeric"
        aria-label={`${label}, ${part === 0 ? "Stunden" : "Minuten"}`}
        value={shown}
        disabled={disabled}
        onChange={(event) => type(part, event.target.value)}
        onKeyDown={(event) => step(part, event)}
        onFocus={(event) => event.target.select()}
        onBlur={() => setEditing(null)}
        className="w-[1.375rem] rounded-[0.25rem] bg-transparent text-center font-mono text-xs text-ink outline-none focus:bg-accent-soft focus:text-accent"
      />
    );
  };

  return (
    <span
      role="group"
      aria-label={label}
      className={`hairline inline-flex h-8 items-center gap-0.5 rounded-[var(--radius-control)] bg-well px-1.5 ${disabled ? "opacity-50" : ""}`}
    >
      {segment(0)}
      <span className="font-mono text-xs text-ink-faint">:</span>
      {segment(1)}
    </span>
  );
}
