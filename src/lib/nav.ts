// Where the main window is and which sheet is open, shared by everything that navigates.

import { useSyncExternalStore } from "react";
import type { LocationKind } from "./types";

export type Section =
  | { kind: "overview" }
  | { kind: "job"; jobId: string }
  | { kind: "location"; locationId: string }
  | { kind: "history" }
  | { kind: "settings" };

export type Sheet =
  | { kind: "addLocation"; preset?: LocationKind["type"] }
  | { kind: "jobWizard"; jobId?: string }
  | null;

interface Nav {
  section: Section;
  sheet: Sheet;
}

let nav: Nav = { section: { kind: "overview" }, sheet: null };
const listeners = new Set<() => void>();

function set(change: Partial<Nav>) {
  nav = { ...nav, ...change };
  for (const listener of listeners) listener();
}

export const navigate = (section: Section) => set({ section });
export const openSheet = (sheet: Sheet) => set({ sheet });
export const closeSheet = () => set({ sheet: null });

export function useNav(): Nav {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => nav,
  );
}
