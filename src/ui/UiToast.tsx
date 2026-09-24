import { CircleCheck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { UiButton } from "./UiButton";
import { UiIconButton } from "./UiIconButton";
import { useT } from "../i18n";

export interface UiToastMessage {
  /** Changes for every new message, so the timer starts over. */
  id: number;
  text: string;
  action?: { label: string; onPress: () => void };
  /** How long it stays, in milliseconds. */
  duration?: number;
}

interface UiToastProps {
  message: UiToastMessage | null;
  onDismiss: () => void;
}

/** A short confirmation at the bottom of the window, with at most one action, e.g. undo. */
export function UiToast({ message, onDismiss }: UiToastProps) {
  const t = useT();
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, message.duration ?? 5000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-40 flex justify-center" aria-live="polite">
      <AnimatePresence>
        {message ? (
          <motion.div
            key={message.id}
            role="status"
            className="hairline pointer-events-auto flex items-center gap-3 rounded-[var(--radius-panel)] bg-raised py-1.5 pr-1.5 pl-3 shadow-2xl"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <CircleCheck className="size-4 shrink-0 text-ok" strokeWidth={2.1} />
            <span className="text-[0.8125rem] text-ink">{message.text}</span>
            {message.action ? (
              <UiButton
                variant="secondary"
                onPress={() => {
                  message.action?.onPress();
                  onDismiss();
                }}
              >
                {message.action.label}
              </UiButton>
            ) : null}
            <UiIconButton icon={X} label={t.common.dismiss} onPress={onDismiss} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
