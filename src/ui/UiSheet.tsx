import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { UiIconButton } from "./UiIconButton";

interface UiSheetProps {
  open: boolean;
  title: string;
  /** Small line under the title, e.g. the current step. */
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons along the bottom edge, right-aligned. */
  footer?: ReactNode;
  /** Something above the content that belongs to the whole sheet, e.g. a step bar. */
  header?: ReactNode;
  width?: "md" | "lg";
}

const widths = { md: "w-[34rem]", lg: "w-[46rem]" };

/** A dialog that slides over the window. Escape or a click on the dimmed area closes it. */
export function UiSheet({ open, title, subtitle, onClose, children, footer, header, width = "lg" }: UiSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="sheet"
          className="absolute inset-0 z-30 flex items-start justify-center bg-[oklch(0_0_0/0.45)] pt-14"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`hairline flex max-h-[calc(100%-5rem)] flex-col overflow-hidden rounded-[0.875rem] bg-raised shadow-2xl ${widths[width]}`}
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <header className="hairline-b flex items-start gap-3 px-5 pt-4 pb-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
                {subtitle ? <span className="text-xs text-ink-faint">{subtitle}</span> : null}
              </div>
              <UiIconButton icon={X} label="Schließen" onPress={onClose} />
            </header>
            {header}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <footer className="hairline-t flex items-center justify-end gap-2 bg-well px-5 py-3">{footer}</footer> : null}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
