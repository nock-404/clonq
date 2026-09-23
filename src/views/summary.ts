import type { ClonqState } from "../hooks/useClonq";
import type { Tone } from "../lib/labels";

/** One line about everything, as the status in the action bar. */
export function overallSummary(state: ClonqState): { text: string; tone: Tone } {
  const running = Object.values(state.live).filter((live) => live.phase !== "finished").length;
  if (running > 0) return { text: running === 1 ? "Ein Job läuft" : `${running} Jobs laufen`, tone: "accent" };
  const latest = Object.values(state.latest);
  const failed = latest.filter((run) => run.status === "failed").length;
  const blocked = latest.filter((run) => run.status === "blocked").length;
  if (failed > 0) return { text: failed === 1 ? "Ein Job ist fehlgeschlagen" : `${failed} Jobs fehlgeschlagen`, tone: "danger" };
  if (blocked > 0) return { text: blocked === 1 ? "Ein Job wartet auf dich" : `${blocked} Jobs warten auf dich`, tone: "warn" };
  if (latest.length === 0) return { text: "Noch kein Lauf", tone: "neutral" };
  return { text: "Alles aktuell", tone: "ok" };
}
