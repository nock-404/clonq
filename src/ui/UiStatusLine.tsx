import type { ReactNode } from "react";
import { UiLamp } from "./UiLamp";
import { UiText } from "./UiText";

export type UiStatus = "idle" | "busy" | "done" | "failed";

interface UiStatusLineProps {
  /** busy blinks amber, done glows green, failed glows red; idle has no lamp. */
  state: UiStatus;
  children: ReactNode;
  /** The whole text, for when the line is cut short. */
  title?: string;
  /** A quiet action right after the text, e.g. "Show in Finder". */
  action?: ReactNode;
}

const lamps = {
  busy: <UiLamp tone="accent" busy />,
  done: <UiLamp tone="ok" lit />,
  failed: <UiLamp tone="danger" lit />,
  idle: null,
};

const tones = { busy: "neutral", done: "ok", failed: "danger", idle: "neutral" } as const;

/** One line that says what just happened, with a panel lamp in front of it that lights only while something does. */
export function UiStatusLine({ state, children, title, action }: UiStatusLineProps) {
  return (
    <span role="status" className="flex min-h-5 min-w-0 items-center gap-2">
      {lamps[state]}
      <span className="min-w-0">
        <UiText variant="caption" tone={tones[state]} truncate title={title}>
          {children}
        </UiText>
      </span>
      {action}
    </span>
  );
}
