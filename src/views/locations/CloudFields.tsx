import type { ReactNode } from "react";
import type { CloudProviderInfo } from "../../lib/types";
import { UiField, UiInput } from "../../ui";
import { fieldWords, rootWords } from "./kinds";

interface CloudFieldsProps {
  provider: CloudProviderInfo;
  values: Record<string, string>;
  onValue: (key: string, value: string) => void;
  root: string;
  onRoot: (value: string) => void;
  disabled: boolean;
  /** Placed beside the start folder, e.g. the name field. */
  aside?: ReactNode;
}

/** The inputs a cloud provider asks for, in German, then where on it the location starts. */
export function CloudFields({ provider, values, onValue, root, onRoot, disabled, aside }: CloudFieldsProps) {
  const start = rootWords(provider.id);
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
      {provider.fields.map((field, index) => {
        const words = fieldWords(field);
        return (
          <div key={field.key} className={index === 0 && provider.fields.length % 2 === 1 ? "col-span-2" : undefined}>
            <UiField label={words.label} hint={words.hint}>
              <UiInput
                value={values[field.key] ?? ""}
                onChange={(value) => onValue(field.key, value)}
                type={field.secret ? "password" : "text"}
                placeholder={words.placeholder}
                mono={!field.secret}
                disabled={disabled}
              />
            </UiField>
          </div>
        );
      })}
      <div className={aside ? undefined : "col-span-2"}>
        <UiField label={start.label} hint={start.hint}>
          <UiInput value={root} onChange={onRoot} placeholder={start.placeholder} mono disabled={disabled} />
        </UiField>
      </div>
      {aside}
    </div>
  );
}
