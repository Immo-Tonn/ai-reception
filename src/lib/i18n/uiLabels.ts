import type { Locale } from "./locales";

/**
 * Tiny labels for shared UI primitives that are used everywhere without a
 * messages prop (e.g. the Sheet close button). Picked from <html lang>.
 */
const CLOSE: Record<Locale, string> = { de: "Schließen", en: "Close", ru: "Закрыть", uk: "Закрити" };

export function closeLabelFor(lang: string | null | undefined): string {
  const key = (lang ?? "").slice(0, 2) as Locale;
  return CLOSE[key] ?? CLOSE.en;
}
