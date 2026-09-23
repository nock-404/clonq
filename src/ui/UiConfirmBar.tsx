import type { LucideIcon } from "lucide-react";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { UiButton } from "./UiButton";

interface UiConfirmBarProps {
  /** The question, as one short sentence. */
  title: string;
  /** What follows from each answer. */
  children?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  tone?: "danger" | "warn";
  /** False when something around it already answers Escape, e.g. the sheet it sits in. */
  escapeCancels?: boolean;
}

const frames = {
  danger: "bg-danger-soft ring-[0.0625rem] ring-danger/45",
  warn: "bg-warn-soft ring-[0.0625rem] ring-warn/45",
};

/**
 * A question asked in place before something that cannot simply be undone. It takes the focus
 * onto the safe answer, Escape gives that answer, and Enter only acts on the focused button, so
 * a key press meant for the view underneath cannot confirm it by accident.
 */
export function UiConfirmBar({ title, children, cancelLabel, confirmLabel, confirmIcon, onCancel, onConfirm, busy = false, tone = "danger", escapeCancels = true }: UiConfirmBarProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeCancels) {
        event.preventDefault();
        onCancel();
      }
      // The focused button still gets its click; only listeners further along do not see the key.
      if (event.key === "Enter") event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, escapeCancels]);

  return (
    <div ref={root} role="alertdialog" aria-label={title} className={`flex items-center gap-3 rounded-[var(--radius-panel)] px-3.5 py-2.5 ${frames[tone]}`}>
      <TriangleAlert className={`size-4 shrink-0 ${tone === "danger" ? "text-danger" : "text-warn"}`} strokeWidth={2.2} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[0.8125rem] font-semibold text-ink">{title}</span>
        {children ? <span className="text-xs leading-snug text-ink-soft">{children}</span> : null}
      </div>
      <UiButton variant="secondary" keys={["esc"]} onPress={onCancel}>
        {cancelLabel}
      </UiButton>
      <UiButton variant="danger" icon={confirmIcon} disabled={busy} onPress={onConfirm}>
        {confirmLabel}
      </UiButton>
    </div>
  );
}
