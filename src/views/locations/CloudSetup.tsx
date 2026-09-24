import { Check, ExternalLink, Plug, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { api } from "../../lib/api";
import type { CloudProvider, CloudProviderInfo } from "../../lib/types";
import { UiButton, UiNotice, UiProgressBar, UiSegmented, UiText } from "../../ui";
import { CloudFields } from "./CloudFields";
import { nameTaken, sameCloud } from "./duplicates";
import { providerLabel, providerShort } from "./kinds";
import { ExistingNotice, NameField } from "./parts";
import { lampOf, useAdded, useSuggestedName, useTask, type Setup, type SetupAction, type SetupContext } from "./setup";

/** rclone gives the browser sign-in five minutes (src-tauri/src/cloud.rs). */
export const SIGN_IN_SECONDS = 300;

const NO_VALUES: Record<string, string> = {};

/** The current time, ticking every second while `active`. */
export function useSeconds(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** "4:05" */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A name for a cloud location from what was typed: the bucket, the server of a WebDAV address, or the provider. */
function suggestName(provider: CloudProviderInfo | undefined, values: Record<string, string>, root: string): string {
  if (!provider) return "";
  if (provider.id === "webdav") {
    try {
      return new URL((values.url ?? "").trim()).hostname || "WebDAV";
    } catch {
      return "WebDAV";
    }
  }
  const first = root.trim().replace(/^\/+/, "").split("/")[0] ?? "";
  if ((provider.id === "s3" || provider.id === "b2") && first) return first;
  return providerShort[provider.id];
}

/**
 * Cloud storage through rclone. "cloud" offers every provider but WebDAV;
 * "webdav" is WebDAV alone. Browser-login providers open the browser and the
 * call returns once the account is connected; the backend tests the access and
 * saves only when that works.
 */
export function useCloudSetup(context: SetupContext, mode: "cloud" | "webdav"): Setup {
  const t = useT();
  const tc = t.locations.cloud;
  const tw = t.locations.flow;
  const config = context.state.config;
  const [providers, setProviders] = useState<CloudProviderInfo[] | null>(null);
  const load = useTask();
  const [picked, setPicked] = useState<CloudProvider | null>(mode === "webdav" ? "webdav" : null);
  const [values, setValues] = useState(NO_VALUES);
  const [root, setRoot] = useState("");
  const add = useTask();
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const { added, done } = useAdded(context.onAdded);

  const fetchProviders = () =>
    void load.run(api.cloudProviders).then((list) => {
      if (list) setProviders(list);
    });

  // Loads the first time this kind is shown; after a failure only the button tries again.
  useEffect(() => {
    if (context.active && providers === null) fetchProviders();
  }, [context.active, providers]);

  const choices = (providers ?? []).filter((item) => (mode === "webdav" ? item.id === "webdav" : item.id !== "webdav"));
  const provider = choices.find((item) => item.id === picked) ?? choices[0];
  const { name, setName, edited } = useSuggestedName(suggestName(provider, values, root));
  const missing = (provider?.fields ?? []).some((field) => field.required && (values[field.key] ?? "").trim() === "");
  const taken = add.busy || added ? undefined : nameTaken(config, name);
  const existing = provider && !add.busy && !added ? sameCloud(config, provider.id, root) : undefined;
  const ready = provider !== undefined && !missing && name.trim() !== "" && !taken;
  const waiting = add.busy && waitingSince !== null;
  const now = useSeconds(waiting);
  const left = waitingSince === null ? SIGN_IN_SECONDS : Math.min(SIGN_IN_SECONDS, SIGN_IN_SECONDS - (now - waitingSince) / 1000);
  const label = provider ? providerLabel[provider.id] : "";

  const submit = async () => {
    if (!provider || !ready) return;
    const fields = Object.fromEntries(provider.fields.map((field) => [field.key, (values[field.key] ?? "").trim()]));
    const started = Date.now();
    setWaitingSince(provider.browserLogin ? started : null);
    const location = await add.run(() => api.addCloudLocation(name.trim(), provider.id, fields, root.trim()));
    // A sign-in that was given up and started again keeps its own clock.
    setWaitingSince((current) => (current === started ? null : current));
    if (location) done(location);
  };

  const abandon = () => {
    add.cancel();
    setWaitingSince(null);
  };

  const locked = add.busy || !!added;
  const body = waiting ? (
    <div className="flex flex-col gap-3 pt-1">
      <UiText variant="heading">{tc.signInTitle(label)}</UiText>
      <UiText tone="neutral">
        {tw.signInOpen(label)} {tc.signInAllow}
      </UiText>
      <div className="flex flex-col gap-1.5 pt-1">
        <UiProgressBar value={(left / SIGN_IN_SECONDS) * 100} />
        <UiText variant="caption" tone="neutral">
          {tw.signInClock(formatClock(left))}
        </UiText>
      </div>
      <UiText variant="caption" tone="neutral">
        {tc.signInCancel}
      </UiText>
    </div>
  ) : (
    <div className="flex flex-col gap-3.5">
      {load.error ? (
        <UiNotice
          tone="danger"
          actions={
            <UiButton icon={RotateCw} onPress={fetchProviders} disabled={load.busy}>
              {tw.reload}
            </UiButton>
          }
        >
          {tc.providersFailed(load.error)}
        </UiNotice>
      ) : null}
      {providers === null && !load.error ? (
        <UiText variant="caption" tone="neutral">
          {tc.loadingProviders}
        </UiText>
      ) : null}
      {mode === "cloud" && provider ? (
        <div className="flex flex-col gap-2">
          <UiSegmented
            label={tc.providerGroup}
            value={provider.id}
            segments={choices.map((item) => ({ value: item.id, label: providerShort[item.id] }))}
            onChange={(id) => {
              if (locked) return;
              setPicked(id);
              setName(null);
              add.clear();
            }}
          />
          <UiText variant="caption" tone="neutral">
            {label} · {provider.browserLogin ? tc.browserLogin : tc.keyLogin}
          </UiText>
        </div>
      ) : null}
      {provider ? (
        <CloudFields
          provider={provider}
          values={values}
          onValue={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          root={root}
          onRoot={setRoot}
          disabled={locked}
          aside={<NameField value={name} onChange={setName} taken={taken} hint={tc.nameHint} disabled={locked} />}
        />
      ) : null}
      {existing ? (
        <ExistingNotice subject={tc.subject} location={existing} onOpen={() => context.reveal(existing.id)} soft>
          {" "}
          {tc.otherAccount}
        </ExistingNotice>
      ) : null}
      {add.error ? (
        <UiNotice tone="danger">{add.error}</UiNotice>
      ) : provider ? (
        <UiText variant="caption" tone="neutral">
          {provider.browserLogin
            ? tc.browserHint(label)
            : tc.keyHint}
        </UiText>
      ) : null}
    </div>
  );

  const plate = {
    name: provider ? name : "",
    lamp: added ? ("on" as const) : add.busy ? ("busy" as const) : add.error ? ("fault" as const) : ("off" as const),
    threaded: added !== null,
    empty: provider === undefined,
    steps: [
      lampOf({ done: provider !== undefined && !missing, ready: provider !== undefined }),
      lampOf({ done: !!added, busy: add.busy, failed: !!add.error, ready }),
      lampOf({ done: !!added, ready: false }),
    ],
    status: added
      ? tw.added
      : waiting
        ? tc.waitingBrowser
        : add.busy
          ? tw.checkingAccess
          : add.error
            ? tc.noAccess
            : providers === null
              ? load.error
                ? tc.providersNotLoaded
                : tc.loadingProviders
              : ready
                ? tw.readyToConnect
                : tw.notConnected,
    tone: added ? ("ok" as const) : add.error || load.error ? ("danger" as const) : ("neutral" as const),
  };

  let action: SetupAction;
  if (added) {
    action = { label: tw.added, icon: Check, run: () => {}, disabled: true };
  } else if (provider?.browserLogin) {
    action = { label: waiting ? tc.signingIn : tw.signInBrowser, icon: waiting ? undefined : ExternalLink, run: () => void submit(), disabled: add.busy || !ready };
  } else {
    action = { label: add.busy ? tw.checkingAccess : tw.connectAndAdd, icon: add.busy ? undefined : Plug, run: () => void submit(), disabled: add.busy || !ready };
  }

  return {
    body,
    action,
    secondary: waiting ? { label: t.common.cancel, keys: ["esc"], run: abandon, disabled: false } : undefined,
    plate,
    dirty: Object.values(values).some((value) => value.trim() !== "") || root.trim() !== "" || edited || (mode === "cloud" && picked !== null),
    busy: add.busy || load.busy,
    abandon: waiting ? abandon : undefined,
    final: added !== null,
  };
}
