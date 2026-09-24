import { ArrowLeft, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useClonq } from "../../hooks/useClonq";
import { useT } from "../../i18n";
import { navigate } from "../../lib/nav";
import type { Location, LocationKind } from "../../lib/types";
import { UiButton, UiChoiceCard, UiKbd, UiSheet, UiText } from "../../ui";
import { UiDriveFront } from "../../ui/UiDriveFront";
import { UiLocationGlyph } from "../../ui/UiLocationGlyph";
import { useCloudSetup } from "./CloudSetup";
import { useFolderSetup } from "./FolderSetup";
import { KIND_ORDER, kindInfo, kinds, type KindInfo, type SetupKind } from "./kinds";
import { useServerSetup } from "./ServerSetup";
import type { Setup, SetupAction, SetupContext } from "./setup";
import { useSmbSetup } from "./SmbSetup";
import { newDrives, useVolumeSetup } from "./VolumeSetup";

interface AddLocationSheetProps {
  open: boolean;
  preset?: LocationKind["type"];
  onClose: () => void;
  onAdded: (location: Location) => void;
}

/** "Add location": pick a kind, then fill in what that kind needs. Every opening starts fresh. */
export function AddLocationSheet({ open, preset, onClose, onAdded }: AddLocationSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((count) => count + 1);
  }
  // A call that ends after the sheet was closed must not act on whatever is open by then.
  const isOpen = useRef(open);
  useEffect(() => {
    isOpen.current = open;
  });
  const handOn = (location: Location) => {
    if (isOpen.current) onAdded(location);
  };
  return <AddLocationFlow key={session} open={open} preset={preset} onClose={onClose} onAdded={handOn} />;
}

const indexOf = (kind: SetupKind) => Math.max(0, KIND_ORDER.indexOf(kind));

function AddLocationFlow({ open, preset, onClose, onAdded }: AddLocationSheetProps) {
  const state = useClonq();
  const t = useT();
  const tl = t.locations.sheet;
  const kindList = kinds();
  const [kind, setKind] = useState<SetupKind | null>(preset ?? null);
  const [highlight, setHighlight] = useState(() => indexOf(preset ?? "folder"));
  // The drive front follows the mouse while it rests on a card, the selection follows the keyboard.
  const [hovered, setHovered] = useState<number | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const choose = (next: SetupKind) => {
    setKind(next);
    setHighlight(indexOf(next));
    setHovered(null);
    setDiscarding(false);
  };
  const reveal = (locationId: string) => {
    onClose();
    navigate({ kind: "location", locationId });
  };
  const context = (own: SetupKind): SetupContext => ({ state, active: kind === own, onAdded, reveal, switchKind: choose });

  // Every kind keeps its own form, so going back and forth loses nothing.
  const setups: Record<SetupKind, Setup> = {
    folder: useFolderSetup(context("folder")),
    volume: useVolumeSetup(context("volume")),
    ssh: useServerSetup(context("ssh")),
    smb: useSmbSetup(context("smb")),
    cloud: useCloudSetup(context("cloud"), "cloud"),
    webdav: useCloudSetup(context("webdav"), "webdav"),
  };
  const setup = kind ? setups[kind] : null;
  const all = Object.values(setups);
  const finished = all.some((item) => item.final);
  const dirty = all.some((item) => item.dirty) && !finished;
  const running = all.some((item) => item.busy);
  const notes = all.flatMap((item) => (item.dirty && item.discardNote ? [item.discardNote] : []));
  const canGoBack = setup !== null && !setup.busy && !setup.final;

  const shown = kindList[hovered ?? highlight] ?? (kindList[0] as KindInfo);
  const info = kind ? kindInfo(kind) : null;
  const highlighted = kindList[highlight] ?? (kindList[0] as KindInfo);
  const action: SetupAction = setup?.action ?? { label: tl.next, icon: ArrowRight, run: () => choose(highlighted.kind), disabled: false };

  const back = () => {
    if (!canGoBack) return;
    setKind(null);
    setDiscarding(false);
  };
  const requestClose = () => {
    if (dirty && !discarding) setDiscarding(true);
    else onClose();
  };

  // The sheet listens before everything else in the window, so the view underneath never
  // sees these keys: Enter presses the primary button, Escape steps back one level.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const field = target instanceof HTMLInputElement ? target : null;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (discarding) setDiscarding(false);
      else if (setup?.abandon) setup.abandon();
      else if (setup?.back) setup.back();
      else if (setup && !setup.final) back();
      else requestClose();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
      if (target?.closest("[data-own-enter]")) return;
      event.stopPropagation();
      // A focused button keeps its own Enter.
      if (target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (discarding) onClose();
      else if (!action.disabled && action.enter !== false) action.run();
      return;
    }
    // A confirmation that plain Enter must not give takes ⌘↵ instead.
    if (event.key === "Enter" && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.isComposing && action.enter === false) {
      event.preventDefault();
      event.stopPropagation();
      if (!discarding && !action.disabled) action.run();
      return;
    }
    if (discarding) return;
    if (event.key === "ArrowLeft" && event.metaKey) {
      if (field && field.value !== "") return;
      event.preventDefault();
      event.stopPropagation();
      back();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || field) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      event.preventDefault();
      event.stopPropagation();
      if (setup) {
        setup.onArrow?.(step);
      } else {
        setHighlight((index) => (index + step + kindList.length) % kindList.length);
        setHovered(null);
      }
      return;
    }
    const digit = Number(event.key);
    if (!setup && Number.isInteger(digit) && digit >= 1 && digit <= kindList.length) {
      event.preventDefault();
      choose((kindList[digit - 1] as KindInfo).kind);
    }
  });

  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [open]);

  const drives = newDrives(state);
  const footer = discarding ? (
    <>
      <span className="min-w-0 flex-1">
        <UiText variant="caption" tone="neutral">
          {[tl.discardLost, ...notes, running ? tl.discardRunning : ""].filter(Boolean).join(" ")}
        </UiText>
      </span>
      <UiButton variant="ghost" keys={["esc"]} onPress={() => setDiscarding(false)}>
        {tl.keepEditing}
      </UiButton>
      <UiButton variant="danger" keys={["↵"]} onPress={onClose}>
        {tl.discard}
      </UiButton>
    </>
  ) : (
    <>
      {setup ? (
        setup.final ? null : (
          <UiButton variant="ghost" icon={ArrowLeft} keys={canGoBack ? ["⌘", "←"] : undefined} disabled={!canGoBack} onPress={back}>
            {tl.back}
          </UiButton>
        )
      ) : (
        <UiButton variant="ghost" keys={["esc"]} onPress={requestClose}>
          {t.common.cancel}
        </UiButton>
      )}
      <span className="flex-1" />
      {setup?.secondary ? (
        <UiButton variant="ghost" keys={setup.secondary.disabled ? undefined : setup.secondary.keys} disabled={setup.secondary.disabled} onPress={setup.secondary.run}>
          {setup.secondary.label}
        </UiButton>
      ) : null}
      <UiButton variant="primary" icon={action.icon} keys={action.disabled ? undefined : action.enter === false ? ["⌘", "↵"] : ["↵"]} disabled={action.disabled} onPress={action.run}>
        {action.label}
      </UiButton>
    </>
  );

  return (
    <UiSheet open={open} title={tl.title} subtitle={info ? info.title : tl.question} onClose={requestClose} footer={footer}>
      {/* One height for every kind and step, so the sheet does not jump. */}
      <div className="grid h-[24rem] grid-cols-[minmax(0,1fr)_15rem] gap-5">
        <motion.div
          key={`form-${kind ?? "list"}`}
          initial={{ opacity: 0, x: kind ? 8 : -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.16 }}
          className="-m-1 min-h-0 overflow-y-auto p-1"
        >
          {setup ? (
            setup.body
          ) : (
            <div role="radiogroup" aria-label={tl.kindGroup} className="flex flex-col gap-1.5">
              {kindList.map((item, index) => (
                <div key={item.kind} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}>
                  <UiChoiceCard
                    art={<UiLocationGlyph kind={item.kind} size="md" />}
                    title={item.title}
                    description={item.kind === "volume" && drives.length > 0 ? tl.connectedDrives(drives.map((drive) => drive.name).join(", ")) : item.short}
                    selected={index === highlight}
                    onPress={() => choose(item.kind)}
                    aside={<UiKbd keys={[String(index + 1)]} />}
                  />
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {setup && info ? (
          <UiDriveFront
            key={`plate-${info.kind}`}
            kind={setup.plate.empty ? null : info.kind}
            label={setup.plate.name.trim()}
            placeholder={tl.unnamed}
            lamp={setup.plate.lamp}
            threaded={setup.plate.threaded}
            pulse={setup.final ? "added" : "open"}
            lamps={info.lamps.map((word, index) => ({ key: String(index), label: word, state: setup.plate.steps[index] ?? "off" }))}
            sequence
            status={setup.plate.status}
            statusTone={setup.plate.tone}
            fill
          />
        ) : (
          <UiDriveFront key="plate-list" kind={shown.kind} label={shown.title} lamp="off" threaded={false} status={shown.needs} fill>
            <UiText variant="caption" tone="neutral">
              {shown.long}
            </UiText>
          </UiDriveFront>
        )}
      </div>
    </UiSheet>
  );
}
