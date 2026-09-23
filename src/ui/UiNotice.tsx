import { TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "../lib/labels";
import { UiIconButton } from "./UiIconButton";
import { toneSoft } from "./tone";

interface UiNoticeProps {
  children: ReactNode;
  tone?: Tone;
  onDismiss?: () => void;
  actions?: ReactNode;
}

export function UiNotice({ children, tone = "warn", onDismiss, actions }: UiNoticeProps) {
  return (
    <div className={`flex items-start gap-2 rounded-[var(--radius-control)] px-2.5 py-2 ${toneSoft[tone]}`}>
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs leading-snug">
        {children}
        {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}
      </div>
      {onDismiss ? <UiIconButton icon={X} label="Schließen" onPress={onDismiss} /> : null}
    </div>
  );
}
