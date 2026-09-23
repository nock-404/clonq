interface UiStepsProps {
  steps: string[];
  current: number;
  /** Steps up to this index may be clicked to jump back. */
  onJump?: (index: number) => void;
}

export function UiSteps({ steps, current, onJump }: UiStepsProps) {
  return (
    <ol className="hairline-b flex items-center gap-1 px-5 py-2.5">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!onJump || index > current}
              onClick={() => onJump?.(index)}
              className={[
                "flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium",
                active ? "bg-accent-soft text-accent" : done ? "text-ink-soft hover:bg-hover" : "text-ink-faint",
              ].join(" ")}
            >
              <span className={`grid size-4 place-items-center rounded-full text-[0.625rem] tabular ${active ? "bg-accent text-on-accent" : done ? "bg-ink/20 text-ink" : "bg-track"}`}>
                {index + 1}
              </span>
              {step}
            </button>
            {index < steps.length - 1 ? <span className="h-[0.0625rem] w-3 bg-edge" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
