import { en } from "./data/en";
import { de } from "./data/de";
import { uk } from "./data/uk";
import { ru } from "./data/ru";
import { defaultLocale, type Locale } from "./locales";

/**
 * The shape of every locale dictionary, derived from the English source of
 * truth (data/en.ts). Adding a key there and forgetting it in data/de.ts
 * etc. is a type error, not a silent missing string in the UI.
 */
export type Messages = typeof en;

const dictionaries: Record<Locale, Messages> = { en, de, uk, ru };

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}

export {
  locales,
  defaultLocale,
  localeMeta,
  isLocale,
  resolveLocale,
  LOCALE_COOKIE,
  type TextDirection,
  type LocaleMeta,
} from "./locales";
export type { Locale } from "./locales";
