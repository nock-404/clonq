// Updates from the GitHub releases: looked for on start and every few hours, installed only on request.

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current"; checkedAt: number }
  | { phase: "available"; version: string; notes: string | null }
  | { phase: "downloading"; version: string; received: number; total: number | null }
  | { phase: "restarting"; version: string }
  | { phase: "failed"; message: string };

const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = { phase: "idle" };
let pending: Update | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdate(): UpdateState {
  return useSyncExternalStore(subscribe, () => state);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Asks GitHub for a newer release. Quiet on failure when `quiet`, so an offline Mac does not nag. */
export async function checkForUpdate(quiet = false) {
  if (state.phase === "checking" || state.phase === "downloading" || state.phase === "restarting") return;
  set({ phase: "checking" });
  try {
    const update = await check();
    pending = update;
    set(update ? { phase: "available", version: update.version, notes: update.body ?? null } : { phase: "current", checkedAt: Date.now() });
  } catch (error) {
    set(quiet ? { phase: "idle" } : { phase: "failed", message: messageOf(error) });
  }
}

/** Downloads the pending update, swaps the app and starts it again. */
export async function installUpdate() {
  const update = pending;
  if (!update) return;
  let received = 0;
  let total: number | null = null;
  set({ phase: "downloading", version: update.version, received, total });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? null;
      if (event.event === "Progress") received += event.data.chunkLength;
      set({ phase: "downloading", version: update.version, received, total });
    });
    set({ phase: "restarting", version: update.version });
    await relaunch();
  } catch (error) {
    set({ phase: "failed", message: messageOf(error) });
  }
}

/** Starts the automatic checks once per window. Development builds only check when asked. */
export function startUpdateChecks() {
  if (started || import.meta.env.DEV) return;
  started = true;
  setTimeout(() => void checkForUpdate(true), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdate(true), EVERY_MS);
}
