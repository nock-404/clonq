export interface UiBar {
  key: string;
  value: number;
  /** Shown on hover. */
  title: string;
  highlight?: boolean;
}

interface UiBarsProps {
  bars: UiBar[];
  label: string;
}

const H = 64;
const GAP = 0.28;

export function UiBars({ bars, label }: UiBarsProps) {
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const width = 100 / Math.max(bars.length, 1);
  return (
    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block h-full w-full" role="img" aria-label={label}>
      {bars.map((bar, index) => {
        const height = bar.value > 0 ? Math.max(2, (bar.value / max) * (H - 2)) : 1;
        return (
          <rect
            key={bar.key}
            x={index * width + (width * GAP) / 2}
            y={H - height}
            width={width * (1 - GAP)}
            height={height}
            rx="0.6"
            className={bar.highlight ? "fill-accent" : bar.value > 0 ? "fill-ink/35" : "fill-ink/10"}
          >
            <title>{bar.title}</title>
          </rect>
        );
      })}
    </svg>
  );
}
