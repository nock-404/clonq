import { AppWindowMac, Power } from "lucide-react";
import { useClonq, clearError } from "../hooks/useClonq";
import { api } from "../lib/api";
import { UiIconButton, UiNotice, UiText } from "../ui";
import { JobList } from "./JobList";
import { overallSummary } from "./summary";

export function Popover() {
  const state = useClonq();
  const summary = overallSummary(state);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <UiText variant="title">clonq</UiText>
          <UiText variant="label" tone={summary.tone}>
            {summary.text}
          </UiText>
        </div>
        <UiIconButton icon={AppWindowMac} label="Fenster öffnen" onPress={() => void api.openMainWindow()} />
        <UiIconButton icon={Power} label="clonq beenden" onPress={() => void api.quit()} />
      </header>

      {state.error ? (
        <div className="px-3 pb-2">
          <UiNotice tone="danger" onDismiss={clearError}>
            {state.error}
          </UiNotice>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <JobList state={state} />
      </div>
    </div>
  );
}
