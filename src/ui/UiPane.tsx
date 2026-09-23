import { motion } from "motion/react";
import type { ReactNode } from "react";

interface UiPaneProps {
  children: ReactNode;
  padding?: "sm" | "md";
}

const paddings = { sm: "p-2.5", md: "p-3.5" };

/** A glass surface on the glass, fading in when it appears. */
export function UiPane({ children, padding = "md" }: UiPaneProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className={`pane ${paddings[padding]}`}
    >
      {children}
    </motion.div>
  );
}
