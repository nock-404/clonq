// Small pieces every kind's form uses.

import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Location } from "../../lib/types";
import { UiButton, UiField, UiInput, UiNotice } from "../../ui";

interface NameFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Another location that already has this name. */
  taken: Location | undefined;
  hint: string;
  disabled?: boolean;
}

/** The name the location gets in clonq; a name that is already used is refused. */
export function NameField({ value, onChange, taken, hint, disabled = false }: NameFieldProps) {
  return (
    <UiField label="Name" error={taken ? "Einen Ort mit diesem Namen gibt es schon." : null} hint={hint}>
      <UiInput value={value} onChange={onChange} placeholder="Name des Ortes" disabled={disabled} />
    </UiField>
  );
}

interface ExistingNoticeProps {
  /** What is there twice, e.g. "Dieser Ordner". */
  subject: string;
  location: Location;
  onOpen: () => void;
  /** Warn only, e.g. when it may still be another account. */
  soft?: boolean;
  children?: ReactNode;
}

/** Stops the user before the same place is added twice, with a way to the location that exists. */
export function ExistingNotice({ subject, location, onOpen, soft = false, children }: ExistingNoticeProps) {
  return (
    <UiNotice
      tone={soft ? "neutral" : "warn"}
      actions={
        <UiButton variant="secondary" icon={ArrowUpRight} onPress={onOpen}>
          „{location.name}“ öffnen
        </UiButton>
      }
    >
      {subject} ist schon als Ort „{location.name}“ angelegt.
      {children}
    </UiNotice>
  );
}
