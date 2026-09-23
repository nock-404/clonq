import { Download, RotateCw } from "lucide-react";
import { formatBytes } from "../lib/format";
import { checkForUpdate, installUpdate, useUpdate } from "../lib/update";
import { UiButton, UiProgressBar } from "../ui";
import { UiLogo } from "../ui/UiLogo";

/** A newer clonq is out: a small band with one button. Invisible while there is nothing to install. */
export function UpdateBand() {
  const update = useUpdate();
  if (update.phase !== "available" && update.phase !== "downloading" && update.phase !== "restarting") return null;
  const percent = update.phase === "downloading" && update.total ? (update.received / update.total) * 100 : null;
  return (
    <div className="hairline flex flex-col gap-2 rounded-[var(--radius-panel)] bg-accent-soft px-3 py-2.5">
      <div className="flex items-center gap-2">
        <UiLogo variant="mark" size="xs" />
        <span className="text-xs font-medium text-ink">clonq {update.version} ist da</span>
      </div>
      {update.phase === "available" ? (
        <UiButton variant="primary" icon={Download} onPress={() => void installUpdate()}>
          Installieren und neu starten
        </UiButton>
      ) : (
        <div className="flex flex-col gap-1">
          <UiProgressBar value={update.phase === "restarting" ? 100 : percent} />
          <span className="text-[0.6875rem] text-ink-soft tabular">
            {update.phase === "restarting"
              ? "clonq startet neu …"
              : update.total
                ? `${formatBytes(update.received)} von ${formatBytes(update.total)} geladen`
                : "wird geladen …"}
          </span>
        </div>
      )}
    </div>
  );
}

/** The update part of the settings: version, a manual check, and the result. */
export function UpdateCheck() {
  const update = useUpdate();
  const busy = update.phase === "checking" || update.phase === "downloading" || update.phase === "restarting";
  const line =
    update.phase === "checking"
      ? "Sucht nach Updates …"
      : update.phase === "current"
        ? "Diese Version ist die neueste."
        : update.phase === "failed"
          ? `Suche fehlgeschlagen: ${update.message}`
          : update.phase === "available"
            ? `Version ${update.version} steht bereit.`
            : null;
  return (
    <div className="flex flex-col items-start gap-2">
      <UiButton variant="secondary" icon={RotateCw} disabled={busy} onPress={() => void checkForUpdate()}>
        Nach Updates suchen
      </UiButton>
      {line ? <span className={`text-xs ${update.phase === "failed" ? "text-danger" : "text-ink-soft"}`}>{line}</span> : null}
      <UpdateBand />
    </div>
  );
}
