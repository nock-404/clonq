import { Check } from "lucide-react";
import type { Config, Job } from "../../lib/types";
import { UiText } from "../../ui";
import { ringBg, ringOf } from "../../ui/rings";
import { hasAutomatic, triggerWords } from "./draft";

interface DoneStepProps {
  job: Job;
  config: Config | null;
}

/** How the job will start from now on, in one sentence. */
export function startSentence(job: Job, config: Config | null): string {
  if (!hasAutomatic(job.triggers)) return "Der Job startet nur von Hand.";
  if (!job.enabled) return "Die Automatik ist aus; der Job startet vorerst nur von Hand.";
  const words = new Intl.ListFormat("de", { type: "disjunction" }).format(triggerWords(job.triggers, config));
  return `Der Job startet ${words}, solange clonq läuft.`;
}

/** After a new job is saved: what happens next, and the offer of a dry run. */
export function DoneStep({ job, config }: DoneStepProps) {
  const index = config?.jobs.findIndex((item) => item.id === job.id) ?? -1;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <span className={`grid size-10 place-items-center rounded-full text-canvas ${ringBg[ringOf(job.ring, Math.max(0, index))]}`}>
        <Check className="size-5" strokeWidth={3} />
      </span>
      <div className="flex max-w-[30rem] flex-col items-center gap-1.5">
        <UiText variant="title">„{job.name}“ ist angelegt.</UiText>
        <UiText tone="neutral">{startSentence(job, config)}</UiText>
      </div>
      <p className="max-w-[26rem] text-xs leading-relaxed text-ink-faint">
        Ein Probelauf zeigt, was der erste Lauf kopieren und löschen würde, ohne dabei etwas zu verändern.
      </p>
    </div>
  );
}
