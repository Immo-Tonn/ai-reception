import type { Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";

const supported: Locale[] = ["de", "en", "uk", "ru"];

/** Unknown/missing locale falls back to English — never throws. */
export function resolveLocale(locale: string | undefined): Locale {
  return supported.includes(locale as Locale) ? (locale as Locale) : "en";
}

export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** ISO date ("2026-09-29") → readable date in the given locale. */
export function formatBookingDate(isoDate: string, locale: Locale, style: "full" | "medium"): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return formatDate(date, locale, { dateStyle: style });
}
