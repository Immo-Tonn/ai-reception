import "server-only";
import { cookies, headers } from "next/headers";
import { isLocale, defaultLocale, LOCALE_COOKIE, type Locale } from "./locales";

/**
 * Next.js-only adapter. Everything else in lib/i18n is plain TypeScript so
 * it can be reused as-is by the future React Native / Expo app (which will
 * read the locale from its own persisted user profile / device settings
 * instead of a cookie + Accept-Language).
 */

export { LOCALE_COOKIE };

/**
 * Detection order (product requirement):
 * saved preference (cookie) → user profile locale (TODO once auth/profiles
 * exist — this is where it plugs in, before the cookie fallback below) →
 * browser language (Accept-Language) → English.
 *
 * Once a person picks a language explicitly, the cookie is set and always
 * wins — auto-detection never overrides a deliberate choice.
 */
export async function getRequestLocale(): Promise<Locale> {
  const store = await cookies();
  const saved = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;

  return detectLocaleFromAcceptLanguage(await headers());
}

function detectLocaleFromAcceptLanguage(headerList: Headers): Locale {
  const acceptLanguage = headerList.get("accept-language");
  if (!acceptLanguage) return defaultLocale;

  const preferred = acceptLanguage
    .split(",")
    .map((entry) => {
      const [tag, qValue] = entry.trim().split(";q=");
      return { tag: tag.toLowerCase(), quality: qValue ? Number(qValue) : 1 };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of preferred) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }

  return defaultLocale;
}
