import { localeMeta, type Locale } from "./locales";

/**
 * Locale-aware formatting — SPEC.md §73/§74. Built on Intl so it works
 * identically in the Next.js web app and later in React Native (Hermes
 * ships Intl support), without a formatting library dependency.
 */

function bcp47(locale: Locale): string {
  return localeMeta[locale].bcp47;
}

export function formatDate(
  date: Date | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
): string {
  return new Intl.DateTimeFormat(bcp47(locale), options).format(date);
}

export function formatTime(
  date: Date | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(bcp47(locale), options).format(date);
}

export function formatDateTime(
  date: Date | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(bcp47(locale), options).format(date);
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(bcp47(locale), options).format(value);
}

/**
 * `currency` is always explicit (workspace/business setting, §74 — EUR by
 * default for DACH) — never inferred from the interface locale, since the
 * two are independent (a German-language UI can display USD revenue).
 */
export function formatCurrency(
  value: number,
  currency: string,
  locale: Locale,
  options?: Omit<Intl.NumberFormatOptions, "style" | "currency">,
): string {
  return new Intl.NumberFormat(bcp47(locale), {
    currencyDisplay: "narrowSymbol",
    ...options,
    style: "currency",
    currency,
  }).format(value);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: Locale,
  options?: Intl.RelativeTimeFormatOptions,
): string {
  return new Intl.RelativeTimeFormat(bcp47(locale), options).format(value, unit);
}
