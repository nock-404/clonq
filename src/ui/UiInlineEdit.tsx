import { Pencil } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { UiButton } from "./UiButton";
import { UiIconButton } from "./UiIconButton";
import { UiInput } from "./UiInput";
import { UiKbd } from "./UiKbd";
import { useT } from "../i18n";

interface UiInlineEditProps {
  value: string;
  /** Saves the new value; resolves to an error text, or null when it worked. */
  onSave: (value: string) => Promise<string | null>;
  /** Names the action, e.g. "Rename". */
  label: string;
  /** How the value looks while it is not being edited. */
  children: ReactNode;
  /** The shortcut that opens the field, shown next to the pencil; the owner binds it. */
  keys?: string[];
  /** Opens and closes the field from outside, e.g. from that shortcut. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

/** Shows a value with a pencil next to it; the pencil turns it into a field. Enter saves, Escape cancels. */
export function UiInlineEdit({ value, onSave, label, children, keys, editing, onEditingChange }: UiInlineEditProps) {
  const t = useT();
  const [ownEditing, setOwnEditing] = useState(false);
  const isEditing = editing ?? ownEditing;
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Every opening starts from the current value.
  const [wasEditing, setWasEditing] = useState(isEditing);
  if (isEditing !== wasEditing) {
    setWasEditing(isEditing);
    if (isEditing) {
      setDraft(value);
      setError(null);
    }
  }

  useEffect(() => {
    if (isEditing) input.current?.select();
  }, [isEditing]);

  const setEditing = (next: boolean) => {
    if (editing === undefined) setOwnEditing(next);
    onEditingChange?.(next);
  };

  const save = async () => {
    const next = draft.trim();
    if (next === value) return setEditing(false);
    setBusy(true);
    const problem = await onSave(next);
    setBusy(false);
    if (problem) setError(problem);
    else setEditing(false);
  };

  if (!isEditing) {
    return (
      <div className="group flex min-w-0 items-center gap-2">
        {children}
        <span className="flex items-center gap-1 opacity-45 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <UiIconButton icon={Pencil} label={label} onPress={() => setEditing(true)} />
          {keys ? <UiKbd keys={keys} /> : null}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <UiInput
            ref={input}
            value={draft}
            onChange={setDraft}
            disabled={busy}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void save();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
              }
            }}
          />
        </div>
        <UiButton variant="primary" keys={busy || draft.trim() === "" ? undefined : ["↵"]} disabled={busy || draft.trim() === ""} onPress={() => void save()}>
          {busy ? t.common.saving : t.common.save}
        </UiButton>
        <UiButton variant="ghost" keys={["esc"]} onPress={() => setEditing(false)}>
          {t.common.cancel}
        </UiButton>
      </div>
      {error ? <span className="text-[0.6875rem] text-danger">{error}</span> : null}
    </div>
  );
}
