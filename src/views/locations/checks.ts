// When this window last saw each location checked, and the result of cloud checks
// it ran itself (the backend only re-tests a cloud in its ten-minute round).

import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api";
import type { Location, Reach } from "../../lib/types";

interface OwnCheck {
  at: number;
  reach: Reach;
}

const checkedAt = new Map<string, number>();
const own = new Map<string, OwnCheck>();
/** The last background round over servers and clouds. */
let backgroundAt: number | null = null;
let revision = 0;
const listeners = new Set<() => void>();
let listening = false;

function changed() {
  revision += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function listen() {
  if (listening) return;
  listening = true;
  void api.onServersChecked(() => {
    backgroundAt = Date.now();
    changed();
  });
}

/** Servers and clouds are tested by the backend every ten minutes; the rest is looked at live. */
export function checkedInBackground(location: Location): boolean {
  return location.kind.type === "ssh" || location.kind.type === "cloud";
}

export function markChecked(id: string) {
  checkedAt.set(id, Date.now());
  changed();
}

/** A check this window ran itself; it counts until the next background round reports. */
export function recordOwnCheck(id: string, reach: Reach) {
  const at = Date.now();
  own.set(id, { at, reach });
  checkedAt.set(id, at);
  changed();
}

/** When the location was last checked, as far as this window knows, and the freshest reach. */
export function useCheck(location: Location, reach: Reach | undefined): { at: number | null; reach: Reach | undefined } {
  useEffect(listen, []);
  useSyncExternalStore(subscribe, () => revision);
  const mine = checkedAt.get(location.id) ?? 0;
  const background = checkedInBackground(location) ? (backgroundAt ?? 0) : 0;
  const at = Math.max(mine, background) || null;
  const ownCheck = own.get(location.id);
  const fresh = ownCheck && ownCheck.at > background ? ownCheck.reach : reach;
  return { at, reach: fresh };
}

/** Starts listening for the background rounds as soon as the flow is loaded. */
listen();
