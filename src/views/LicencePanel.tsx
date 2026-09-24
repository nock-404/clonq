import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { formatDay } from "../lib/format";
import { messageLabel } from "../lib/labels";
import type { LicenceStatus } from "../lib/types";
import { UiButton, UiInput, UiNotice, UiPanel } from "../ui";
import { UiLinkButton } from "../ui/UiLinkButton";

function errorText(reason: unknown): string {
  return messageLabel(reason instanceof Error ? reason.message : String(reason));
}

/** Settings → Licence: the state of clonq Pro and the place to paste a key ("Enter licence"). */
export function LicencePanel() {
  const t = useT().shell.licence;
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const [entering, setEntering] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api.licenceStatus().then(setStatus).catch(() => setStatus({ state: "none" }));
  }, []);

  const activate = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      setStatus(await api.enterLicence(key));
      setEntering(false);
      setKey("");
    } catch (reason) {
      setProblem(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const until = (date: string | null) => (date ? t.updatesUntil(formatDay(date)) : t.updatesForGood);

  const line =
    status === null
      ? t.reading
      : status.state === "active"
        ? `${t.active(status.email)} ${until(status.updatesUntil)}`
        : status.state === "notCovered"
          ? t.notCovered(status.updatesUntil ? formatDay(status.updatesUntil) : "", formatDay(status.released))
          : status.state === "revoked"
            ? t.revoked
            : status.state === "unchecked"
              ? t.unchecked
              : t.none;

  return (
    <UiPanel title={t.title}>
      <div className="flex flex-col gap-3">
        <span className="text-xs text-ink-soft">{line}</span>
        {status?.state === "active" ? (
          <div>
            <UiLinkButton onPress={() => void api.removeLicence().then(setStatus)}>{t.remove}</UiLinkButton>
          </div>
        ) : entering ? (
          <div className="flex flex-col gap-2">
            <UiInput value={key} onChange={setKey} placeholder="CLONQ1-…" mono autoFocus onKeyDown={(event) => event.key === "Enter" && void activate()} />
            <div className="flex gap-2">
              <UiButton variant="primary" icon={KeyRound} disabled={!key.trim() || busy} onPress={() => void activate()}>
                {busy ? t.checking : t.activate}
              </UiButton>
              <UiButton variant="ghost" onPress={() => setEntering(false)}>
                {t.cancel}
              </UiButton>
            </div>
            {problem ? <UiNotice tone="danger">{problem}</UiNotice> : null}
          </div>
        ) : (
          <div>
            <UiButton variant="secondary" icon={KeyRound} onPress={() => setEntering(true)}>
              {t.enter}
            </UiButton>
          </div>
        )}
      </div>
    </UiPanel>
  );
}
