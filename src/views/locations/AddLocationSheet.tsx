import type { Location, LocationKind } from "../../lib/types";
import { UiSheet } from "../../ui";

// Placeholder; the full flow replaces this file.

interface AddLocationSheetProps {
  open: boolean;
  preset?: LocationKind["type"];
  onClose: () => void;
  onAdded: (location: Location) => void;
}

export function AddLocationSheet({ open, onClose }: AddLocationSheetProps) {
  return (
    <UiSheet open={open} title="Ort hinzufügen" onClose={onClose}>
      <span className="text-xs text-ink-faint">…</span>
    </UiSheet>
  );
}
