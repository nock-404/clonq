interface UiKbdProps {
  keys: string[];
}

export function UiKbd({ keys }: UiKbdProps) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-[0.25rem] bg-hover px-1 font-sans text-[0.6875rem] font-medium text-ink-soft"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
