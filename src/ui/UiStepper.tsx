import { Check } from "lucide-react";

export type UiStepState = "done" | "current" | "open" | "problem" | "locked";

export interface UiStepperStep {
  label: string;
  /**
   * done: reached and complete; current: the step on screen; open: reached but not complete;
   * problem: reached, with something to fix; locked: not reached yet.
   */
  state: UiStepState;
}

interface UiStepperProps {
  steps: UiStepperStep[];
  label: string;
  /** Every step but a locked one can be clicked. */
  onJump: (index: number) => void;
}

const marks: Record<UiStepState, string> = {
  done: "bg-ink-soft text-canvas",
  current: "bg-accent text-on-accent",
  open: "hairline text-ink-soft",
  problem: "bg-warn-soft text-warn",
  locked: "bg-track text-ink-faint",
};

const words: Record<UiStepState, string> = {
  done: "text-ink-soft",
  current: "text-ink font-semibold",
  open: "text-ink-soft",
  problem: "text-warn",
  locked: "text-ink-faint",
};

/**
 * Numbered steps along the top of a multi-step sheet. Finished steps carry a check mark; the
 * pieces of line between finished steps are drawn as tape.
 */
export function UiStepper({ steps, label, onJump }: UiStepperProps) {
  return (
    <nav aria-label={label} className="hairline-b px-5 py-2">
      <ol className="flex items-center gap-1">
        {steps.map((step, index) => {
          const next = steps[index + 1];
          const joined = step.state === "done" && (next?.state === "done" || next?.state === "current");
          return (
            <li key={step.label} className="flex items-center gap-1">
              <button
                type="button"
                disabled={step.state === "locked"}
                aria-current={step.state === "current" ? "step" : undefined}
                onClick={() => onJump(index)}
                className={[
                  "flex h-6 items-center gap-1.5 rounded-full pr-2 pl-1 text-xs transition-colors",
                  step.state === "locked" ? "" : "hover:bg-hover",
                  words[step.state],
                ].join(" ")}
              >
                <span className={`grid size-4 place-items-center rounded-full text-[0.625rem] font-semibold tabular ${marks[step.state]}`}>
                  {step.state === "done" ? <Check className="size-2.5" strokeWidth={3.4} /> : index + 1}
                </span>
                {step.label}
              </button>
              {next ? (
                <span aria-hidden className={`h-[0.125rem] w-4 rounded-full ${joined ? "bg-oxide-light" : "bg-edge"}`} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
