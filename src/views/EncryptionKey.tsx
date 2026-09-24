import { Copy, Eye, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { UiButton, UiPanel } from "../ui";

/**
 * The password of an encrypted job. Without it the cloud copy cannot be opened, not even by
 * clonq once this Mac is gone, so it is shown on request and meant to be kept elsewhere.
 */
export function EncryptionKey({ jobId, shown = false }: { jobId: string; shown?: boolean }) {
  const t = useT().detail.encryption;
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const reveal = useCallback(
    () =>
      void api
        .encryptionKey(jobId)
        .then((value) => (value ? setPassword(value) : setFailed(true)))
        .catch(() => setFailed(true)),
    [jobId],
  );
  useEffect(() => {
    if (shown) reveal();
  }, [shown, reveal]);
  const copy = () => {
    if (!password) return;
    void navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <UiPanel title={t.title}>
      <div className="flex flex-col gap-2.5">
        <span className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
          <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
          {t.explain}
        </span>
        {password ? (
          <div className="flex items-center gap-2">
            <code className="rounded-[var(--radius-control)] bg-track px-2.5 py-1.5 font-mono text-[0.8125rem] tracking-wide text-ink select-all">{password}</code>
            <UiButton variant="ghost" icon={Copy} onPress={copy}>
              {copied ? t.copied : t.copy}
            </UiButton>
          </div>
        ) : failed ? (
          <span className="text-xs text-danger">{t.missing}</span>
        ) : (
          <div>
            <UiButton variant="secondary" icon={Eye} onPress={reveal}>
              {t.show}
            </UiButton>
          </div>
        )}
        {password ? <span className="text-[0.6875rem] leading-snug text-ink-faint">{t.rclone}</span> : null}
      </div>
    </UiPanel>
  );
}
