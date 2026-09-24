import type { ReactNode } from "react";

interface UiLinkButtonProps {
  children: ReactNode;
  onPress: () => void;
  title?: string;
}

/** A quiet text action inside a line, e.g. "Change" next to a summary value. */
export function UiLinkButton({ children, onPress, title }: UiLinkButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onPress}
      className="shrink-0 rounded-[0.25rem] px-1 text-[0.6875rem] font-medium text-ink-faint transition-colors hover:bg-hover hover:text-accent"
    >
      {children}
    </button>
  );
}
