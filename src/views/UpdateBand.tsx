import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, RotateCw } from "lucide-react";
import { formatDate } from "../lib/format";
import { useT } from "../i18n";
import { formatBytes } from "../lib/format";
import { checkForUpdate, installUpdate, useUpdate } from "../lib/update";
import { UiButton, UiProgressBar } from "../ui";
import { UiLogo } from "../ui/UiLogo";

/** A newer clonq is out: a small band with one button. Invisible while there is nothing to install. */
export function UpdateBand({ detailed = false }: { detailed?: boolean }) {
  const update = useUpdate();
  const t = useT().shell.update;
  if (update.phase !== "available" && update.phase !== "downloading" && update.phase !== "restarting") return null;
  const percent = update.phase === "downloading" && update.total ? (update.received / update.total) * 100 : null;
  return (
    <div className="hairline flex flex-col gap-2 rounded-[var(--radius-panel)] bg-accent-soft px-3 py-2.5">
      <div className="flex items-center gap-2">
        <UiLogo variant="mark" size="xs" />
        <span className="text-xs font-medium text-ink">{t.available(update.version)}</span>
      </div>
      {update.phase === "available" && !update.cover.covered ? (
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-[0.6875rem] leading-snug text-warn">{detailed ? t.notCovered(update.cover.updatesUntil ? formatDate(update.cover.updatesUntil) : "") : t.notCoveredShort}</span>
          <div className="flex flex-wrap gap-2">
            {update.cover.renewUrl ? (
              <UiButton variant="primary" onPress={() => void openUrl(update.cover.renewUrl ?? "")}>
                {t.renew}
              </UiButton>
            ) : null}
            <UiButton variant="secondary" icon={Download} onPress={() => void installUpdate()}>
              {t.installAnyway}
            </UiButton>
          </div>
        </div>
      ) : update.phase === "available" ? (
        <div className="flex flex-col items-start gap-1">
          <UiButton variant="primary" icon={Download} onPress={() => void installUpdate()}>
            {t.install}
          </UiButton>
          <span className="text-[0.6875rem] text-ink-soft">{t.restartsAfter}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <UiProgressBar value={update.phase === "restarting" ? 100 : percent} />
          <span className="text-[0.6875rem] text-ink-soft tabular">
            {update.phase === "restarting"
              ? t.restarting
              : update.total
                ? t.loaded(formatBytes(update.received), formatBytes(update.total))
                : t.loading}
          </span>
        </div>
      )}
    </div>
  );
}

/** The update part of the settings: version, a manual check, and the result. */
export function UpdateCheck() {
  const update = useUpdate();
  const t = useT().shell.update;
  const busy = update.phase === "checking" || update.phase === "downloading" || update.phase === "restarting";
  const line =
    update.phase === "checking"
      ? t.checking
      : update.phase === "current"
        ? t.current
        : update.phase === "failed"
          ? t.failed(update.message)
          : update.phase === "available"
            ? t.ready(update.version)
            : null;
  return (
    <div className="flex flex-col items-start gap-2">
      <UiButton variant="secondary" icon={RotateCw} disabled={busy} onPress={() => void checkForUpdate()}>
        {t.check}
      </UiButton>
      {line ? <span className={`text-xs ${update.phase === "failed" ? "text-danger" : "text-ink-soft"}`}>{line}</span> : null}
      <UpdateBand detailed />
    </div>
  );
}
