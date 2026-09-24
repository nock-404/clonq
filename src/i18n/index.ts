// Translations. English is the source: every text is written in src/i18n/en first,
// every other language mirrors its shape exactly (the type below enforces that).
//
// A text is either a string or a function that builds the sentence from values,
// so each language can handle plurals and word order its own way:
//   en: files: (n: number) => (n === 1 ? "1 file" : `${n} files`)
//
// Adding a language: copy src/i18n/en to src/i18n/<code>, translate, add it to
// CATALOGS and LANGUAGES below, and add the code to Language in src/lib/types.ts.

import { useSyncExternalStore } from "react";
import type { Language } from "../lib/types";
import { de } from "./de";
import { en } from "./en";

/** The shape every language must have: same keys, same function signatures. */
export type Shape<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends (...args: infer A) => string ? (...args: A) => string : Shape<T[K]>;
};

export type Catalog = Shape<typeof en>;
export type Lang = Exclude<Language, "system">;

const CATALOGS: Record<Lang, Catalog> = { en, de };

/** Offered in the settings, each in its own language. */
export const LANGUAGES: { code: Lang; name: string; locale: string }[] = [
  { code: "en", name: "English", locale: "en-US" },
  { code: "de", name: "Deutsch", locale: "de-DE" },
];

function systemLang(): Lang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.toLowerCase().split("-")[0];
    const found = LANGUAGES.find((lang) => lang.code === code);
    if (found) return found.code;
  }
  return "en";
}

let setting: Language = "system";
let lang: Lang = systemLang();
const listeners = new Set<() => void>();

/** Called by the store whenever the config arrives or changes. */
export function setLanguage(next: Language) {
  setting = next;
  const resolved = next === "system" ? systemLang() : next;
  if (resolved === lang) return;
  lang = resolved;
  document.documentElement.lang = resolved;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The texts of the current language, for code outside React (formatting, labels). */
export function texts(): Catalog {
  return CATALOGS[lang] ?? en;
}

/** The BCP 47 locale for Intl number and date formatting. */
export function locale(): string {
  const tag = navigator.language;
  if (tag.toLowerCase().startsWith(lang)) return tag;
  return LANGUAGES.find((item) => item.code === lang)?.locale ?? "en-US";
}

export function currentLang(): Lang {
  return lang;
}

export function currentSetting(): Language {
  return setting;
}

/** The texts of the current language; the component renders again when it changes. */
export function useT(): Catalog {
  return useSyncExternalStore(subscribe, texts);
}
