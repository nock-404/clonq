interface UiKbdProps {
  keys: string[];
  /** On an accent-coloured button. */
  inverse?: boolean;
}

export function UiKbd({ keys, inverse = false }: UiKbdProps) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className={[
            "grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-[0.25rem] px-1 font-sans text-[0.6875rem] font-medium",
            inverse ? "bg-on-accent/15 text-on-accent" : "bg-hover text-ink-soft",
          ].join(" ")}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
