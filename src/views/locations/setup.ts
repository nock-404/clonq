// Shared pieces of the add-location flow: what each kind hands to the sheet, and
// small hooks for calls that can fail, for the moment after adding, and for names.

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ClonqState } from "../../hooks/useClonq";
import { messageLabel, type Tone } from "../../lib/labels";
import type { Location } from "../../lib/types";
import type { UiLampState } from "../../ui/UiDriveFront";
import type { GlyphLamp } from "../../ui/UiLocationGlyph";
import { markChecked } from "./checks";
import { errorText, type SetupKind } from "./kinds";

/** A button along the bottom edge; Enter presses the primary one. */
export interface SetupAction {
  label: string;
  icon?: LucideIcon;
  run: () => void;
  disabled: boolean;
  /**
   * False for a confirmation that a habitual Enter must not give, e.g. that a
   * fingerprint matches: only a click or ⌘↵ presses it.
   */
  enter?: boolean;
}

/** What the drive front beside the form shows. */
export interface PlateState {
  /** Text on the label strip: the name the location will get. */
  name: string;
  lamp: GlyphLamp;
  /** The connection is proven: the tape runs through the head to the bay. */
  threaded: boolean;
  /** Nothing in the bay yet, e.g. no drive plugged in. */
  empty?: boolean;
  /** One state per panel lamp of the kind, in order. */
  steps: UiLampState[];
  status: string;
  tone: Tone;
}

/** What a kind's form hands to the sheet. */
export interface Setup {
  body: ReactNode;
  action: SetupAction;
  /** A second button left of the primary one, e.g. to stop waiting for the browser. */
  secondary?: SetupAction & { keys?: string[] };
  plate: PlateState;
  /** The user has typed or chosen something that closing would throw away. */
  dirty: boolean;
  /** A call runs; going back is blocked until it ends. */
  busy: boolean;
  /** Gives up waiting for a call that may take minutes; Escape does the same. */
  abandon?: () => void;
  /** One step back inside the form, e.g. from the fingerprints to the address; Escape does this before leaving the form. */
  back?: () => void;
  /** Arrow keys outside of fields, e.g. to move through a list of drives. */
  onArrow?: (step: 1 | -1) => void;
  /** Added to the question before closing, e.g. that a key already exists. */
  discardNote?: string;
  /** The location exists already; going back to the list makes no sense any more. */
  final?: boolean;
}

/** What every kind's form gets from the sheet. */
export interface SetupContext {
  state: ClonqState;
  /** This kind's form is the one on screen. */
  active: boolean;
  onAdded: (location: Location) => void;
  /** Closes the sheet and shows an existing location. */
  reveal: (locationId: string) => void;
  /** Moves to another kind's form. */
  switchKind: (kind: SetupKind) => void;
}

/** A panel lamp from what is known about its step. */
export function lampOf(step: { done: boolean; busy?: boolean; failed?: boolean; ready?: boolean }): UiLampState {
  if (step.busy) return "busy";
  if (step.done) return "done";
  if (step.failed) return "failed";
  return step.ready ? "active" : "off";
}

/**
 * Runs one backend call at a time and keeps its error, already in German.
 * `cancel` stops waiting: a result that arrives later is ignored.
 */
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  useEffect(
    () => () => {
      token.current += 1;
    },
    [],
  );
  const run = async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    token.current += 1;
    const mine = token.current;
    setBusy(true);
    setError(null);
    try {
      const result = await task();
      return token.current === mine ? result : undefined;
    } catch (problem) {
      if (token.current === mine) setError(messageLabel(errorText(problem)));
      return undefined;
    } finally {
      if (token.current === mine) setBusy(false);
    }
  };
  const cancel = () => {
    token.current += 1;
    setBusy(false);
  };
  return { busy, error, run, cancel, clear: () => setError(null) };
}

/** How long the drive front shows the new location threaded and lit before the sheet hands it on. */
const LINGER_MS = 1400;

/** Holds the new location for a moment, so the tape can be seen laid in, then hands it on. */
export function useAdded(onAdded: (location: Location) => void) {
  const [added, setAdded] = useState<Location | null>(null);
  const handler = useRef(onAdded);
  useEffect(() => {
    handler.current = onAdded;
  });
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => handler.current(added), LINGER_MS);
    return () => clearTimeout(timer);
  }, [added]);
  const done = (location: Location) => {
    markChecked(location.id);
    setAdded(location);
  };
  return { added, done };
}

/** A name field that follows a suggestion until the user types their own. */
export function useSuggestedName(suggestion: string) {
  const [custom, setCustom] = useState<string | null>(null);
  return { name: custom ?? suggestion, setName: setCustom, edited: custom !== null };
}
