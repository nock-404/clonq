import { motion } from "motion/react";

interface UiCounterProps {
  value: number;
  /** Minimum number of digit wheels. */
  digits?: number;
  size?: "sm" | "lg";
}

const sizes = {
  sm: { wheel: "h-5 w-3 text-sm", digit: "h-5" },
  lg: { wheel: "h-8 w-[1.15rem] text-2xl", digit: "h-8" },
};

/** A mechanical counter: every digit is a wheel that rolls to its number. */
export function UiCounter({ value, digits = 1, size = "lg" }: UiCounterProps) {
  const text = String(Math.max(0, Math.floor(value))).padStart(digits, "0");
  return (
    <span className="inline-flex gap-px font-mono font-medium tabular" aria-label={String(value)}>
      {[...text].map((digit, index) => (
        <span key={text.length - index} className={`relative overflow-hidden rounded-sm bg-well text-center leading-none ${sizes[size].wheel}`}>
          <motion.span
            className="absolute inset-x-0 top-0 flex flex-col"
            initial={false}
            animate={{ y: `${-Number(digit) * 10}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
          >
            {Array.from({ length: 10 }, (_, n) => (
              <span key={n} className={`grid place-items-center ${sizes[size].digit}`}>
                {n}
              </span>
            ))}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
