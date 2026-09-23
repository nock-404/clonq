// A short confirmation after something happened to a job, e.g. "deleted, undo?". It outlives the
// view that raised it, so it is kept here and shown by the job wizard, which is always mounted.

import { useSyncExternalStore } from "react";
import type { UiToastMessage } from "../../ui/UiToast";

let current: UiToastMessage | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function showJobToast(message: Omit<UiToastMessage, "id">) {
  counter += 1;
  current = { ...message, id: counter };
  emit();
}

export function hideJobToast() {
  current = null;
  emit();
}

export function useJobToast(): UiToastMessage | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
