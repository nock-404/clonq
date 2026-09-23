interface UiLampsProps {
  count?: number;
  active: boolean;
}

/** A strip of indicator lamps, blinking out of step while data moves. */
export function UiLamps({ count = 16, active }: UiLampsProps) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={[
            "size-1.5 rounded-full",
            active ? "animate-lamp lamp-stagger bg-accent" : "bg-ink/15",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
