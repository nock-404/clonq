import { UiSwitch } from "./UiSwitch";

interface UiToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** A switch with its name beside it; the name can be clicked too. Nothing else belongs inside. */
export function UiToggle({ label, checked, onChange }: UiToggleProps) {
  return (
    <label className="inline-flex shrink-0 items-center gap-2">
      <UiSwitch checked={checked} onChange={onChange} label={label} />
      <span className={`text-xs font-medium ${checked ? "text-ink-soft" : "text-ink-faint"}`}>{label}</span>
    </label>
  );
}
