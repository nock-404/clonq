import { motion } from "motion/react";

interface UiCounterProps {
  value: number;
  /** Minimum number of digit wheels. */
  digits?: number;
  size?: "sm" | "lg";
}

/** Full size of one wheel in rem; a narrow panel makes all wheels smaller, never fewer. */
const sizes = {
  sm: { width: 0.75, height: 1.25, font: 0.875 },
  lg: { width: 1.15, height: 2, font: 1.5 },
};

/** A mechanical counter: every digit is a wheel that rolls to its number. */
export function UiCounter({ value, digits = 1, size = "lg" }: UiCounterProps) {
  const text = String(Math.max(0, Math.floor(value))).padStart(digits, "0");
  const full = sizes[size];
  // Each wheel takes its share of the available width, up to its full size; height and
  // digits shrink with it, so a long number stays on one line and whole.
  // Only length × number here: dividing a length by a length needs a newer WebKit than macOS 13 has.
  const width = `min(${full.width}rem, calc((100cqw - ${text.length - 1}px) / ${text.length}))`;
  const box = { width, height: `calc(${width} * ${full.height / full.width})`, fontSize: `calc(${width} * ${full.font / full.width})` };
  return (
    <span className="@container block w-full min-w-0">
    <span className="inline-flex gap-px font-mono font-medium tabular" aria-label={String(value)}>
      {[...text].map((digit, index) => (
        <span key={text.length - index} className="relative overflow-hidden rounded-sm bg-well text-center leading-none" style={box}>
          <motion.span
            className="absolute inset-x-0 top-0 flex flex-col"
            initial={false}
            animate={{ y: `${-Number(digit) * 10}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
          >
            {Array.from({ length: 10 }, (_, n) => (
              <span key={n} className="grid place-items-center" style={{ height: box.height }}>
                {n}
              </span>
            ))}
          </motion.span>
        </span>
      ))}
    </span>
    </span>
  );
}
