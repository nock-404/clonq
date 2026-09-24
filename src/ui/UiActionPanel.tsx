import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Tone } from "../lib/labels";
import { UiKbd } from "./UiKbd";
import { toneText } from "./tone";
import { useT } from "../i18n";

export interface UiAction {
  id: string;
  title: string;
  icon: LucideIcon;
  keys?: string[];
  tone?: Tone;
  disabled?: boolean;
  run: () => void;
}

interface UiActionPanelProps {
  open: boolean;
  title: string;
  actions: UiAction[];
  onClose: () => void;
}

/** The ⌘K panel: every action of the selected thing, searchable, with its shortcut. */
export function UiActionPanel({ open, title, actions, onClose }: UiActionPanelProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const visible = useMemo(
    () => actions.filter((action) => !action.disabled && action.title.toLowerCase().includes(query.toLowerCase())),
    [actions, query],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      input.current?.focus();
    }
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((current) => Math.min(current + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = visible[index];
      if (action) {
        onClose();
        action.run();
      }
    } else if (event.key === "Escape" || (event.key === "k" && event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="scrim"
            className="absolute inset-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="panel"
            role="dialog"
            aria-label={title}
            className="hairline absolute right-2 bottom-12 z-20 w-72 overflow-hidden rounded-[var(--radius-panel)] bg-raised shadow-2xl"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <div className="hairline-b px-3 pt-2.5 pb-2 text-[0.6875rem] font-medium text-ink-faint">{title}</div>
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto p-1.5" role="listbox">
              {visible.map((action, position) => (
                <button
                  key={action.id}
                  type="button"
                  role="option"
                  aria-selected={position === index}
                  onMouseMove={() => setIndex(position)}
                  onClick={() => {
                    onClose();
                    action.run();
                  }}
                  className={[
                    "flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-left text-[0.8125rem]",
                    position === index ? "bg-selected" : "",
                    action.tone ? toneText[action.tone] : "text-ink",
                  ].join(" ")}
                >
                  <action.icon className="size-4 shrink-0" strokeWidth={2.1} />
                  <span className="flex-1 truncate">{action.title}</span>
                  {action.keys ? <UiKbd keys={action.keys} /> : null}
                </button>
              ))}
            </div>
            <input
              ref={input}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t.common.searchActions}
              spellCheck={false}
              className="hairline-t h-9 w-full bg-transparent px-3 text-[0.8125rem] text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
            />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
