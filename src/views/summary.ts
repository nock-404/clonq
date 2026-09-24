import type { ClonqState } from "../hooks/useClonq";
import { texts } from "../i18n";
import type { Tone } from "../lib/labels";

export interface Summary {
  text: string;
  /** For tight spots such as the popover's action bar. */
  short: string;
  tone: Tone;
}

/** One line about everything. */
export function overallSummary(state: ClonqState): Summary {
  const t = texts().shell.summary;
  const running = Object.values(state.live).filter((live) => live.phase !== "finished").length;
  if (running > 0) {
    return { text: t.running(running), short: t.runningShort(running), tone: "accent" };
  }
  const latest = Object.values(state.latest);
  const failed = latest.filter((run) => run.status === "failed").length;
  const blocked = latest.filter((run) => run.status === "blocked").length;
  if (failed > 0) {
    return { text: t.failed(failed), short: t.failedShort(failed), tone: "danger" };
  }
  if (blocked > 0) {
    return { text: t.blocked(blocked), short: t.blockedShort(blocked), tone: "warn" };
  }
  if (latest.length === 0) return { text: t.noRunYet, short: t.noRunYet, tone: "neutral" };
  return { text: t.upToDate, short: t.upToDateShort, tone: "ok" };
}
