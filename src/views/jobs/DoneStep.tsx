import { Check } from "lucide-react";
import { locale, texts, useT } from "../../i18n";
import type { Config, Job } from "../../lib/types";
import { UiText } from "../../ui";
import { ringBg, ringOf } from "../../ui/rings";
import { firstRunSentences, hasAutomatic, triggerWords } from "./draft";

interface DoneStepProps {
  job: Job;
  config: Config | null;
}

/** How the job will start from now on, in one sentence. */
export function startSentence(job: Job, config: Config | null): string {
  const t = texts().wizard;
  if (!hasAutomatic(job.triggers)) return t.done.manual;
  if (!job.enabled) return t.name.automationOff;
  const words = new Intl.ListFormat(locale(), { type: "disjunction" }).format(triggerWords(job.triggers, config));
  return t.done.starts(words);
}

/** After a new job is saved: what happens next, and the offer of a dry run. */
export function DoneStep({ job, config }: DoneStepProps) {
  const t = useT().wizard;
  const index = config?.jobs.findIndex((item) => item.id === job.id) ?? -1;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <span className={`grid size-10 place-items-center rounded-full text-canvas ${ringBg[ringOf(job.ring, Math.max(0, index))]}`}>
        <Check className="size-5" strokeWidth={3} />
      </span>
      <div className="flex max-w-[30rem] flex-col items-center gap-1.5">
        <UiText variant="title">{t.done.title(job.name)}</UiText>
        <UiText tone="neutral">{startSentence(job, config)}</UiText>
      </div>
      <p className="max-w-[26rem] text-xs leading-relaxed text-ink-faint">
        {job.mode === "bidirectional"
          ? [...firstRunSentences(job.conflicts, job.archive.enabled), t.done.dryRunTwoWay].join(" ")
          : t.done.dryRunOneWay}
      </p>
    </div>
  );
}
