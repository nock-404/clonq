import type { LucideIcon } from "lucide-react";
import { UiText } from "./UiText";

interface UiEmptyProps {
  icon: LucideIcon;
  title: string;
  detail?: string;
}

export function UiEmpty({ icon: Icon, title, detail }: UiEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Icon className="size-7 text-ink-faint" strokeWidth={1.6} />
      <UiText variant="heading">{title}</UiText>
      {detail ? <UiText variant="caption" tone="neutral">{detail}</UiText> : null}
    </div>
  );
}
