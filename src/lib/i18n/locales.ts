/**
 * Supported locales — SPEC.md §73 (Internationalization).
 *
 * v1 ships de / en / uk / ru. The list is intentionally a typed union so
 * adding a locale later (ar, pl, fr, ...) is a matter of extending
 * `locales` + `localeMeta` + adding a data/<code>.ts dictionary — no
 * component or routing rewrite required.
 *
 * `dir` is tracked per locale now so RTL locales (e.g. `ar`) can be added
 * without an architecture change, even though no RTL locale ships in v1.
 */

export const LOCALE_COOKIE = "serviceos_locale";

export const locales = ["en", "de", "uk", "ru"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export type TextDirection = "ltr" | "rtl";

export interface LocaleMeta {
  code: Locale;
  /** English name, used in developer-facing contexts. */
  label: string;
  /** Name written in the language itself, shown in the language switcher. */
  nativeLabel: string;
  dir: TextDirection;
  /** BCP 47 tag used for Intl.* formatting. */
  bcp47: string;
}

export const localeMeta: Record<Locale, LocaleMeta> = {
  en: { code: "en", label: "English", nativeLabel: "English", dir: "ltr", bcp47: "en" },
  de: { code: "de", label: "German", nativeLabel: "Deutsch", dir: "ltr", bcp47: "de" },
  uk: { code: "uk", label: "Ukrainian", nativeLabel: "Українська", dir: "ltr", bcp47: "uk" },
  ru: { code: "ru", label: "Russian", nativeLabel: "Русский", dir: "ltr", bcp47: "ru" },
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : defaultLocale;
}
