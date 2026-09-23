import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface UiBreadcrumbProps {
  /** The first crumb, e.g. a location with its glyph. */
  root: ReactNode;
  segments: string[];
  /** 0 is the root, 1 the first segment, and so on. */
  onJump: (depth: number) => void;
  label: string;
  /** More segments than this fold into an ellipsis after the root. */
  max?: number;
}

/** Where a browser stands: root › folder › folder. Every crumb but the last jumps back up. */
export function UiBreadcrumb({ root, segments, onJump, label, max = 4 }: UiBreadcrumbProps) {
  const hidden = Math.max(0, segments.length - max);
  const crumbs = [
    { depth: 0, content: root },
    ...segments.map((segment, index) => ({ depth: index + 1, content: segment })),
  ].filter((crumb) => crumb.depth === 0 || crumb.depth > hidden);
  const last = segments.length;

  return (
    <nav aria-label={label} className="flex min-w-0 items-center gap-0.5 text-xs">
      {crumbs.map((crumb, index) => (
        <span key={crumb.depth} className="flex min-w-0 items-center gap-0.5">
          {index > 0 ? <ChevronRight className="size-3 shrink-0 text-ink-faint" strokeWidth={2.2} aria-hidden /> : null}
          {index === 1 && hidden > 0 ? (
            <>
              <span className="px-1 text-ink-faint">…</span>
              <ChevronRight className="size-3 shrink-0 text-ink-faint" strokeWidth={2.2} aria-hidden />
            </>
          ) : null}
          <button
            type="button"
            disabled={crumb.depth === last}
            aria-current={crumb.depth === last ? "location" : undefined}
            onClick={() => onJump(crumb.depth)}
            className={[
              "flex h-6 min-w-0 items-center gap-1.5 truncate rounded-[var(--radius-control)] px-1.5 font-medium",
              crumb.depth === last ? "text-ink" : "text-ink-soft hover:bg-hover hover:text-ink",
            ].join(" ")}
          >
            {crumb.content}
          </button>
        </span>
      ))}
    </nav>
  );
}
