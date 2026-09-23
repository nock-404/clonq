import type { ReactNode } from "react";
import { UiButton } from "./UiButton";

interface UiPathFieldProps {
  label: string;
  /** The chosen path as it should read, e.g. "~/Pictures/Fotoarchiv"; null while nothing is chosen. */
  path: string | null;
  placeholder: string;
  /** A button at the end of the field, e.g. "Anderer Ordner …". */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  hint?: ReactNode;
}

/**
 * A path that was picked elsewhere (e.g. in the macOS folder dialog), shown as
 * segments with the last one in full ink. Not a <label>: clicking the caption
 * must not press the button next to the path.
 */
export function UiPathField({ label, path, placeholder, action, hint }: UiPathFieldProps) {
  const parts = path ? path.split("/") : [];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <div className="flex items-center gap-2">
        <div
          className="hairline flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-[var(--radius-control)] bg-well px-2.5 font-mono text-xs select-text"
          title={path ?? undefined}
        >
          {path ? (
            parts.map((part, index) => (
              <span key={`${index}-${part}`} className="flex shrink-0 items-center last:min-w-0 last:shrink">
                {index > 0 ? <span className="px-0.5 text-ink-faint">/</span> : null}
                <span className={index === parts.length - 1 ? "truncate text-ink" : "text-ink-soft"}>{part}</span>
              </span>
            ))
          ) : (
            <span className="truncate font-sans text-ink-faint">{placeholder}</span>
          )}
        </div>
        {action ? (
          <UiButton onPress={action.onPress} disabled={action.disabled}>
            {action.label}
          </UiButton>
        ) : null}
      </div>
      {hint ? <span className="text-[0.6875rem] text-ink-faint">{hint}</span> : null}
    </div>
  );
}
