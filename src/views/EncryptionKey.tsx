import { Copy, Eye, EyeOff, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { messageLabel } from "../lib/labels";
import { UiButton, UiPanel } from "../ui";

/**
 * The password of an encrypted job. Without it the cloud copy cannot be opened, not even by
 * clonq once this Mac is gone, so it is shown on request and meant to be kept elsewhere.
 */
export function EncryptionKey({ jobId, shown = false }: { jobId: string; shown?: boolean }) {
  const t = useT().detail.encryption;
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  // "missing": the job has no password on this Mac; any other text: reading it failed.
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reveal = useCallback(() => {
    setProblem(null);
    void api
      .encryptionKey(jobId)
      .then((value) => (value ? setPassword(value) : setProblem("missing")))
      .catch((reason: unknown) => setProblem(messageLabel(reason instanceof Error ? reason.message : String(reason))));
  }, [jobId]);
  useEffect(() => {
    if (shown) reveal();
  }, [shown, reveal]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    if (!password) return;
    const done = (state: "yes" | "failed") => {
      setCopied(state);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    };
    navigator.clipboard.writeText(password).then(() => done("yes"), () => done("failed"));
  };
  return (
    <UiPanel title={t.title}>
      <div className="flex flex-col gap-2.5">
        <span className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
          <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
          {t.explain}
        </span>
        {password ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-[var(--radius-control)] bg-track px-2.5 py-1.5 font-mono text-[0.8125rem] tracking-wide text-ink select-all">{password}</code>
            <UiButton variant="ghost" icon={Copy} onPress={copy}>
              {copied === "yes" ? t.copied : copied === "failed" ? t.copyFailed : t.copy}
            </UiButton>
            <UiButton variant="ghost" icon={EyeOff} onPress={() => setPassword(null)}>
              {t.hide}
            </UiButton>
          </div>
        ) : (
          <div>
            <UiButton variant="secondary" icon={Eye} onPress={reveal}>
              {t.show}
            </UiButton>
          </div>
        )}
        {problem ? <span className="text-xs text-danger">{problem === "missing" ? t.missing : t.readFailed(problem)}</span> : null}
        {password ? <span className="text-[0.6875rem] leading-snug text-ink-faint">{t.rclone}</span> : null}
      </div>
    </UiPanel>
  );
}
